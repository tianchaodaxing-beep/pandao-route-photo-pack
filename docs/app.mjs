import { escapeHtml, stationLabel, LIMITS } from './core.mjs';
const $ = id => document.getElementById(id);
let routeFile = null, photoFiles = [], result = null, zip = null, worker = null, busy = false, currentId = null, filter = 'all';
const photoUrls = new Map();
const labels = { located: 'Located', ambiguous: 'Multiple positions', off_route: 'Too far from route', missing_gps: 'No GPS', metadata_error: 'Unreadable location' };
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function setBusy(value) { busy = value; for (const id of ['sample', 'route-input', 'photos-input', 'start', 'offset', 'interval']) $(id).disabled = value; $('build').disabled = value || !routeFile || !photoFiles.length; $('download').disabled = value || !zip; }
function invalidate() { zip = null; result = null; $('results').hidden = true; $('download').disabled = true; $('build').disabled = !routeFile || !photoFiles.length; $('basis').textContent = 'If the route supplies engineering stations, those stations take precedence.'; for (const url of photoUrls.values()) URL.revokeObjectURL(url); photoUrls.clear(); }
function selectedInputs() { $('route-name').textContent = routeFile?.name || 'One GeoJSON LineString'; $('photo-count').textContent = photoFiles.length ? photoFiles.length + ' JPEG files' : 'JPEG files with GPS'; }
function setOwn() { $('mode').textContent = 'Your file batch'; $('sample-note').hidden = true; }
$('route-input').addEventListener('change', event => { routeFile = event.target.files[0] || null; invalidate(); selectedInputs(); setOwn(); status('Route selected. Add photos, then build the packet.'); });
$('photos-input').addEventListener('change', event => { photoFiles = [...event.target.files].sort((a, b) => a.name.localeCompare(b.name, 'en')); invalidate(); selectedInputs(); setOwn(); status('Photos selected. Check the settings, then build the packet.'); });
for (const id of ['start', 'offset', 'interval']) $(id).addEventListener('input', () => { invalidate(); status('Settings changed. Build the packet again.'); });
$('build').addEventListener('click', build);
$('sample').addEventListener('click', async () => {
  if (busy) return;
  invalidate(); setBusy(true); status('Loading the illustrative field example…');
  try {
    const fetchFile = async (path, name) => { const response = await fetch(path); if (!response.ok) throw Error('The example file could not be loaded. Refresh and try again.'); return new File([await response.blob()], name); };
    routeFile = await fetchFile('samples/route.geojson', 'route.geojson');
    photoFiles = await Promise.all(Array.from({ length: 9 }, (_, i) => { const name = 'IMG_' + String(i + 1).padStart(4, '0') + '.jpg'; return fetchFile('samples/photos/' + name, name); }));
    for (const [id, value] of [['start', '0'], ['offset', '30'], ['interval', '100']]) $(id).value = value;
    $('route-input').value = ''; $('photos-input').value = '';
    selectedInputs(); $('mode').textContent = 'Illustrative field example'; $('sample-note').hidden = false;
    setBusy(false); await build(); $('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { status(error.message, true); setBusy(false); }
});
async function build() {
  if (busy || !routeFile || !photoFiles.length) return;
  invalidate(); setBusy(true); status('Reading photo locations and building the handoff…');
  try {
    if (routeFile.size > 3_000_000 || photoFiles.length > LIMITS.photos || photoFiles.reduce((s, p) => s + p.size, 0) > LIMITS.totalBytes || photoFiles.some(p => p.size > LIMITS.photoBytes)) throw Error('Use a route under 3 MB and up to 1,000 JPEG photos, under 30 MB each and 250 MB total.');
    const options = { startM: $('start').valueAsNumber, maxOffsetM: $('offset').valueAsNumber, intervalM: $('interval').valueAsNumber };
    const route = await routeFile.arrayBuffer(), photos = [];
    for (const photo of photoFiles) { photos.push({ name: photo.name, bytes: await photo.arrayBuffer() }); photoUrls.set(photo.name, URL.createObjectURL(photo)); }
    worker?.terminate(); worker = new Worker('worker.mjs', { type: 'module' });
    const data = await new Promise((resolve, reject) => { worker.onmessage = event => event.data.error ? reject(Error(event.data.error)) : resolve(event.data); worker.onerror = () => reject(Error('The photo batch could not be processed. Refresh and try a smaller batch.')); worker.postMessage({ route, photos, options }, [route, ...photos.map(p => p.bytes)]); });
    result = data.result; zip = data.zip; render(); status(`Packet ready: ${result.summary.located} located photos and ${result.summary.review} photos to review.`);
  } catch (error) { invalidate(); status(error.message, true); }
  finally { worker?.terminate(); worker = null; setBusy(false); }
}
function render() {
  $('results').hidden = false;
  for (const [id, value] of [['located', result.summary.located], ['review', result.summary.review], ['empty', result.summary.emptyBins]]) $(id).textContent = value;
  $('route-title').textContent = result.route.name;
  $('range').textContent = stationLabel(result.route.stations[0]) + ' → ' + stationLabel(result.route.stations.at(-1));
  $('basis').textContent = result.route.stationBasis === 'supplied_stations' ? 'Using the engineering stations supplied with this route.' : 'Using approximate surface-distance stations from the selected start.';
  $('interval-caption').textContent = result.config.intervalM + ' m intervals';
  $('coverage-strip').innerHTML = result.coverage.map(b => `<div class="${b.photos.length ? 'filled' : ''}" title="${stationLabel(b.startM)} to ${stationLabel(b.endM)}: ${b.photos.length} photos"></div>`).join('');
  filter = 'all'; document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
  renderTable(); selectPhoto(result.photos[0].id);
}
function renderTable() {
  $('photo-rows').innerHTML = result.photos.filter(r => filter === 'all' || (filter === 'located' ? r.assigned : !r.assigned)).map(r => `<tr><td><button data-photo="${r.id}">${escapeHtml(r.source)}</button></td><td class="station-cell">${r.assigned ? r.assigned.station : 'Review'}</td><td>${r.suggested ? r.suggested.offsetM.toFixed(1) + ' m' : '—'}</td><td><span class="pill ${r.assigned ? '' : 'review'}">${labels[r.status]}</span></td></tr>`).join('');
}
function selectPhoto(id) {
  currentId = id; const row = result.photos.find(r => r.id === id);
  $('photo-id').textContent = 'Photo ' + row.id;
  $('selected-image').src = photoUrls.get(row.source); $('selected-image').alt = row.source;
  $('photo-details').innerHTML = `<h4>${row.assigned ? row.assigned.station + ' · ' + row.assigned.side : labels[row.status]}</h4><p>${escapeHtml(row.source)}</p><p>${row.assigned ? row.assigned.offsetM.toFixed(1) + ' m from route' : row.candidates ? 'Suggested stations: ' + row.candidates.map(c => c.station).join(' / ') : 'Check the original photo location.'}</p><p>${escapeHtml(row.capturedAt || 'Capture time unavailable')}</p><p>${row.assigned ? 'Included in the station-named photo folder.' : 'Included in the review folder. Confirm the location before assigning a station.'}</p>`;
  renderMap();
}
function renderMap() {
  // An unwrapped local overview avoids a seam on routes crossing the date line.
  const origin = result.route.coordinates[0], cos = Math.cos(origin[1] * Math.PI / 180);
  const xy = c => [(((c[0] - origin[0] + 540) % 360) - 180) * cos, c[1] - origin[1]];
  const coords = result.route.coordinates.map(xy), photoCoords = result.photos.filter(p => p.gps).map(p => ({ id: p.id, status: p.status, p: xy(p.gps) }));
  // Keep distant photos from flattening the route; the table still includes them.
  const visible = photoCoords.filter(p => result.photos.find(r => r.id === p.id).suggested?.offsetM <= Math.max(100, result.config.maxOffsetM * 3));
  const all = [...coords, ...visible.map(p => p.p)], xs = all.map(p => p[0]), ys = all.map(p => p[1]), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(560 / Math.max(maxX - minX, 0.00001), 290 / Math.max(maxY - minY, 0.00001)), centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const point = p => [325 + (p[0] - centerX) * scale, 190 - (p[1] - centerY) * scale], routePoints = coords.map(point);
  $('route-map').innerHTML = `<defs><pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#dce8ef" stroke-width="1"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#164b69"/></marker></defs><rect width="650" height="380" fill="url(#grid)"/><polyline class="route-line" points="${routePoints.map(p => p.join(',')).join(' ')}" marker-end="url(#arrow)"/><text x="${routePoints[0][0] + 10}" y="${routePoints[0][1] + 23}">${stationLabel(result.route.stations[0])}</text><text x="${routePoints.at(-1)[0] - 60}" y="${routePoints.at(-1)[1] - 15}">${stationLabel(result.route.stations.at(-1))}</text>${visible.map(p => { const [x, y] = point(p.p); return `<circle cx="${x}" cy="${y}" r="${p.id === currentId ? 9 : 6}" class="photo-point ${p.status === 'located' ? '' : 'review'} ${p.id === currentId ? 'selected' : ''}" data-photo="${p.id}" tabindex="0" role="button" aria-label="Select photo ${p.id}"><title>Photo ${p.id}</title></circle>`; }).join('')}`;
}
document.addEventListener('click', event => { const photo = event.target.closest('[data-photo]'); if (photo && result) selectPhoto(photo.dataset.photo); const button = event.target.closest('[data-filter]'); if (button && result) { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === button)); renderTable(); } });
$('route-map').addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && event.target.dataset.photo) { event.preventDefault(); selectPhoto(event.target.dataset.photo); } });
$('download').addEventListener('click', () => { if (!zip) return; const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' })), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'route-photo-packet.zip'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); status('Photo packet downloaded. Extract the ZIP, then open index.html.'); });
