import test from 'node:test'; import assert from 'node:assert/strict';
import { alongRoute, signalsOn, camerasOn, estimateCycle, nextGreenIn, signalStats, createSignalLearner, recordSignal } from './road.js';

// gerade Route nach Osten auf 48° N, 2 km
const m = 1 / (111320 * Math.cos(48 * Math.PI / 180)), route = [[10, 48], [10 + 1000 * m, 48], [10 + 2000 * m, 48]];
test('Punkte entlang der Route: Position und Abstand', () => {
  const r = alongRoute(route, [[10 + 500 * m, 48 + 10 / 111320], [10 + 1500 * m, 48 + 200 / 111320], [11, 48]]);
  assert.equal(r.length, 1); assert.ok(Math.abs(r[0].along - 500) < 2); assert.ok(Math.abs(r[0].off - 10) < 1);
});
test('Ampeln: nah beieinander liegende zählen als eine', () => {
  const s = signalsOn(route, [[10 + 400 * m, 48], [10 + 430 * m, 48], [10 + 1200 * m, 48]]);
  assert.deepEqual(s.map(x => Math.round(x.along)), [400, 1200]);
});
test('Blitzer: feste mit Tempolimit und gemeldete, sortiert', () => {
  const c = camerasOn(route, [[10 + 1500 * m, 48, 50]], [{ lonlat: [10 + 300 * m, 48 + 40 / 111320], t: 1, id: 'x' }]);
  assert.deepEqual(c.map(x => [x.kind, x.limit, Math.round(x.along)]), [['gemeldet', null, 300], ['fest', 50, 1500]]);
});
test('Umlaufzeit: Festzeit-Ampel mit 90 s wird erkannt, Zufall nicht', () => {
  const base = 1793000000 - (1793000000 % 90) + 37, greens = [0, 3, 7, 40, 41, 95, 960, 961, 2000].map((k, i) => base + k * 90 + (i % 3)); // ±2 s Streuung
  const c = estimateCycle(greens);
  assert.equal(c.T, 90); assert.ok(Math.abs(c.phase - 38) < 2, 'Phase ' + c.phase);
  const now = base + 5000 * 90 + 30; assert.ok(Math.abs(nextGreenIn(c, now) - 61) < 3);
  let x = 7; const rnd = Array.from({ length: 12 }, () => 1793000000 + (x = (x * 7919 + 13) % 100003));
  assert.equal(estimateCycle(rnd), null);
  assert.equal(estimateCycle(greens.slice(0, 3)), null, 'zu wenige Beobachtungen');
});
test('Lernen: Halt vor der Ampel ergibt Wartezeit und Grün-Zeitpunkt, Durchfahrt zählt als frei', () => {
  const L = createSignalLearner(), sig = [{ id: 'a', along: 500 }, { id: 'b', along: 1500 }], t0 = 1793000000000, obs = [];
  const f = (s, along, speed) => obs.push(...L.feed({ t: t0 + s * 1000, along, speed }, sig));
  f(0, 300, 12); f(10, 420, 8); f(15, 470, 0.5); f(25, 470, 0); f(40, 472, 0.3); f(47, 480, 4); f(55, 560, 12);   // 32 s gewartet
  f(100, 1400, 14); f(108, 1540, 14);                                                                           // b ohne Halt
  assert.deepEqual(obs, [{ id: 'a', wait: 32, green: t0 / 1000 + 47 }, { id: 'b', wait: null, green: null }]);
  const store = {}; obs.forEach(o => recordSignal(store, o)); recordSignal(store, { id: 'a', wait: null, green: null });
  const st = signalStats(store.a); assert.equal(st.n, 2); assert.equal(st.pStop, 0.5); assert.equal(st.expected, 16); assert.equal(st.cycle, null);
});

test('Lernen: Ampeln hinter dem Einstiegspunkt und über einen GPS-Sprung hinweg werden nicht gewertet', () => {
  const L = createSignalLearner(), sig = [{ id: 'a', along: 500 }, { id: 'b', along: 1500 }, { id: 'c', along: 3000 }, { id: 'd', along: 3400 }], obs = [];
  const f = (s, along) => obs.push(...L.feed({ t: s * 1000, along, speed: 14 }, sig));
  f(0, 1000); f(10, 1140); f(22, 1300); f(40, 1560);   // Einstieg hinter a; b normal passiert
  f(50, 3100); f(60, 3240); f(75, 3450);     // Sprung über c hinweg; d normal passiert
  assert.deepEqual(obs.map(o => o.id), ['b', 'd']);
});
