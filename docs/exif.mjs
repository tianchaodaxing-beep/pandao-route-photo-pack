// Read bounded TIFF directories from a JPEG EXIF segment without rewriting the image.
export function readGps(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw Error('Select JPEG photos. This file has no JPEG header.');
  let pos = 2;
  while (pos < bytes.length) {
    if (bytes[pos++] !== 255) throw Error('The JPEG marker stream is damaged.');
    while (pos < bytes.length && bytes[pos] === 255) pos++;
    const marker = bytes[pos++];
    if (marker === 0xda || marker === 0xd9) return { gps: null, capturedAt: null };
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (pos + 2 > bytes.length) throw Error('The JPEG segment is truncated.');
    const length = bytes[pos] * 256 + bytes[pos + 1];
    if (length < 2 || pos + length > bytes.length) throw Error('The JPEG segment length is invalid.');
    if (marker === 0xe1 && length >= 8 && new TextDecoder().decode(bytes.slice(pos + 2, pos + 8)) === 'Exif\0\0') return tiff(bytes.slice(pos + 8, pos + length));
    pos += length;
  }
  throw Error('The JPEG header is incomplete.');
}
function tiff(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const check = (pos, size) => { if (!Number.isInteger(pos) || pos < 0 || pos + size > bytes.length) throw Error('The EXIF directory is damaged.'); };
  check(0, 8);
  const order = String.fromCharCode(bytes[0], bytes[1]);
  if (!['II', 'MM'].includes(order)) throw Error('The EXIF byte order is invalid.');
  const little = order === 'II', u16 = p => { check(p, 2); return view.getUint16(p, little); }, u32 = p => { check(p, 4); return view.getUint32(p, little); };
  if (u16(2) !== 42) throw Error('The EXIF TIFF header is invalid.');
  function directory(pos) {
    const count = u16(pos); if (count > 512) throw Error('The EXIF directory contains too many entries.');
    check(pos + 2, count * 12 + 4);
    const entries = new Map();
    for (let i = 0; i < count; i++) { const at = pos + 2 + 12 * i; entries.set(u16(at), { type: u16(at + 2), count: u32(at + 4), at }); }
    return entries;
  }
  function value(entry) {
    if (!entry) return null;
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[entry.type];
    if (!size || entry.count > 4096) throw Error('The requested EXIF value is invalid.');
    const total = size * entry.count, start = total <= 4 ? entry.at + 8 : u32(entry.at + 8); check(start, total);
    if (entry.type === 2) return new TextDecoder().decode(bytes.slice(start, start + total)).replace(/\0.*$/s, '');
    const result = [];
    for (let i = 0; i < entry.count; i++) {
      const p = start + i * size;
      if (entry.type === 5) { const denominator = u32(p + 4); if (!denominator) throw Error('An EXIF GPS fraction has a zero denominator.'); result.push(u32(p) / denominator); }
      else result.push(entry.type === 1 ? bytes[p] : entry.type === 3 ? u16(p) : u32(p));
    }
    return result;
  }
  const root = directory(u32(4));
  let capturedAt = value(root.get(0x132));
  const exifPointer = value(root.get(0x8769));
  if (exifPointer) capturedAt = value(directory(exifPointer[0]).get(0x9003)) || capturedAt;
  const gpsPointer = value(root.get(0x8825));
  if (!gpsPointer) return { gps: null, capturedAt };
  const gps = directory(gpsPointer[0]);
  const latRef = value(gps.get(1)), latDms = value(gps.get(2)), lonRef = value(gps.get(3)), lonDms = value(gps.get(4));
  if (!latRef && !lonRef && !latDms && !lonDms) return { gps: null, capturedAt };
  function coordinate(dms, ref, refs, max) {
    if (!dms || dms.length !== 3 || !refs.includes(ref) || dms.some(x => !Number.isFinite(x) || x < 0) || dms[1] >= 60 || dms[2] >= 60) throw Error('The EXIF GPS coordinate is incomplete or invalid.');
    const number = dms[0] + dms[1] / 60 + dms[2] / 3600;
    if (number > max) throw Error('The EXIF GPS coordinate is outside its valid range.');
    return ref === refs[1] ? -number : number;
  }
  return { gps: [coordinate(lonDms, lonRef, ['E', 'W'], 180), coordinate(latDms, latRef, ['N', 'S'], 90)], capturedAt };
}
