// Merge decoded member bitmaps into counts and a ranked list of meeting options.

/** counts[i] = number of members free in slot i. */
export function tally(n, members) {
  const counts = new Uint16Array(n);
  for (const m of members) for (let i = 0; i < n; i++) counts[i] += m.bits[i] ? 1 : 0;
  return counts;
}

/**
 * Rank meeting options of `lengthSlots` consecutive slots.
 *  - a meeting may only span slots that follow each other with no gap (day ends and DST gaps break it)
 *  - a member counts as available only if free for the WHOLE meeting
 *  - options missing any required member are dropped
 *  - sorted by number available (desc), then earliest start; overlapping options are thinned greedily
 * @returns {{start:number, end:number, startMs:number, endMs:number, available:number[], missing:number[], extendsToMs:number}[]}
 */
export function rankOptions({ slots, slotMs, members, required = new Set(), lengthSlots = 1, limit = 8 }) {
  const n = slots.length;
  const L = Math.max(1, lengthSlots | 0);
  if (!members.length || n < L) return [];

  // runEnd[i]: last index j such that slots i..j are back-to-back.
  const runEnd = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    runEnd[i] = i + 1 < n && slots[i + 1].ms === slots[i].ms + slotMs ? runEnd[i + 1] : i;
  }

  const freeFor = (k, a, b) => { // member k free on slots [a, b)
    const bits = members[k].bits;
    for (let i = a; i < b; i++) if (!bits[i]) return false;
    return true;
  };

  const cands = [];
  for (let i = 0; i + L <= n; i++) {
    if (runEnd[i] < i + L - 1) continue;
    const available = [];
    const missing = [];
    for (let k = 0; k < members.length; k++) (freeFor(k, i, i + L) ? available : missing).push(k);
    if ([...required].some((k) => !available.includes(k))) continue;
    if (!available.length) continue;
    cands.push({ start: i, end: i + L, available, missing });
  }
  cands.sort((a, b) => b.available.length - a.available.length || a.start - b.start);

  const picked = [];
  for (const c of cands) {
    if (picked.some((p) => c.start < p.end && p.start < c.end)) continue;
    picked.push(c);
    if (picked.length >= limit) break;
  }

  return picked.map((c) => {
    // How long the same group stays free after the meeting would end.
    let j = c.end;
    while (j <= runEnd[c.start] && c.available.every((k) => members[k].bits[j])) j++;
    return {
      ...c,
      startMs: slots[c.start].ms,
      endMs: slots[c.end - 1].ms + slotMs,
      extendsToMs: slots[j - 1].ms + slotMs,
    };
  });
}
