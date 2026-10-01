export const VERSION = '0.1.0';
export const LIMITS = { photos: 1000, totalBytes: 250_000_000, photoBytes: 30_000_000, vertices: 10000, projections: 5_000_000 };
const R = 6371008.8, rad = Math.PI / 180;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(...a);
const unit = a => a.map(x => x / norm(a));
const vector = ([lon, lat]) => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)];
const angle = (a, b) => Math.atan2(norm(cross(a, b)), dot(a, b));
const lonlat = a => [Math.atan2(a[1], a[0]) / rad, Math.atan2(a[2], Math.hypot(a[0], a[1])) / rad];
const rounded = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
export function validCoordinate(c) { return Array.isArray(c) && c.length >= 2 && c.slice(0, 2).every(x => typeof x === 'number' && Number.isFinite(x)) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90; }
export function parseRoute(text, { startM = 0 } = {}) {
  if (typeof text !== 'string' || text.length > 3_000_000) throw Error('The route must be a GeoJSON file under 3 MB.');
  let data; try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw Error('The route is not valid JSON. Export one GeoJSON LineString.'); }
  if (data.crs) throw Error('Re-export this route in WGS84 longitude, latitude without a legacy CRS.');
  if (data.type === 'FeatureCollection') { if (!Array.isArray(data.features) || data.features.length !== 1) throw Error('Select a GeoJSON file with exactly one route feature.'); data = data.features[0]; }
  const properties = data.type === 'Feature' ? data.properties || {} : {}, geometry = data.type === 'Feature' ? data.geometry : data;
  if (geometry?.type !== 'LineString') throw Error('The route must be one continuous GeoJSON LineString in WGS84 longitude, latitude.');
  const points = geometry.coordinates;
  if (!Array.isArray(points) || points.length < 2 || points.length > LIMITS.vertices || !points.every(validCoordinate)) throw Error('The route needs 2 to 10,000 valid longitude, latitude vertices.');
  if (data.crs || geometry.crs) throw Error('Re-export this route in WGS84 longitude, latitude without a legacy CRS.');
  if (!Number.isFinite(startM) || startM < 0 || startM > 1e9) throw Error('The start station must be between 0 and 1,000,000,000 meters.');
  const supplied = properties.stations_m;
  if (supplied !== undefined && (!Array.isArray(supplied) || supplied.length !== points.length || supplied.some((x, i) => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1e9 || i && x <= supplied[i - 1]))) throw Error('stations_m must contain one strictly increasing station in meters per route vertex.');
  const stations = supplied ? [...supplied] : [startM], segments = []; let lengthM = 0;
  for (let i = 1; i < points.length; i++) {
    const a = vector(points[i - 1]), b = vector(points[i]), theta = angle(a, b), length = theta * R;
    if (length < 0.01) throw Error('Remove duplicate route vertices or segments shorter than 1 cm.');
    if (length > 100_000) throw Error('A route segment exceeds 100 km. Add intermediate vertices.');
    lengthM += length;
    if (!supplied) stations.push(startM + lengthM);
    const normal = unit(cross(a, b)), tangent = cross(normal, a);
    segments.push({ index: i - 1, a, b, normal, tangent, theta, lengthM: length, startM: stations[i - 1], endM: stations[i] });
  }
  if (stations.at(-1) - stations[0] > 1_000_000) throw Error('Split routes longer than 1,000 km into separate jobs.');
  return { name: typeof properties.name === 'string' ? properties.name.slice(0, 120) : 'Inspection route', coordinates: points.map(p => p.slice(0, 2)), stations, lengthM, stationBasis: supplied ? 'supplied_stations' : 'surface_distance', segments };
}
export function stationLabel(m) { const n = Math.round(m); return Math.floor(n / 1000) + '+' + String(n % 1000).padStart(3, '0'); }
function projection(segment, p) {
  const t = Math.max(0, Math.min(segment.theta, Math.atan2(dot(p, segment.tangent), dot(p, segment.a))));
  const q = segment.a.map((x, i) => x * Math.cos(t) + segment.tangent[i] * Math.sin(t));
  const offsetM = angle(p, q) * R, side = offsetM < 1 ? 'center' : dot(p, segment.normal) >= 0 ? 'left' : 'right';
  return { stationM: segment.startM + t / segment.theta * (segment.endM - segment.startM), offsetM, side, segment: segment.index, onRoute: lonlat(q) };
}
export function locate(route, coordinate, { maxOffsetM = 30, ambiguityM = 5 } = {}) {
  if (!validCoordinate(coordinate)) throw Error('The photo needs a valid longitude, latitude coordinate.');
  if (!Number.isFinite(maxOffsetM) || maxOffsetM < 1 || maxOffsetM > 1000 || !Number.isFinite(ambiguityM) || ambiguityM < 0 || ambiguityM > 100) throw Error('Use an offset limit of 1 to 1,000 m and ambiguity tolerance of 0 to 100 m.');
  const p = vector(coordinate), candidates = route.segments.map(s => projection(s, p)).sort((a, b) => a.offsetM - b.offsetM || a.stationM - b.stationM), best = candidates[0];
  const alternatives = [];
  for (const c of candidates) if (c.offsetM <= best.offsetM + ambiguityM && c.offsetM <= maxOffsetM && Math.abs(c.stationM - best.stationM) >= 30 && !alternatives.some(a => Math.abs(a.stationM - c.stationM) < 30)) alternatives.push(c);
  const status = best.offsetM > maxOffsetM ? 'off_route' : alternatives.length ? 'ambiguous' : 'located';
  const format = c => ({ ...c, stationM: rounded(c.stationM), offsetM: rounded(c.offsetM), station: stationLabel(c.stationM), onRoute: c.onRoute.map(x => rounded(x, 8)) });
  return { status, suggested: format(best), candidates: [best, ...alternatives].map(format) };
}
export function inspect(route, photos, options = {}) {
  const config = { startM: 0, maxOffsetM: 30, ambiguityM: 5, intervalM: 100, ...options };
  if (!Number.isFinite(config.intervalM) || config.intervalM < 10 || config.intervalM > 10000) throw Error('Use a coverage interval of 10 to 10,000 meters.');
  // Validate location settings even when every photo lacks GPS.
  locate(route, route.coordinates[0], config);
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > LIMITS.photos || photos.length * route.segments.length > LIMITS.projections) throw Error('Use 1 to 1,000 photos and at most 5,000,000 photo/segment comparisons. Split this job if needed.');
  const seen = new Set();
  const rows = photos.map((photo, index) => {
    if (typeof photo.name !== 'string' || !photo.name || seen.has(photo.name.toLowerCase())) throw Error('Photo names must be unique, including letter case.');
    seen.add(photo.name.toLowerCase());
    const result = photo.error ? { status: 'metadata_error', error: photo.error } : photo.gps ? locate(route, photo.gps, config) : { status: 'missing_gps' };
    const safeName = photo.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 70) || 'photo';
    const id = String(index + 1).padStart(4, '0'), station = result.status === 'located' ? result.suggested : null;
    const output = station ? `photos/${station.station.replace('+', '-')}_${station.side}_${id}_${safeName}.jpg` : `review/${result.status}_${id}_${safeName}.jpg`;
    return { id, source: photo.name, capturedAt: photo.capturedAt || null, gps: photo.gps || null, ...result, assigned: station, output };
  });
  rows.sort((a, b) => (a.assigned?.stationM ?? Infinity) - (b.assigned?.stationM ?? Infinity) || a.id.localeCompare(b.id));
  const start = route.stations[0], end = route.stations.at(-1), bins = Math.ceil((end - start) / config.intervalM);
  if (bins > 10000) throw Error('Use a wider coverage interval for this route.');
  const coverage = Array.from({ length: bins }, (_, i) => ({ startM: rounded(start + i * config.intervalM), endM: rounded(Math.min(end, start + (i + 1) * config.intervalM)), photos: [] }));
  for (const row of rows) if (row.assigned) { const bin = Math.min(bins - 1, Math.max(0, Math.floor((row.assigned.stationM - start) / config.intervalM))); coverage[bin].photos.push(row.id); }
  const summary = { photos: rows.length, located: rows.filter(x => x.status === 'located').length, review: rows.filter(x => x.status !== 'located').length, bins, emptyBins: coverage.filter(x => !x.photos.length).length };
  return { version: VERSION, route: { name: route.name, coordinates: route.coordinates, stations: route.stations, stationBasis: route.stationBasis, lengthM: rounded(route.lengthM) }, config, summary, photos: rows, coverage };
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function cell(value) { let s = String(value ?? ''); if (typeof value !== 'number' && /^[\s]*[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }
const csv = rows => rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
const json = object => JSON.stringify(object, null, 2) + '\n';
export function outputDocuments(result) {
  const rows = result.photos;
  const header = ['photo_id', 'source_name', 'output_file', 'status', 'station', 'station_m', 'offset_m', 'side', 'longitude', 'latitude', 'captured_at', 'candidate_stations', 'issue'];
  const records = rows.map(r => [r.id, r.source, r.output, r.status, r.assigned?.station, r.assigned?.stationM, r.assigned?.offsetM, r.assigned?.side, r.gps?.[0], r.gps?.[1], r.capturedAt, r.candidates?.map(x => x.station).join(' | '), r.error]);
  const photoCsv = csv([header, ...records]);
  const issues = csv([header, ...records.filter((_, i) => rows[i].status !== 'located')]);
  const coverage = csv([['from_station', 'to_station', 'from_m', 'to_m', 'photo_count', 'photo_ids', 'status'], ...result.coverage.map(b => [stationLabel(b.startM), stationLabel(b.endM), b.startM, b.endM, b.photos.length, b.photos.join(' | '), b.photos.length ? 'has_photos' : 'no_photos'])]);
  const geo = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: result.route.name, stations_m: result.route.stations }, geometry: { type: 'LineString', coordinates: result.route.coordinates } }, ...rows.filter(r => r.gps).map(r => ({ type: 'Feature', properties: { photo_id: r.id, file: r.output, status: r.status, station_m: r.assigned?.stationM ?? null, offset_m: r.suggested?.offsetM ?? null }, geometry: { type: 'Point', coordinates: r.gps } }))] };
  const labels = { located: 'Located', off_route: 'Too far from route', ambiguous: 'Multiple route positions', missing_gps: 'No GPS location', metadata_error: 'Unreadable location' };
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(result.route.name)} — Route Photo Pack</title><style>body{font:15px system-ui;color:#173348;margin:32px;max-width:1200px}h1{font-size:32px}header{border-bottom:4px solid #126b95;padding-bottom:20px}.summary{display:flex;gap:24px;flex-wrap:wrap}section{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}article{border:1px solid #cbd7df;padding:12px;break-inside:avoid}img{width:100%;height:190px;object-fit:contain;background:#eef3f6}h2{font-size:17px}p{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:24px 0}td,th{text-align:left;padding:8px;border:1px solid #cbd7df}.review{border-top:4px solid #d69312}@media print{body{margin:10mm}section{grid-template-columns:repeat(2,1fr)}a{color:inherit;text-decoration:none}}@media(max-width:600px){body{margin:16px}section{grid-template-columns:1fr}}</style><header><h1>${escapeHtml(result.route.name)}</h1><p>Route Photo Pack · ${escapeHtml(stationLabel(result.route.stations[0]))} to ${escapeHtml(stationLabel(result.route.stations.at(-1)))} · ${result.route.stationBasis === 'supplied_stations' ? 'Supplied route stations' : 'Approximate surface-distance stations'}</p><div class="summary"><span>${result.summary.photos} photos</span><span>${result.summary.located} located</span><span>${result.summary.review} need review</span><span>${result.summary.emptyBins} intervals without photos</span></div><p>GPS positions are approximate. Confirm engineering stations against your approved alignment. Intervals without photos do not prove that an inspection was missed.</p></header><h2>Photo register</h2><section>${rows.map(r => `<article class="${r.assigned ? '' : 'review'}"><a href="${escapeHtml(r.output)}"><img loading="lazy" src="${escapeHtml(r.output)}" alt="Inspection photo ${r.id}"></a><h2>${r.assigned ? escapeHtml(r.assigned.station) + ' · ' + r.assigned.side : labels[r.status]}</h2><p>${escapeHtml(r.source)}</p><p>${r.assigned ? r.assigned.offsetM.toFixed(1) + ' m from route' : r.candidates ? 'Suggested stations: ' + r.candidates.map(c => escapeHtml(c.station)).join(' / ') : 'Check the original photo location.'}</p><p>${escapeHtml(r.capturedAt || 'Capture time unavailable')}</p></article>`).join('')}</section><h2>Intervals without photos</h2><table><thead><tr><th>From</th><th>To</th></tr></thead><tbody>${result.coverage.filter(b => !b.photos.length).map(b => `<tr><td>${stationLabel(b.startM)}</td><td>${stationLabel(b.endM)}</td></tr>`).join('') || '<tr><td colspan="2">Every interval has at least one located photo.</td></tr>'}</tbody></table><p>Open photo-register.csv, review.csv and coverage.csv for the complete lists. Use your browser Print command to save this register as a PDF.</p><footer><a href="mailto:tianchaodaxing@gmail.com">tianchaodaxing@gmail.com</a></footer></html>\n`;
  return [{ name: 'index.html', text: html }, { name: 'photo-register.csv', text: photoCsv }, { name: 'review.csv', text: issues }, { name: 'coverage.csv', text: coverage }, { name: 'inspection.geojson', text: json(geo) }, { name: 'report.json', text: json(result) }];
}
