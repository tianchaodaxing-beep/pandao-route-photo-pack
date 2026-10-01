import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readGps } from '../docs/exif.mjs';
import { makePacket } from '../docs/packet.mjs';
import { zipBytes } from '../docs/zip.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), sample = join(root, 'docs/samples');
async function inputs() { const files = (await readdir(join(sample, 'photos'))).sort(); return { route: await readFile(join(sample, 'route.geojson')), photos: await Promise.all(files.map(async name => ({ name, bytes: await readFile(join(sample, 'photos', name)) }))) }; }
const digest = b => createHash('sha256').update(b).digest('hex');
test('Read GPS from independently generated JPEG EXIF', async () => { const { photos } = await inputs(); const data = readGps(photos[0].bytes); assert.ok(Math.abs(data.gps[0] - (-0.138844178183)) < 0.0000001); assert.ok(Math.abs(data.gps[1] - 51.500089932036) < 0.0000001); assert.equal(data.capturedAt, '2026:01:15 10:01:00'); });
test('A real JPEG without GPS returns no fabricated location', async () => { const data = readGps(await readFile(join(sample, 'photos/IMG_0009.jpg'))); assert.equal(data.gps, null); });
test('Reject a non-JPEG header', () => assert.throws(() => readGps(new Uint8Array([1, 2, 3, 4]))));
test('Reject a truncated JPEG segment', () => assert.throws(() => readGps(new Uint8Array([255, 216, 255, 225, 0, 100, 69]))));
test('Both TIFF byte orders yield the same GPS coordinates', () => {
  function fixture(little) {
    const t = new Uint8Array(128), v = new DataView(t.buffer); t.set(little ? [73, 73] : [77, 77]);
    const u16 = (p, n) => v.setUint16(p, n, little), u32 = (p, n) => v.setUint32(p, n, little);
    u16(2, 42); u32(4, 8); u16(8, 1); u16(10, 0x8825); u16(12, 4); u32(14, 1); u32(18, 26); u16(26, 4);
    for (let i = 0; i < 4; i++) { const at = 28 + 12 * i; u16(at, i + 1); u16(at + 2, i % 2 ? 5 : 2); u32(at + 4, i % 2 ? 3 : 2); if (i % 2) u32(at + 8, i === 1 ? 80 : 104); else t[at + 8] = i === 0 ? 83 : 87; }
    for (const [p, degree] of [[80, 12], [104, 34]]) { u32(p, degree); u32(p + 4, 1); u32(p + 8, 30); u32(p + 12, 1); u32(p + 16, 0); u32(p + 20, 1); }
    const j = new Uint8Array(2 + 4 + 6 + t.length + 2); j.set([255, 216, 255, 225, 0, t.length + 8, 69, 120, 105, 102, 0, 0]); j.set(t, 12); j.set([255, 217], j.length - 2); return j;
  }
  assert.deepEqual(readGps(fixture(true)).gps, [-34.5, -12.5]); assert.deepEqual(readGps(fixture(false)).gps, [-34.5, -12.5]);
});
test('Field example locates six photos and separates all three exceptions', async () => { const { route, photos } = await inputs(); const { result } = await makePacket(route, photos); assert.equal(result.summary.located, 6); assert.equal(result.summary.review, 3); assert.equal(result.summary.emptyBins, 8); assert.deepEqual(result.photos.filter(p => !p.assigned).map(p => p.status).sort(), ['ambiguous', 'missing_gps', 'off_route']); });
test('Explicit browser defaults and omitted CLI defaults produce identical packet bytes', async () => { const { route, photos } = await inputs(); const a = await makePacket(route, photos), b = await makePacket(route, photos, { startM: 0, maxOffsetM: 30, intervalM: 100 }); assert.deepEqual(a.zip, b.zip); });
test('Photo copies remain byte-identical and manifest fingerprints are complete', async () => { const { route, photos } = await inputs(); const original = photos.map(p => digest(p.bytes)); const packet = await makePacket(route, photos), manifest = JSON.parse(packet.files.find(f => f.name === 'manifest.json').text); for (const row of packet.result.photos) { const file = packet.files.find(f => f.name === row.output), input = photos.find(p => p.name === row.source); assert.equal(digest(file.bytes), digest(input.bytes)); } assert.deepEqual(photos.map(p => digest(p.bytes)), original); assert.equal(manifest.outputs.length, packet.files.length - 1); for (const record of manifest.outputs) { const file = packet.files.find(f => f.name === record.name); assert.equal(digest(file.bytes || Buffer.from(file.text)), record.sha256); } });
test('Invalid metadata stays in the packet with its error', async () => { const { route } = await inputs(); const p = await makePacket(route, [{ name: 'broken.jpg', bytes: new Uint8Array([1, 2, 3, 4]) }]); assert.equal(p.result.photos[0].status, 'metadata_error'); assert.ok(p.result.photos[0].error); assert.equal(p.files.find(f => f.name === p.result.photos[0].output).bytes.length, 4); });
test('Packet rejects unsupported formats and invalid UTF-8 routes', async () => { const { route } = await inputs(); await assert.rejects(makePacket(route, [{ name: 'photo.heic', bytes: new Uint8Array([1]) }])); await assert.rejects(makePacket(new Uint8Array([255]), [{ name: 'photo.jpg', bytes: new Uint8Array([1]) }])); });
test('ZIP rejects path traversal and case collisions', () => { for (const names of [['../bad.jpg'], ['/bad.jpg'], ['a//b.jpg'], ['A.jpg', 'a.jpg']]) assert.throws(() => zipBytes(names.map(name => ({ name, text: '' })))); });
test('CLI processes the downloaded-format example and refuses to replace its output', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'route-pack-test-')), out = join(temp, 'output');
  try {
    const args = [join(root, 'bin/pack.mjs'), '--route', join(sample, 'route.geojson'), '--photos', join(sample, 'photos'), '--out', out];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(first.status, 0, first.stderr); assert.equal(JSON.parse(first.stdout).located, 6);
    const before = await readFile(join(out, 'route-photo-packet.zip'));
    const next = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(next.status, 1); assert.match(next.stderr, /already exists/); assert.deepEqual(await readFile(join(out, 'route-photo-packet.zip')), before);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('CLI errors do not leave a misleading output directory', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'route-pack-test-'));
  try { const invalid = join(temp, 'invalid.geojson'), photos = join(temp, 'photos'), out = join(temp, 'out'); await writeFile(invalid, '{bad'); await mkdir(photos); await writeFile(join(photos, 'a.jpg'), new Uint8Array([1])); const p = spawnSync(process.execPath, [join(root, 'bin/pack.mjs'), '--route', invalid, '--photos', photos, '--out', out], { encoding: 'utf8' }); assert.equal(p.status, 1); assert.ok(!(await readdir(temp)).includes('out')); } finally { await rm(temp, { recursive: true, force: true }); }
});
test('CLI rejects unknown options and missing values', () => { for (const args of [['--unknown', 'x'], ['--route'], ['--route', 'a', '--route', 'b']]) { const p = spawnSync(process.execPath, [join(root, 'bin/pack.mjs'), ...args], { encoding: 'utf8' }); assert.equal(p.status, 1); assert.ok(p.stderr.includes('Route Photo Pack:')); } });
