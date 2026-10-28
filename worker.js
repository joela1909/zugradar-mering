const UPSTREAM = 'https://v6.db.transport.rest';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const target = UPSTREAM + url.pathname.slice(4) + url.search;
    try {
      const r = await fetch(target, { headers: { 'user-agent': 'zugradar-mering (privates Hobbyprojekt)', accept: 'application/json' }, cf: { cacheTtl: 15, cacheEverything: true } });
      const body = await r.text();
      return new Response(r.ok ? body : JSON.stringify({ error: `Upstream ${r.status}`, detail: body.slice(0, 200) }), {
        status: r.ok ? 200 : 502,
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=15' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Upstream nicht erreichbar', detail: String(e).slice(0, 200) }), { status: 502, headers: { 'content-type': 'application/json' } });
    }
  },
};
