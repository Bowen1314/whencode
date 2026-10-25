import { buildSlots, planFingerprint, planToParams } from '../../site/js/plan.js';

export const BASE = process.env.BASE_URL || 'http://127.0.0.1:8766/whencode/';
export const ORIGIN = new URL(BASE).origin;

// Contains the EU fall-back (Oct 25) and the US fall-back (Nov 1).
export const PLAN = { title: 'CS 214 project', start: '2026-10-24', end: '2026-11-08', weekdays: [1, 2, 3, 4, 5, 6, 7], fromMin: 540, toMin: 1260, slotMin: 30, tz: 'America/New_York' };
export const BUILT = buildSlots(PLAN);
export const FP = planFingerprint(PLAN);
export const planHash = (extra = '') => planToParams(PLAN).toString() + extra;
export const slotAt = (iso) => {
  const s = BUILT.slots.find((x) => x.ms === Date.parse(iso));
  if (!s) throw new Error(`no slot at ${iso}`);
  return s;
};
export const cell = (page, i, grid = '#fill-grid') => page.locator(`${grid} .cell[data-i="${i}"]`);
/** Click "Later" until the page containing slot s is shown (7 days per page). */
export async function showPageOf(page, s, grid = '#fill-grid') {
  const target = Math.floor(s.day / 7);
  for (let k = 0; k < target; k++) await page.locator(`${grid} .pager button`, { hasText: 'Later' }).click();
}
