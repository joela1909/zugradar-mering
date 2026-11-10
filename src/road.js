// Ampeln und Blitzer entlang einer Route, Lernen der Ampel-Wartezeiten aus den eigenen Fahrten, Schätzung der Grünphase.
const M_LAT = 111320;
const mx = lat => M_LAT * Math.cos(lat * Math.PI / 180);

/** Punkte nahe der Route: [{p, i, along (m ab Start), off (m seitlich)}], nach Position sortiert */
export function alongRoute(coords, points, tol = 25) {
  if (!coords || coords.length < 2) return [];
  const kx = mx(coords[0][1]), cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + Math.hypot((coords[i][0] - coords[i - 1][0]) * kx, (coords[i][1] - coords[i - 1][1]) * M_LAT));
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const c of coords) { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); }
  const padX = tol / kx, padY = tol / M_LAT, out = [];
  points.forEach((p, idx) => {
    if (p[0] < w - padX || p[0] > e + padX || p[1] < s - padY || p[1] > n + padY) return;
    let best = null;
    for (let i = 1; i < coords.length; i++) {
      const ax = coords[i - 1][0] * kx, ay = coords[i - 1][1] * M_LAT, dx = coords[i][0] * kx - ax, dy = coords[i][1] * M_LAT - ay, l2 = dx * dx + dy * dy;
      const px = p[0] * kx - ax, py = p[1] * M_LAT - ay, t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
      const off = Math.hypot(px - dx * t, py - dy * t);
      if (off <= tol && (!best || off < best.off)) best = { p, i: idx, along: cum[i - 1] + Math.sqrt(l2) * t, off };
    }
    if (best) out.push(best);
  });
  return out.sort((a, b) => a.along - b.along);
}

/** Stabile Kennung einer Ampelkreuzung (für gelernte Werte) */
export const signalId = p => p[0].toFixed(5) + ',' + p[1].toFixed(5);

/** Ampelkreuzungen auf der Route; Kreuzungen dichter als 60 m hintereinander zählen als eine */
export function signalsOn(coords, junctions) {
  const out = [];
  for (const h of alongRoute(coords, junctions, 28)) {
    if (out.length && h.along - out[out.length - 1].along < 60) continue;
    out.push({ id: signalId(h.p), lonlat: h.p, along: h.along });
  }
  return out;
}
/** Blitzer auf der Route: feste (OSM, [lon,lat,tempo]) und gemeldete ({lonlat,t,id}) */
export function camerasOn(coords, fixed, reports = []) {
  const a = alongRoute(coords, fixed, 30).map(h => ({ lonlat: [h.p[0], h.p[1]], along: h.along, limit: h.p[2] || null, kind: 'fest' }));
  const b = alongRoute(coords, reports.map(r => [...r.lonlat, r]), 60).map(h => ({ lonlat: [h.p[0], h.p[1]], along: h.along, limit: null, kind: 'gemeldet', t: h.p[2].t, id: h.p[2].id }));
  return [...a, ...b].sort((x, y) => x.along - y.along);
}

/**
 * Umlaufzeit einer Ampel aus beobachteten Grün-Zeitpunkten (Sekunden seit 1970) schätzen.
 * Annahme: Festzeitsteuerung, an die Uhrzeit gekoppelt, ganzzahlige Umlaufzeit 40–150 s. Liefert { T, phase, r, n } oder null,
 * wenn die Beobachtungen zu keiner Umlaufzeit eng genug zusammenfallen (verkehrsabhängige Steuerung, zu wenig Daten).
 */
export function estimateCycle(greens, minN = 6, minR = 0.75) {
  if (!greens || greens.length < minN) return null;
  let best = null;
  for (let T = 40; T <= 150; T++) {
    let c = 0, s = 0;
    for (const t of greens) { const a = 2 * Math.PI * ((t % T) / T); c += Math.cos(a); s += Math.sin(a); }
    const r = Math.hypot(c, s) / greens.length;
    if (!best || r > best.r + 0.02 || (r > best.r - 0.02 && T > best.T && r >= minR)) best = { T, r, phase: ((Math.atan2(s, c) / (2 * Math.PI)) * T + T) % T };
  }
  return best && best.r >= minR ? { ...best, n: greens.length } : null;
}
/** Sekunden bis zum nächsten geschätzten Grünbeginn (0 … T) */
export const nextGreenIn = (model, nowSec) => (((model.phase - (nowSec % model.T)) % model.T) + model.T) % model.T;

/** Kennzahlen einer Ampel aus den gelernten Beobachtungen */
export function signalStats(o) {
  if (!o) return null;
  const n = (o.pass || 0) + (o.waits?.length || 0);
  if (!n) return null;
  const avgWait = o.waits?.length ? o.waits.reduce((a, b) => a + b, 0) / o.waits.length : 0, pStop = (o.waits?.length || 0) / n;
  return { n, pStop, avgWait, expected: pStop * avgWait, cycle: estimateCycle(o.greens) };
}

/**
 * Lernt aus der Fahrt: an welcher Ampel wurde wie lange gewartet, wann wurde es grün.
 * feed({ t (ms), along (m auf der Route), speed (m/s) }, signale) → Liste abgeschlossener Beobachtungen
 * [{ id, wait (s) | null (ohne Halt durchgefahren), green (s seit 1970) | null }]
 */
export function createSignalLearner() {
  let stop = null, prev = null; const done = new Set();
  return {
    reset() { stop = null; prev = null; done.clear(); },
    feed({ t, along, speed }, signals) {
      // Ampeln, an denen die Anfahrt nicht beobachtet wurde (Einstieg mitten in die Route, GPS-Sprung > 300 m), nicht werten
      if (prev == null || along - prev > 300 || along < prev - 100) for (const s of signals) if (s.along < along - 25) done.add(s.id);
      prev = along;
      const out = [], ahead = signals.find(s => !done.has(s.id) && s.along - along > -15);
      if (stop && speed > 3) {                                   // wieder angefahren → Wartezeit und Grün-Zeitpunkt
        const wait = (t - stop.t) / 1000;
        if (wait >= 4 && wait <= 240) out.push({ id: stop.id, wait: Math.round(wait), green: Math.round(t / 1000) });
        done.add(stop.id); stop = null;
      } else if (!stop && ahead && speed < 1.2 && ahead.along - along < 90 && ahead.along - along > -10) stop = { id: ahead.id, t };
      for (const s of signals) {                                 // ohne Halt passiert
        if (done.has(s.id) || (stop && stop.id === s.id)) continue;
        if (along - s.along > 25) { done.add(s.id); out.push({ id: s.id, wait: null, green: null }); }
      }
      return out;
    },
  };
}
/** Beobachtung in den Speicher einer Ampel eintragen (höchstens 40 Werte je Liste) */
export function recordSignal(store, ob) {
  const o = store[ob.id] || (store[ob.id] = { pass: 0, waits: [], greens: [] });
  if (ob.wait == null) o.pass = (o.pass || 0) + 1;
  else { o.waits.push(ob.wait); o.greens.push(ob.green); o.waits = o.waits.slice(-40); o.greens = o.greens.slice(-40); }
  return store;
}
