const encoder = new TextEncoder();
const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
export function zipBytes(files) {
  const chunks = [], central = [], names = new Set(); let offset = 0, centralLength = 0;
  if (files.length > 65535) throw Error('Too many files in the ZIP.');
  for (const file of files) {
    if (!/^[A-Za-z0-9._/-]+$/.test(file.name) || file.name.split('/').some(x => !x || ['.', '..'].includes(x)) || names.has(file.name.toLowerCase())) throw Error('Output filenames must be unique safe relative paths.');
    names.add(file.name.toLowerCase());
    const name = encoder.encode(file.name), body = file.bytes instanceof Uint8Array ? file.bytes : encoder.encode(file.text), crc = crc32(body);
    const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(12, 33, true);
    view.setUint32(14, crc, true); view.setUint32(18, body.length, true); view.setUint32(22, body.length, true); view.setUint16(26, name.length, true); header.set(name, 30);
    const record = new Uint8Array(46 + name.length), c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 33, true);
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, body.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); record.set(name, 46);
    chunks.push(header, body); central.push(record); offset += header.length + body.length; centralLength += record.length;
    if (offset + centralLength > 0xffffffff) throw Error('This ZIP is too large. Split the batch.');
  }
  const tail = new Uint8Array(22), e = new DataView(tail.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, centralLength, true); e.setUint32(16, offset, true);
  const bytes = new Uint8Array(offset + centralLength + 22); let pos = 0;
  for (const chunk of [...chunks, ...central, tail]) { bytes.set(chunk, pos); pos += chunk.length; }
  return bytes;
}
