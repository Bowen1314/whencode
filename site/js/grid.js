// Accessible availability grid, used both for painting (member) and the heatmap (organiser).
//
// Columns are the organiser's days; rows are the slots of each day. Every slot is a fixed
// instant, labelled in the VIEWER's time zone. When the viewer's offset from the organiser
// changes inside a page (a DST change in only one of the two zones), the affected day gets a
// visible "+1 h" / "−1 h" badge and every cell's accessible label carries its exact local time.

import { dateKey, fmtDay, fmtDayLong, fmtDayNum, fmtTime, fmtWeekday, offsetMinutes } from './tz.js';

const DAYS_PER_PAGE = 7;

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  if (text != null) e.textContent = text;
  return e;
}

export class Grid {
  /**
   * @param {HTMLElement} host
   * @param {object} o
   * @param {'paint'|'heat'} o.mode
   * @param {(i:number)=>{text:string, cls:string, state?:string, extra?:string}} o.cellInfo
   * @param {(i:number, value:boolean)=>void} [o.onSet]   paint mode: a cell was set
   * @param {()=>void} [o.onCommit]                        paint mode: a stroke finished
   * @param {(i:number)=>void} [o.onFocusCell]
   */
  constructor(host, o) {
    this.host = host;
    this.o = o;
    this.page = 0;
    this.focusI = null;
    this.painting = null;
    this.cells = new Map();
    this.live = el('div', { class: 'sr-only', 'aria-live': 'polite' });
    this._onUp = () => this._endPaint();
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
  }

  setData(plan, built, viewerTz) {
    this.plan = plan;
    this.built = built;
    this.viewerTz = viewerTz;
    this.index = built.days.map(() => new Array(built.rows).fill(-1));
    for (const s of built.slots) this.index[s.day][s.row] = s.i;
    this.pages = Math.max(1, Math.ceil(built.days.length / DAYS_PER_PAGE));
    if (this.page >= this.pages) this.page = 0;
    this.render();
  }

  setViewerTz(tz) {
    this.viewerTz = tz;
    this.render();
  }

  pageOf(i) {
    return Math.floor(this.built.slots[i].day / DAYS_PER_PAGE);
  }

  showSlot(i) {
    const p = this.pageOf(i);
    if (p !== this.page) { this.page = p; this.render(); }
    this.focusCell(i, true);
  }

  slotLabel(i) {
    const s = this.built.slots[i];
    const tz = this.viewerTz;
    const end = s.ms + this.built.slotMs;
    let t = `${fmtDayLong(s.ms, tz)}, ${fmtTime(s.ms, tz)} to ${fmtTime(end, tz)}`;
    if (tz !== this.plan.tz) t += ` your time (${fmtTime(s.ms, this.plan.tz)} organiser time)`;
    return t;
  }

  render() {
    const { built, viewerTz: tz, plan } = this;
    const host = this.host;
    host.textContent = '';
    this.cells.clear();
    const first = this.page * DAYS_PER_PAGE;
    const dayIdx = [];
    for (let d = first; d < Math.min(first + DAYS_PER_PAGE, built.days.length); d++) dayIdx.push(d);

    // Offset of viewer vs organiser at each column's first slot; the most common one labels the rows.
    const firstSlot = dayIdx.map((d) => this.index[d].find((i) => i >= 0));
    const delta = firstSlot.map((i) => (i == null || i < 0 ? 0 : offsetMinutes(built.slots[i].ms, tz) - offsetMinutes(built.slots[i].ms, plan.tz)));
    const freq = new Map();
    delta.forEach((x) => freq.set(x, (freq.get(x) || 0) + 1));
    const refDelta = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

    if (this.pages > 1) {
      const nav = el('div', { class: 'pager' });
      const prev = el('button', { type: 'button', class: 'btn small', 'aria-label': 'Earlier days' }, '◀ Earlier');
      const next = el('button', { type: 'button', class: 'btn small', 'aria-label': 'Later days' }, 'Later ▶');
      prev.disabled = this.page === 0;
      next.disabled = this.page === this.pages - 1;
      prev.addEventListener('click', () => { this.page--; this.render(); });
      next.addEventListener('click', () => { this.page++; this.render(); });
      const lastShown = dayIdx[dayIdx.length - 1];
      const status = el('span', { class: 'pager-status' }, `Days ${first + 1}–${lastShown + 1} of ${built.days.length}`);
      nav.append(prev, status, next);
      host.append(nav);
    }

    const grid = el('div', {
      class: `grid mode-${this.o.mode}`,
      role: 'grid',
      'aria-label': this.o.label || 'Availability',
      'aria-multiselectable': this.o.mode === 'paint' ? 'true' : null,
      'aria-readonly': this.o.mode === 'heat' ? 'true' : null,
      'aria-rowcount': String(built.rows + 1),
      'aria-colcount': String(dayIdx.length + 1),
    });

    const head = el('div', { role: 'row', class: 'grow head' });
    head.append(el('div', { role: 'columnheader', class: 'corner' }, this.o.mode === 'paint' ? 'Your time' : 'Time'));
    dayIdx.forEach((d, k) => {
      const i = firstSlot[k];
      const ms = i != null && i >= 0 ? built.slots[i].ms : Date.UTC(built.days[d].y, built.days[d].m - 1, built.days[d].d, 12);
      const ch = el('div', { role: 'columnheader', class: 'colhead' });
      ch.append(el('span', { class: 'wd' }, fmtWeekday(ms, tz)), el('span', { class: 'dn' }, fmtDayNum(ms, tz)));
      const shift = delta[k] - refDelta;
      if (shift) {
        const h = shift / 60;
        const txt = `${shift > 0 ? '+' : '−'}${Math.abs(h)} h`;
        ch.append(el('span', { class: 'shift', title: `Daylight saving: on this day times are ${Math.abs(h)} hour${Math.abs(h) === 1 ? '' : 's'} ${shift > 0 ? 'later' : 'earlier'} than the row labels` }, txt));
        ch.append(el('span', { class: 'sr-only' }, `, times ${shift > 0 ? 'later' : 'earlier'} than row labels by ${Math.abs(h)} hour`));
        ch.classList.add('shifted');
      }
      head.append(ch);
    });
    grid.append(head);

    let tabbable = null;
    for (let r = 0; r < built.rows; r++) {
      const row = el('div', { role: 'row', class: 'grow' });
      // Row label: viewer-local time of this row on a day with the reference offset.
      let labelMs = null;
      dayIdx.forEach((d, k) => {
        const i = this.index[d][r];
        if (labelMs == null && i >= 0 && delta[k] === refDelta) labelMs = built.slots[i].ms;
      });
      if (labelMs == null) {
        dayIdx.forEach((d, k) => {
          const i = this.index[d][r];
          if (labelMs == null && i >= 0) labelMs = built.slots[i].ms - (delta[k] - refDelta) * 60000;
        });
      }
      const showLabel = r % Math.max(1, Math.round(60 / plan.slotMin)) === 0;
      const rh = el('div', { role: 'rowheader', class: `rowhead${showLabel ? '' : ' minor'}` });
      rh.append(el('span', { class: showLabel ? '' : 'sr-only' }, labelMs == null ? '' : fmtTime(labelMs, tz)));
      row.append(rh);

      dayIdx.forEach((d, k) => {
        const i = this.index[d][r];
        if (i < 0) {
          row.append(el('div', { role: 'gridcell', class: 'cell void', 'aria-disabled': 'true', 'aria-label': 'No slot: clocks skip this time (daylight saving).' }));
          return;
        }
        const s = built.slots[i];
        const c = el('div', { role: 'gridcell', class: 'cell', 'data-i': String(i), tabindex: '-1' });
        const f = firstSlot[k];
        if (f != null && f >= 0 && dateKey(s.ms, tz) !== dateKey(built.slots[f].ms, tz)) {
          c.classList.add('nd');
          const prevI = r > 0 ? this.index[d][r - 1] : -1;
          if (prevI < 0 || dateKey(built.slots[prevI].ms, tz) === dateKey(built.slots[f].ms, tz)) {
            c.classList.add('nd-start');
            c.setAttribute('data-day', fmtDayNum(s.ms, tz));
          }
        }
        this.cells.set(i, c);
        this._paintCell(i);
        row.append(c);
        if (tabbable == null) tabbable = i;
      });
      grid.append(row);
    }

    const keep = this.focusI != null && this.cells.has(this.focusI) ? this.focusI : tabbable;
    if (keep != null) this.cells.get(keep).tabIndex = 0;
    this.focusI = keep;

    this._wire(grid);
    host.append(grid, this.live);
    const ro = el('p', { class: 'readout', 'aria-hidden': 'true' });
    this.readout = ro;
    host.append(ro);
    this._updateReadout();
  }

  _paintCell(i) {
    const c = this.cells.get(i);
    if (!c) return;
    const info = this.o.cellInfo(i);
    c.className = 'cell ' + (info.cls || '') + (c.classList.contains('nd') ? ' nd' : '') + (c.classList.contains('nd-start') ? ' nd-start' : '');
    c.textContent = info.text || '';
    if (this.o.mode === 'paint') c.setAttribute('aria-selected', info.state === 'free' ? 'true' : 'false');
    c.setAttribute('aria-label', `${this.slotLabel(i)}: ${info.extra || info.state || ''}`);
    c.title = `${this.slotLabel(i)}\n${info.extra || info.state || ''}`;
  }

  refresh(i) {
    if (i != null) this._paintCell(i);
    else for (const k of this.cells.keys()) this._paintCell(k);
    this._updateReadout();
  }

  _updateReadout() {
    if (!this.readout) return;
    if (this.focusI == null || !this.cells.has(this.focusI)) { this.readout.textContent = ''; return; }
    const info = this.o.cellInfo(this.focusI);
    this.readout.textContent = `${this.slotLabel(this.focusI)}: ${info.extra || info.state || ''}`;
  }

  focusCell(i, move = true) {
    if (!this.cells.has(i)) return;
    if (this.focusI != null && this.cells.has(this.focusI)) this.cells.get(this.focusI).tabIndex = -1;
    this.focusI = i;
    const c = this.cells.get(i);
    c.tabIndex = 0;
    if (move) c.focus({ preventScroll: false });
    this._updateReadout();
    this.o.onFocusCell?.(i);
  }

  _neighbour(i, dCol, dRow) {
    const s = this.built.slots[i];
    let d = s.day, r = s.row;
    for (let step = 0; step < 400; step++) {
      d += dCol; r += dRow;
      if (r < 0 || r >= this.built.rows || d < 0 || d >= this.built.days.length) return null;
      const j = this.index[d][r];
      if (j >= 0) return j;
    }
    return null;
  }

  _set(i, value) {
    this.o.onSet(i, value);
    this._paintCell(i);
  }

  _wire(grid) {
    grid.addEventListener('keydown', (e) => {
      const i = this.focusI;
      if (i == null) return;
      const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (moves[e.key]) {
        e.preventDefault();
        const j = this._neighbour(i, ...moves[e.key]);
        if (j == null) return;
        if (this.pageOf(j) !== this.page) { this.page = this.pageOf(j); this.focusI = j; this.render(); }
        if (this.o.mode === 'paint' && e.shiftKey) {
          const v = this.o.cellInfo(i).state === 'free';
          this._set(j, v);
          this._announce(j);
          this.o.onCommit?.();
        }
        this.focusCell(j);
        return;
      }
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const s = this.built.slots[i];
        const list = this.index[s.day].filter((x) => x >= 0);
        this.focusCell(e.key === 'Home' ? list[0] : list[list.length - 1]);
        return;
      }
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        const p = this.page + (e.key === 'PageDown' ? 1 : -1);
        if (p < 0 || p >= this.pages) return;
        e.preventDefault();
        this.page = p;
        this.focusI = null;
        this.render();
        const firstCell = this.cells.keys().next().value;
        if (firstCell != null) this.focusCell(firstCell);
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (this.o.mode === 'paint') {
          this._set(i, this.o.cellInfo(i).state !== 'free');
          this._announce(i);
          this._updateReadout();
          this.o.onCommit?.();
        } else {
          this.o.onFocusCell?.(i);
        }
      }
    });

    grid.addEventListener('focusin', (e) => {
      const c = e.target.closest?.('.cell[data-i]');
      if (c) {
        const i = Number(c.dataset.i);
        if (i !== this.focusI) this.focusCell(i, false);
      }
    });

    if (this.o.mode === 'paint') {
      grid.addEventListener('pointerdown', (e) => {
        const c = e.target.closest('.cell[data-i]');
        if (!c || e.button > 0) return;
        e.preventDefault();
        const i = Number(c.dataset.i);
        const v = this.o.cellInfo(i).state !== 'free';
        this.painting = { value: v, last: i };
        this._set(i, v);
        this.focusCell(i);
      });
      grid.addEventListener('pointermove', (e) => {
        if (!this.painting) return;
        const t = document.elementFromPoint(e.clientX, e.clientY);
        const c = t && t.closest && t.closest('.cell[data-i]');
        if (!c) return;
        const i = Number(c.dataset.i);
        if (i === this.painting.last) return;
        this.painting.last = i;
        this._set(i, this.painting.value);
        this.focusCell(i, false);
      });
    } else {
      grid.addEventListener('click', (e) => {
        const c = e.target.closest('.cell[data-i]');
        if (c) this.focusCell(Number(c.dataset.i));
      });
    }
  }

  _endPaint() {
    if (!this.painting) return;
    this.painting = null;
    this._updateReadout();
    this.o.onCommit?.();
  }

  _announce(i) {
    const info = this.o.cellInfo(i);
    this.live.textContent = `${info.state === 'free' ? 'Free' : 'Not free'}: ${fmtDay(this.built.slots[i].ms, this.viewerTz)} ${fmtTime(this.built.slots[i].ms, this.viewerTz)}`;
  }
}
