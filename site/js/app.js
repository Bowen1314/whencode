// WhenCode page controller. Three views, chosen by the URL fragment (never sent to a server):
//   #d=...&h=...            -> member view (add your availability)
//   #d=...&v=merge&m=...    -> merge view (organiser); a reply link (#d=...&m=CODE) opens here too
//   (no plan)               -> setup view (create a starter link)

import { allTimeZones, fmtDay, fmtTime, localTimeZone } from './tz.js';
import { buildSlots, formatDate, LIMITS, parseDate, planFingerprint, planFromParams, planToParams, validatePlan } from './plan.js';
import { decodeCode, encodeCode, findCodes, cleanName, toBase64Url, fromBase64Url, NAME_MAX } from './codec.js';
import { busySlots, importIcs } from './ics-import.js';
import { rankOptions, tally } from './merge.js';
import { buildInvite } from './ics-export.js';
import { Grid } from './grid.js';
import { qrSvg } from './qr.js';
import { demoMembers, demoPlan, sampleIcs } from './samples.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, text) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : v);
  }
  if (text != null) e.textContent = text;
  return e;
};

const state = {
  plan: null, built: null, fp: 0, viewerTz: localTimeZone(),
  fill: null, merge: null, grids: {},
};

// ---------- small utilities ----------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function baseUrl() {
  return location.origin + location.pathname;
}

function planLink(extra = {}) {
  const q = planToParams(state.plan);
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x)); else if (v != null) q.set(k, v);
  }
  return `${baseUrl()}#${q.toString()}`;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  toast('Copied to clipboard');
}

document.addEventListener('click', (e) => {
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    const src = document.getElementById(copyBtn.dataset.copy);
    if (src) copyText(src.value);
  }
  const qrBtn = e.target.closest('[data-qr]');
  if (qrBtn) {
    const box = $(`[data-qr-box="${qrBtn.dataset.qr}"]`);
    box.hidden = !box.hidden;
    qrBtn.textContent = box.hidden ? 'Show QR code' : 'Hide QR code';
    renderQr(qrBtn.dataset.qr);
  }
  const a = e.target.closest('a[href^="#"]');
  if (a && !a.getAttribute('href').includes('=')) {
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (target) {
      e.preventDefault();
      target.setAttribute('tabindex', '-1');
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
    }
  }
});

function renderQr(id) {
  const box = $(`[data-qr-box="${id}"]`);
  if (!box || box.hidden) return;
  box.textContent = '';
  const value = document.getElementById(id).value;
  try {
    box.append(qrSvg(value, 'QR code of the link above'));
    box.append(el('p', { class: 'small' }, `Scan to open this link on a phone. ${value.length} characters.`));
  } catch {
    box.append(el('p', { class: 'small' }, 'This link is too long for a QR code.'));
  }
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function showView(name) {
  for (const v of ['setup', 'fill', 'merge']) $(`#view-${v}`).hidden = v !== name;
  document.body.dataset.view = name;
}

function packBits(bits) {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((v, i) => { if (v) out[i >> 3] |= 0x80 >> (i & 7); });
  return toBase64Url(out);
}
function unpackBits(s, n) {
  const bits = new Uint8Array(n);
  try {
    const b = fromBase64Url(s);
    if (b.length !== Math.ceil(n / 8)) return null;
    for (let i = 0; i < n; i++) bits[i] = (b[i >> 3] >> (7 - (i & 7))) & 1;
    return bits;
  } catch { return null; }
}

function rangeText(startMs, endMs, tz) {
  return `${fmtDay(startMs, tz)}, ${fmtTime(startMs, tz)} – ${fmtTime(endMs, tz)}`;
}

function minutesText(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---------- plan bar (shared by member and merge views) ----------
function renderPlanBars() {
  const p = state.plan, b = state.built;
  for (const bar of $$('[data-planbar]')) {
    bar.textContent = '';
    const first = b.slots[0].ms, last = b.slots[b.slots.length - 1].ms;
    const h = el('div', { class: 'planinfo' });
    h.append(el('p', { class: 'plantitle' }, p.title || 'Group meeting'));
    const wd = p.weekdays.length === 7 ? 'every day' : p.weekdays.map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1]).join(', ');
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    h.append(el('p', { class: 'planmeta' }, `${fmtDay(first, p.tz)} – ${fmtDay(last, p.tz)} (${b.days.length} days, ${wd}) · ${hm(p.fromMin)}–${hm(p.toMin)} ${p.tz} · ${p.slotMin}-minute slots`));
    const tzWrap = el('div', { class: 'tzpick' });
    const id = `vtz-${bar.closest('.view').id}`;
    tzWrap.append(el('label', { for: id }, 'Show times in'));
    const sel = el('select', { id });
    const zones = allTimeZones();
    if (!zones.includes(state.viewerTz)) zones.unshift(state.viewerTz);
    for (const z of zones) {
      const o = el('option', { value: z }, z === localTimeZone() ? `${z} (this device)` : z);
      if (z === state.viewerTz) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      state.viewerTz = sel.value;
      $$('[data-planbar] select').forEach((s) => { s.value = sel.value; });
      Object.values(state.grids).forEach((g) => g.setViewerTz(state.viewerTz));
      if (document.body.dataset.view === 'merge') renderOptions();
      if (document.body.dataset.view === 'fill') renderInside();
    });
    tzWrap.append(sel);
    bar.append(h, tzWrap);
    if (state.viewerTz !== p.tz) {
      bar.append(el('p', { class: 'small tznote' }, `The organiser set the hours in ${p.tz}. The grid below is shown in ${state.viewerTz}.`));
    }
  }
}

// ---------- SETUP ----------
let setupWired = false;
function initSetup() {
  showView('setup');
  if (setupWired) return;
  setupWired = true;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  $('#f-start').value = formatDate(today + 864e5);
  $('#f-end').value = formatDate(today + 7 * 864e5);
  const chips = $('#f-weekdays');
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((n, k) => {
    const id = `wd-${k + 1}`;
    const lab = el('label', { class: 'chip', for: id });
    const cb = el('input', { type: 'checkbox', id, value: String(k + 1) });
    cb.checked = true;
    lab.append(cb, el('span', {}, n));
    chips.append(lab);
  });
  for (const [sel, def] of [['#f-from', 540], ['#f-to', 1260]]) {
    const s = $(sel);
    for (let m = sel === '#f-from' ? 0 : 30; m <= (sel === '#f-from' ? 1410 : 1440); m += 30) {
      const label = m === 1440 ? '24:00 (midnight)' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const o = el('option', { value: String(m) }, label);
      if (m === def) o.selected = true;
      s.append(o);
    }
  }
  const tzSel = $('#f-tz');
  const zones = allTimeZones();
  const here = localTimeZone();
  if (!zones.includes(here)) zones.unshift(here);
  for (const z of zones) {
    const o = el('option', { value: z }, z === here ? `${z} (this device)` : z);
    if (z === here) o.selected = true;
    tzSel.append(o);
  }
  const form = $('#setup-form');
  form.addEventListener('input', updateSetupSummary);
  form.addEventListener('change', updateSetupSummary);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = readSetup();
    const errs = validatePlan(p);
    const box = $('#setup-errors');
    if (errs.length) {
      box.hidden = false;
      box.textContent = errs.join(' ');
      return;
    }
    box.hidden = true;
    state.plan = p;
    const link = planLink();
    $('#starter-link').value = link;
    $('#starter-msg').value = `${p.title ? p.title + ': ' : ''}let's find a meeting time. Open this, mark when you're free (or import your calendar; it stays on your device), then reply here with your code: ${link}`;
    $('#starter-fill').href = planLink({ v: 'fill' });
    $('#starter-merge').href = planLink({ v: 'merge' });
    const r = $('#setup-result');
    r.hidden = false;
    renderQr('starter-link');
    r.focus();
    r.scrollIntoView({ block: 'start' });
  });
  $('#demo-btn').addEventListener('click', openDemo);
  updateSetupSummary();
}

function readSetup() {
  return {
    title: $('#f-title').value.trim().slice(0, LIMITS.titleMax),
    start: $('#f-start').value,
    end: $('#f-end').value,
    weekdays: $$('#f-weekdays input:checked').map((c) => Number(c.value)),
    fromMin: Number($('#f-from').value),
    toMin: Number($('#f-to').value),
    slotMin: Number($('#f-slot').value),
    tz: $('#f-tz').value,
  };
}

function updateSetupSummary() {
  const p = readSetup();
  const errs = validatePlan(p);
  const out = $('#setup-summary');
  if (errs.length) { out.textContent = errs[0]; return; }
  const b = buildSlots(p);
  const perDay = b.rows;
  // Worst case: raw bitmap; header with an 8-byte name.
  const bytes = 2 + 1 + 8 + 1 + Math.ceil(b.slots.length / 8) + 2;
  const chars = 4 + Math.ceil((bytes * 4) / 3);
  out.textContent = `${b.days.length} days × ${perDay} slots = ${b.slots.length} slots. Each member's code is at most about ${chars} characters (often shorter).`;
}

function openDemo() {
  const plan = demoPlan();
  const built = buildSlots(plan);
  const fp = planFingerprint(plan);
  const codes = demoMembers(built).map((m) => encodeCode({ fp, name: m.name, bits: m.bits }));
  state.plan = plan;
  store.set(`whencode:merge:${fp}`, []); // start the demo clean
  location.hash = `${planToParams(plan).toString()}&v=merge&${codes.map((c) => 'm=' + c).join('&')}`;
}

// ---------- FILL (member) ----------
function initFill() {
  showView('fill');
  const n = state.built.slots.length;
  const key = `whencode:fill:${state.fp}`;
  const saved = store.get(key) || {};
  const f = {
    key,
    name: saved.name || '',
    bits: (saved.free && unpackBits(saved.free, n)) || new Uint8Array(n),
    cal: (saved.cal && unpackBits(saved.cal, n)) || new Uint8Array(n),
    reason: new Array(n).fill(''),
    icsText: null,
  };
  state.fill = f;
  renderPlanBars();
  $('#m-name').value = f.name;
  $('#m-name').maxLength = NAME_MAX;

  const grid = new Grid($('#fill-grid'), {
    mode: 'paint',
    label: 'Your availability. Selected cells are times you are free.',
    cellInfo: (i) => {
      const free = !!f.bits[i], cal = !!f.cal[i];
      const why = f.reason[i] ? `: ${f.reason[i]}` : '';
      if (free && cal) return { text: '✓', cls: 'free over', state: 'free', extra: `free (you overrode a calendar event${why})` };
      if (free) return { text: '✓', cls: 'free', state: 'free', extra: 'free' };
      if (cal) return { text: '', cls: 'cal', state: 'busy', extra: `not free (busy in your calendar${why})` };
      return { text: '', cls: 'busy', state: 'busy', extra: 'not free' };
    },
    onSet: (i, v) => { f.bits[i] = v ? 1 : 0; },
    onCommit: () => { updateMyCode(); saveFill(); },
  });
  state.grids = { fill: grid };
  grid.setData(state.plan, state.built, state.viewerTz);

  $('#fill-to-merge').href = planLink({ v: 'merge' });
  $('#ics-sample-dl').href = URL.createObjectURL(new Blob([sampleIcs(state.plan)], { type: 'text/calendar' }));
  updateMyCode();
}

function saveFill() {
  const f = state.fill;
  store.set(f.key, { name: f.name, free: packBits(f.bits), cal: packBits(f.cal) });
}

function updateMyCode() {
  const f = state.fill;
  f.name = cleanName($('#m-name').value);
  const code = encodeCode({ fp: state.fp, name: f.name, bits: f.bits });
  f.code = code;
  $('#my-code').value = code;
  $('#my-link').value = planLink({ m: code });
  renderQr('my-link');
  renderInside();
}

function renderInside() {
  const f = state.fill;
  if (!f || !f.code) return;
  const body = $('#inside-body');
  body.textContent = '';
  const d = decodeCode(f.code, { fp: state.fp, n: state.built.slots.length });
  const free = d.bits.reduce((a, b) => a + b, 0);
  const L = d.layout;
  if (!f.name) body.append(el('p', { class: 'notice warn' }, 'Add your name above so the organiser knows whose code this is.'));
  const table = el('table', { class: 'inside-table' });
  table.append(el('caption', { class: 'sr-only' }, 'Contents of your code'));
  const thead = el('thead');
  const hr = el('tr');
  ['Part', 'Size', 'Value'].forEach((h) => hr.append(el('th', { scope: 'col' }, h)));
  thead.append(hr);
  table.append(thead);
  const tb = el('tbody');
  const bytes = (k) => `${k} byte${k === 1 ? '' : 's'}`;
  const row = (a, b, c) => { const tr = el('tr'); tr.append(el('th', { scope: 'row' }, a), el('td', {}, b), el('td', {}, c)); tb.append(tr); };
  row('Format tag', `${L.prefix} characters`, '"WC1." (version 1)');
  row('Window check', bytes(L.fingerprint), `0x${((d.bytes[0] << 8) | d.bytes[1]).toString(16).padStart(4, '0')}, matches this planning window`);
  row('Name', bytes(L.nameLength + L.name), d.name ? `"${d.name}"` : '(empty)');
  row('Availability', bytes(L.encoding + L.payload), `${state.built.slots.length} slots, ${free} free, stored as ${d.enc === 1 ? 'run lengths (shorter for your pattern)' : 'one bit per slot'}`);
  row('Checksum', bytes(L.checksum), 'CRC-16, catches copy and paste damage');
  table.append(tb);
  const tf = el('tfoot');
  const fr = el('tr');
  fr.append(el('th', { scope: 'row' }, 'Total'), el('td', {}, bytes(L.total)), el('td', {}, `${L.chars} characters of text`));
  tf.append(fr);
  table.append(tf);
  body.append(table);
  body.append(el('p', { class: 'small' }, 'Not in the code: event titles, your calendar file, your time zone, contact details, device information.'));

  // Decode the code itself and list the free ranges, to show exactly what the organiser will see.
  const ranges = [];
  const { slots, slotMs } = state.built;
  for (let i = 0; i < slots.length; i++) {
    if (!d.bits[i]) continue;
    let j = i;
    while (j + 1 < slots.length && d.bits[j + 1] && slots[j + 1].ms === slots[j].ms + slotMs) j++;
    ranges.push([slots[i].ms, slots[j].ms + slotMs]);
    i = j;
  }
  const det = el('details', { class: 'ranges' });
  det.append(el('summary', {}, `Free times decoded from this code (${ranges.length} block${ranges.length === 1 ? '' : 's'}, shown in ${state.viewerTz})`));
  const ul = el('ul');
  if (!ranges.length) ul.append(el('li', {}, 'None yet: mark some times as free.'));
  ranges.slice(0, 60).forEach(([a, b]) => ul.append(el('li', {}, rangeText(a, b, state.viewerTz))));
  if (ranges.length > 60) ul.append(el('li', {}, `…and ${ranges.length - 60} more`));
  det.append(ul);
  body.append(det);
}

function runImport(text, label) {
  const f = state.fill;
  const { slots, slotMs } = state.built;
  const report = $('#ics-report');
  report.hidden = false;
  report.className = 'notice';
  let res;
  try {
    res = importIcs(text, {
      startMs: slots[0].ms, endMs: slots[slots.length - 1].ms + slotMs,
      viewerTz: state.viewerTz, includeAllDay: $('#ics-allday').checked,
    });
  } catch (e) {
    report.className = 'notice error';
    report.textContent = e.message;
    return;
  }
  f.icsText = text;
  const { busy, reason } = busySlots(slots, slotMs, res.intervals);
  f.cal = busy;
  f.reason = reason;
  f.bits = Uint8Array.from(busy, (b) => (b ? 0 : 1));
  state.grids.fill.refresh();
  updateMyCode();
  saveFill();
  const s = res.stats;
  const busyCount = busy.reduce((a, b) => a + b, 0);
  report.textContent = '';
  report.append(el('p', {}, `Read ${label} on this device: ${s.events} events (${s.recurring} repeating), ${res.intervals.length} occurrences overlap this planning window, which blocks ${busyCount} of ${slots.length} slots.`));
  const skipped = [];
  if (s.transparent) skipped.push(`${s.transparent} marked "free"`);
  if (s.cancelled) skipped.push(`${s.cancelled} cancelled`);
  if (s.allDaySkipped) skipped.push(`${s.allDaySkipped} all-day`);
  if (skipped.length) report.append(el('p', {}, `Ignored: ${skipped.join(', ')}.`));
  if (s.unknownZones.length) report.append(el('p', {}, `Unknown time zone name${s.unknownZones.length > 1 ? 's' : ''} ${s.unknownZones.join(', ')}: those events were read as ${state.viewerTz} time. Please check them on the grid.`));
  if (s.capped) report.append(el('p', {}, `${s.capped} repeating event(s) had too many occurrences and were cut short.`));
  report.append(el('p', { class: 'strong' }, 'Every other time in the window is now marked free. Review the grid and unmark anything you cannot do (sleep, travel, other plans). Event titles are shown only to you, in the grid tooltips.'));
}

function wireFill() {
  $('#m-name').addEventListener('input', () => { updateMyCode(); saveFill(); });
  $('#all-free').addEventListener('click', () => { state.fill.bits.fill(1); state.grids.fill.refresh(); updateMyCode(); saveFill(); });
  $('#all-busy').addEventListener('click', () => { state.fill.bits.fill(0); state.grids.fill.refresh(); updateMyCode(); saveFill(); });
  $('#ics-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast('That file is larger than 20 MB.'); return; }
    const r = new FileReader();
    r.onload = () => runImport(String(r.result), `"${file.name}"`);
    r.readAsText(file);
  });
  $('#ics-allday').addEventListener('change', () => { if (state.fill?.icsText) runImport(state.fill.icsText, 'the calendar'); });
  $('#ics-sample').addEventListener('click', () => runImport(sampleIcs(state.plan), 'the sample calendar'));
  $('#forget-me').addEventListener('click', () => {
    store.del(state.fill.key);
    state.fill.bits.fill(0); state.fill.cal.fill(0); state.fill.reason.fill('');
    $('#m-name').value = '';
    state.grids.fill.refresh();
    updateMyCode();
    toast('Removed your saved name and grid from this browser');
  });
  const share = $('#share-btn');
  if (navigator.share) {
    share.hidden = false;
    share.addEventListener('click', () => navigator.share({ text: `My availability: ${$('#my-link').value}` }).catch(() => {}));
  }
  // Tabs
  const tabs = $$('[role="tab"]');
  const select = (t) => {
    tabs.forEach((x) => {
      const on = x === t;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
    });
  };
  tabs.forEach((t, k) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const nt = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      select(nt);
      nt.focus();
    });
  });
}

// ---------- MERGE ----------
function initMerge(hashCodes) {
  showView('merge');
  const key = `whencode:merge:${state.fp}`;
  const m = { key, members: [], required: new Set(), pick: null };
  state.merge = m;
  renderPlanBars();

  const len = $('#len');
  len.textContent = '';
  for (let k = 1; k * state.plan.slotMin <= 240; k++) {
    const o = el('option', { value: String(k) }, minutesText(k * state.plan.slotMin));
    if (k * state.plan.slotMin === Math.max(60, state.plan.slotMin)) o.selected = true;
    len.append(o);
  }
  $('#ltitle').value = state.plan.title || 'Group meeting';
  $('#merge-to-fill').href = planLink({ v: 'fill' });

  const grid = new Grid($('#heat-grid'), {
    mode: 'heat',
    label: 'Group availability heatmap. Each cell shows how many members are free.',
    cellInfo: heatInfo,
    onFocusCell: showCellDetail,
  });
  state.grids = { heat: grid };
  grid.setData(state.plan, state.built, state.viewerTz);

  const saved = store.get(key) || [];
  addCodes([...saved, ...hashCodes], { quiet: !hashCodes.length, fromLink: hashCodes.length > 0 });
  renderMerge();
}

function heatInfo(i) {
  const m = state.merge;
  const n = m.members.length;
  if (!n) return { text: '', cls: 'h0', state: 'no codes yet', extra: 'no codes yet' };
  const freeNames = [], cant = [];
  m.members.forEach((x) => (x.bits[i] ? freeNames : cant).push(x.name || '(no name)'));
  const c = freeNames.length;
  const level = c === 0 ? 0 : c === n ? 5 : Math.min(4, 1 + Math.floor((c / n) * 4));
  const inPick = m.pick && i >= m.pick.start && i < m.pick.end;
  const reqMissing = [...m.required].some((name) => cant.includes(name));
  return {
    text: `${c}/${n}`,
    cls: `h${level}${inPick ? ' pick' : ''}${c === n ? ' all' : ''}${reqMissing ? ' reqx' : ''}`,
    state: `${c} of ${n} free`,
    extra: `${c}/${n} free (${c} of ${n}).${cant.length ? ` Can't: ${cant.join(', ')}.` : ' Everyone is free.'}${inPick ? ' Part of the selected option.' : ''}`,
  };
}

function showCellDetail(i) {
  const m = state.merge;
  const box = $('#cell-detail');
  box.textContent = '';
  if (!m || !m.members.length) return;
  const s = state.built.slots[i];
  const freeNames = [], cant = [];
  m.members.forEach((x) => (x.bits[i] ? freeNames : cant).push(x.name || '(no name)'));
  box.append(el('p', { class: 'strong' }, rangeText(s.ms, s.ms + state.built.slotMs, state.viewerTz)));
  box.append(el('p', {}, `Free (${freeNames.length}): ${freeNames.join(', ') || 'nobody'}`));
  box.append(el('p', {}, `Can't (${cant.length}): ${cant.join(', ') || 'nobody'}`));
}

function addCodes(list, { quiet = false, fromLink = false } = {}) {
  const m = state.merge;
  const n = state.built.slots.length;
  const added = [], updated = [], errors = [];
  let dupes = 0;
  for (const code of list) {
    try {
      const d = decodeCode(code, { fp: state.fp, n });
      const same = m.members.find((x) => x.code === code);
      if (same) { dupes++; continue; }
      const byName = m.members.findIndex((x) => x.name.toLowerCase() === d.name.toLowerCase());
      const entry = { code, name: d.name || `Member ${m.members.length + 1}`, bits: d.bits };
      if (byName >= 0) { m.members[byName] = entry; updated.push(entry.name); } else { m.members.push(entry); added.push(entry.name); }
    } catch (e) {
      errors.push(e.message);
    }
  }
  store.set(m.key, m.members.map((x) => x.code));
  const rep = $('#paste-report');
  if (quiet && !errors.length) { rep.hidden = true; return; }
  rep.hidden = false;
  rep.className = errors.length ? 'notice warn' : 'notice ok';
  rep.textContent = '';
  const parts = [];
  if (added.length) parts.push(`Added ${added.join(', ')}.`);
  if (updated.length) parts.push(`Replaced the earlier code from ${updated.join(', ')}.`);
  if (dupes && !fromLink) parts.push(`${dupes} code${dupes > 1 ? 's were' : ' was'} already added.`);
  if (!list.length) parts.push('No codes found. Codes start with "WC1.".');
  rep.append(el('p', {}, parts.join(' ') || 'Nothing new.'));
  if (errors.length) {
    const ul = el('ul');
    errors.forEach((x) => ul.append(el('li', {}, x)));
    rep.append(el('p', { class: 'strong' }, `${errors.length} code${errors.length > 1 ? 's' : ''} could not be used:`), ul);
  }
}

function renderMerge() {
  const m = state.merge;
  const ul = $('#members');
  ul.textContent = '';
  $('#members-empty').hidden = m.members.length > 0;
  $('#clear-members').hidden = m.members.length === 0;
  $('#member-count').textContent = m.members.length ? `(${m.members.length})` : '';
  const n = state.built.slots.length;
  for (const [k, x] of m.members.entries()) {
    const li = el('li');
    const free = x.bits.reduce((a, b) => a + b, 0);
    const info = el('div', { class: 'who' });
    info.append(el('span', { class: 'mname' }, x.name), el('span', { class: 'small' }, `free in ${free} of ${n} slots`));
    const reqId = `req-${k}`;
    const req = el('label', { class: 'check req', for: reqId });
    const cb = el('input', { type: 'checkbox', id: reqId });
    cb.checked = m.required.has(x.name);
    cb.addEventListener('change', () => {
      if (cb.checked) m.required.add(x.name); else m.required.delete(x.name);
      renderOptions();
      renderHeatLegend();
      state.grids.heat.refresh();
    });
    req.append(cb, el('span', {}, 'Required'));
    const rm = el('button', { type: 'button', class: 'btn small ghost', 'aria-label': `Remove ${x.name}` }, 'Remove');
    rm.addEventListener('click', () => {
      m.members.splice(k, 1);
      m.required.delete(x.name);
      store.set(m.key, m.members.map((y) => y.code));
      renderMerge();
    });
    li.append(info, req, rm);
    ul.append(li);
  }
  for (const name of [...m.required]) if (!m.members.some((x) => x.name === name)) m.required.delete(name);
  renderOptions();
  state.grids.heat.refresh();
  renderHeatLegend();
  $('#merge-link').value = planLink({ v: 'merge', m: m.members.map((x) => x.code) });
}

function renderHeatLegend() {
  const lg = $('#heat-legend');
  lg.textContent = '';
  const n = state.merge.members.length;
  if (!n) return;
  lg.append(el('span', {}, 'Cells show free / total:'));
  for (const [lv, t] of [[0, 'nobody'], [2, 'some'], [4, 'most'], [5, 'everyone']]) {
    const s = el('span');
    s.append(el('i', { class: `sw h${lv}${lv === 5 ? ' all' : ''}` }, lv === 5 ? `${n}/${n}` : ''), document.createTextNode(` ${t}`));
    lg.append(s);
  }
  if (state.merge.required.size) {
    const s = el('span');
    s.append(el('i', { class: 'sw h2 reqx' }), document.createTextNode(' striped: a required member can\'t'));
    lg.append(s);
  }
}

function renderOptions() {
  const m = state.merge;
  const ol = $('#options');
  ol.textContent = '';
  if (!m.members.length) {
    ol.append(el('li', { class: 'empty' }, 'Add codes to see the best times.'));
    return;
  }
  const L = Number($('#len').value) || 1;
  const required = new Set(m.members.map((x, k) => (m.required.has(x.name) ? k : -1)).filter((k) => k >= 0));
  const opts = rankOptions({ slots: state.built.slots, slotMs: state.built.slotMs, members: m.members, required, lengthSlots: L, limit: 6 });
  if (!opts.length) {
    ol.append(el('li', { class: 'empty' }, required.size
      ? `No ${minutesText(L * state.plan.slotMin)} slot where every required member is free. Try a shorter meeting or fewer required members.`
      : `No ${minutesText(L * state.plan.slotMin)} slot where anyone is free.`));
    return;
  }
  const tz = state.viewerTz;
  const n = m.members.length;
  opts.forEach((o, rank) => {
    const li = el('li', { class: `opt${m.pick && m.pick.start === o.start && m.pick.end === o.end ? ' picked' : ''}` });
    const head = el('div', { class: 'opt-head' });
    head.append(el('span', { class: 'rank', 'aria-hidden': 'true' }, String(rank + 1)));
    const when = el('div', { class: 'when' });
    when.append(el('strong', {}, rangeText(o.startMs, o.endMs, tz)));
    if (tz !== state.plan.tz) when.append(el('span', { class: 'small' }, `${fmtTime(o.startMs, state.plan.tz)} – ${fmtTime(o.endMs, state.plan.tz)} organiser time`));
    head.append(when);
    const score = el('span', { class: `score${o.available.length === n ? ' all' : ''}` }, o.available.length === n ? `All ${n} free` : `${o.available.length} of ${n} free`);
    head.append(score);
    li.append(head);
    const cant = o.missing.map((k) => m.members[k].name);
    li.append(el('p', { class: 'cant' }, cant.length ? `Can't make it: ${cant.join(', ')}` : 'Everyone can make it.'));
    if (o.extendsToMs > o.endMs) li.append(el('p', { class: 'small' }, `The same people stay free until ${fmtTime(o.extendsToMs, tz)}.`));
    const acts = el('div', { class: 'actions' });
    const dl = el('button', { type: 'button', class: 'btn small primary' }, 'Download invite (.ics)');
    dl.addEventListener('click', () => {
      const text = buildInvite({
        title: $('#ltitle').value.trim() || 'Group meeting',
        startMs: o.startMs, endMs: o.endMs,
        available: o.available.map((k) => m.members[k].name),
        missing: cant,
      });
      download('meeting.ics', text, 'text/calendar');
      toast('Invite saved: open it to add the meeting to a calendar');
    });
    const show = el('button', { type: 'button', class: 'btn small' }, 'Show on heatmap');
    show.addEventListener('click', () => {
      m.pick = { start: o.start, end: o.end };
      state.grids.heat.refresh();
      renderOptions();
      state.grids.heat.showSlot(o.start);
    });
    acts.append(dl, show);
    li.append(acts);
    ol.append(li);
  });
}

function wireMerge() {
  $('#add-codes').addEventListener('click', () => {
    const codes = findCodes($('#paste').value);
    addCodes(codes);
    $('#paste').value = '';
    renderMerge();
  });
  $('#len').addEventListener('change', () => { state.merge.pick = null; renderOptions(); state.grids.heat.refresh(); });
  $('#clear-members').addEventListener('click', () => {
    state.merge.members = [];
    state.merge.required.clear();
    store.set(state.merge.key, []);
    renderMerge();
  });
}

// ---------- routing ----------
function route() {
  const raw = location.hash.slice(1);
  if (raw && !raw.includes('=')) {
    if (!document.body.dataset.view) initSetup();
    return; // in-page anchor such as #about
  }
  const q = new URLSearchParams(raw);
  $('#boot-error').hidden = true;
  const { plan, errors } = planFromParams(q);
  if (!plan) {
    if (q.has('d')) {
      const b = $('#boot-error');
      b.hidden = false;
      b.textContent = `This link's planning window is not valid: ${errors.join(' ')} Ask the organiser for a new link, or create one below.`;
    }
    initSetup();
    return;
  }
  state.plan = plan;
  state.built = buildSlots(plan);
  state.fp = planFingerprint(plan);
  const codes = q.getAll('m').filter(Boolean);
  const v = q.get('v');
  if (v === 'fill' || (!codes.length && v !== 'merge')) initFill(); else initMerge(codes);
  window.scrollTo(0, 0);
}

function boot() {
  wireFill();
  wireMerge();
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

try {
  boot();
} catch (e) {
  const b = document.getElementById('boot-error');
  b.hidden = false;
  b.textContent = `Something went wrong while starting: ${e.message}`;
  throw e;
}
