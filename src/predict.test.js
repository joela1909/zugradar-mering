import test from 'node:test'; import assert from 'node:assert/strict';
import { expectedDelay, median } from './predict.js';
test('ohne Daten = Fahrplan', () => assert.equal(expectedDelay({ live: null, stopsAway: 3, hist: [] }).min, 0));
test('nur Live', () => assert.equal(expectedDelay({ live: 4, stopsAway: 1, hist: [] }).min, 4));
test('Live hat Vorrang vor der Historie', () => { const r = expectedDelay({ live: 10, stopsAway: 1, hist: [2, 2, 2] }); assert.equal(r.min, 10); assert.match(r.basis, /meist \+2/); });
test('median', () => assert.equal(median([1, 9, 3]), 3));
