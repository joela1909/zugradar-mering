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

const MUC_HBF = /^München Hbf/, MUC_STOP = /^(München[- ]Pasing|München Hbf)/;
/**
 * Anzeige-Filter je Richtung:
 * Richtung Augsburg → nur Züge, die in München Hbf starten bzw. von dort kommen.
 * Richtung München → nur Züge, die in München-Pasing oder München Hbf halten.
 */
export function matchesDir(d, dir) {
  if (dirOf(d) !== dir) return false;
  const prev = [...(d.previousStops || []), d.origin].filter(Boolean), next = d.nextStops || [];
  if (dir === 'augsburg') return prev.length ? prev.some(n => MUC_HBF.test(n)) : /münchen/i.test(d.origin || '');
  return next.length ? next.some(n => MUC_STOP.test(n)) : /münchen/i.test(d.direction || '');
}
