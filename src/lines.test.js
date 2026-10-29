import test from 'node:test'; import assert from 'node:assert/strict';
import { viaStations } from './lines.js';
test('lange Abschnitte werden an Bahnhöfen geteilt', () => {
  const v = viaStations('8003982', '8004158'); // Mering → Pasing
  assert.deepEqual([v[0].name, v[1].name, v.at(-1).name], ['Mering', 'Althegnenberg', 'München-Pasing']);
  assert.ok(v.length >= 10);
  const r = viaStations('8004158', '8003982'); assert.equal(r[0].name, 'München-Pasing');
  assert.equal(viaStations('8003982', '8000545'), null); // benachbart
  assert.equal(viaStations('8003982', '9999999'), null);
});
