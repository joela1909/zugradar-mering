import { parseTime, parseTimetable, parseStations, merge, toDepartures, toStopover, planPath, addHours, tripKey, splitPath } from './iris.js';

const BASE = 'https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1';
const UA = 'zugradar-mering (privates Hobbyprojekt)';
const BIAS = { lat: 48.27, lon: 10.98 }; // Raum Mering/Augsburg für die Ortssuche

const json = (data, status = 200, ttl = 15) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } });

class ApiError extends Error { constructor(msg, status = 502) { super(msg); this.status = status; } }

// Antworten kurz zwischenspeichern (Rate-Limit der Bahn: 60 Anfragen/min)
async function cached(key, ttl, fn) {
  const cache = caches.default, req = new Request('https://cache.local/' + encodeURIComponent(key));
  const hit = await cache.match(req);
  if (hit) return hit.text();
  const text = await fn();
  await cache.put(req, new Response(text, { headers: { 'cache-control': `max-age=${ttl}` } }));
  return text;
}

async function db(env, path, ttl) {
  if (!env.DB_CLIENT_ID || !env.DB_API_KEY) throw new ApiError('DB_CLIENT_ID / DB_API_KEY fehlen (Worker-Secrets)', 500);
  return cached('db:' + path, ttl, async () => {
    const r = await fetch(BASE + path, { headers: { 'DB-Client-Id': env.DB_CLIENT_ID, 'DB-Api-Key': env.DB_API_KEY, accept: 'application/xml', 'user-agent': UA } });
    if (r.status === 404) return '<timetable/>'; // z. B. Stunde ohne Daten
    if (!r.ok) throw new ApiError(`Bahn-API ${r.status} ${path.split('/')[1]} ${(await r.text()).slice(0, 80)}`);
    return r.text();
  });
}

const station = async (env, pattern) => parseStations(await db(env, '/station/' + encodeURIComponent(pattern), 86400));
const plan = async (env, eva, date) => parseTimetable(await db(env, `/plan/${eva}/${planPath(date)}`, 300));
const changes = async (env, eva) => parseTimetable(await db(env, `/fchg/${eva}`, 30));

// Koordinaten per Ortssuche (Photon/OSM), 30 Tage gemerkt
async function locate(name) {
  const text = await cached('geo:' + name, 2592000, async () => {
    for (const q of [`${name} Bahnhof`, name]) {
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lang=de&lat=${BIAS.lat}&lon=${BIAS.lon}`, { headers: { 'user-agent': UA } });
      if (!r.ok) continue;
      const f = (await r.json()).features?.[0];
      if (f) return JSON.stringify({ latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0] });
    }
    throw new ApiError('Ort nicht gefunden: ' + name);
  });
  return JSON.parse(text);
}

async function locateAddress(query) {
  const text = await cached('addr:' + query, 2592000, async () => {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=de&lat=${BIAS.lat}&lon=${BIAS.lon}`, { headers: { 'user-agent': UA } });
    const f = r.ok && (await r.json()).features?.[0];
    if (!f) throw new ApiError('Adresse nicht gefunden');
    return JSON.stringify({ latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0] });
  });
  return JSON.parse(text);
}

async function locations(env, q) {
  const list = await station(env, q.get('query') || '');
  const out = [];
  for (const s of list.slice(0, Number(q.get('results')) || 5)) out.push({ type: 'stop', id: s.eva, name: s.name, location: await locate(s.name).catch(() => null) });
  return out.filter(s => s.location);
}

async function departures(env, eva, q) {
  const now = new Date(), hours = Math.ceil((Number(q.get('duration')) || 120) / 60);
  const plans = await Promise.all(Array.from({ length: hours + 1 }, (_, i) => plan(env, eva, addHours(now, i))));
  const stops = merge(plans.flat(), await changes(env, eva));
  return { departures: toDepartures(stops, eva, now).slice(0, Number(q.get('results')) || 14) };
}

// Fahrtverlauf: dieselbe Fahrt an den Nachbarbahnhöfen suchen, dort Zeiten + Koordinaten holen
async function trip(env, tripId) {
  const [id, eva, pt] = tripId.split('@');
  const base = parseTime(pt); // Stundenraster reicht, Nachbarstunden werden mit abgesucht
  const own = merge(await plan(env, eva, base), await changes(env, eva)).find(s => s.id === id);
  if (!own) throw new ApiError('Fahrt nicht gefunden');
  const here = (await station(env, eva).catch(() => [])).find(s => s.eva === eva);
  const ownName = here?.name || 'Mering St Afra';
  const before = splitPath(own.ar?.ppth).slice(-4), after = splitPath(own.dp?.ppth).slice(0, 2);
  const key = tripKey(id);
  const find = async (name, hourShifts) => {
    const s = (await station(env, name))[0]; if (!s) return null;
    const location = await locate(s.name).catch(() => null); if (!location) return null;
    for (const sh of hourShifts) {
      const hit = (await plan(env, s.eva, addHours(base, sh))).find(x => tripKey(x.id) === key);
      if (hit) return toStopover(s.name, s.eva, location, merge([hit], await changes(env, s.eva))[0]);
    }
    return null;
  };
  const beforeStops = await Promise.all(before.map(n => find(n, [0, -1])));
  const afterStops = await Promise.all(after.map(n => find(n, [0, 1])));
  const here1 = toStopover(ownName, eva, await locate(ownName), own);
  const stopovers = [...beforeStops, here1, ...afterStops].filter(Boolean);
  return { trip: { id: tripId, stopovers } };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const path = url.pathname.slice(4), q = url.searchParams;
    try {
      let m;
      if (path === '/geocode') return json(await locateAddress(q.get('q') || ''), 200, 86400);
      if (path === '/locations') return json(await locations(env, q), 200, 3600);
      if ((m = path.match(/^\/stops\/([^/]+)\/departures$/))) return json(await departures(env, decodeURIComponent(m[1]), q));
      if ((m = path.match(/^\/trips\/(.+)$/))) return json(await trip(env, decodeURIComponent(m[1])));
      return json({ error: 'unbekannter Pfad' }, 404);
    } catch (e) {
      console.error(path, e?.stack);
      return json({ error: e instanceof ApiError ? e.message : 'Fehler', detail: String(e?.message || e).slice(0, 160) }, e?.status || 502, 0);
    }
  },
};
