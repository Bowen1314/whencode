// Measure share-code and reply-link length for different planning windows.
//   node scripts/measure-codes.mjs
// "Raw" is the size when every slot costs one bit (the encoder's upper bound for any pattern).
// "Demo patterns" uses the five synthetic members from the in-app demo (block-shaped weekly
// availability written in five different time zones); the encoder picks run lengths when shorter.
import { buildSlots, planFingerprint, planToParams } from '../site/js/plan.js';
import { encodeCode } from '../site/js/codec.js';
import { demoMembers } from '../site/js/samples.js';

const BASE = 'https://bowen1314.github.io/whencode/';
const NAME = 'Jordan K'; // 8 characters
const rows = [];
for (const days of [7, 14, 28]) {
  for (const slotMin of [30, 15]) {
    const start = Date.UTC(2026, 10, 23);
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    const plan = { title: 'CS 214 project', start: iso(start), end: iso(start + (days - 1) * 864e5), weekdays: [1, 2, 3, 4, 5, 6, 7], fromMin: 540, toMin: 1260, slotMin, tz: 'America/New_York' };
    const b = buildSlots(plan);
    const fp = planFingerprint(plan);
    let seed = 1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const raw = encodeCode({ fp, name: NAME, bits: b.slots.map(() => (rnd() < 0.5 ? 1 : 0)) }).length;
    const demo = demoMembers(b).map((m) => encodeCode({ fp, name: NAME, bits: m.bits }).length).sort((x, y) => x - y);
    const link = (len) => `${BASE}#${planToParams(plan)}&m=`.length + len;
    rows.push({ days, slotMin, slots: b.slots.length, raw, demoMin: demo[0], demoMax: demo.at(-1), linkRaw: link(raw), linkDemoMax: link(demo.at(-1)) });
  }
}
console.log('| Window (9:00–21:00 daily) | Slots | Code, worst case (chars) | Code, demo patterns (chars) | Reply link, worst case (chars) |');
console.log('|---|---:|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.days} days, ${r.slotMin}-min slots | ${r.slots} | ${r.raw} | ${r.demoMin}–${r.demoMax} | ${r.linkRaw} |`);
