#!/usr/bin/env node
import { readFile, readdir, mkdir, writeFile, stat, lstat, rename, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makePacket } from '../docs/packet.mjs';
import { VERSION, LIMITS } from '../docs/core.mjs';
const HELP = `Route Photo Pack ${VERSION}

Usage:
  route-photo-pack --route route.geojson --photos photo-folder --out new-packet

Options:
  --route FILE       One WGS84 GeoJSON LineString
  --photos FOLDER    Folder containing JPEG photos (no recursive scan)
  --out FOLDER       New output folder; existing folders are never replaced
  --start-m NUMBER   Starting station in meters (default: 0)
  --offset-m NUMBER  Maximum photo distance from route (default: 30)
  --ambiguity-m N    Distance tolerance for multiple route positions (default: 5)
  --interval-m N     Photo coverage interval in meters (default: 100)
  --help            Show help
  --version         Print version

A feature may supply properties.stations_m, one increasing station per vertex.
Without those stations, locations use approximate surface distance.
Review photos with missing GPS, distant positions or multiple route positions.
Intervals without photos do not prove that an inspection was missed.
No original file is renamed or modified.
Contact: tianchaodaxing@gmail.com`;
async function boundedRead(path, limit) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw Error('Use a regular file within the size limit: ' + path);
  const bytes = await readFile(path);
  if (bytes.length > limit) throw Error('The file grew beyond its size limit: ' + path);
  return bytes;
}
async function main(args) {
  if (!args.length || args.includes('--help')) { console.log(HELP); return; }
  if (args.includes('--version')) { console.log(VERSION); return; }
  const options = {}, allowed = ['route', 'photos', 'out', 'start-m', 'offset-m', 'ambiguity-m', 'interval-m'];
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !allowed.includes(key) || key in options || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw Error('Unknown, repeated or incomplete option: ' + args[i]);
    options[key] = args[++i];
  }
  if (!options.route || !options.photos || !options.out) throw Error('Supply --route, --photos and --out. See --help.');
  const config = {};
  for (const [key, field] of [['start-m', 'startM'], ['offset-m', 'maxOffsetM'], ['ambiguity-m', 'ambiguityM'], ['interval-m', 'intervalM']]) if (key in options) { if (!options[key].trim() || !Number.isFinite(Number(options[key]))) throw Error('Use a finite number for --' + key); config[field] = Number(options[key]); }
  const out = resolve(options.out), folder = resolve(options.photos);
  try { await stat(out); throw Error('Output already exists. Choose a new output folder.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const route = await boundedRead(resolve(options.route), 3_000_000);
  const dirInfo = await lstat(folder);
  if (!dirInfo.isDirectory()) throw Error('Select a regular photo folder.');
  const entries = (await readdir(folder, { withFileTypes: true })).filter(x => /\.jpe?g$/i.test(x.name)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (!entries.length || entries.length > LIMITS.photos) throw Error('The photo folder needs 1 to 1,000 JPEG files.');
  const photos = []; let total = 0;
  for (const entry of entries) {
    if (!entry.isFile()) throw Error('Photo symlinks and folders are not accepted: ' + entry.name);
    const bytes = await boundedRead(join(folder, entry.name), LIMITS.photoBytes); total += bytes.length;
    if (total > LIMITS.totalBytes) throw Error('The photo batch exceeds 250 MB. Split this batch.');
    photos.push({ name: entry.name, bytes });
  }
  const packet = await makePacket(route, photos, config);
  await mkdir(dirname(out), { recursive: true });
  const stage = join(dirname(out), '.route-photo-pack-' + randomUUID()); await mkdir(stage);
  try {
    for (const file of packet.files) { const path = join(stage, file.name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.bytes || file.text, { flag: 'wx' }); }
    await writeFile(join(stage, 'route-photo-packet.zip'), packet.zip, { flag: 'wx' });
    // Reserve the destination before moving outputs; another invocation cannot replace it.
    await mkdir(out);
    for (const entry of await readdir(stage)) await rename(join(stage, entry), join(out, entry));
    await rm(stage, { recursive: true });
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
  console.log(JSON.stringify({ output: out, ...packet.result.summary }, null, 2));
}
main(process.argv.slice(2)).catch(error => { console.error('Route Photo Pack: ' + error.message); process.exitCode = 1; });
