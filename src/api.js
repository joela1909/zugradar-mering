import { buildGraph, shortestPath, smoothPath, overpassQuery } from '../rail.js';
import { railFromTiles } from './tilerail.js';
const BASE = '/api';
const j = async (u, o) => {
  const r = await fetch(u, o);
  if (!r.ok) { let d = ''; try { const b = await r.json(); d = `${b.error || ''} ${b.detail || ''}`; } catch {} throw new Error(`${r.status} ${d || u}`.trim()); }
  return r.json();
};
const D = s => (s ? new Date(s) : null);
const minutes = s => (s == null ? null : s / 60);

export const FALLBACK_STATION = { id: null, name: 'Mering-St Afra', lonlat: [10.971202, 48.274282] };

export async function findStation() {
  const r = await j(`${BASE}/locations?query=${encodeURIComponent('Mering St Afra')}&results=5&v=3`, { cache: 'no-store' });
  const s = r.find(x => /afra/i.test(x.name)) || r[0];
  if (!s) throw new Error('Station nicht gefunden');
  return { id: s.id, name: s.name, lonlat: [s.location.longitude, s.location.latitude] };
}

export async function geocode(q) { const r = await j(`${BASE}/geocode?q=${encodeURIComponent(q)}`); return [r.longitude, r.latitude]; }

export async function departures(station) {
  const r = await j(`${BASE}/stops/${station.id}/departures?duration=240&past=90&results=80&language=de&remarks=false`);
  return r.departures.map(d => ({
    tripId: d.tripId, line: d.line?.name || '?', direction: d.direction || '', platform: d.platform || d.plannedPlatform || '–', plannedPlatform: d.plannedPlatform || null,
    trainNo: d.trainNo || null, category: d.category || null, origin: d.origin || null, nextStops: d.nextStops || [], previousStops: d.previousStops || [],
    key: d.tripKey || null, wings: d.wings || [],
    planned: D(d.plannedWhen), actual: D(d.when), delay: minutes(d.delay), cancelled: !!d.cancelled,
  })).filter(d => d.planned);
}

export async function trip(tripId, station) {
  const r = await j(`${BASE}/trips/${encodeURIComponent(tripId)}?stopovers=true&polyline=true&language=de`);
  const t = r.trip || r;
  const stopovers = (t.stopovers || []).filter(s => s.stop?.location).map(s => ({
    name: s.stop.name, id: s.stop.id, lonlat: [s.stop.location.longitude, s.stop.location.latitude],
    arr: D(s.arrival || s.plannedArrival), dep: D(s.departure || s.plannedDeparture),
    plannedArr: D(s.plannedArrival), plannedDep: D(s.plannedDeparture),
    arrDelay: minutes(s.arrivalDelay), depDelay: minutes(s.departureDelay), cancelled: !!s.cancelled,
  }));
  const st = t.start && { name: t.start.stop.name, dep: D(t.start.departure || t.start.plannedDeparture), plannedDep: D(t.start.plannedDeparture), depDelay: minutes(t.start.departureDelay) };
  const polyline = (t.polyline?.features || []).map(f => f.geometry.coordinates);
  const line = polyline.length > 1 ? polyline : stopovers.map(s => s.lonlat);
  return { stopovers, start: st || null, polyline: line, currentLocation: t.currentLocation ? [t.currentLocation.longitude, t.currentLocation.latitude] : null };
}

const ROUTERS = { foot: 'routed-foot', bike: 'routed-bike', car: 'routed-car' };
export async function route(mode, from, to) {
  const p = ROUTERS[mode] || ROUTERS.foot;
  const r = await j(`https://routing.openstreetmap.de/${p}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`);
  const x = r.routes[0];
  return { coords: x.geometry.coordinates, meters: x.distance, seconds: x.duration };
}

/* ---------- Demo-Daten (offline, grob vereinfachte Geometrie) ---------- */
export function demo(now = new Date()) {
  const station = { ...FALLBACK_STATION };
  const names = [['Augsburg Hbf', [10.8855, 48.3654]], ['Augsburg-Hochzoll', [10.9330, 48.3430]], [station.name, station.lonlat],
    ['Mering', [10.9830, 48.2670]], ['Althegnenberg', [11.1040, 48.2160]], ['Maisach', [11.2300, 48.2060]], ['München Hbf', [11.5600, 48.1400]]];
  const polyline = [];
  for (let i = 0; i < names.length - 1; i++) {
    const [a, b] = [names[i][1], names[i + 1][1]];
    for (let k = 0; k < 12; k++) polyline.push([a[0] + (b[0] - a[0]) * k / 12 + Math.sin(i + k) * 0.0006, a[1] + (b[1] - a[1]) * k / 12 + Math.cos(i + k) * 0.0004]);
  }
  polyline.push(names[names.length - 1][1]);
  // Haltepunkte exakt auf die Linie legen
  const snap = p => polyline.reduce((b, q) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(b[0] - p[0], b[1] - p[1]) ? q : b));
  const mk = (off, delays, rev = false) => {
    const base = new Date(now); base.setSeconds(0, 0);
    const mins = [0, 6, 12, 15, 24, 31, 52];
    const stopovers = (rev ? [...names].reverse() : names).map(([n, ll], i) => {
      const p = new Date(+base + (off + mins[i]) * 60000), dl = delays[i] ?? delays[delays.length - 1];
      return { name: n, lonlat: snap(ll), plannedArr: p, plannedDep: new Date(+p + 60000), arr: new Date(+p + dl * 60000), dep: new Date(+p + 60000 + dl * 60000), arrDelay: dl, depDelay: dl };
    });
    return { stopovers, polyline: rev ? [...polyline].reverse() : polyline, start: { name: stopovers[0].name, dep: stopovers[0].dep, plannedDep: stopovers[0].plannedDep, depDelay: stopovers[0].depDelay } };
  };
  const trips = [
    { line: 'RE 9', direction: 'München Hbf', trip: mk(-9, [2, 3, 4, 5]) },
    { line: 'RB 86', direction: 'München Hbf', trip: mk(14, [0, 1, 3, 6]) },
    { line: 'RE 80', direction: 'München Hbf', trip: mk(38, [0, 0, 0, 0]) },
    { line: 'RE 9', direction: 'Ulm Hbf', trip: mk(-5, [0, 1, 2], true), rev: true },
  ];
  const deps = trips.map((t, i) => { const s = t.trip.stopovers[t.trip.stopovers.findIndex(x => /afra/i.test(x.name))]; const names2 = t.trip.stopovers.map(x => x.name), k = names2.findIndex(n => /afra/i.test(n)); return { tripId: 'demo' + i, line: t.line, direction: t.direction, platform: String(i + 1), planned: s.plannedDep, actual: s.dep, delay: s.depDelay, cancelled: false, previousStops: names2.slice(0, k), nextStops: names2.slice(k + 1), origin: names2[0] }; });
  return { station, deps, trip: id => Promise.resolve({ ...trips[+id.slice(4)].trip, currentLocation: null }) };
}

/**
 * Gleisverlauf zwischen zwei Halten aus OpenStreetMap. Das Handy fragt Overpass selbst
 * (Cloudflare wird von den Overpass-Servern nicht bedient); Anfragen laufen nacheinander,
 * jeder Abschnitt wird dauerhaft gemerkt, „kein Gleisweg“ einen Tag lang.
 */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let overpassQueue = Promise.resolve();
const pause = ms => new Promise(r => setTimeout(r, ms));
// Ist Overpass vom Handy aus nicht erreichbar, für diese Sitzung nicht mehr versuchen (sonst wartet jeder Abschnitt lange)
let overpassDown = false;
async function overpassFetch(query) {
  if (overpassDown) return null;
  for (const u of OVERPASS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
      try {
        const r = await fetch(`${u}?data=${encodeURIComponent(query)}`, { signal: ctl.signal });
        if (r.status === 429 || r.status === 504) { await pause(4000); continue; } // ausgelastet: kurz warten, nochmal
        if (r.ok) return await r.json();
        break;
      } catch { break; } finally { clearTimeout(t); }
    }
  }
  overpassDown = true;
  return null;
}
// Kachel-Adresse der Grundkarte (wird gesetzt, sobald die Karte geladen ist)
let tileTemplate = null, tileReady;
const tileWait = new Promise(r => (tileReady = r));
export function setTileTemplate(t) { if (t && !tileTemplate) { tileTemplate = t; tileReady(t); } }

/** Herkunft der Gleisabschnitte (für die Anzeige im großen Blatt) */
export const railStats = { cache: 0, tiles: 0, overpass: 0, none: 0, fail: 0, problems: [] };
export async function rail(a, b, aLL, bLL, label = `${a} → ${b}`) {
  const k = `zr.rail.v7.${a}.${b}`;
  try { const c = JSON.parse(localStorage.getItem(k)); if (c && (c.c || Date.now() - c.t < 864e5)) { railStats[c.c ? 'cache' : 'none']++; return c.c; } } catch {}
  if (!aLL || !bLL) return null;
  const job = overpassQueue.then(async () => {
    // 1. Gleise aus den Kartenkacheln (gleiche OSM-Daten, die die Karte ohnehin lädt)
    const tpl = tileTemplate || await Promise.race([tileWait, pause(5000)]);
    let why = 'Karte noch nicht geladen';
    if (tpl) {
      try { const r = await railFromTiles(tpl, aLL, bLL); if (r.path) { railStats.tiles++; return r.path.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]); } why = r.why; } catch (e) { why = 'Fehler: ' + String(e?.message || e).slice(0, 60); }
    }
    railStats.problems.push(`${label}: Karte ${why}`);
    // 2. Reserve: Overpass
    const data = await overpassFetch(overpassQuery(aLL, bLL, 0.012));
    if (!data) { railStats.fail++; railStats.problems.push(`${label}: Overpass nicht erreichbar`); return undefined; } // nichts merken, später neu versuchen
    const main = (data.elements || []).filter(e => !/yard|siding|spur|crossover/.test(e.tags?.service || ''));
    const path = shortestPath(buildGraph(main), aLL, bLL) || shortestPath(buildGraph(data.elements), aLL, bLL);
    railStats[path ? 'overpass' : 'none']++;
    return path ? smoothPath(path).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]) : null;
  });
  overpassQueue = job.then(() => pause(400), () => pause(400));
  const coords = await job.catch(() => undefined);
  if (coords !== undefined) { try { localStorage.setItem(k, JSON.stringify({ c: coords, t: Date.now() })); } catch {} }
  return coords ?? null;
}

/** Auslastung des Bahn-Kontingents (Anfragen der letzten Minute) */
export async function limit() { return j(`${BASE}/limit`, { cache: 'no-store' }); }

/* ---------- Straße: Routen mit Alternativen, Live-Verkehr, Meldungen, eigene Blitzer-Meldungen ---------- */
/** Valhalla-Polyline (6 Nachkommastellen) → [[lon,lat]] */
export function decodePolyline6(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  const next = () => { let r = 0, s = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32); return r & 1 ? ~(r >> 1) : r >> 1; };
  while (i < str.length) { lat += next(); lon += next(); out.push([lon / 1e6, lat / 1e6]); }
  return out;
}
const geoLen = c => { let d = 0; for (let i = 1; i < c.length; i++) d += Math.hypot((c[i][0] - c[i - 1][0]) * 111320 * Math.cos(c[i][1] * Math.PI / 180), (c[i][1] - c[i - 1][1]) * 111320); return d; };
// gleiche Strecke? (Länge ähnlich und Mittelpunkt nah beieinander)
const similar = (a, b) => Math.abs(a.meters - b.meters) < 0.04 * a.meters && Math.hypot((a.coords[a.coords.length >> 1][0] - b.coords[b.coords.length >> 1][0]) * 74000, (a.coords[a.coords.length >> 1][1] - b.coords[b.coords.length >> 1][1]) * 111320) < 400;
let trafficOff = 0; // Zeitpunkt, bis zu dem der Live-Verkehr nicht erneut versucht wird (kein Schlüssel / Störung)
/**
 * Routen von a nach b: { list: [{coords, meters, seconds, delay, noTraffic, jams, geo}], traffic: 'tomtom' | null }.
 * Auto: mit Live-Verkehr über den eigenen Server (TomTom), sonst OSRM + Alternativen von Valhalla (beides OpenStreetMap, ohne Verkehr).
 */
export async function routes(mode, from, to) {
  const fin = (list, traffic) => ({ list: list.map(r => ({ delay: 0, noTraffic: null, jams: [], ...r, geo: geoLen(r.coords) })), traffic });
  if (mode === 'car' && Date.now() > trafficOff) {
    try {
      const r = await j(`${BASE}/traffic/route?from=${from[0].toFixed(5)},${from[1].toFixed(5)}&to=${to[0].toFixed(5)},${to[1].toFixed(5)}`);
      if (r.routes?.length) return fin(r.routes, r.provider);
    } catch (e) { trafficOff = Date.now() + (/^501/.test(e.message) ? 30 : 3) * 60000; }
  }
  const main = await route(mode, from, to), list = [main];
  if (mode === 'car') {
    try {
      const q = { locations: [{ lon: from[0], lat: from[1] }, { lon: to[0], lat: to[1] }], costing: 'auto', alternates: 2, units: 'kilometers' };
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 6000);
      const v = await j('https://valhalla1.openstreetmap.de/route?json=' + encodeURIComponent(JSON.stringify(q)), { signal: ctl.signal }).finally(() => clearTimeout(tm));
      const trips = [v.trip, ...(v.alternates || []).map(a => a.trip)].map(t => ({ coords: t.legs.flatMap(l => decodePolyline6(l.shape)), meters: t.summary.length * 1000, seconds: t.summary.time }));
      const same = trips.find(t => similar(main, t)), k = same ? main.seconds / same.seconds : 1; // Zeiten an die Hauptroute angleichen
      for (const t of trips) if (!list.some(x => similar(x, t))) list.push({ ...t, seconds: t.seconds * k });
      list.sort((x, y) => x.seconds - y.seconds);
    } catch {}
  }
  return fin(list, null);
}
export const trafficStatus = () => j(`${BASE}/traffic/status`);
export const incidents = () => j(`${BASE}/traffic/incidents`);
export const getReports = () => j(`${BASE}/reports`).then(r => r.reports || []);
export const addReport = lonlat => j(`${BASE}/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lonlat }) }).then(r => r.reports || []);
export const delReport = id => j(`${BASE}/reports?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => r.reports || []);
