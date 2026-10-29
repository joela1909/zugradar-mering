// Gleise direkt aus den Vektorkacheln der Grundkarte (OpenFreeMap, OpenMapTiles-Schema, Daten: OpenStreetMap)
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import { buildGraphFromLines, shortestPath, smoothPath, nearestOnEdge, meters } from '../rail.js';

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
export function railLinesFromTile(buf, { x, y, z }, all = false) {
  const layer = new VectorTile(new Pbf(buf)).layers.transportation;
  if (!layer) return [];
  const out = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i), p = f.properties;
    if (p.class !== 'rail' || (!all && /yard|siding|spur|crossover/.test(p.service || ''))) continue;
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

/** Gleisweg von a nach b aus den Kacheln: { path } oder { path: null, why: Grund } */
export async function railFromTiles(template, a, b) {
  const tiles = pickTiles(a, b);
  if (!tiles) return { path: null, why: 'Abschnitt zu lang' };
  const bufs = await Promise.all(tiles.map(t => fetch(template.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y)).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null)));
  const missing = bufs.filter(x => !x).length;
  if (missing === bufs.length) return { path: null, why: 'Kacheln nicht erreichbar' };
  // erst nur Hauptgleise; findet sich kein Weg (z. B. Bahnsteiggleise im Hbf als Nebengleis eingetragen), mit allen Gleisen;
  // zuletzt Lücken in den Kartendaten (z. B. an Brücken, bis 40 m) überbrücken
  let why = '';
  for (const [all, stitch] of [[false, 6], [true, 6], [true, 40]]) {
    const lines = bufs.flatMap((buf, i) => (buf ? railLinesFromTile(new Uint8Array(buf), tiles[i], all) : []));
    const g = buildGraphFromLines(lines, stitch), path = shortestPath(g, a, b, 400);
    if (path) return { path: smoothPath(path) };
    const sa = nearestOnEdge(g, a, 1e9), sb = nearestOnEdge(g, b, 1e9), m = s => (s ? Math.round(meters(s.p, s === sa ? a : b)) + ' m' : '–');
    why = `${tiles.length} Kacheln z${tiles[0].z}${missing ? `, ${missing} fehlen` : ''}, ${lines.length} Gleisstücke, Abstand zum Gleis ${m(sa)} / ${m(sb)}`;
  }
  return { path: null, why: 'kein Weg (' + why + ')' };
}
