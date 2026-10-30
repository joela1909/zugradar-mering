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
  assert.equal(startName({ previousStops: ['München-Pasing', 'Maisach'] }), 'München-Pasing');
  assert.equal(startName({ previousStops: ['Dasing', 'Mering'] }), 'Dasing');
  assert.equal(startName({}), null);
});
test('Fortschritt', () => {
  assert.equal(timeProgress(0, 100, 50), .5); assert.equal(timeProgress(0, 100, -5), 0); assert.equal(timeProgress(0, 100, 500), 1); assert.equal(timeProgress(null, 1, 1), null);
  assert.equal(distProgress(1000, 250), .75); assert.equal(distProgress(1000, 2000), 0); assert.equal(distProgress(0, 5), 0);
  assert.equal(buffer(new Date('2026-10-28T19:10Z'), new Date('2026-10-28T19:04Z')), 6); assert.equal(minutesUntil(new Date(5 * 60000), new Date(0)), 5);
});
import { matchesDir } from './progress.js';
test('Richtungsfilter', () => {
  const ausMuc = { previousStops: ['München Hbf', 'Pasing', 'Maisach', 'Mering'], origin: 'München Hbf', nextStops: ['Augsburg-Hochzoll', 'Augsburg Hbf'] };
  const ausGeltendorf = { previousStops: ['Geltendorf', 'Mering'], origin: 'Geltendorf', nextStops: ['Augsburg Hbf'] };
  assert.equal(matchesDir(ausMuc, 'augsburg'), true);
  assert.equal(matchesDir(ausGeltendorf, 'augsburg'), false);
  assert.equal(matchesDir({ previousStops: ['München-Pasing', 'Mering'], origin: 'München-Pasing', nextStops: ['Augsburg Hbf'] }, 'augsburg'), true);
  const nachMuc = { previousStops: ['Augsburg Hbf'], nextStops: ['Mering', 'München-Pasing', 'München Hbf'] };
  const nachPasing = { previousStops: ['Augsburg Hbf'], nextStops: ['Maisach', 'München Pasing'] };
  const nachGeltendorf = { previousStops: ['Augsburg Hbf'], nextStops: ['Mering', 'Geltendorf'], direction: 'Geltendorf' };
  assert.equal(matchesDir(nachMuc, 'muenchen'), true);
  assert.equal(matchesDir(nachPasing, 'muenchen'), true);
  assert.equal(matchesDir(nachGeltendorf, 'muenchen'), false);
  assert.equal(matchesDir(nachMuc, 'augsburg'), false);
  assert.equal(matchesDir({ direction: 'München Hbf' }, 'muenchen'), true);
});

import { stopFractions } from './progress.js';
test('Halte im Balken', () => {
  const t = new Map([['Maisach', 60], ['Althegnenberg', 80]]);
  const r = stopFractions(['Pasing', 'Lochhausen', 'Maisach', 'Althegnenberg'], t, 0, 100);
  assert.deepEqual(r.map(x => x.name), ['Pasing', 'Lochhausen', 'Maisach', 'Althegnenberg']);
  assert.equal(r[2].f, .6); assert.equal(r[3].f, .8); assert.ok(r[0].f > 0 && r[0].f < r[1].f && r[1].f < .6);
  assert.deepEqual(stopFractions([], new Map(), 0, 100), []);
});

import { livery } from './progress.js';
test('Lackierung', () => {
  assert.equal(livery({ category: 'ARV', line: 'ARV RE9' }), 'arverio');
  assert.equal(livery({ line: 'ARV RB86' }), 'arverio');
  assert.equal(livery({ category: 'RE', line: 'RE 9' }), 'db');
  assert.equal(livery({ line: 'RB 86' }), 'db');
  assert.equal(livery({ category: 'ICE', line: 'ICE 1' }), 'db');
  assert.equal(livery({ category: 'BRB', line: 'BRB RB67' }), 'other');
});

import { couple } from './progress.js';
test('gekoppelte Züge: gleiche Planzeit und Richtung → ein Eintrag', () => {
  const t = new Date('2026-10-29T14:52:00Z'), muc = ['Mering', 'München-Pasing', 'München Hbf'], aug = ['Kissing', 'Augsburg Hbf'];
  const list = couple([
    { tripId: 'a', line: 'RE80', planned: t, nextStops: muc },
    { tripId: 'b', line: 'RE89', planned: new Date(+t), nextStops: muc },
    { tripId: 'c', line: 'RB87', planned: t, nextStops: aug },                       // andere Richtung: eigener Zug
    { tripId: 'd', line: 'RB86', planned: new Date(+t + 60000), nextStops: muc },    // eine Minute später: eigener Zug
  ]);
  assert.deepEqual(list.map(d => [d.tripId, d.coupled.map(x => x.tripId)]), [['a', ['b']], ['c', []], ['d', []]]);
});
test('gleiche Planzeit, aber 8 min Unterschied: heute getrennt (RB89 pünktlich, RE80 +8)', () => {
  const t = new Date('2026-10-30T19:04:00Z'), aug = ['Kissing', 'Augsburg Hbf'];
  const list = couple([
    { tripId: 'rb', line: 'RB89', planned: t, actual: t, delay: 0, nextStops: aug },
    { tripId: 're', line: 'RE80', planned: t, actual: new Date(+t + 8 * 60000), delay: 8, nextStops: aug },
  ]);
  assert.deepEqual(list.map(d => [d.tripId, d.delay, d.coupled.length]), [['rb', 0, 0], ['re', 8, 0]]);
});
test('Flügelzug laut Bahn bleibt gekoppelt, auch bei 8 min Unterschied; verspäteter Teil wird Hauptzug', () => {
  const t = new Date('2026-10-30T19:04:00Z'), aug = ['Kissing', 'Augsburg Hbf'];
  const list = couple([
    { tripId: 'rb', key: 'K-RB', wings: ['K-RE'], line: 'RB89', planned: t, actual: t, delay: 0, nextStops: aug },
    { tripId: 're', key: 'K-RE', wings: [], line: 'RE80', planned: t, actual: new Date(+t + 8 * 60000), delay: 8, nextStops: aug },
  ]);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].tripId, list[0].delay, list[0].coupled.map(x => x.tripId)], ['re', 8, ['rb']]);
});
test('gekoppelte Züge: größte Verspätung gilt (RE80 ±0, RE89 +1 → +1)', () => {
  const t = new Date('2026-10-30T16:52:00Z'), muc = ['Mering', 'München Hbf'];
  const [g] = couple([
    { tripId: 'a', line: 'RE80', planned: t, actual: t, delay: 0, nextStops: muc },
    { tripId: 'b', line: 'RE89', planned: t, actual: new Date(+t + 60000), delay: 1, nextStops: muc },
  ]);
  assert.equal(g.delay, 1); assert.equal(+g.actual, +t + 60000);
});
