// Ersetzt "cross-fetch" im Worker durch das eingebaute fetch (node-fetch läuft in Workers nicht zuverlässig)
export const Request = globalThis.Request;
export const Headers = globalThis.Headers;
export const Response = globalThis.Response;

export async function fetch(url, opts = {}) {
  const { agent, keepalive, query, ...rest } = opts;
  const res = await globalThis.fetch(url, rest);
  if (!res.ok) {
    let body = '';
    try { body = (await res.clone().text()).slice(0, 120); } catch {}
    globalThis.__lastFail = `HTTP ${res.status} ${new URL(url).pathname} ${body}`.trim();
  }
  return res;
}
export default fetch;
