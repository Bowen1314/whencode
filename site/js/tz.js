// Time zone helpers built only on the browser's Intl API (no tz database shipped).
// All instants are milliseconds since the Unix epoch (UTC).

const fmtCache = new Map();

function partsFormatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in a zone: {y, m (1-12), d, h, mi, s}. */
export function wallParts(ms, tz) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour === 24 ? 0 : out.hour, mi: out.minute, s: out.second };
}

/** UTC offset of a zone at an instant, in minutes (e.g. -240 for EDT). */
export function offsetMinutes(ms, tz) {
  const p = wallParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  const whole = Math.floor(ms / 1000) * 1000;
  return Math.round((asUtc - whole) / 60000);
}

/**
 * Convert a wall-clock time in `tz` to an instant.
 * Returns {ms, status} where status is:
 *  - 'ok'         exactly one instant has this wall time
 *  - 'ambiguous'  the wall time happens twice (clocks fall back); ms is the FIRST occurrence
 *  - 'gap'        the wall time never happens (clocks spring forward); ms is null
 */
export function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offsets = new Set([
    offsetMinutes(guess - 36 * 3600e3, tz),
    offsetMinutes(guess, tz),
    offsetMinutes(guess + 36 * 3600e3, tz),
  ]);
  const hits = [];
  for (const off of offsets) {
    const t = guess - off * 60000;
    const p = wallParts(t, tz);
    if (p.y === y && p.m === m && p.d === d && p.h === h && p.mi === mi && !hits.includes(t)) hits.push(t);
  }
  hits.sort((a, b) => a - b);
  if (hits.length === 0) return { ms: null, status: 'gap' };
  return { ms: hits[0], status: hits.length > 1 ? 'ambiguous' : 'ok' };
}

export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function allTimeZones() {
  let list = [];
  try {
    list = Intl.supportedValuesOf('timeZone');
  } catch {
    list = ['UTC'];
  }
  // Some ICU builds (e.g. Chromium) list only legacy names; add the current ones the browser accepts.
  const modern = ['Asia/Kolkata', 'Europe/Kyiv', 'Asia/Ho_Chi_Minh', 'Asia/Kathmandu', 'Asia/Yangon', 'America/Nuuk', 'Pacific/Kanton'];
  const extra = modern.filter((z) => !list.includes(z) && isValidTimeZone(z));
  list = [...new Set(['UTC', ...list, ...extra])].sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)));
  return list;
}

const labelCache = new Map();
function fmt(tz, opts) {
  const key = tz + JSON.stringify(opts);
  let f = labelCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts });
    labelCache.set(key, f);
  }
  return f;
}

export const fmtTime = (ms, tz) => fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(ms);
export const fmtDay = (ms, tz) => fmt(tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
export const fmtDayLong = (ms, tz) => fmt(tz, { weekday: 'long', day: 'numeric', month: 'long' }).format(ms);
export const fmtWeekday = (ms, tz) => fmt(tz, { weekday: 'short' }).format(ms);
export const fmtDayNum = (ms, tz) => fmt(tz, { day: 'numeric', month: 'short' }).format(ms);

/** "UTC−4" style label of a zone's offset at an instant. */
export function offsetLabel(ms, tz) {
  const off = offsetMinutes(ms, tz);
  const sign = off < 0 ? '−' : '+';
  const a = Math.abs(off);
  const hh = Math.floor(a / 60);
  const mm = a % 60;
  return `UTC${sign}${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}`;
}

/** Calendar-date key (YYYY-MM-DD) of an instant as seen in a zone. */
export function dateKey(ms, tz) {
  const p = wallParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
