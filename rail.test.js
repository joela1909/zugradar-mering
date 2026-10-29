import test from 'node:test'; import assert from 'node:assert/strict';
import { buildGraph, shortestPath, thin, nearestNode, overpassQuery, meters } from './rail.js';

// Gleis A: gerade von (0,0) nach (0.03,0); Gleis B: Umweg über Norden; getrennte Insel weit weg
const way = (id, nodes, pts) => ({ type: 'way', id, nodes, geometry: pts.map(([lon, lat]) => ({ lat, lon })) });
const els = [
  way(1, [1, 2, 3], [[10, 48], [10.01, 48], [10.02, 48]]),
  way(2, [3, 4], [[10.02, 48], [10.03, 48]]),
  way(3, [1, 5, 6, 4], [[10, 48], [10, 48.02], [10.03, 48.02], [10.03, 48]]),
  way(4, [90, 91], [[12, 50], [12.01, 50]]),
];
test('Graph + kürzester Weg folgt dem direkten Gleis', () => {
  const g = buildGraph(els), p = shortestPath(g, [10.0001, 48.0001], [10.0299, 48.0001]);
  assert.ok(p && p.length === 4); assert.deepEqual(p[0], [10, 48]); assert.deepEqual(p.at(-1), [10.03, 48]);
});
test('Umweg wenn das direkte Gleis fehlt', () => {
  const g = buildGraph(els.filter(e => e.id !== 1)); const p = shortestPath(g, [10, 48], [10.03, 48]);
  assert.ok(p.some(c => c[1] === 48.02));
});
test('nicht verbunden / zu weit weg', () => {
  const g = buildGraph(els);
  assert.equal(shortestPath(g, [10, 48], [12, 50]), null);
  assert.equal(nearestNode(g, [10.5, 48.5]), null);
});
test('ausdünnen + Abfrage', () => {
  const pts = Array.from({ length: 50 }, (_, i) => [10 + i * 0.00001, 48]);
  const t = thin(pts, 8); assert.ok(t.length < 20); assert.deepEqual(t[0], pts[0]); assert.deepEqual(t.at(-1), pts.at(-1));
  assert.match(overpassQuery([10, 48], [10.1, 48.1]), /railway.*rail.*out geom/);
  assert.ok(Math.abs(meters([10, 48], [10, 48.001]) - 111) < 2);
});
import { smoothPath } from './rail.js';
test('glätten: Endpunkte bleiben, Zacken verschwinden, Kurven bleiben nah', () => {
  const zig = Array.from({ length: 60 }, (_, i) => [10 + i * 0.0003, 48 + (i % 2) * 0.00004]); // 4-m-Zacken
  const s = smoothPath(zig);
  assert.deepEqual(s[0], zig[0]); assert.deepEqual(s.at(-1), zig.at(-1));
  const mid = s.slice(3, -3); const spread = Math.max(...mid.map(p => p[1])) - Math.min(...mid.map(p => p[1]));
  assert.ok(spread * 111000 < 1.5, 'Zacken < 1,5 m');
  const arc = Array.from({ length: 50 }, (_, i) => { const a = i / 49 * Math.PI / 2; return [10 + Math.sin(a) * 0.01, 48 + (1 - Math.cos(a)) * 0.007]; });
  const sa = smoothPath(arc); const d = Math.max(...sa.map(p => Math.min(...arc.map(q => meters(p, q)))));
  assert.ok(d < 15, 'Kurve weicht < 15 m ab: ' + d.toFixed(1));
});
import { buildGraphFromLines } from './rail.js';
test('Linien aus Kacheln: Nähte an Kachelgrenzen werden verbunden', () => {
  // Gleis über zwei Kacheln, an der Grenze 2 m Lücke; dazu ein Abzweig
  const left = [[10.000, 48], [10.005, 48], [10.0099, 48]], right = [[10.009925, 48.00001], [10.015, 48], [10.02, 48]];
  const branch = [[10.005, 48], [10.005, 48.01]];
  const g = buildGraphFromLines([left, right, branch]);
  const p = shortestPath(g, [10.0001, 48], [10.0199, 48]);
  assert.ok(p && p.length >= 5); assert.deepEqual(p.at(-1), [10.02, 48]);
  const q = shortestPath(g, [10.0001, 48], [10.005, 48.0099]); assert.ok(q);   // über den Abzweig
  assert.equal(shortestPath(buildGraphFromLines([left, [[10.012, 48], [10.02, 48]]]), [10, 48], [10.02, 48]), null); // 160 m Lücke: nicht verbunden
});
