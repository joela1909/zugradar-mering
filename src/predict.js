const KEY = 'zugradar.history.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = h => { try { localStorage.setItem(KEY, JSON.stringify(h)); } catch {} };
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Beobachtung (Verspätung in Min am Bahnhof) je Linie+Abfahrtsminute des Tages; max. 30 pro Schlüssel. */
export function record(key, delayMin) {
  const h = load(); const a = h[key] || [];
  a.push(delayMin); h[key] = a.slice(-30); save(h);
}
// Uhrzeit in deutscher Zeit (unabhängig von der Zeitzone des Geräts)
export const histKey = (line, planned) => `${line}|${planned.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })}`;

/**
 * Erwartete Verspätung am Bahnhof (Min).
 * live: aktuell prognostizierte Verspätung (Min) oder null, stopsAway: Halte bis zum Bahnhof,
 * hist: Verlauf (Min). Live-Werte der Bahn haben Vorrang; die Historie zählt nur ohne Live-Daten.
 */
export function expectedDelay({ live, stopsAway, hist }) {
  const hm = hist.length >= 3 ? median(hist) : null;
  if (live == null) return { min: hm ?? 0, basis: hm == null ? 'Fahrplan' : `Historie (${hist.length}×)` };
  // Liegt eine Live-Prognose der Bahn vor, wird genau sie angezeigt (die eigene Historie nur als Hinweis)
  return { min: live, basis: hm == null ? 'Live (DB)' : `Live (DB) · sonst meist ${hm >= 0.5 ? '+' + Math.round(hm) : 'pünktlich'}` };
}
export { median };
