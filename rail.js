// Gleisgraph aus OSM-Daten (Overpass "out geom") und kürzester Weg zwischen zwei Koordinaten. Reine Funktionen.

const R = 6371000, rad = d => d * Math.PI / 180;
export function meters(a, b) { // [lon, lat]
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** elements: Overpass-Ways mit nodes[] und geometry[{lat,lon}] */
export function buildGraph(elements) {
  const pos = new Map(), adj = new Map();
  const link = (a, b, w) => { (adj.get(a) || adj.set(a, []).get(a)).push({ to: b, w }); };
  for (const el of elements || []) {
    if (el.type !== 'way' || !el.nodes || !el.geometry || el.nodes.length !== el.geometry.length) continue;
    for (let i = 0; i < el.nodes.length; i++) {
      const g = el.geometry[i]; if (!g) continue;
      pos.set(el.nodes[i], [g.lon, g.lat]);
      if (i) { const a = el.nodes[i - 1], b = el.nodes[i], ga = el.geometry[i - 1]; if (!ga) continue; const w = meters([ga.lon, ga.lat], [g.lon, g.lat]); link(a, b, w); link(b, a, w); }
    }
  }
  return { pos, adj };
}

export function nearestNode(g, ll, maxDist = 600) {
  let best = null, bd = Infinity;
  for (const [id, p] of g.pos) { if (!g.adj.has(id)) continue; const d = Math.abs(p[0] - ll[0]) * 70000 + Math.abs(p[1] - ll[1]) * 111000; if (d < bd * 1.5) { const m = meters(p, ll); if (m < bd) { bd = m; best = id; } } }
  return bd <= maxDist ? best : null;
}

class Heap { // Min-Heap für Dijkstra
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

/** Kürzester Weg entlang der Gleise von startLL nach endLL; null, wenn nicht verbunden oder zu weit von den Gleisen. */
export function shortestPath(g, startLL, endLL, maxSnap = 600) {
  const s = nearestNode(g, startLL, maxSnap), t = nearestNode(g, endLL, maxSnap);
  if (s == null || t == null) return null;
  const dist = new Map([[s, 0]]), prev = new Map(), heap = new Heap(); heap.push(0, s);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (u === t) break;
    if (d > (dist.get(u) ?? Infinity)) continue;
    for (const { to, w } of g.adj.get(u) || []) { const nd = d + w; if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, u); heap.push(nd, to); } }
  }
  if (!dist.has(t)) return null;
  const ids = [t]; while (ids[0] !== s) ids.unshift(prev.get(ids[0]));
  return ids.map(id => g.pos.get(id));
}

/** Punkte ausdünnen (mindestens minGap Meter Abstand; Anfang und Ende bleiben). */
export function thin(coords, minGap = 8) {
  if (coords.length < 3) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) if (meters(out[out.length - 1], coords[i]) >= minGap) out.push(coords[i]);
  out.push(coords[coords.length - 1]);
  return out;
}

export function overpassQuery(a, b, pad = 0.03) {
  const s = Math.min(a[1], b[1]) - pad, n = Math.max(a[1], b[1]) + pad, w = Math.min(a[0], b[0]) - pad, e = Math.max(a[0], b[0]) + pad;
  const f = x => x.toFixed(5);
  return `[out:json][timeout:25];way["railway"="rail"]["service"!~"yard|siding|spur|crossover"](${f(s)},${f(w)},${f(n)},${f(e)});out geom qt;`;
}

/** Glättet einen Gleisweg (gleitender Mittelwert über ±`radius` m), damit Gleiswechsel keine Zacken erzeugen. */
export function smoothPath(coords, radius = 30, step = 10) {
  if (!coords || coords.length < 3) return coords;
  const rs = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i], d = meters(a, b), n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) rs.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  const w = Math.max(1, Math.round(radius / step)), out = [rs[0]];
  for (let i = 1; i < rs.length - 1; i++) {
    const lo = Math.max(0, i - w), hi = Math.min(rs.length - 1, i + w), m = Math.min(i - lo, hi - i); // symmetrisch, an den Enden kleiner
    let x = 0, y = 0; for (let j = i - m; j <= i + m; j++) { x += rs[j][0]; y += rs[j][1]; }
    out.push([x / (2 * m + 1), y / (2 * m + 1)]);
  }
  out.push(rs[rs.length - 1]);
  return thin(out, 8);
}

/**
 * Gleisgraph aus Linien (z. B. aus Vektorkacheln). Gleiche Punkte werden zusammengeführt; Linienenden werden mit
 * dem nächsten Punkt einer anderen Linie im Umkreis von `stitch` Metern verbunden (Kachelgrenzen, Abzweige).
 */
export function buildGraphFromLines(lines, stitch = 6) {
  const pos = new Map(), adj = new Map(), lineOf = new Map(), ends = [];
  const key = p => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  const link = (a, b, w) => { (adj.get(a) || adj.set(a, []).get(a)).push({ to: b, w }); };
  lines.forEach((ln, li) => {
    let prev = null;
    ln.forEach((p, i) => {
      const id = key(p);
      if (!pos.has(id)) { pos.set(id, p); lineOf.set(id, li); }
      if (prev && prev !== id) { const w = meters(pos.get(prev), p); link(prev, id, w); link(id, prev, w); }
      prev = id;
      if (i === 0 || i === ln.length - 1) ends.push([id, li]);
    });
  });
  const C = 0.0001, cell = p => Math.floor(p[0] / C) + ':' + Math.floor(p[1] / C), grid = new Map();
  for (const [id, p] of pos) { const k = cell(p); (grid.get(k) || grid.set(k, []).get(k)).push(id); }
  for (const [id, li] of ends) {
    const p = pos.get(id), cx = Math.floor(p[0] / C), cy = Math.floor(p[1] / C);
    let best = null, bd = stitch;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const o of grid.get((cx + dx) + ':' + (cy + dy)) || []) {
      if (o === id || lineOf.get(o) === li) continue;
      const d = meters(p, pos.get(o)); if (d < bd) { bd = d; best = o; }
    }
    if (best) { link(id, best, bd); link(best, id, bd); }
  }
  return { pos, adj };
}
