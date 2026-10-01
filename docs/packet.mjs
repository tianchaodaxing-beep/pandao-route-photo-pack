import { inspect, parseRoute, outputDocuments, LIMITS } from './core.mjs';
import { readGps } from './exif.mjs';
import { zipBytes } from './zip.mjs';
const encoder = new TextEncoder();
const body = file => file.bytes || encoder.encode(file.text);
async function digest(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join(''); }
export async function makePacket(routeBytes, photos, options = {}) {
  const bytes = routeBytes instanceof Uint8Array ? routeBytes : new Uint8Array(routeBytes);
  if (bytes.length > 3_000_000) throw Error('Select a GeoJSON route under 3 MB.');
  const routeText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!photos.length || photos.length > LIMITS.photos || photos.reduce((sum, p) => sum + p.bytes.length, 0) > LIMITS.totalBytes) throw Error('Use 1 to 1,000 JPEG photos totaling at most 250 MB. Split larger batches.');
  const metadata = photos.map(p => {
    if (!/\.jpe?g$/i.test(p.name) || p.bytes.length > LIMITS.photoBytes) throw Error('Use JPEG photos under 30 MB each: ' + p.name);
    try { return { name: p.name, ...readGps(p.bytes) }; } catch (error) { return { name: p.name, error: error.message }; }
  });
  const result = inspect(parseRoute(routeText, options), metadata, options), files = outputDocuments(result);
  files.push({ name: 'inputs/route.geojson', bytes });
  const source = new Map(photos.map(p => [p.name, p]));
  for (const photo of result.photos) files.push({ name: photo.output, bytes: source.get(photo.source).bytes });
  const manifest = { version: result.version, inputs: [{ name: 'route.geojson', sha256: await digest(bytes) }], outputs: [] };
  for (const photo of photos) manifest.inputs.push({ name: photo.name, sha256: await digest(photo.bytes) });
  for (const file of files) manifest.outputs.push({ name: file.name, bytes: body(file).length, sha256: await digest(body(file)) });
  files.push({ name: 'manifest.json', text: JSON.stringify(manifest, null, 2) + '\n' });
  return { result, files, zip: zipBytes(files) };
}
