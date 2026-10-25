// The planning window ("plan") chosen by the organiser and carried in the starter link.
//
// A plan is: date range (inclusive), allowed weekdays, daily hours, slot length and ONE
// time zone (the organiser's). Slots are generated per calendar day as wall-clock times in
// that zone and turned into absolute instants. Every member's bitmap indexes this same
// ordered list of instants, so members in other zones only change how slots are LABELLED.
//
// DST policy (documented in the README):
//  - a wall time that does not exist (clocks spring forward) produces no slot;
//  - a wall time that happens twice (clocks fall back) produces one slot, at its first occurrence.

import { isValidTimeZone, zonedToUtc } from './tz.js';

export const LIMITS = { maxDays: 31, maxRangeDays: 62, maxSlots: 2016, titleMax: 60 };
export const SLOT_CHOICES = [15, 20, 30, 60];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(s) {
  const m = DATE_RE.exec(s || '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { y, m: mo, d, t };
}

export function formatDate(t) {
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

/** ISO weekday 1 (Mon) .. 7 (Sun) of a calendar date. */
export function isoWeekday(t) {
  const w = new Date(t).getUTCDay();
  return w === 0 ? 7 : w;
}

function minToHm(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}:${String(m).padStart(2, '0')}` : `${h}`;
}

function hmToMin(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s || '');
  if (!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0;
  if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) return null;
  return h * 60 + mi;
}

/** Check a plan object. Returns a list of human-readable problems (empty = valid). */
export function validatePlan(p) {
  const errs = [];
  const a = parseDate(p.start), b = parseDate(p.end);
  if (!a) errs.push('Start date is missing or invalid.');
  if (!b) errs.push('End date is missing or invalid.');
  if (a && b && b.t < a.t) errs.push('End date is before start date.');
  if (a && b && (b.t - a.t) / 864e5 + 1 > LIMITS.maxRangeDays) errs.push(`Date range is longer than ${LIMITS.maxRangeDays} days.`);
  if (!Array.isArray(p.weekdays) || p.weekdays.length === 0) errs.push('Pick at least one weekday.');
  if (!SLOT_CHOICES.includes(p.slotMin)) errs.push('Slot length must be 15, 20, 30 or 60 minutes.');
  if (!(Number.isInteger(p.fromMin) && Number.isInteger(p.toMin)) || p.fromMin < 0 || p.toMin > 1440 || p.toMin <= p.fromMin) {
    errs.push('Daily end time must be after the start time.');
  } else if (SLOT_CHOICES.includes(p.slotMin) && (p.toMin - p.fromMin) < p.slotMin) {
    errs.push('Daily hours are shorter than one slot.');
  }
  if (!isValidTimeZone(p.tz)) errs.push('Unknown time zone.');
  if ((p.title || '').length > LIMITS.titleMax) errs.push(`Title is longer than ${LIMITS.titleMax} characters.`);
  if (!errs.length) {
    const days = planDays(p);
    if (days.length === 0) errs.push('No days in the range match the chosen weekdays.');
    if (days.length > LIMITS.maxDays) errs.push(`More than ${LIMITS.maxDays} days selected.`);
    const perDay = Math.floor((p.toMin - p.fromMin) / p.slotMin);
    if (days.length * perDay > LIMITS.maxSlots) errs.push(`Too many slots (${days.length * perDay}); the limit is ${LIMITS.maxSlots}. Use longer slots or fewer days.`);
  }
  return errs;
}

export function planDays(p) {
  const a = parseDate(p.start), b = parseDate(p.end);
  const out = [];
  if (!a || !b) return out;
  for (let t = a.t; t <= b.t; t += 864e5) {
    if (p.weekdays.includes(isoWeekday(t))) {
      const x = new Date(t);
      out.push({ key: formatDate(t), y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() });
    }
    if (out.length > LIMITS.maxDays + 1) break;
  }
  return out;
}

/**
 * Generate the slot list.
 * Returns { days, rows, slots, slotMs } where
 *   rows  = number of wall-clock rows per day (some cells may be missing on DST days)
 *   slots = [{ i, day, row, ms, ambiguous }] in chronological order (bitmap order).
 */
export function buildSlots(p) {
  const days = planDays(p);
  const rows = Math.floor((p.toMin - p.fromMin) / p.slotMin);
  const slots = [];
  days.forEach((day, di) => {
    for (let r = 0; r < rows; r++) {
      const min = p.fromMin + r * p.slotMin;
      const { ms, status } = zonedToUtc(day.y, day.m, day.d, Math.floor(min / 60), min % 60, p.tz);
      if (status === 'gap') continue;
      // Guard: with the first-occurrence rule an instant can never repeat, but keep order strict.
      if (slots.length && ms <= slots[slots.length - 1].ms) continue;
      slots.push({ i: slots.length, day: di, row: r, ms, ambiguous: status === 'ambiguous' });
    }
  });
  return { days, rows, slots, slotMs: p.slotMin * 60000 };
}

/** Canonical string of the parts of a plan that define the slot list (title excluded). */
export function planCanonical(p) {
  return [p.start, p.end, [...p.weekdays].sort().join(''), p.fromMin, p.toMin, p.slotMin, p.tz].join('|');
}

/** 16-bit fingerprint of a plan (FNV-1a 32 folded), embedded in every code. */
export function planFingerprint(p) {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(planCanonical(p))) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ((h >>> 16) ^ (h & 0xffff)) & 0xffff;
}

/** Serialize a plan to URL-fragment parameters (readable on purpose). */
export function planToParams(p) {
  const q = new URLSearchParams();
  if (p.title) q.set('t', p.title);
  q.set('d', `${p.start}~${p.end}`);
  const wd = [...p.weekdays].sort().join('');
  if (wd !== '1234567') q.set('wd', wd);
  q.set('h', `${minToHm(p.fromMin)}-${minToHm(p.toMin)}`);
  q.set('s', String(p.slotMin));
  q.set('z', p.tz);
  return q;
}

/** Parse a plan from URLSearchParams. Returns {plan, errors}. plan is null if absent. */
export function planFromParams(q) {
  if (!q.has('d')) return { plan: null, errors: [] };
  const [start, end] = (q.get('d') || '').split('~');
  const wd = q.get('wd') || '1234567';
  const weekdays = [...new Set(wd.split('').map(Number).filter((n) => n >= 1 && n <= 7))];
  const [hf, ht] = (q.get('h') || '9-17').split('-');
  const plan = {
    title: (q.get('t') || '').slice(0, LIMITS.titleMax),
    start, end: end || start, weekdays,
    fromMin: hmToMin(hf), toMin: hmToMin(ht),
    slotMin: Number(q.get('s') || 30),
    tz: q.get('z') || 'UTC',
  };
  const errors = validatePlan(plan);
  return { plan: errors.length ? null : plan, errors };
}

/** Indices of slots that start right after slot i (no gap), used for multi-slot meetings. */
export function isContiguous(slots, i, slotMs) {
  return i + 1 < slots.length && slots[i + 1].ms === slots[i].ms + slotMs;
}
