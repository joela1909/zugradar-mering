// Reine Logik: Richtung, Startbahnhof, Fortschritt
export const START_RE = /^(Augsburg Hbf|München Hbf|München[- ]Pasing)/;
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

const MUC_HBF = /^(München Hbf|München[- ]Pasing)/, MUC_STOP = /^(München[- ]Pasing|München Hbf)/;
/**
 * Anzeige-Filter je Richtung:
 * Richtung Augsburg → nur Züge, die in München Hbf oder München-Pasing starten bzw. von dort kommen.
 * Richtung München → nur Züge, die in München-Pasing oder München Hbf halten.
 */
export function matchesDir(d, dir) {
  if (dirOf(d) !== dir) return false;
  const prev = [...(d.previousStops || []), d.origin].filter(Boolean), next = d.nextStops || [];
  if (dir === 'augsburg') return prev.length ? prev.some(n => MUC_HBF.test(n)) : /münchen/i.test(d.origin || '');
  return next.length ? next.some(n => MUC_STOP.test(n)) : /münchen/i.test(d.direction || '');
}

/**
 * Halte zwischen Start und Bahnhof als Positionen (0..1) im Fortschrittsbalken.
 * names: Halte nach dem Start (Reihenfolge), times: Map Name → Zeit (nur für bekannte Halte).
 * Halte ohne Zeit werden gleichmäßig zwischen ihren Nachbarn verteilt.
 */
export function stopFractions(names, times, tStart, tEnd) {
  const known = names.map(n => (times.get(n) != null ? timeProgress(tStart, tEnd, times.get(n)) : null));
  const out = [];
  for (let i = 0; i < names.length; i++) {
    let f = known[i];
    if (f == null) {
      let a = i - 1, b = i + 1;
      while (a >= 0 && known[a] == null) a--;
      while (b < names.length && known[b] == null) b++;
      const fa = a >= 0 ? known[a] : 0, fb = b < names.length ? known[b] : 1;
      f = fa + (fb - fa) * (i - a) / (b - a);
    }
    out.push({ name: names[i], f });
  }
  return out.map((o, i, arr) => ({ ...o, f: Math.max(o.f, i ? arr[i - 1].f : 0) })).filter(o => o.f > 0.02 && o.f < 0.98);
}

const DB_CATEGORIES = /^(RE|RB|IRE|IC|ICE|EC|ECE|S|RJ|RJX|NJ|FLX|TGV)$/i;
/** Zug-Lackierung nach Betreiber: 'arverio' (blau), 'db' (rot) oder 'other' (neutral). */
export function livery(dep) {
  const cat = (dep.category || '').trim(), name = (dep.line || '').trim();
  if (/^ARV$/i.test(cat) || /^ARV\b/i.test(name)) return 'arverio';
  if (DB_CATEGORIES.test(cat) || (!cat && /^(RE|RB|IRE|IC|ICE|S)\b/i.test(name))) return 'db';
  return 'other';
}

/** Abfahrten zur exakt gleichen Planzeit in dieselbe Richtung fahren gekoppelt (z. B. RE80 + RE89):
 *  ein Eintrag je Zug, die weiteren Zugteile stehen in .coupled */
export function couple(list) {
  const out = [], by = new Map();
  for (const d of list) {
    const k = +d.planned + '|' + dirOf(d), g = by.get(k);
    if (g) g.coupled.push(d); else { const c = { ...d, coupled: [] }; by.set(k, c); out.push(c); }
  }
  return out;
}
