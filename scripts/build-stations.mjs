// Erzeugt stations.json (EVA, Name, Breite, Länge) aus dem npm-Paket "db-stations" (Daten: DB StaDa, CC BY 4.0).
import { readFileSync, writeFileSync } from 'node:fs';
const rows = readFileSync(new URL('../node_modules/db-stations/data.ndjson', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const out = rows.filter(r => r.location?.latitude && r.location?.longitude).map(r => [r.id, r.name, +r.location.latitude.toFixed(6), +r.location.longitude.toFixed(6)]);
writeFileSync(new URL('../stations.json', import.meta.url), JSON.stringify(out));
console.log(out.length, 'Bahnhöfe');
