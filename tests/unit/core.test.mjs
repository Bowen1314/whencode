import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { zonedToUtc, offsetMinutes, wallParts } from '../../site/js/tz.js';
import { buildSlots, planFingerprint, planFromParams, planToParams, validatePlan } from '../../site/js/plan.js';
import { encodeCode, decodeCode, findCodes, cleanName, CodeError } from '../../site/js/codec.js';
import { importIcs, busySlots } from '../../site/js/ics-import.js';
import { rankOptions, tally } from '../../site/js/merge.js';
import { buildInvite, foldLine } from '../../site/js/ics-export.js';
import ICAL from '../../site/vendor/ical.min.js';

const Z = (s) => Date.parse(s); // ISO string with Z -> ms
const fixture = (f) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8');

// Planning window used across tests: it contains the EU fall-back (Oct 25) AND the US fall-back (Nov 1).
const PLAN = { title: 'CS 214 project', start: '2026-10-24', end: '2026-11-08', weekdays: [1, 2, 3, 4, 5, 6, 7], fromMin: 9 * 60, toMin: 21 * 60, slotMin: 30, tz: 'America/New_York' };

test('zonedToUtc: normal, DST gap and DST overlap in New York', () => {
  assert.deepEqual(zonedToUtc(2026, 10, 24, 9, 0, 'America/New_York'), { ms: Z('2026-10-24T13:00:00Z'), status: 'ok' });
  assert.deepEqual(zonedToUtc(2026, 11, 2, 9, 0, 'America/New_York'), { ms: Z('2026-11-02T14:00:00Z'), status: 'ok' });
  assert.deepEqual(zonedToUtc(2026, 3, 8, 2, 30, 'America/New_York'), { ms: null, status: 'gap' });
  // 01:30 happens twice on 2026-11-01; we take the first (EDT) one.
  assert.deepEqual(zonedToUtc(2026, 11, 1, 1, 30, 'America/New_York'), { ms: Z('2026-11-01T05:30:00Z'), status: 'ambiguous' });
  assert.equal(zonedToUtc(2026, 10, 24, 18, 30, 'Asia/Kolkata').ms, Z('2026-10-24T13:00:00Z'));
  assert.equal(offsetMinutes(Z('2026-10-24T13:00:00Z'), 'Asia/Kathmandu'), 345);
});

test('buildSlots: 16 days x 24 slots, hard-coded instants across the US fall-back', () => {
  const { slots, days, rows } = buildSlots(PLAN);
  assert.equal(days.length, 16);
  assert.equal(rows, 24);
  assert.equal(slots.length, 384);
  assert.equal(slots[0].ms, Z('2026-10-24T13:00:00Z'));
  const firstOf = (key) => slots.find((s) => days[s.day].key === key).ms;
  assert.equal(firstOf('2026-10-31'), Z('2026-10-31T13:00:00Z')); // still EDT
  assert.equal(firstOf('2026-11-01'), Z('2026-11-01T14:00:00Z')); // EST from 02:00 that morning
  assert.equal(slots.at(-1).ms, Z('2026-11-09T01:30:00Z')); // Nov 8 20:30 EST
});

test('members in other zones: same instants, different local labels (three offsets in one window)', () => {
  const { slots, days } = buildSlots(PLAN);
  const nineAm = (key) => slots.find((s) => days[s.day].key === key && s.row === 0).ms;
  const london = (ms) => wallParts(ms, 'Europe/London');
  assert.equal(london(nineAm('2026-10-24')).h, 14); // EDT vs BST: 5 h
  assert.equal(london(nineAm('2026-10-30')).h, 13); // EDT vs GMT: 4 h (EU changed Oct 25, US not yet)
  assert.equal(london(nineAm('2026-11-02')).h, 14); // EST vs GMT: 5 h
  const kol = wallParts(nineAm('2026-10-24'), 'Asia/Kolkata');
  assert.deepEqual([kol.h, kol.mi], [18, 30]);
  const kol2 = wallParts(nineAm('2026-11-02'), 'Asia/Kolkata');
  assert.deepEqual([kol2.d, kol2.h, kol2.mi], [2, 19, 30]);
});

test('buildSlots: DST days inside the daily hours (gap skipped, repeated hour once)', () => {
  const spring = buildSlots({ ...PLAN, start: '2026-03-08', end: '2026-03-08', fromMin: 0, toMin: 240 });
  assert.equal(spring.slots.length, 6); // 02:00 and 02:30 do not exist
  assert.equal(spring.slots[4].ms, Z('2026-03-08T07:00:00Z')); // 03:00 EDT
  assert.equal(spring.slots[3].ms + 30 * 60000, spring.slots[4].ms); // 01:30 EST -> 03:00 EDT is back-to-back
  const fall = buildSlots({ ...PLAN, start: '2026-11-01', end: '2026-11-01', fromMin: 0, toMin: 240 });
  assert.equal(fall.slots.length, 8);
  assert.ok(fall.slots[2].ambiguous && fall.slots[3].ambiguous);
  assert.equal(fall.slots[4].ms - fall.slots[3].ms, 90 * 60000); // second 01:00-02:00 hour is not offered
});

test('plan params round-trip and validation', () => {
  const q = planToParams({ ...PLAN, weekdays: [1, 2, 3, 4, 5], fromMin: 9 * 60 + 30 });
  assert.equal(q.get('wd'), '12345');
  assert.equal(q.get('h'), '9:30-21');
  const { plan, errors } = planFromParams(new URLSearchParams(q.toString()));
  assert.deepEqual(errors, []);
  assert.equal(planFingerprint(plan), planFingerprint({ ...PLAN, weekdays: [1, 2, 3, 4, 5], fromMin: 570, title: 'other title' }));
  assert.ok(validatePlan({ ...PLAN, tz: 'Not/AZone' }).includes('Unknown time zone.'));
  assert.ok(validatePlan({ ...PLAN, toMin: 8 * 60 }).length > 0);
  assert.notEqual(planFingerprint(PLAN), planFingerprint({ ...PLAN, tz: 'America/Chicago' }));
});

test('codec: round trip for raw and run-length payloads, unicode names', () => {
  const fp = planFingerprint(PLAN);
  const n = 384;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const noisy = Array.from({ length: n }, () => (rnd() < 0.5 ? 1 : 0));
  const blocky = Array.from({ length: n }, (_, i) => (i % 24 >= 8 && i % 24 < 14 ? 1 : 0));
  for (const bits of [noisy, blocky, new Array(n).fill(0), new Array(n).fill(1)]) {
    const code = encodeCode({ fp, name: 'Zoë 李', bits });
    const d = decodeCode(code, { fp, n });
    assert.equal(d.name, 'Zoë 李');
    assert.deepEqual([...d.bits], bits);
    assert.equal(d.layout.total, d.bytes.length);
  }
  const blockyCode = decodeCode(encodeCode({ fp, name: 'A', bits: blocky }), { fp, n });
  assert.equal(blockyCode.enc, 1); // runs are shorter for block-shaped availability
  assert.equal(decodeCode(encodeCode({ fp, name: 'A', bits: noisy }), { fp, n }).enc, 0);
});

test('codec: damaged, truncated and wrong-window codes are rejected loudly', () => {
  const fp = planFingerprint(PLAN);
  const bits = Array.from({ length: 384 }, (_, i) => i % 3 === 0 ? 1 : 0);
  const code = encodeCode({ fp, name: 'Ana', bits });
  assert.throws(() => decodeCode(code.slice(0, -3), { fp, n: 384 }), (e) => e instanceof CodeError && e.kind === 'damaged');
  const flipped = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
  assert.throws(() => decodeCode(flipped, { fp, n: 384 }), (e) => e.kind === 'damaged');
  assert.throws(() => decodeCode(code, { fp: fp ^ 1, n: 384 }), (e) => e.kind === 'other-plan');
  assert.throws(() => decodeCode('hello', { fp, n: 384 }), (e) => e.kind === 'format');
  assert.equal(cleanName('  a\u0007b   c  '), 'ab c');
  assert.equal([...cleanName('x'.repeat(40))].length, 24);
});

test('findCodes pulls codes out of a pasted chat log and links', () => {
  const fp = planFingerprint(PLAN);
  const a = encodeCode({ fp, name: 'A', bits: new Array(384).fill(1) });
  const b = encodeCode({ fp, name: 'B', bits: new Array(384).fill(0) });
  const chat = `[10:01] Ana: here ${a}\n[10:05] Bo: https://example.org/whencode/#d=2026-10-24~2026-11-08&m=${b} thx\n[10:06] Ana: ${a}`;
  assert.deepEqual(findCodes(chat), [a, b]);
});

const WINDOW = (() => {
  const { slots } = buildSlots(PLAN);
  return { startMs: slots[0].ms, endMs: slots.at(-1).ms + 30 * 60000 };
})();

test('ics import: RRULE + EXDATE + RECURRENCE-ID + VTIMEZONE across the US DST change', () => {
  const { intervals, stats } = importIcs(fixture('student-ny.ics'), { ...WINDOW, viewerTz: 'America/New_York' });
  const of = (title) => intervals.filter((i) => i.title.startsWith(title)).map((i) => [new Date(i.start).toISOString(), new Date(i.end).toISOString()]);
  assert.deepEqual(of('CS 214 Lecture'), [
    ['2026-10-27T14:20:00.000Z', '2026-10-27T15:40:00.000Z'], // Tue, EDT
    // Thu Oct 29 removed by EXDATE
    ['2026-11-03T19:00:00.000Z', '2026-11-03T20:20:00.000Z'], // Tue override: moved to 14:00 EST
    ['2026-11-05T15:20:00.000Z', '2026-11-05T16:40:00.000Z'], // Thu, EST
  ]);
  assert.deepEqual(of('Library desk shift'), [
    ['2026-10-24T16:00:00.000Z', '2026-10-24T20:00:00.000Z'],
    ['2026-10-31T16:00:00.000Z', '2026-10-31T20:00:00.000Z'],
    ['2026-11-07T17:00:00.000Z', '2026-11-07T21:00:00.000Z'],
  ]);
  const gym = of('Morning gym');
  assert.ok(gym.some(([s]) => s === '2026-10-30T11:00:00.000Z'));
  assert.ok(gym.some(([s]) => s === '2026-11-02T12:00:00.000Z'));
  assert.equal(stats.transparent, 1);
  assert.equal(stats.cancelled, 1);
  assert.equal(stats.allDaySkipped, 1);
  assert.equal(stats.capped, 0);
  assert.equal(of('Reading').length + of('Club').length + of("Mom's").length, 0);
});

test('ics import: all-day events optional; TZID without VTIMEZONE; UTC; floating; unknown zone', () => {
  const ny = importIcs(fixture('student-ny.ics'), { ...WINDOW, viewerTz: 'America/New_York', includeAllDay: true });
  const bday = ny.intervals.find((i) => i.allDay);
  assert.equal(new Date(bday.start).toISOString(), '2026-10-30T04:00:00.000Z');
  assert.equal(bday.end - bday.start, 864e5);

  const { intervals, stats } = importIcs(fixture('london-mixed.ics'), { ...WINDOW, viewerTz: 'Asia/Kolkata' });
  const iso = (t) => intervals.filter((i) => i.title === t).map((i) => new Date(i.start).toISOString());
  assert.deepEqual(iso('Seminar'), ['2026-10-26T13:00:00.000Z', '2026-11-02T13:00:00.000Z']); // 13:00 GMT via Intl
  assert.deepEqual(iso('Call (UTC)'), ['2026-10-27T09:00:00.000Z']);
  assert.deepEqual(iso('Floating study block'), ['2026-10-28T03:30:00.000Z']); // 09:00 in the member's zone
  assert.deepEqual(iso('Unknown zone name'), ['2026-10-29T04:30:00.000Z']);
  assert.deepEqual(stats.unknownZones, ['Mars Standard Time']);
});

test('busySlots marks every slot that overlaps an event', () => {
  const { slots, slotMs } = buildSlots(PLAN);
  const { intervals } = importIcs(fixture('student-ny.ics'), { ...WINDOW, viewerTz: 'America/New_York' });
  const { busy, reason } = busySlots(slots, slotMs, intervals);
  const at = (iso) => slots.find((s) => s.ms === Z(iso)).i;
  // Lecture Tue Oct 27 10:20-11:40 EDT -> slots 10:00, 10:30, 11:00, 11:30 are busy; 9:30 and 12:00 are not.
  assert.equal(busy[at('2026-10-27T13:30:00Z')], 0);
  for (const t of ['14:00', '14:30', '15:00', '15:30']) assert.equal(busy[at(`2026-10-27T${t}:00Z`)], 1);
  assert.equal(busy[at('2026-10-27T16:00:00Z')], 0); // 12:00 EDT: the "show as free" event does not count
  assert.equal(reason[at('2026-10-27T14:30:00Z')], 'CS 214 Lecture');
  assert.equal(busy[at('2026-10-29T14:30:00Z')], 0); // EXDATE: free
});

test('rankOptions: whole-meeting availability, required members, no meetings across gaps', () => {
  const slots = [0, 1, 2, 3, 5, 6].map((k, i) => ({ i, ms: k * 1800e3 })); // gap between index 3 and 4
  const members = [
    { name: 'A', bits: [1, 1, 1, 1, 1, 1] },
    { name: 'B', bits: [0, 1, 1, 0, 1, 1] },
    { name: 'C', bits: [1, 1, 0, 0, 1, 1] },
  ];
  assert.deepEqual([...tally(6, members)], [2, 3, 2, 1, 3, 3]);
  const two = rankOptions({ slots, slotMs: 1800e3, members, lengthSlots: 2 });
  assert.equal(two[0].start, 4); // 5-6 everyone; 3->4 would cross the gap
  assert.deepEqual(two[0].available, [0, 1, 2]);
  assert.ok(two.every((o) => !(o.start === 3)));
  const reqC = rankOptions({ slots, slotMs: 1800e3, members, lengthSlots: 1, required: new Set([2]) });
  assert.ok(reqC.every((o) => o.available.includes(2)));
  const one = rankOptions({ slots, slotMs: 1800e3, members, lengthSlots: 1, limit: 3 });
  assert.equal(one[0].start, 1);
  assert.equal(one[0].extendsToMs, 2 * 1800e3); // A,B,C all free only in slot 1
});

test('invite .ics: UTC times, escaping, folding, and it parses back with ical.js', () => {
  const text = buildInvite({
    title: 'CS 214; group, meeting', startMs: Z('2026-11-03T19:00:00Z'), endMs: Z('2026-11-03T20:00:00Z'),
    available: ['Ana', 'Bo', 'Chen'.repeat(20)], missing: ['Dee'], nowMs: Z('2026-10-24T00:00:00Z'),
  });
  for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const ev = new ICAL.Event(new ICAL.Component(ICAL.parse(text)).getFirstSubcomponent('vevent'));
  assert.equal(ev.summary, 'CS 214; group, meeting');
  assert.equal(ev.startDate.toUnixTime() * 1000, Z('2026-11-03T19:00:00Z'));
  assert.equal(ev.endDate.toUnixTime() * 1000, Z('2026-11-03T20:00:00Z'));
  assert.match(ev.description, /Can't make it: Dee/);
  assert.equal(foldLine('x'.repeat(80)).split('\r\n')[1], ' ' + 'x'.repeat(5));
});
