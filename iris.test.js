import test from 'node:test'; import assert from 'node:assert/strict';
import { trackWindow, hourShifts, parseTimetable, parseStations, merge, parseTime, toDepartures, toStopover, decode, planPath, tripKey } from './iris.js';

const plan = `<?xml version="1.0"?><timetable station="Mering St Afra"><s id="-7381563449385417706-2610281752-5" eva="8004052">
<tl f="N" t="p" o="80" c="RE" n="57312"/><ar pt="2610281809" pp="1" l="RE9" ppth="Augsburg Hbf|Augsburg-Hochzoll"/>
<dp pt="2610281810" pp="1" l="RE9" ppth="Mering|M&#xfc;nchen Hbf"/></s>
<s id="-5-2610281900-2"><tl c="RB" n="1"/><dp pt="2610281900" pp="2" ppth="Mering"/></s></timetable>`;
const fchg = `<timetable><s id="-7381563449385417706-2610281752-5"><ar ct="2610281814"/><dp ct="2610281815" cp="2"/></s></timetable>`;

test('parse + merge', () => {
  const m = merge(parseTimetable(plan), parseTimetable(fchg));
  assert.equal(m.length, 2);
  assert.equal(m[0].dp.ct, '2610281815'); assert.equal(m[0].dp.pt, '2610281810'); assert.equal(m[0].dp.ppth.split('|')[1], 'München Hbf');
});
test('Abfahrten', () => {
  const d = toDepartures(merge(parseTimetable(plan), parseTimetable(fchg)), '8004052', new Date('2026-10-28T16:00:00Z'));
  assert.equal(d[0].delay, 300); assert.equal(d[0].direction, 'München Hbf'); assert.equal(d[0].platform, '2'); assert.equal(d[0].line.name, 'RE9'); assert.equal(d[0].plannedPlatform, '1');
  assert.ok(d[0].tripId.endsWith('@8004052@2610281810'));
  assert.equal(d[0].trainNo, '57312'); assert.equal(d[0].origin, 'Augsburg Hbf'); assert.deepEqual(d[0].nextStops, ['Mering', 'München Hbf']);
});
test('Zeit (Sommer-/Winterzeit)', () => {
  assert.equal(parseTime('2610281810').toISOString(), '2026-10-28T17:10:00.000Z'); // CET = UTC+1
  assert.equal(parseTime('2607011200').toISOString(), '2026-07-01T10:00:00.000Z'); // CEST = UTC+2
  assert.equal(planPath(new Date('2026-10-28T17:10:00Z')), '261028/18');
});
test('Bahnhofssuche', () => assert.equal(parseStations('<stations><station name="Mering-St Afra" eva="8004052" ds100="MMS"/></stations>')[0].eva, '8004052'));
test('Stopover', () => { const s = parseTimetable(plan)[0]; const o = toStopover('X', '1', { latitude: 1, longitude: 2 }, s); assert.equal(o.departureDelay, 0); assert.equal(o.plannedArrival, '2026-10-28T17:09:00.000Z'); });
test('misc', () => { assert.equal(decode('a&amp;b'), 'a&b'); assert.equal(tripKey('-1-2610281752-5'), '-1-2610281752'); });

test('Tracking-Fenster', () => {
  const w = trackWindow(['Ulm', 'München Hbf', 'München-Pasing', 'Maisach', 'Mering'], ['Augsburg-Hochzoll', 'A2', 'A3', 'Augsburg Hbf', 'Ulm Hbf']);
  assert.equal(w.start, 'München Hbf'); assert.deepEqual(w.before, ['München Hbf', 'München-Pasing', 'Maisach', 'Mering']); assert.equal(w.after.length, 5);
  assert.deepEqual(trackWindow(['Dasing', 'Mering'], []).before, ['Dasing', 'Mering']);
  // RB Richtung München: alle Halte bis München Hbf, nicht nur 4
  const rb = ['Mering', 'Althegnenberg', 'Haspelmoor', 'Mammendorf', 'Malching (Oberbay)', 'Maisach', 'Gernlinden', 'Esting', 'Olching', 'Gröbenzell', 'München-Lochhausen', 'München-Langwied', 'München-Pasing', 'München Hbf'];
  assert.deepEqual(trackWindow(['Augsburg Hbf', 'Kissing'], rb).after, rb);
  // Richtung Augsburg: bis Augsburg Hbf + 4 danach
  assert.equal(trackWindow(['München Hbf', 'Mering'], ['Kissing', 'Augsburg-Hochzoll', 'Augsburg Hbf', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6']).after.at(-1), 'B4');
});
test('Stundenverschiebung', () => {
  const t0 = new Date('2026-10-28T18:05:00Z');
  assert.equal(hourShifts(0, -1, t0)[0], 0);
  assert.equal(hourShifts(10, -1, t0)[0], -1); // 45 min früher → Stunde davor
  assert.equal(hourShifts(3, 1, t0)[0], 0);
});
