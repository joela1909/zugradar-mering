import stations from './stations.json';
import { SlidingWindow } from './limiter.js';
import { buildGraph, shortestPath, thin, overpassQuery } from './rail.js';
import { trackWindow, hourShifts, parseTime, parseTimetable, parseStations, merge, toDepartures, toStopover, planPath, addHours, tripKey, splitPath } from './iris.js';

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

// ---- Bahn-Kontingent: genau DB_RATE_LIMIT (Standard 60) Anfragen pro gleitender Minute, für alle Geräte zusammen ----
// Zentraler Zähler als Durable Object; jede Worker-Anfrage holt sich Freigaben in kleinen Paketen und gibt Reste zurück.
export class RateLimiter {
  constructor(state, env) { this.w = new SlidingWindow(Number(env.DB_RATE_LIMIT) || 60, 60000); }
  async fetch(req) {
    const u = new URL(req.url), n = Number(u.searchParams.get('n')) || 0;
    if (u.pathname === '/take') return Response.json({ k: this.w.take(n) });
    if (u.pathname === '/give') { this.w.give(n); return Response.json({ ok: true }); }
    if (u.pathname === '/pause') { this.w.pause(n); return Response.json({ ok: true }); }
    return Response.json({ used: this.w.used(), limit: this.w.limit, nextFreeMs: this.w.nextFree() });
  }
}
function makeBudget(env) {
  const stub = env.LIMITER ? env.LIMITER.get(env.LIMITER.idFromName('db-timetables')) : null;
  let pool = 0, empty = false, chain = Promise.resolve();
  const call = async (path, n) => (await stub.fetch(`https://limiter/${path}?n=${n}`)).json();
  return {
    // eine Freigabe holen (Anfragen werden der Reihe nach bedient, damit wichtige zuerst drankommen)
    take() {
      if (!stub) return Promise.resolve(true);
      return (chain = chain.then(async () => {
        if (pool > 0) { pool--; return true; }
        if (empty) return false;
        const { k } = await call('take', 6).catch(() => ({ k: 0 }));
        if (k > 0) { pool = k - 1; return true; }
        empty = true; return false;
      }));
    },
    async release() { if (stub && pool > 0) { const n = pool; pool = 0; await call('give', n).catch(() => {}); } },
    async pause(ms) { if (stub) await call('pause', ms).catch(() => {}); },
    async stats() { return stub ? call('stats', 0) : { used: null, limit: Number(env.DB_RATE_LIMIT) || 60 }; },
  };
}

// Bahn-Abruf mit Zwischenspeicher: frisch genug → aus dem Speicher; sonst, falls Kontingent frei, neu laden;
// ist das Kontingent erschöpft, die zuletzt gespeicherte Antwort liefern (bis zu einem Tag alt).
async function db(env, path, fresh) {
  if (!env.DB_CLIENT_ID || !env.DB_API_KEY) throw new ApiError('DB_CLIENT_ID / DB_API_KEY fehlen (Worker-Secrets)', 500);
  const cache = caches.default, key = new Request('https://cache.local/db3:' + encodeURIComponent(path));
  const hit = await cache.match(key);
  const age = hit ? (Date.now() - Number(hit.headers.get('x-at') || 0)) / 1000 : Infinity;
  if (hit && age < fresh) return hit.text();
  if (!(await env.budget.take())) {
    if (hit) return hit.text();
    throw new ApiError('Bahn-Kontingent für diese Minute ausgeschöpft', 503);
  }
  const r = await fetch(BASE + path, { headers: { 'DB-Client-Id': env.DB_CLIENT_ID, 'DB-Api-Key': env.DB_API_KEY, accept: 'application/xml', 'user-agent': UA } });
  if (r.status === 429) { await env.budget.pause(15000); if (hit) return hit.text(); throw new ApiError('Bahn-Kontingent erreicht', 503); }
  let text;
  if (r.status === 404) text = '<timetable/>'; // z. B. Stunde ohne Daten
  else if (!r.ok) { if (hit) return hit.text(); throw new ApiError(`Bahn-API ${r.status} ${path.split('/')[1]} ${(await r.text()).slice(0, 80)}`); }
  else text = await r.text();
  await cache.put(key, new Response(text, { headers: { 'cache-control': 'max-age=86400', 'x-at': String(Date.now()) } }));
  return text;
}

// Frische: Bahnhöfe 1 Tag, Fahrpläne 10 min, Echtzeit-Änderungen bei jeder Anfrage, solange das Kontingent reicht
const station = async (env, pattern) => parseStations(await db(env, '/station/' + encodeURIComponent(pattern), 86400));
const plan = async (env, eva, date) => parseTimetable(await db(env, `/plan/${eva}/${planPath(date)}`, 600));
const changes = async (env, eva, fresh = 0) => parseTimetable(await db(env, `/fchg/${eva}`, fresh).catch(() => '<timetable/>'));


// Koordinaten aus den Stationsdaten der Bahn (EVA bzw. Name), sonst Ortssuche
const norm = n => n.toLowerCase().replace(/[^a-zäöüß0-9]/g, '');
const byEva = new Map(stations.map(([eva, , lat, lon]) => [eva, { latitude: lat, longitude: lon }]));
const byName = new Map(stations.map(([, name, lat, lon]) => [norm(name), { latitude: lat, longitude: lon }]));
const known = (name, eva) => (eva && byEva.get(eva)) || byName.get(norm(name)) || null;

// Koordinaten per Ortssuche (Photon/OSM), 30 Tage gemerkt – nur für unbekannte Orte
async function locate(name, eva) {
  const fixed = known(name, eva);
  if (fixed) return fixed;
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
  const query = (q.get('query') || '').trim();
  const words = query.toLowerCase().split(/[\s.-]+/).filter(Boolean);
  const variants = [...new Set([query.replace(' ', '-'), query, query.replace(/\s+/g, '-'), query.replace(/\bSt\.?\s*/i, 'St. '), words.slice(0, 2).join(' '), words[0]].filter(Boolean))];
  const tried = [], found = new Map();
  for (const v of variants) {
    const list = await station(env, v).catch(e => { tried.push(`${v}: ${e.message}`); return []; });
    tried.push(`${v}: ${list.length}`);
    for (const st of list) found.set(st.eva, st);
    if ([...found.values()].some(st => words.every(w => st.name.toLowerCase().includes(w)))) break;
  }
  const rank = st => words.filter(w => st.name.toLowerCase().includes(w)).length;
  const best = [...found.values()].sort((a, b) => rank(b) - rank(a)).slice(0, Number(q.get('results')) || 5);
  if (!best.length) throw new ApiError('Keine Station gefunden (' + tried.join(' | ') + ')', 404);
  return Promise.all(best.map(async st => ({ type: 'stop', id: st.eva, name: st.name, location: await locate(st.name, st.eva).catch(() => ({ latitude: BIAS.lat, longitude: BIAS.lon })) })));
}

async function departures(env, eva, q) {
  const now = new Date(), hours = Math.ceil((Number(q.get('duration')) || 120) / 60);
  const plans = await Promise.all(Array.from({ length: hours + 1 }, (_, i) => plan(env, eva, addHours(now, i))));
  const stops = merge(plans.flat(), await changes(env, eva));
  return { departures: toDepartures(stops, eva, now).slice(0, Number(q.get('results')) || 14) };
}

// Fahrtverlauf: dieselbe Fahrt an den Nachbarbahnhöfen suchen, dort Zeiten + Koordinaten holen
// ---- Gleisgeometrie (OpenStreetMap über Overpass), je Abschnitt zwischen zwei Halten, dauerhaft zwischengespeichert ----
// Mehrere Overpass-Server: overpass-api.de nimmt Verbindungen aus Rechenzentren teils nicht an
const OVERPASS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter'];
async function overpass(query) {
  const errors = [];
  for (const u of OVERPASS) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(`${u}?data=${encodeURIComponent(query)}`, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { errors.push(`${new URL(u).host}: ${String(e?.message || e).slice(0, 40)}`); }
    finally { clearTimeout(t); }
  }
  throw new ApiError('Gleisdaten nicht erreichbar (' + errors.join('; ') + ')');
}
async function railSegment(from, to) {
  const a = byEva.get(from), b = byEva.get(to);
  if (!a || !b) throw new ApiError('Bahnhof unbekannt', 404);
  const A = [a.longitude, a.latitude], B = [b.longitude, b.latitude];
  const text = await cached(`rail1:${from}-${to}`, 2592000, async () => {
    const data = await overpass(overpassQuery(A, B, 0.012));
    const path = shortestPath(buildGraph(data.elements), A, B);
    if (!path) throw new ApiError('Kein Gleisweg gefunden', 404);
    return JSON.stringify({ coords: thin(path).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]) });
  });
  return JSON.parse(text);
}

// Bahnhof per Name: zuerst aus der eingebauten DB-Liste (EVA + Koordinaten), sonst Stationssuche
const byNameEntry = new Map(stations.map(([eva, name, lat, lon]) => [norm(name), { eva, name, location: { latitude: lat, longitude: lon } }]));
async function resolve(env, name) {
  const hit = byNameEntry.get(norm(name));
  if (hit) return hit;
  const list = await station(env, name), s = list.find(x => x.name === name) || list[0];
  return s ? { eva: s.eva, name: s.name, location: known(s.name, s.eva) } : null;
}

// Fahrtverlauf: dieselbe Fahrt an allen Halten vom Start (München/Augsburg) bis München Hbf bzw. 4 Halte nach Augsburg Hbf suchen
async function trip(env, tripId) {
  const [id, eva, pt] = tripId.split('@');
  const base = parseTime(pt);
  const own = merge(await plan(env, eva, base), await changes(env, eva)).find(s => s.id === id);
  if (!own) throw new ApiError('Fahrt nicht gefunden');
  const ownName = (stations.find(r => r[0] === eva) || [])[1] || 'Mering St Afra';
  const win = trackWindow(splitPath(own.ar?.ppth), splitPath(own.dp?.ppth), 4);
  const key = tripKey(id);
  const find = async (name, shifts, fresh) => {
    const st = await resolve(env, name); if (!st?.location) return null;
    const [sh0, ...rest] = shifts;
    for (const sh of [sh0, ...rest]) {
      const hit = (await plan(env, st.eva, addHours(base, sh))).find(x => tripKey(x.id) === key);
      if (hit) return toStopover(st.name, st.eva, st.location, merge([hit], await changes(env, st.eva, fresh))[0]);
    }
    return null;
  };
  const n = win.before.length;
  // Reihenfolge nach Nähe zum Bahnhof: bei knappem Kontingent bekommen die nahen Halte die frischen Daten
  const jobs = [...win.before.map((name, i) => ({ side: 'b', i, d: n - i, name, sh: hourShifts(n - i, -1, base) })), ...win.after.map((name, i) => ({ side: 'a', i, d: i + 1, name, sh: hourShifts(i + 1, 1, base) }))].sort((x, y) => x.d - y.d);
  // ferne Halte (> 4 Stationen) höchstens einmal pro Minute frisch, damit das Kontingent für die nahen reicht
  const done = await Promise.all(jobs.map(j => find(j.name, j.sh, j.d > 4 ? 60 : 0).catch(() => null).then(r => ({ ...j, r }))));
  const beforeStops = win.before.map((_, i) => done.find(j => j.side === 'b' && j.i === i).r);
  const afterStops = win.after.map((_, i) => done.find(j => j.side === 'a' && j.i === i).r);
  const here1 = toStopover(ownName, eva, await locate(ownName, eva), own);
  const stopovers = [...beforeStops, here1, ...afterStops].filter(Boolean);
  const start = stopovers.find(x => x.stop.name === win.start) || null;
  return { trip: { id: tripId, stopovers, start } };
}

export default {
  async fetch(req, env0, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env0.ASSETS.fetch(req);
    const budget = makeBudget(env0), env = { ...env0, budget };
    const path = url.pathname.slice(4), q = url.searchParams;
    try {
      let m;
      if (path === '/limit') return json(await budget.stats(), 200, 0);
      if (path === '/rail') return json(await railSegment(q.get('from') || '', q.get('to') || ''), 200, 86400);
      if (path === '/geocode') return json(await locateAddress(q.get('q') || ''), 200, 86400);
      if (path === '/locations') { const r = await locations(env, q); ctx?.waitUntil?.(budget.release()); return json(r, 200, 60); }
      if ((m = path.match(/^\/stops\/([^/]+)\/departures$/))) { const r = await departures(env, decodeURIComponent(m[1]), q); ctx?.waitUntil?.(budget.release()); return json(r, 200, 5); }
      if ((m = path.match(/^\/trips\/(.+)$/))) { const r = await trip(env, decodeURIComponent(m[1])); ctx?.waitUntil?.(budget.release()); return json(r, 200, 5); }
      return json({ error: 'unbekannter Pfad' }, 404);
    } catch (e) {
      console.error(path, e?.stack);
      ctx?.waitUntil?.(budget.release());
      return json({ error: e instanceof ApiError ? e.message : 'Fehler', detail: String(e?.message || e).slice(0, 160) }, e?.status || 502, 0);
    }
  },
};
