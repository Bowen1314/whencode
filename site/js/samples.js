// Synthetic sample data for trying WhenCode without real calendars. Nothing here is real data.

import { parseDate, formatDate, isoWeekday } from './plan.js';
import { wallParts } from './tz.js';

const pad = (n) => String(n).padStart(2, '0');
const icsLocal = (t, hm) => formatDate(t).replace(/-/g, '') + 'T' + hm.replace(':', '') + '00';
const icsDay = (t) => formatDate(t).replace(/-/g, '');

/** Most recent date on or before t whose ISO weekday is wd. */
function onOrBefore(t, wd) {
  while (isoWeekday(t) !== wd) t -= 864e5;
  return t;
}
function onOrAfter(t, wd) {
  while (isoWeekday(t) !== wd) t += 864e5;
  return t;
}

/**
 * A sample student calendar positioned around the plan's dates, in the plan's time zone.
 * It exercises: weekly RRULE, EXDATE, a moved occurrence (RECURRENCE-ID), a weekday rule,
 * a "show as free" event and an all-day event.
 */
export function sampleIcs(plan) {
  const start = parseDate(plan.start).t;
  const tz = plan.tz;
  const tue0 = onOrBefore(start - 21 * 864e5, 2);
  const firstTue = onOrAfter(start, 2);
  const firstThu = onOrAfter(start, 4);
  const sat0 = onOrBefore(start - 7 * 864e5, 6);
  const mon0 = onOrBefore(start - 7 * 864e5, 1);
  const fri = onOrAfter(start, 5);
  const allDay = onOrAfter(start + 864e5, 3);
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WhenCode//Synthetic sample calendar//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', 'UID:sample-lecture@whencode', 'DTSTAMP:20260101T000000Z', 'SUMMARY:CS 214 Lecture',
    `DTSTART;TZID=${tz}:${icsLocal(tue0, '10:20')}`, `DTEND;TZID=${tz}:${icsLocal(tue0, '11:40')}`,
    'RRULE:FREQ=WEEKLY;BYDAY=TU,TH',
    `EXDATE;TZID=${tz}:${icsLocal(firstThu, '10:20')}`,
    'END:VEVENT',
    'BEGIN:VEVENT', 'UID:sample-lecture@whencode', 'DTSTAMP:20260101T000000Z', 'SUMMARY:CS 214 Lecture (moved)',
    `RECURRENCE-ID;TZID=${tz}:${icsLocal(firstTue, '10:20')}`,
    `DTSTART;TZID=${tz}:${icsLocal(firstTue, '15:00')}`, `DTEND;TZID=${tz}:${icsLocal(firstTue, '16:20')}`,
    'END:VEVENT',
    'BEGIN:VEVENT', 'UID:sample-shift@whencode', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Library desk shift',
    `DTSTART;TZID=${tz}:${icsLocal(sat0, '12:00')}`, `DTEND;TZID=${tz}:${icsLocal(sat0, '16:00')}`,
    'RRULE:FREQ=WEEKLY;BYDAY=SA', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:sample-commute@whencode', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Commute and dinner',
    `DTSTART;TZID=${tz}:${icsLocal(mon0, '17:30')}`, `DTEND;TZID=${tz}:${icsLocal(mon0, '19:00')}`,
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:sample-lab@whencode', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Chem lab',
    `DTSTART;TZID=${tz}:${icsLocal(mon0 + 2 * 864e5, '13:00')}`, `DTEND;TZID=${tz}:${icsLocal(mon0 + 2 * 864e5, '16:00')}`,
    'RRULE:FREQ=WEEKLY;BYDAY=WE', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:sample-free@whencode', 'DTSTAMP:20260101T000000Z', 'SUMMARY:Reading time (shown as free)',
    'TRANSP:TRANSPARENT',
    `DTSTART;TZID=${tz}:${icsLocal(fri, '10:00')}`, `DTEND;TZID=${tz}:${icsLocal(fri, '12:00')}`, 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:sample-allday@whencode', 'DTSTAMP:20260101T000000Z', "SUMMARY:Roommate's birthday",
    `DTSTART;VALUE=DATE:${icsDay(allDay)}`, `DTEND;VALUE=DATE:${icsDay(allDay + 864e5)}`, 'END:VEVENT',
    'END:VCALENDAR',
  ];
  return L.join('\r\n') + '\r\n';
}

/** The demo planning window: two working weeks starting next Monday, 9:00-21:00 New York time. */
export function demoPlan(now = Date.now()) {
  const p = wallParts(now, 'America/New_York');
  let t = Date.UTC(p.y, p.m - 1, p.d) + 864e5;
  t = onOrAfter(t, 1);
  return {
    title: 'Demo: CS 214 group project',
    start: formatDate(t), end: formatDate(t + 11 * 864e5), weekdays: [1, 2, 3, 4, 5],
    fromMin: 9 * 60, toMin: 21 * 60, slotMin: 30, tz: 'America/New_York',
  };
}

// Five synthetic members. Each pattern is written in that member's OWN local time, so the demo
// also shows the time-zone conversion. (The codes themselves never contain a time zone.)
const DEMO_MEMBERS = [
  { name: 'Ana', tz: 'America/New_York', free: (wd, m) => wd <= 5 && ((m >= 720 && m < 1020 && wd !== 3) || (m >= 1140 && m < 1260)) },
  { name: 'Bo', tz: 'Europe/London', free: (wd, m) => (wd <= 5 ? m >= 1020 && m < 1380 : m >= 600 && m < 1320) },
  { name: 'Chen', tz: 'Asia/Kolkata', free: (wd, m) => m >= 1080 && m < 1410 && wd !== 6 },
  { name: 'Dee', tz: 'America/Chicago', free: (wd, m) => (wd === 2 || wd === 4) && m >= 660 && m < 960 },
  { name: 'Eli', tz: 'America/Los_Angeles', free: (wd, m) => wd <= 5 && m >= 540 && m < 840 && !(wd === 1 && m < 660) },
];

export function demoMembers(built) {
  return DEMO_MEMBERS.map((d) => ({
    name: d.name,
    bits: built.slots.map((s) => {
      const w = wallParts(s.ms, d.tz);
      const wd = isoWeekday(Date.UTC(w.y, w.m - 1, w.d));
      return d.free(wd, w.h * 60 + w.mi) ? 1 : 0;
    }),
  }));
}

