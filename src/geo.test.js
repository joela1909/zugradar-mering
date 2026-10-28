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
