// Fest hinterlegte Gleisführung durch vorgegebene Punkte, glatt interpoliert (zentripetaler Catmull-Rom-Spline:
// läuft durch jeden Punkt, ohne Knicke und ohne Überschwingen). Gilt in beiden Fahrtrichtungen.

// Augsburg-Hochzoll → Kissing → Mering-St Afra → Mering → Althegnenberg (Bahnhöfe mit EVA, dazwischen Stützpunkte)
const CORRIDOR = [
  { eva: '8000661', ll: [10.943376, 48.352977] },                   // Augsburg-Hochzoll
  [10.9471561, 48.3512155], [10.9497941, 48.3490000], [10.9511841, 48.3461844], // Kurve, dann Gerade
  'straight',                                                       // Hilfspunkte halten die Gerade gerade
  { eva: '8003299', ll: [10.959553, 48.300922] },                   // Kissing
  [10.9618345, 48.2897961], [10.9644882, 48.2830146],               // Kurve, Kurvenscheitel
  { eva: '8004008', ll: [10.971202, 48.274282] },                   // Mering-St Afra
  [10.9779107, 48.2689568],                                         // Kurvenscheitel
  { eva: '8003982', ll: [10.988291, 48.262698] },                   // Mering
  [11.0001707, 48.2558076], [11.0236651, 48.2490185], [11.0301715, 48.2478511], [11.0401919, 48.2446402], // S-Kurve
  { eva: '8000545', ll: [11.063003, 48.236374] },                   // Althegnenberg
];

/** Spline durch alle Punkte, etwa alle `step` Meter ein Stützpunkt. Liefert Linie und Index jedes Eingangspunkts. */
export function smoothLine(points, step = 20) {
  const lat0 = points[0][1] * Math.PI / 180, kx = Math.cos(lat0) * 111320, ky = 110540;
  const P = points.map(([lon, lat]) => [lon * kx, lat * ky]);
  const n = P.length, out = [], idx = [];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], len = v => Math.hypot(v[0], v[1]);
  const lerp = (a, b, t0, t1, t) => { const d = t1 - t0 || 1e-9; return [a[0] * (t1 - t) / d + b[0] * (t - t0) / d, a[1] * (t1 - t) / d + b[1] * (t - t0) / d]; };
  for (let i = 0; i < n - 1; i++) {
    const p1 = P[i], p2 = P[i + 1];
    const p0 = i > 0 ? P[i - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
    const p3 = i + 2 < n ? P[i + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    const t0 = 0, t1 = t0 + Math.sqrt(len(sub(p1, p0))) + 1e-6, t2 = t1 + Math.sqrt(len(sub(p2, p1))) + 1e-6, t3 = t2 + Math.sqrt(len(sub(p3, p2))) + 1e-6;
    const m = Math.max(2, Math.ceil(len(sub(p2, p1)) / step));
    idx.push(out.length);
    for (let k = 0; k < m; k++) {
      const t = t1 + (t2 - t1) * k / m;
      const A1 = lerp(p0, p1, t0, t1, t), A2 = lerp(p1, p2, t1, t2, t), A3 = lerp(p2, p3, t2, t3, t);
      const B1 = lerp(A1, A2, t0, t2, t), B2 = lerp(A2, A3, t1, t3, t);
      out.push(k === 0 ? p1 : lerp(B1, B2, t1, t2, t));
    }
  }
  idx.push(out.length); out.push(P[n - 1]);
  return { line: out.map(([x, y]) => [x / kx, y / ky]), idx };
}

// 'straight' zwischen zwei Punkten: zwei Hilfspunkte bei 12 % und 88 % einfügen
function expand(list) {
  const out = [];
  list.forEach((p, i) => {
    if (p !== 'straight') { out.push(p); return; }
    const a = list[i - 1], b = list[i + 1], A = Array.isArray(a) ? a : a.ll, B = Array.isArray(b) ? b : b.ll;
    for (const f of [0.12, 0.88]) out.push([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f]);
  });
  return out;
}
const built = (() => {
  const C = expand(CORRIDOR), pts = C.map(p => (Array.isArray(p) ? p : p.ll));
  const { line, idx } = smoothLine(pts);
  const at = new Map(); C.forEach((p, i) => { if (!Array.isArray(p)) at.set(p.eva, idx[i]); });
  return { line, at };
})();

/** Gleisverlauf zwischen zwei Bahnhöfen (EVA) einschließlich der Bahnhöfe, oder null, wenn nicht hinterlegt. */
export function corridorSegment(fromEva, toEva) {
  const a = built.at.get(String(fromEva)), b = built.at.get(String(toEva));
  if (a == null || b == null || a === b) return null;
  return a < b ? built.line.slice(a, b + 1) : built.line.slice(b, a + 1).reverse();
}
export const corridorLine = () => built.line;
