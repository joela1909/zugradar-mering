import { createClient } from 'db-vendo-client';
import { profile as dbnav } from 'db-vendo-client/p/dbnav/index.js';
import { profile as dbweb } from 'db-vendo-client/p/dbweb/index.js';
import { profile as db } from 'db-vendo-client/p/db/index.js';

const UA = 'zugradar-mering (privates Hobbyprojekt)';
const UPSTREAM = 'https://v6.db.transport.rest';
const profiles = { dbnav, dbweb, db };
const clients = {};
const getClient = name => (clients[name] ||= createClient(profiles[name], UA, { enrichStations: false }));

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=15' } });
const num = (v, d) => (v == null || v === '' ? d : Number(v));

// Direkt über die Bahn (db-vendo-client) – gleiches Datenformat wie transport.rest
async function viaVendo(name, path, q) {
  const c = getClient(name);
  let m;
  if (path === '/locations') return json(await c.locations(q.get('query') || '', { results: num(q.get('results'), 5), stops: true, addresses: false, poi: false }));
  if ((m = path.match(/^\/stops\/([^/]+)\/departures$/))) return json(await c.departures(decodeURIComponent(m[1]), { duration: num(q.get('duration'), 120), results: num(q.get('results'), 14), language: 'de', remarks: false }));
  if ((m = path.match(/^\/trips\/(.+)$/))) return json(await c.trip(decodeURIComponent(m[1]), { stopovers: true, polyline: true, language: 'de' }));
  return json({ error: 'unbekannter Pfad' }, 404);
}

async function viaTransportRest(path, search) {
  const r = await fetch(UPSTREAM + path + search, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`transport.rest ${r.status}`);
  return new Response(await r.text(), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=15' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const path = url.pathname.slice(4);
    const errors = [];
    globalThis.__lastFail = '';
    const sources = [...Object.keys(profiles).map(n => [n, () => viaVendo(n, path, url.searchParams)]), ['transport.rest', () => viaTransportRest(path, url.search)]];
    for (const [name, fn] of sources) {
      globalThis.__lastFail = '';
      try { return await fn(); } catch (e) { console.error(name, e?.stack); errors.push(`${name}: ${[e?.message, globalThis.__lastFail, e?.response?.status && 'status ' + e.response.status].filter(Boolean).join(' / ').slice(0, 220) || 'unbekannt'}`); }
    }
    return json({ error: 'Alle Quellen fehlgeschlagen', detail: errors.join(' | ') }, 502);
  },
};
