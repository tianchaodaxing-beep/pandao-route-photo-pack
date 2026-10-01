import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, locate, inspect, stationLabel, outputDocuments } from '../docs/core.mjs';
const line = coordinates => JSON.stringify({ type: 'LineString', coordinates });
const straight = () => parseRoute(line([[0, 0], [0.01, 0]]));
const calibrated = () => parseRoute(JSON.stringify({ type: 'Feature', properties: { name: 'Road A', stations_m: [12000, 13000] }, geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0]] } }));
test('Equatorial route has independently known surface length', () => assert.ok(Math.abs(straight().lengthM - 1111.950802335329) < 0.00001));
test('A midpoint uses supplied engineering stations', () => { const p = locate(calibrated(), [0.005, 0]); assert.equal(p.status, 'located'); assert.equal(p.suggested.stationM, 12500); });
test('A start station offsets surface-distance stationing', () => { const r = parseRoute(line([[0, 0], [0.01, 0]]), { startM: 2500 }); assert.equal(locate(r, [0.005, 0]).suggested.stationM, 3055.975); });
test('Supplied stations take precedence over a start offset', () => { const r = parseRoute(JSON.stringify({ type: 'Feature', properties: { stations_m: [10, 20] }, geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0]] } }), { startM: 9000 }); assert.equal(locate(r, [0.005, 0]).suggested.stationM, 15); });
test('North of an eastbound route is left', () => assert.equal(locate(straight(), [0.005, 0.0001]).suggested.side, 'left'));
test('South of an eastbound route is right', () => assert.equal(locate(straight(), [0.005, -0.0001]).suggested.side, 'right'));
test('A photo on the line is center', () => assert.equal(locate(straight(), [0.005, 0]).suggested.side, 'center'));
test('Projection is clamped to route endpoints', () => { const p = locate(calibrated(), [-0.0001, 0]); assert.equal(p.suggested.stationM, 12000); assert.ok(Math.abs(p.suggested.offsetM - 11.12) < 0.01); });
test('A photo beyond the offset limit receives no assigned station', () => { const r = inspect(straight(), [{ name: 'distant.jpg', gps: [0.005, 0.01] }]); assert.equal(r.photos[0].status, 'off_route'); assert.equal(r.photos[0].assigned, null); assert.equal(r.summary.located, 0); });
test('A crossing retains materially different station candidates', () => { const r = parseRoute(line([[-0.001, -0.001], [0.001, 0.001], [-0.001, 0.001], [0.001, -0.001]])); const p = locate(r, [0, 0]); assert.equal(p.status, 'ambiguous'); assert.equal(p.candidates.length, 2); assert.ok(Math.abs(p.candidates[1].stationM - p.candidates[0].stationM) > 500); });
test('Neighboring segments at a shared vertex are one position', () => { const p = locate(parseRoute(line([[0, 0], [0.001, 0], [0.001, 0.001]])), [0.001, 0]); assert.equal(p.status, 'located'); });
test('Nearby returning sections are ambiguous', () => { const p = locate(parseRoute(line([[0, 0], [0.002, 0], [0.002, 0.00005], [0, 0.00005]])), [0.001, 0.000025]); assert.equal(p.status, 'ambiguous'); });
test('Route crosses the date line along the short path', () => { const r = parseRoute(line([[179.999, 0], [-179.999, 0]])); assert.ok(Math.abs(r.lengthM - 222.39016) < 0.001); assert.ok(locate(r, [180, 0]).suggested.offsetM < 0.001); });
test('A single feature collection is accepted', () => assert.equal(parseRoute(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0]] } }] })).segments.length, 1));
for (const [name, data] of [
  ['invalid JSON', '{bad'], ['multiple route features', JSON.stringify({ type: 'FeatureCollection', features: [{}, {}] })],
  ['projected coordinates', line([[500000, 4000000], [500100, 4000000]])], ['duplicate route vertices', line([[0, 0], [0, 0]])],
  ['unsupported MultiLineString', JSON.stringify({ type: 'MultiLineString', coordinates: [[[0, 0], [0.01, 0]]] })],
  ['long route segment', line([[0, 0], [2, 0]])], ['legacy CRS on a collection', JSON.stringify({ type: 'FeatureCollection', crs: {}, features: [] })],
  ['string coordinates', line([['0', 0], [0.01, 0]])],
  ['decreasing engineering stations', JSON.stringify({ type: 'Feature', properties: { stations_m: [20, 10] }, geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0]] } })],
  ['station array length mismatch', JSON.stringify({ type: 'Feature', properties: { stations_m: [1] }, geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0]] } })]
]) test('Reject ' + name, () => assert.throws(() => parseRoute(data)));
test('Missing GPS stays in review and does not fill coverage', () => { const r = inspect(calibrated(), [{ name: 'no-location.jpg' }]); assert.equal(r.photos[0].status, 'missing_gps'); assert.match(r.photos[0].output, /^review\//); assert.equal(r.summary.emptyBins, r.summary.bins); });
test('Metadata errors remain explicit', () => { const r = inspect(calibrated(), [{ name: 'damaged.jpg', error: 'Damaged GPS' }]); assert.equal(r.photos[0].status, 'metadata_error'); assert.equal(r.photos[0].error, 'Damaged GPS'); });
test('Coverage boundaries and final endpoint are assigned once', () => { const r = inspect(calibrated(), [{ name: 'a.jpg', gps: [0, 0] }, { name: 'b.jpg', gps: [0.001, 0] }, { name: 'c.jpg', gps: [0.01, 0] }], { intervalM: 100 }); assert.equal(r.coverage[0].photos.length, 1); assert.equal(r.coverage[1].photos.length, 1); assert.equal(r.coverage[9].photos.length, 1); assert.equal(r.coverage.flatMap(b => b.photos).length, 3); });
test('Invalid coverage interval is rejected', () => assert.throws(() => inspect(straight(), [{ name: 'a.jpg' }], { intervalM: 0 })));
test('Invalid location settings are rejected even without GPS', () => assert.throws(() => inspect(straight(), [{ name: 'a.jpg' }], { maxOffsetM: NaN })));
test('Duplicate photo names are rejected across letter case', () => assert.throws(() => inspect(straight(), [{ name: 'A.jpg' }, { name: 'a.jpg' }])));
test('Station formatting carries rounded kilometers', () => { assert.equal(stationLabel(12999.6), '13+000'); assert.equal(stationLabel(5), '0+005'); });
test('Output filenames stay relative and unique', () => { const r = inspect(straight(), [{ name: '../../evil.jpg' }, { name: 'a b.jpg' }]); assert.ok(r.photos.every(p => !p.output.includes('..'))); assert.equal(new Set(r.photos.map(p => p.output)).size, 2); });
test('HTML escapes source names and route names', () => { const route = calibrated(); route.name = '<script>alert(1)</script>'; const r = inspect(route, [{ name: '<img onerror=alert(1)>.jpg' }]); const html = outputDocuments(r).find(f => f.name === 'index.html').text; assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img onerror')); });
test('CSV protects formulas in source names but preserves negative numeric coordinates', () => { const r = inspect(straight(), [{ name: '=HYPERLINK(1).jpg', gps: [-0.00001, 0] }]); const text = outputDocuments(r).find(f => f.name === 'photo-register.csv').text; assert.ok(text.includes('"\'=HYPERLINK(1).jpg"')); assert.ok(text.includes('"-0.00001"')); });
test('GIS export retains original GPS and no assigned station for review photos', () => { const r = inspect(straight(), [{ name: 'outside.jpg', gps: [0.005, 0.01] }]); const data = JSON.parse(outputDocuments(r).find(f => f.name === 'inspection.geojson').text); assert.deepEqual(data.features[1].geometry.coordinates, [0.005, 0.01]); assert.equal(data.features[1].properties.station_m, null); });
