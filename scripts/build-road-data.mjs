// Ampeln und feste Blitzer aus OpenStreetMap (Overpass) → src/data/*.json
// Aufruf: node scripts/build-road-data.mjs   (Daten © OpenStreetMap-Mitwirkende, ODbL)
import fs from 'fs';
import { execFileSync } from 'child_process';
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const SIG = '48.15,10.70,48.47,11.10', CAM = '47.90,10.40,48.70,11.80'; // Süd,West,Nord,Ost: Ampeln Großraum Augsburg, Blitzer weiter gefasst
const Q = `[out:json][timeout:60];(node["highway"="traffic_signals"](${SIG});node["highway"="speed_camera"](${CAM}););out body;`;
let data = null;
for (const m of MIRRORS) {
  try { data = JSON.parse(execFileSync('curl', ['-s', '-m', '90', '--data-urlencode', 'data=' + Q, m], { maxBuffer: 1 << 28 }).toString()); if (data.elements?.length) { console.log('Quelle:', m); break; } } catch { data = null; }
}
if (!data?.elements?.length) { console.error('Kein Overpass-Server erreichbar'); process.exit(1); }
const m = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 111320);
const r5 = x => +x.toFixed(5);
// Ampel-Knoten einer Kreuzung (≤ 45 m auseinander) zu einem Punkt zusammenfassen
const nodes = data.elements.filter(e => e.tags?.highway === 'traffic_signals').map(e => [e.lon, e.lat]);
const groups = [];
for (const n of nodes) {
  const g = groups.find(g => g.some(q => m(q, n) <= 45));
  if (g) g.push(n); else groups.push([n]);
}
const signals = groups.map(g => [r5(g.reduce((s, q) => s + q[0], 0) / g.length), r5(g.reduce((s, q) => s + q[1], 0) / g.length)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const cameras = data.elements.filter(e => e.tags?.highway === 'speed_camera').map(e => [r5(e.lon), r5(e.lat), parseInt(e.tags.maxspeed, 10) || 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync('src/data/signals.json', JSON.stringify(signals));
fs.writeFileSync('src/data/cameras.json', JSON.stringify(cameras));
console.log(`${nodes.length} Ampel-Knoten → ${signals.length} Kreuzungen, ${cameras.length} feste Blitzer`);
