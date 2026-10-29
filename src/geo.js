const R = 6371000;
export const rad = d => d * Math.PI / 180;
export function dist(a, b) { // [lon,lat]
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function cumulative(line) {
  const c = [0];
  for (let i = 1; i < line.length; i++) c.push(c[i - 1] + dist(line[i - 1], line[i]));
  return c;
}
export function nearestIndex(line, p, from = 0) {
  let best = from, bd = Infinity;
  for (let i = from; i < line.length; i++) { const d = dist(line[i], p); if (d < bd) { bd = d; best = i; } }
  return best;
}
export function pointAt(line, cum, d) {
  if (d <= 0) return line[0];
  if (d >= cum[cum.length - 1]) return line[line.length - 1];
  let i = 1; while (cum[i] < d) i++;
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
}
export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Nächster Punkt auf einer Linie: Abstand, Reststrecke, Richtung und Aufteilung in gefahren/übrig. line: [[lon,lat]] */
export function splitRoute(line, p) {
  if (!line || line.length < 2) return null;
  const cum = cumulative(line);
  let best = { d: Infinity, i: 0, t: 0, pt: line[0] };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], k = Math.cos(rad(a[1]));
    const ax = a[0] * k, bx = b[0] * k, px = p[0] * k, dx = bx - ax, dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d = dist(pt, p);
    if (d < best.d) best = { d, i, t, pt };
  }
  const along = cum[best.i] + dist(line[best.i], best.pt), total = cum[cum.length - 1];
  const ahead = pointAt(line, cum, Math.min(total, along + 40));
  return { off: best.d, along, remaining: Math.max(0, total - along), total, done: [...line.slice(0, best.i + 1), best.pt], rest: [best.pt, ...line.slice(best.i + 1)], bearing: bearing(best.pt, ahead) };
}

/**
 * Hängt einen Gleisabschnitt an eine Linie an. Enden beide auf verschiedenen Nachbargleisen (Versatz bis 60 m),
 * wird der Übergang über ±`blend` m schräg verbunden statt mit einem Quersprung (sonst V-Form am Bahnhof).
 */
export function appendSeg(line, seg, blend = 60) {
  const last = line[line.length - 1];
  if (!last) { line.push(...seg); return line; }
  const gap = dist(last, seg[0]);
  if (gap < 0.5) { line.push(...seg.slice(1)); return line; }
  if (gap > 60) { line.push(...seg); return line; }
  let walked = 0;
  while (line.length > 1 && walked + dist(line[line.length - 2], line[line.length - 1]) < blend) { walked += dist(line[line.length - 2], line[line.length - 1]); line.pop(); }
  let i = 0; walked = 0;
  while (i < seg.length - 2 && walked + dist(seg[i], seg[i + 1]) < blend) { walked += dist(seg[i], seg[i + 1]); i++; }
  line.push(...seg.slice(i));
  return line;
}
