// Share-code format, version 1.  Text form:  "WC1." + base64url(bytes)
//
//   bytes = fp(2) | nameLen(1) | name(UTF-8, nameLen) | enc(1) | payload | crc(2)
//
//   fp       16-bit fingerprint of the planning window (see plan.js); detects codes for another window
//   name     display name typed by the member (max 24 characters)
//   enc      0 = raw bitmap, 1 = run lengths; the encoder keeps whichever is shorter
//   payload  raw:  ceil(N/8) bytes, slot 0 in the high bit of byte 0, 1 = free
//            runs: LEB128 varints, alternating busy-run, free-run, busy-run, ... (first may be 0)
//   crc      CRC-16/CCITT-FALSE of everything before it; detects truncated or edited codes
//
// Nothing else is in the code: no event titles, no time zone, no device or contact details.

export const PREFIX = 'WC1.';
export const NAME_MAX = 24;
export const CODE_RE = /WC1\.[A-Za-z0-9_-]{6,}/g;

export class CodeError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'format' | 'damaged' | 'other-plan'
  }
}

export function cleanName(s) {
  const flat = String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, NAME_MAX).join('');
}

export function crc16(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

export function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function packRaw(bits) {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((v, i) => { if (v) out[i >> 3] |= 0x80 >> (i & 7); });
  return out;
}

function unpackRaw(bytes, n) {
  if (bytes.length !== Math.ceil(n / 8)) throw new CodeError('damaged', 'Code length does not match this planning window.');
  const bits = new Uint8Array(n);
  for (let i = 0; i < n; i++) bits[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return bits;
}

function packRuns(bits) {
  const out = [];
  const varint = (v) => { do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v); };
  let cur = 0, run = 0;
  for (const v of bits) {
    if (v === cur) run++;
    else { varint(run); cur = v; run = 1; }
  }
  varint(run);
  return Uint8Array.from(out);
}

function unpackRuns(bytes, n) {
  const bits = new Uint8Array(n);
  let pos = 0, cur = 0, i = 0;
  while (i < bytes.length) {
    let v = 0, shift = 0, b;
    do {
      if (i >= bytes.length || shift > 28) throw new CodeError('damaged', 'Code is damaged.');
      b = bytes[i++];
      v |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (pos + v > n) throw new CodeError('damaged', 'Code does not match this planning window.');
    if (cur) bits.fill(1, pos, pos + v);
    pos += v;
    cur ^= 1;
  }
  if (pos !== n) throw new CodeError('damaged', 'Code does not match this planning window.');
  return bits;
}

/** Encode. `bits` is an array/Uint8Array of 0/1 with one entry per slot. */
export function encodeCode({ fp, name, bits }) {
  const nameBytes = new TextEncoder().encode(cleanName(name));
  const raw = packRaw(bits);
  const runs = packRuns(bits);
  const useRuns = runs.length < raw.length;
  const payload = useRuns ? runs : raw;
  const body = new Uint8Array(2 + 1 + nameBytes.length + 1 + payload.length + 2);
  let o = 0;
  body[o++] = (fp >> 8) & 0xff; body[o++] = fp & 0xff;
  body[o++] = nameBytes.length;
  body.set(nameBytes, o); o += nameBytes.length;
  body[o++] = useRuns ? 1 : 0;
  body.set(payload, o); o += payload.length;
  const c = crc16(body.subarray(0, o));
  body[o++] = c >> 8; body[o++] = c & 0xff;
  return PREFIX + toBase64Url(body);
}

/**
 * Decode and check a code against a planning window (fingerprint + slot count).
 * Returns { name, bits, enc, bytes, layout } or throws CodeError.
 */
export function decodeCode(code, { fp, n }) {
  const s = String(code || '').trim();
  if (!s.startsWith(PREFIX)) throw new CodeError('format', 'Not a WhenCode code (codes start with "WC1.").');
  let bytes;
  try { bytes = fromBase64Url(s.slice(PREFIX.length)); } catch { throw new CodeError('damaged', 'Code contains invalid characters.'); }
  if (bytes.length < 8) throw new CodeError('damaged', 'Code is too short; it may have been cut off.');
  const crcGot = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  if (crc16(bytes.subarray(0, bytes.length - 2)) !== crcGot) {
    throw new CodeError('damaged', 'Checksum failed: the code was cut off or changed while copying.');
  }
  const codeFp = (bytes[0] << 8) | bytes[1];
  const nameLen = bytes[2];
  if (3 + nameLen + 1 > bytes.length - 2) throw new CodeError('damaged', 'Code is damaged.');
  let name;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3, 3 + nameLen)); } catch { throw new CodeError('damaged', 'Name is not valid text.'); }
  if (codeFp !== fp) throw new CodeError('other-plan', `Code from ${name || 'someone'} was made for a different planning window (dates, hours, slot length or time zone differ).`);
  const enc = bytes[3 + nameLen];
  const payload = bytes.subarray(4 + nameLen, bytes.length - 2);
  let bits;
  if (enc === 0) bits = unpackRaw(payload, n);
  else if (enc === 1) bits = unpackRuns(payload, n);
  else throw new CodeError('format', 'Code uses an unknown encoding (newer version?).');
  return {
    name, bits, enc, bytes,
    layout: { prefix: PREFIX.length, fingerprint: 2, nameLength: 1, name: nameLen, encoding: 1, payload: payload.length, checksum: 2, total: bytes.length, chars: s.length },
  };
}

/** Find every code-looking token in arbitrary pasted text (a whole chat log is fine). */
export function findCodes(text) {
  return [...new Set(String(text || '').match(CODE_RE) || [])];
}
