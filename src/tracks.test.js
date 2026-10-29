import test from 'node:test'; import assert from 'node:assert/strict';
import { smoothLine, corridorSegment, corridorLine } from './tracks.js';
import { dist, bearing } from './geo.js';

test('läuft exakt durch alle Punkte', () => {
  const pts = [[10, 48], [10.01, 48.005], [10.02, 48], [10.03, 48.004]];
  const { line, idx } = smoothLine(pts);
  pts.forEach((p, i) => assert.ok(dist(line[idx[i]], p) < 0.01));
});
test('keine Knicke: Richtungsänderung je 20-m-Schritt bleibt klein', () => {
  const line = corridorLine(); let worst = 0;
  for (let i = 1; i < line.length - 1; i++) {
    if (dist(line[i - 1], line[i]) < 1 || dist(line[i], line[i + 1]) < 1) continue;
    const d = Math.abs(((bearing(line[i], line[i + 1]) - bearing(line[i - 1], line[i]) + 540) % 360) - 180);
    worst = Math.max(worst, d);
  }
  console.log('größte Richtungsänderung je Schritt:', worst.toFixed(1) + '°');
  assert.ok(worst < 12);
});
test('Gerade zwischen Hochzoll-Kurve und Kissing bleibt (fast) gerade', () => {
  const seg = corridorSegment('8000661', '8003299'), a = [10.9511841, 48.3461844], b = [10.959553, 48.300922];
  const k = Math.cos(48.32 * Math.PI / 180) * 111320, ky = 110540;
  const off = p => { const ax = a[0] * k, ay = a[1] * ky, bx = b[0] * k, by = b[1] * ky, px = p[0] * k, py = p[1] * ky; return Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / Math.hypot(bx - ax, by - ay); };
  const mid = seg.filter(p => p[1] < 48.343 && p[1] > 48.305);
  const worst = Math.max(...mid.map(off));
  console.log('größte Abweichung von der Geraden:', worst.toFixed(1) + ' m');
  assert.ok(worst < 40);
});
test('Abschnitte in beiden Richtungen, unbekannte = null', () => {
  const ab = corridorSegment('8004008', '8003982'), ba = corridorSegment('8003982', '8004008');
  assert.ok(ab.length > 5); assert.deepEqual(ab, [...ba].reverse());
  assert.ok(ab.some(p => dist(p, [10.9779107, 48.2689568]) < 1)); // Kurvenscheitel liegt auf der Linie
  assert.equal(corridorSegment('8000013', '8000661'), null);
});
