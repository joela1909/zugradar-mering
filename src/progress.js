// Reine Logik: Richtung, Startbahnhof, Fortschritt
export const START_RE = /^(Augsburg|München) Hbf/;
const AUGSBURG_SIDE = /augsburg|ulm|donauw|würzburg|nürnberg|ingolstadt/i;

/** 'augsburg' = fährt Richtung Augsburg, sonst 'muenchen' */
export function dirOf(d) {
  const next = d.nextStops || [];
  if (next.length) return next.some(n => /augsburg/i.test(n)) ? 'augsburg' : 'muenchen';
  return AUGSBURG_SIDE.test(d.direction || '') ? 'augsburg' : 'muenchen';
}

/** Startbahnhof der Fahrt: Augsburg Hbf / München Hbf, sonst der erste Halt. */
export function startName(d) {
  const prev = d.previousStops || [];
  return prev.find(n => START_RE.test(n)) || prev[0] || d.origin || null;
}

const clamp = x => Math.max(0, Math.min(1, x));
export const timeProgress = (start, end, now) => (start != null && end != null && end > start ? clamp((now - start) / (end - start)) : null);
export const distProgress = (total, remaining) => (total > 0 ? clamp(1 - remaining / total) : 0);
export const minutesUntil = (t, now) => Math.max(0, Math.round((t - now) / 60000));
/** Puffer in Minuten: Zug-Abfahrt minus eigene Ankunft */
export const buffer = (trainDep, myEta) => Math.round((trainDep - myEta) / 60000);
