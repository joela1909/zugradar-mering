import test from 'node:test'; import assert from 'node:assert/strict';
import { SlidingWindow } from './limiter.js';
test('nie mehr als das Limit in einem Fenster', () => {
  const w = new SlidingWindow(60, 60000);
  assert.equal(w.take(50, 0), 50); assert.equal(w.take(20, 1000), 10); assert.equal(w.take(1, 59999), 0);
  assert.equal(w.take(5, 60000), 5);            // die ersten 50 (t=0) sind aus dem Fenster
  assert.equal(w.used(60000), 15);
  // in jedem 60-s-Fenster höchstens 60
  const v = new SlidingWindow(60, 60000), grants = [];
  for (let t = 0; t < 300000; t += 700) { const k = v.take(3, t); for (let i = 0; i < k; i++) grants.push(t); }
  for (const t0 of grants) assert.ok(grants.filter(t => t >= t0 && t < t0 + 60000).length <= 60);
  assert.ok(grants.length >= 60 * 5 - 60);      // Limit wird ausgeschöpft
});
test('zurückgeben und pausieren', () => {
  const w = new SlidingWindow(10, 60000);
  assert.equal(w.take(8, 0), 8); w.give(5); assert.equal(w.used(0), 3);
  w.pause(5000, 0); assert.equal(w.take(1, 1000), 0); assert.equal(w.take(1, 5001), 1);
  assert.ok(w.nextFree(5001) === 0);
});
