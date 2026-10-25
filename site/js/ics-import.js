// Turn a local .ics export into busy intervals for the planning window.
// Runs entirely in the browser: the file is read with FileReader and never sent anywhere.
//
// Parsing and recurrence expansion (RRULE, RDATE, EXDATE, RECURRENCE-ID overrides) are done by
// ical.js (Mozilla, MPL-2.0). This module only decides which occurrences count as "busy" and
// converts their times to instants:
//   - DTSTART/DTEND with a VTIMEZONE in the file  -> that VTIMEZONE (via ical.js)
//   - TZID that is a real IANA zone but has no VTIMEZONE -> the browser's tz database (Intl)
//   - "Z" (UTC) times                             -> UTC
//   - floating times, unknown TZIDs, all-day dates -> the member's own time zone
// Skipped: STATUS:CANCELLED, TRANSP:TRANSPARENT ("show as free"), and all-day events unless
// the member asks to include them.

import ICAL from '../vendor/ical.min.js';
import { isValidTimeZone, offsetMinutes, zonedToUtc } from './tz.js';

const MAX_OCCURRENCES_PER_EVENT = 20000;
const DAY = 864e5;

/** Wall time -> instant; for a wall time inside a DST gap, use the offset from before the gap. */
function wallToMs(y, m, d, h, mi, s, tz) {
  const r = zonedToUtc(y, m, d, h, mi, tz);
  if (r.status !== 'gap') return r.ms + s * 1000;
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  return guess - offsetMinutes(guess - 36 * 3600e3, tz) * 60000;
}

function timeToMs(t, tzidHint, viewerTz, stats) {
  if (t.isDate) return wallToMs(t.year, t.month, t.day, 0, 0, 0, viewerTz);
  const zone = t.zone;
  if (zone === ICAL.Timezone.utcTimezone) return t.toUnixTime() * 1000;
  if (zone && zone !== ICAL.Timezone.localTimezone && zone.component) return t.toUnixTime() * 1000;
  if (tzidHint && isValidTimeZone(tzidHint)) return wallToMs(t.year, t.month, t.day, t.hour, t.minute, t.second, tzidHint);
  if (tzidHint) stats.unknownZones.add(tzidHint);
  else stats.floating++;
  return wallToMs(t.year, t.month, t.day, t.hour, t.minute, t.second, viewerTz);
}

function propTzid(comp, name) {
  const p = comp.getFirstProperty(name);
  return p ? p.getParameter('tzid') || null : null;
}

function isSkipped(comp, stats) {
  const status = String(comp.getFirstPropertyValue('status') || '').toUpperCase();
  if (status === 'CANCELLED') { stats.cancelled++; return true; }
  const transp = String(comp.getFirstPropertyValue('transp') || '').toUpperCase();
  if (transp === 'TRANSPARENT') { stats.transparent++; return true; }
  return false;
}

/**
 * @param {string} text  contents of an .ics file
 * @param {{startMs:number, endMs:number, viewerTz:string, includeAllDay?:boolean}} opts
 * @returns {{intervals: {start:number,end:number,title:string,allDay:boolean}[], stats: object}}
 */
export function importIcs(text, { startMs, endMs, viewerTz, includeAllDay = false }) {
  let jcal;
  try {
    jcal = ICAL.parse(String(text));
  } catch (e) {
    throw new Error('This file could not be read as an iCalendar (.ics) file.');
  }
  const roots = (Array.isArray(jcal) && typeof jcal[0] !== 'string' ? jcal : [jcal]).map((j) => new ICAL.Component(j));
  const cals = roots.flatMap((r) => (r.name === 'vcalendar' ? [r] : r.getAllSubcomponents('vcalendar')));
  if (!cals.length) throw new Error('No calendar found in this file.');

  const stats = {
    events: 0, recurring: 0, occurrences: 0, inWindow: 0, cancelled: 0, transparent: 0,
    allDaySkipped: 0, floating: 0, capped: 0, unknownZones: new Set(),
  };
  const intervals = [];

  const pushOcc = (start, end, item, allDay) => {
    stats.occurrences++;
    if (end <= start) return; // zero-length events (e.g. reminders) do not block time
    if (end <= startMs || start >= endMs) return;
    if (allDay && !includeAllDay) { stats.allDaySkipped++; return; }
    stats.inWindow++;
    intervals.push({ start, end, title: String(item.component.getFirstPropertyValue('summary') || '(no title)'), allDay });
  };

  for (const cal of cals) {
    const vevents = cal.getAllSubcomponents('vevent');
    const masters = new Map();
    const exceptions = new Map();
    for (const ve of vevents) {
      const uid = String(ve.getFirstPropertyValue('uid') || Math.random());
      if (ve.hasProperty('recurrence-id')) {
        if (!exceptions.has(uid)) exceptions.set(uid, []);
        exceptions.get(uid).push(ve);
      } else {
        masters.set(uid, ve);
      }
    }
    // Overrides whose master is not in the file are treated as stand-alone events.
    for (const [uid, list] of exceptions) {
      if (!masters.has(uid)) list.forEach((ve, k) => masters.set(`${uid}#orphan${k}`, ve));
    }

    for (const [uid, ve] of masters) {
      stats.events++;
      const related = (exceptions.get(uid) || []).map((x) => new ICAL.Event(x));
      let ev;
      try {
        ev = new ICAL.Event(ve, { exceptions: related, strictExceptions: true });
      } catch {
        ev = new ICAL.Event(ve, { exceptions: [] });
      }
      if (!ev.startDate) continue;

      const describe = (item, startT, endT) => {
        const startTz = propTzid(item.component, 'dtstart');
        const endTz = propTzid(item.component, 'dtend') || startTz;
        const allDay = startT.isDate;
        const s = timeToMs(startT, startTz, viewerTz, stats);
        let e;
        if (endT) e = timeToMs(endT, endTz, viewerTz, stats);
        else e = allDay ? s + DAY : s;
        return { s, e, allDay };
      };

      if (!ev.isRecurring()) {
        if (isSkipped(ve, stats)) continue;
        const { s, e, allDay } = describe(ev, ev.startDate, ev.endDate);
        pushOcc(s, e, ev, allDay);
        continue;
      }

      stats.recurring++;
      const it = ev.iterator();
      let next, n = 0;
      const masterTz = propTzid(ve, 'dtstart');
      while ((next = it.next())) {
        if (++n > MAX_OCCURRENCES_PER_EVENT) { stats.capped++; break; }
        // Stop a week after the window: overrides can move an occurrence, but not that far in practice.
        const nominal = timeToMs(next, masterTz, viewerTz, stats);
        if (nominal > endMs + 7 * DAY) break;
        if (nominal < startMs - 7 * DAY) continue;
        const det = ev.getOccurrenceDetails(next);
        const item = det.item || ev;
        if (isSkipped(item.component, stats)) continue;
        const { s, e, allDay } = describe(item, det.startDate, det.endDate);
        pushOcc(s, e, item, allDay);
      }
    }
  }

  intervals.sort((a, b) => a.start - b.start);
  return { intervals, stats: { ...stats, unknownZones: [...stats.unknownZones] } };
}

/**
 * Mark slots that overlap any busy interval.
 * Returns { busy: Uint8Array, reason: string[] } (reason = title of the first overlapping event).
 */
export function busySlots(slots, slotMs, intervals) {
  const busy = new Uint8Array(slots.length);
  const reason = new Array(slots.length).fill('');
  let j0 = 0;
  for (const s of slots) {
    const a = s.ms, b = s.ms + slotMs;
    while (j0 < intervals.length && intervals[j0].end <= a - 7 * DAY) j0++;
    for (let j = j0; j < intervals.length && intervals[j].start < b; j++) {
      const iv = intervals[j];
      if (iv.end > a && iv.start < b) {
        busy[s.i] = 1;
        if (!reason[s.i]) reason[s.i] = iv.title;
      }
    }
  }
  return { busy, reason };
}
