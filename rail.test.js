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
