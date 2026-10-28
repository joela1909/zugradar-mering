const KEY = 'zugradar.history.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = h => { try { localStorage.setItem(KEY, JSON.stringify(h)); } catch {} };
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Beobachtung (Verspätung in Min am Bahnhof) je Linie+Abfahrtsminute des Tages; max. 30 pro Schlüssel. */
export function record(key, delayMin) {
  const h = load(); const a = h[key] || [];
  a.push(delayMin); h[key] = a.slice(-30); save(h);
}
export const histKey = (line, planned) => `${line}|${String(planned.getHours()).padStart(2, '0')}:${String(planned.getMinutes()).padStart(2, '0')}`;

/**
 * Erwartete Verspätung am Bahnhof (Min).
 * live: aktuell prognostizierte Verspätung (Min) oder null, stopsAway: Halte bis zum Bahnhof,
 * hist: Verlauf (Min). Je näher der Zug, desto stärker zählt die Live-Prognose.
 */
export function expectedDelay({ live, stopsAway, hist }) {
  const hm = hist.length >= 3 ? median(hist) : null;
  if (live == null) return { min: hm ?? 0, basis: hm == null ? 'Fahrplan' : `Historie (${hist.length}×)` };
  if (hm == null) return { min: live, basis: 'Live-Prognose' };
  const w = Math.max(0.35, Math.min(0.95, 0.95 - 0.1 * stopsAway)); // Gewicht Live
  return { min: w * live + (1 - w) * hm, basis: `Live ${Math.round(w * 100)} % + Historie` };
}
export { median };
