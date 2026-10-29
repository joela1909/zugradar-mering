// Gleise direkt aus den Vektorkacheln der Grundkarte (OpenFreeMap, OpenMapTiles-Schema, Daten: OpenStreetMap)
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import { buildGraphFromLines, shortestPath, smoothPath } from '../rail.js';

const Z = 14; // höchste Detailstufe der Kacheln
const tx = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const ty = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };

/** Kacheln (z/x/y), die den Ausschnitt zwischen a und b (± pad Grad) abdecken */
export function tilesFor(a, b, pad = 0.006, z = Z) {
  const w = Math.min(a[0], b[0]) - pad, e = Math.max(a[0], b[0]) + pad, s = Math.min(a[1], b[1]) - pad, n = Math.max(a[1], b[1]) + pad;
  const out = [];
  for (let x = tx(w, z); x <= tx(e, z); x++) for (let y = ty(n, z); y <= ty(s, z); y++) out.push({ z, x, y });
  return out;
}

/** Gleislinien (Hauptgleise, ohne Abstell-/Rangiergleise) aus einer Kachel, als [[lon,lat], …] */
export function railLinesFromTile(buf, { x, y, z }) {
  const layer = new VectorTile(new Pbf(buf)).layers.transportation;
  if (!layer) return [];
  const out = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i), p = f.properties;
    if (p.class !== 'rail' || /yard|siding|spur|crossover/.test(p.service || '')) continue;
    const g = f.toGeoJSON(x, y, z).geometry;
    if (g.type === 'LineString') out.push(g.coordinates);
    else if (g.type === 'MultiLineString') out.push(...g.coordinates);
  }
  return out;
}

/**
 * Kacheln für einen Abschnitt: Suchbereich wächst mit der Länge (Gleise weichen von der Luftlinie ab);
 * bei langen Abschnitten (z. B. Pasing – Mering ohne Halt) eine gröbere Stufe, die die Strecken ebenfalls enthält.
 */
export function pickTiles(a, b, max = 40) {
  const span = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])), pad = 0.006 + span * 0.12;
  for (const z of [14, 13, 12, 11]) { const t = tilesFor(a, b, pad, z); if (t.length <= max) return t; }
  return null;
}

/** Gleisweg von a nach b aus den Kacheln; null, wenn keine Verbindung gefunden wurde */
export async function railFromTiles(template, a, b) {
  const tiles = pickTiles(a, b);
  if (!tiles) return null;
  const bufs = await Promise.all(tiles.map(t => fetch(template.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y)).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null)));
  if (bufs.every(x => !x)) throw new Error('Kacheln nicht erreichbar');
  const lines = bufs.flatMap((buf, i) => (buf ? railLinesFromTile(new Uint8Array(buf), tiles[i]) : []));
  const path = shortestPath(buildGraphFromLines(lines), a, b, 400);
  return path ? smoothPath(path) : null;
}
