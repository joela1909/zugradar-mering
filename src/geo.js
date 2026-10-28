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
