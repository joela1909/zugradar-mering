import test from 'node:test'; import assert from 'node:assert/strict';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { tilesFor, pickTiles, railLinesFromTile } from './tilerail.js';
test('Kacheln für einen Ausschnitt', () => {
  const t = tilesFor([10.943, 48.353], [10.959, 48.301]);
  assert.ok(t.length >= 2 && t.length < 20); assert.ok(t.every(k => k.z === 14));
});
test('Gleise aus einer Vektorkachel lesen (ohne Abstellgleise, ohne Straßen)', () => {
  const fc = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { class: 'rail' }, geometry: { type: 'LineString', coordinates: [[10.94, 48.35], [10.95, 48.34]] } },
    { type: 'Feature', properties: { class: 'rail', service: 'yard' }, geometry: { type: 'LineString', coordinates: [[10.941, 48.35], [10.951, 48.34]] } },
    { type: 'Feature', properties: { class: 'primary' }, geometry: { type: 'LineString', coordinates: [[10.94, 48.345], [10.95, 48.345]] } },
  ] };
  const [{ z, x, y }] = tilesFor([10.945, 48.345], [10.945, 48.345], 0);
  const idx = new geojsonvt(fc, { maxZoom: 14, buffer: 64 });
  const buf = vtpbf.fromGeojsonVt({ transportation: idx.getTile(z, x, y) });
  const lines = railLinesFromTile(buf, { z, x, y });
  assert.equal(lines.length, 1);
  // alle Punkte liegen auf dem ursprünglichen Gleis (Kachel schneidet nur ab)
  assert.ok(lines[0].length >= 2 && lines[0].every(([lon, lat]) => Math.abs(lat - (48.35 - (lon - 10.94))) < 0.0003));
});

test('lange Abschnitte: gröbere Kachelstufe, Bereich deckt den Gleisbogen ab', () => {
  const pasing = [11.461872, 48.149852], mering = [10.988291, 48.262698];
  const t = pickTiles(pasing, mering);
  assert.ok(t && t.length <= 40 && t[0].z <= 12, `z=${t?.[0].z} n=${t?.length}`);
  const kurz = pickTiles([10.943376, 48.352977], [10.959553, 48.300922]);
  assert.equal(kurz[0].z, 14);
});
