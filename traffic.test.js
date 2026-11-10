import test from 'node:test'; import assert from 'node:assert/strict';
import { parseTomTomRoutes, parseTomTomIncidents, parseAutobahn, parseLL, addReport } from './traffic.js';

test('TomTom-Route: Geometrie, Zeiten, Stauabschnitte', () => {
  const r = parseTomTomRoutes({ routes: [{ summary: { lengthInMeters: 13400, travelTimeInSeconds: 1100, trafficDelayInSeconds: 140, noTrafficTravelTimeInSeconds: 930 },
    legs: [{ points: [{ latitude: 48.27, longitude: 10.83 }, { latitude: 48.271, longitude: 10.9 }, { latitude: 48.2725, longitude: 10.9727 }] }],
    sections: [{ startPointIndex: 1, endPointIndex: 2, sectionType: 'TRAFFIC', simpleCategory: 'JAM', delayInSeconds: 140, magnitudeOfDelay: 2, effectiveSpeedInKmh: 18 }, { startPointIndex: 0, endPointIndex: 2, sectionType: 'TRAVEL_MODE' }] }, { legs: [] }] });
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].coords.length, r[0].meters, r[0].seconds, r[0].delay, r[0].noTraffic], [3, 13400, 1100, 140, 930]);
  assert.deepEqual(r[0].jams, [{ from: 1, to: 2, cat: 'JAM', delay: 140, mag: 2, speed: 18 }]);
  assert.deepEqual(r[0].coords[0], [10.83, 48.27]);
});
test('TomTom-Meldungen', () => {
  const i = parseTomTomIncidents({ incidents: [{ geometry: { type: 'LineString', coordinates: [[10.9, 48.3], [10.91, 48.31], [10.92, 48.32]] }, properties: { iconCategory: 9, events: [{ description: 'Baustelle' }], from: 'Kissing', to: 'Mering', delay: 60 } }] });
  assert.deepEqual(i, [{ lonlat: [10.91, 48.31], kind: 'Baustelle', text: 'Baustelle · Kissing → Mering', delay: 60, closed: false }]);
});
test('Autobahn-API: nur Meldungen im Ausschnitt', () => {
  const a = parseAutobahn({ warning: [{ title: 'A8 | Dasing - Friedberg', subtitle: ' München -> Stuttgart', delayTimeValue: '3', isBlocked: 'false', coordinate: { lat: 48.39, long: 10.99 } }, { title: 'A8 | Pforzheim', coordinate: { lat: 48.88, long: 8.78 } }] }, [10.5, 48, 11.7, 48.6]);
  assert.deepEqual(a, [{ lonlat: [10.99, 48.39], kind: 'Stau', text: 'A8 | Dasing - Friedberg · München -> Stuttgart', delay: 180, closed: false }]);
});
test('Koordinaten prüfen', () => { assert.deepEqual(parseLL('10.83,48.27'), [10.83, 48.27]); assert.equal(parseLL('0,0'), null); assert.equal(parseLL('a,b'), null); assert.equal(parseLL('10.8,48.2;x'), null); });
test('Blitzer-Meldungen: abgelaufene raus, benachbarte ersetzt', () => {
  const now = 1e12, old = [{ lonlat: [10.9, 48.3], t: now - 4 * 3600e3, id: 'alt' }, { lonlat: [10.95, 48.28], t: now - 1000, id: 'nah' }, { lonlat: [10.8, 48.2], t: now - 1000, id: 'bleibt' }];
  const l = addReport(old, { lonlat: [10.9501, 48.2801] }, now);
  assert.deepEqual(l.map(x => x.id === 'bleibt' ? 'bleibt' : x.t === now ? 'neu' : x.id), ['bleibt', 'neu']);
  assert.equal(addReport(old, null, now).length, 2);
});
