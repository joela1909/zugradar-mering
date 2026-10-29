import test from 'node:test'; import assert from 'node:assert/strict';
import { createGpsFilter } from './gps.js';
const fix = (lon, t, acc = 8) => ({ ll: [lon, 48.27], t, acc });
test('ältere/zwischengespeicherte Fixes werden verworfen', () => {
  const ok = createGpsFilter();
  assert.equal(ok(fix(10.85, 1000)), true); assert.equal(ok(fix(10.8502, 2000)), true);
  assert.equal(ok(fix(10.85, 1500)), false); assert.equal(ok(fix(10.8502, 2000)), false);
});
test('grobe Position zwischen guten wird ignoriert', () => {
  const ok = createGpsFilter();
  ok(fix(10.85, 0)); assert.equal(ok(fix(10.86, 1000, 500)), false); assert.equal(ok(fix(10.8501, 2000)), true);
});
test('unplausibler Sprung wird ignoriert, nach mehreren Fixes aber akzeptiert', () => {
  const ok = createGpsFilter({ maxRejects: 3 });
  ok(fix(10.85, 0));
  for (let i = 1; i <= 3; i++) assert.equal(ok(fix(10.95, i * 1000)), false); // 7 km in 1 s
  assert.equal(ok(fix(10.95, 4000)), true);
});
test('normale Fahrt (30 m/s) bleibt erhalten', () => {
  const ok = createGpsFilter(); ok(fix(10.85, 0));
  assert.equal(ok(fix(10.85 + 30 / 74000, 1000)), true);
});
