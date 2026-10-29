import test from 'node:test'; import assert from 'node:assert/strict';
import { splitRoute, dist } from './geo.js';
const line = [[10, 48], [10.01, 48], [10.02, 48], [10.02, 48.01]]; // Ost, dann Nord
test('Route teilen', () => {
  const r = splitRoute(line, [10.005, 48.0002]);
  assert.ok(r.off < 40); assert.equal(r.done.length, 2); assert.equal(r.rest.length, 4);
  assert.ok(Math.abs(r.remaining + r.along - r.total) < 1);
  assert.ok(Math.abs(r.bearing - 90) < 5);                    // fährt nach Osten
  const r2 = splitRoute(line, [10.0201, 48.005]);
  assert.ok(Math.abs(r2.bearing) < 5 || Math.abs(r2.bearing - 360) < 5); // nach Norden
  assert.ok(r2.remaining < r.remaining);
});
test('abseits der Route', () => assert.ok(splitRoute(line, [10.005, 48.01]).off > 900));
test('zu kurze Linie', () => assert.equal(splitRoute([[10, 48]], [10, 48]), null));

import { appendSeg } from './geo.js';
test('Abschnitte auf Nachbargleisen: schräger Übergang statt Quersprung', () => {
  // A endet bei x=0 auf y=0, B beginnt dort 30 m daneben (Nachbargleis)
  const m = 1 / 111320, A = [], B = [];
  for (let k = -20; k <= 0; k++) A.push([10 + k * 10 * m / Math.cos(48 * Math.PI / 180), 48]);
  for (let k = 0; k <= 20; k++) B.push([10 + k * 10 * m / Math.cos(48 * Math.PI / 180), 48 + 30 * m]);
  const L = appendSeg([...A], B);
  // kein Stück mit Richtungsänderung > 45°
  for (let i = 1; i < L.length - 1; i++) {
    const u = [L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]], v = [L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]];
    const c = (u[0] * v[0] * 0.45 + u[1] * v[1]) / (Math.hypot(u[0] * 0.67, u[1]) * Math.hypot(v[0] * 0.67, v[1]));
    assert.ok(c > 0.7, 'Knick bei ' + i);
  }
  assert.deepEqual(appendSeg([[10, 48], [10.001, 48]], [[10.001, 48], [10.002, 48]]), [[10, 48], [10.001, 48], [10.002, 48]]);
});
