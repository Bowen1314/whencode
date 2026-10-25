// Build a one-event .ics file for the chosen slot (RFC 5545). Times are written in UTC ("Z"),
// so every calendar app shows them correctly in its own zone. No attendee e-mails: WhenCode
// never knows any. The file is generated in the page and saved through a local blob: URL.

function icsDate(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line to 75 octets per physical line (UTF-8 aware). */
export function foldLine(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = ' ';
      curBytes = 1;
      limit = 75;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

function uid() {
  const r = globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  return `${r}@whencode`;
}

/**
 * @param {{title:string, startMs:number, endMs:number, available:string[], missing:string[], nowMs?:number}} o
 */
export function buildInvite({ title, startMs, endMs, available, missing, nowMs = Date.now() }) {
  const desc = [
    `Can make it: ${available.join(', ') || 'nobody'}`,
    `Can't make it: ${missing.join(', ') || 'nobody'}`,
    '',
    'Planned with WhenCode. Times were merged in the browser; nothing was uploaded.',
  ].join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WhenCode//WhenCode 1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid()}`,
    `DTSTAMP:${icsDate(nowMs)}`,
    `DTSTART:${icsDate(startMs)}`,
    `DTEND:${icsDate(endMs)}`,
    `SUMMARY:${escapeText(title || 'Group meeting')}`,
    `DESCRIPTION:${escapeText(desc)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
