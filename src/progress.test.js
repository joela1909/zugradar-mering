import test from 'node:test'; import assert from 'node:assert/strict';
import { dirOf, startName, timeProgress, distProgress, buffer, minutesUntil } from './progress.js';
test('Richtung', () => {
  assert.equal(dirOf({ nextStops: ['Augsburg-Hochzoll', 'Augsburg Hbf', 'Ulm Hbf'] }), 'augsburg');
  assert.equal(dirOf({ nextStops: ['Mering', 'München Hbf'] }), 'muenchen');
  assert.equal(dirOf({ nextStops: ['Mering'], direction: 'Geltendorf' }), 'muenchen');
  assert.equal(dirOf({ direction: 'Ulm Hbf' }), 'augsburg');
  assert.equal(dirOf({ direction: 'München Hbf' }), 'muenchen');
});
test('Startbahnhof', () => {
  assert.equal(startName({ previousStops: ['Ulm Hbf', 'Augsburg Hbf', 'Augsburg-Hochzoll'] }), 'Augsburg Hbf');
  assert.equal(startName({ previousStops: ['Pasing', 'München Hbf'] }), 'München Hbf');
  assert.equal(startName({ previousStops: ['Dasing', 'Mering'] }), 'Dasing');
  assert.equal(startName({}), null);
});
test('Fortschritt', () => {
  assert.equal(timeProgress(0, 100, 50), .5); assert.equal(timeProgress(0, 100, -5), 0); assert.equal(timeProgress(0, 100, 500), 1); assert.equal(timeProgress(null, 1, 1), null);
  assert.equal(distProgress(1000, 250), .75); assert.equal(distProgress(1000, 2000), 0); assert.equal(distProgress(0, 5), 0);
  assert.equal(buffer(new Date('2026-10-28T19:10Z'), new Date('2026-10-28T19:04Z')), 6); assert.equal(minutesUntil(new Date(5 * 60000), new Date(0)), 5);
});
