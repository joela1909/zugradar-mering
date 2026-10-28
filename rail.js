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
