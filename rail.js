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

/** Nächster Punkt auf einem Gleisstück (Projektion), nicht nur auf einem Stützpunkt */
export function nearestOnEdge(g, ll, maxDist = 600) {
  return nearEdges(g, ll, maxDist, 0)[0] || null;
}

/** Projektionen auf alle Gleisstücke bis `slack` m weiter weg als das nächste (nächstes zuerst) */
function nearEdges(g, ll, maxDist, slack) {
  const kx = Math.cos(ll[1] * Math.PI / 180), all = [];
  for (const [a, list] of g.adj) {
    const A = g.pos.get(a);
    for (const { to: b } of list) {
      if (b < a) continue; // jede Kante nur einmal
      const B = g.pos.get(b), dx = (B[0] - A[0]) * kx, dy = B[1] - A[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, (((ll[0] - A[0]) * kx) * dx + (ll[1] - A[1]) * dy) / l2)) : 0;
      const p = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t], d = meters(p, ll);
      if (d < maxDist) all.push({ a, b, p, d });
    }
  }
  all.sort((x, y) => x.d - y.d);
  return all.filter(e => e.d <= all[0].d + slack);
}

/**
 * Kürzester Weg entlang der Gleise von startLL nach endLL. Start und Ziel werden auf den nächsten Punkt eines
 * Gleisstücks gesetzt (Projektion) – so endet der Weg genau am Bahnhof und fährt nicht bis zum nächsten Stützpunkt
 * weiter und wieder zurück. Auch Nachbargleise bis 30 m weiter weg kommen in Frage: auf zweigleisigen Strecken
 * ohne eingetragene Weichen liegen Start und Ziel sonst oft auf verschiedenen, nie verbundenen Gleisen.
 * null, wenn nicht verbunden oder zu weit von den Gleisen.
 */
export function shortestPath(g, startLL, endLL, maxSnap = 600) {
  const ss = nearEdges(g, startLL, maxSnap, 30), ts = nearEdges(g, endLL, maxSnap, 30);
  if (!ss.length || !ts.length) return null;
  const [s, t] = [ss[0], ts[0]];
  if (s.a === t.a && s.b === t.b) return [s.p, t.p]; // gleiches Gleisstück
  const S = '#start', T = '#ziel', at = new Map(), toT = new Map();
  const extra = new Map([[S, ss.map((e, i) => ({ to: '#s' + i, w: e.d }))]]);
  ss.forEach((e, i) => { at.set('#s' + i, e.p); extra.set('#s' + i, [{ to: e.a, w: meters(e.p, g.pos.get(e.a)) }, { to: e.b, w: meters(e.p, g.pos.get(e.b)) }]); });
  ts.forEach((e, i) => {
    at.set('#t' + i, e.p); extra.set('#t' + i, [{ to: T, w: e.d }]);
    for (const n of [e.a, e.b]) (toT.get(n) || toT.set(n, []).get(n)).push({ to: '#t' + i, w: meters(e.p, g.pos.get(n)) });
  });
  const dist = new Map([[S, 0]]), prev = new Map(), heap = new Heap(); heap.push(0, S);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (u === T) break;
    if (d > (dist.get(u) ?? Infinity)) continue;
    const out = [...(extra.get(u) || g.adj.get(u) || []), ...(toT.get(u) || [])];
    for (const { to, w } of out) { const nd = d + w; if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, u); heap.push(nd, to); } }
  }
  if (!dist.has(T)) return null;
  const ids = [prev.get(T)]; while (prev.get(ids[0]) !== S) ids.unshift(prev.get(ids[0]));
  return ids.map(id => at.get(id) || g.pos.get(id));
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
  return `[out:json][timeout:25];way["railway"="rail"](${f(s)},${f(w)},${f(n)},${f(e)});out geom qt;`;
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
      if (i === 0 || i === ln.length - 1) {
        const q = ln[i === 0 ? 1 : ln.length - 2], kx = Math.cos(p[1] * Math.PI / 180);
        const dx = q ? (p[0] - q[0]) * kx : 0, dy = q ? p[1] - q[1] : 0, l = Math.hypot(dx, dy);
        ends.push([id, li, l ? [dx / l, dy / l] : null]); // Richtung aus der Linie hinaus
      }
    });
  });
  // Linienenden mit dem nächsten Punkt auf einem Gleisstück einer anderen Linie verbinden (nicht nur mit Stützpunkten:
  // auf geraden Strecken liegen die in Kacheln oft Hunderte Meter auseinander)
  const segs = [];
  lines.forEach((ln, li) => { for (let i = 1; i < ln.length; i++) { const a = key(ln[i - 1]), b = key(ln[i]); if (a !== b) segs.push([a, b, li]); } });
  const C = 0.0005, grid = new Map();
  segs.forEach((sg, si) => {
    const p = pos.get(sg[0]), q = pos.get(sg[1]);
    for (let x = Math.floor(Math.min(p[0], q[0]) / C) - 1; x <= Math.floor(Math.max(p[0], q[0]) / C) + 1; x++)
      for (let y = Math.floor(Math.min(p[1], q[1]) / C) - 1; y <= Math.floor(Math.max(p[1], q[1]) / C) + 1; y++) { const k = x + ':' + y; (grid.get(k) || grid.set(k, []).get(k)).push(si); }
  });
  // je Linienende: nächstes Gleisstück überhaupt und nächstes in Fahrtrichtung voraus (überbrückt Datenlücken, statt nur
  // ans 4 m entfernte Parallelgleis anzuschließen)
  for (const [id, li, dir] of ends) {
    const p = pos.get(id), kx = Math.cos(p[1] * Math.PI / 180), k = Math.floor(p[0] / C) + ':' + Math.floor(p[1] / C);
    let best = null, bd = stitch, ahead = null, ad = stitch;
    for (const si of grid.get(k) || []) {
      const [a, b, sl] = segs[si]; if (sl === li) continue;
      const A = pos.get(a), B = pos.get(b);
      const dx = (B[0] - A[0]) * kx, dy = B[1] - A[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, (((p[0] - A[0]) * kx) * dx + (p[1] - A[1]) * dy) / l2)) : 0;
      const proj = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t], d = meters(p, proj);
      if (d < bd) { bd = d; best = { a, b, proj }; }
      const vx = (proj[0] - p[0]) * kx, vy = proj[1] - p[1], vl = Math.hypot(vx, vy);
      if (dir && d < ad && d > 1 && (vx * dir[0] + vy * dir[1]) / vl > 0.8) { ad = d; ahead = { a, b, proj }; }
    }
    for (const hit of [best, ahead]) {
      if (!hit) continue;
      const pid = key(hit.proj);
      if (!pos.has(pid)) pos.set(pid, hit.proj);
      for (const o of [hit.a, hit.b, id]) if (o !== pid) { const w = meters(pos.get(o), hit.proj); link(pid, o, w); link(o, pid, w); }
    }
  }
  return { pos, adj };
}
