// Parser/Hilfsfunktionen für die DB Timetables API (IRIS-XML). Reine Funktionen, ohne Netzwerk.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()];
});

const attrs = str => { const o = {}; for (const m of str.matchAll(/([\w:-]+)="([^"]*)"/g)) o[m[1]] = decode(m[2]); return o; };
const tag = (inner, name) => { const m = inner.match(new RegExp(`<${name}\\b([^>]*?)/?>`)); return m ? attrs(m[1]) : null; };

/** <timetable>…<s id=…><tl/><ar/><dp/></s> → [{id, tl, ar, dp}] */
export function parseTimetable(xml) {
  const out = [];
  for (const m of xml.matchAll(/<s\b([^>]*?)(?:\/>|>([\s\S]*?)<\/s>)/g)) {
    const a = attrs(m[1]), inner = m[2] || '';
    out.push({ id: a.id, eva: a.eva, tl: tag(inner, 'tl'), ar: tag(inner, 'ar'), dp: tag(inner, 'dp') });
  }
  return out;
}

export function parseStations(xml) {
  return [...xml.matchAll(/<station\b([^>]*?)\/?>/g)].map(m => attrs(m[1])).filter(s => s.eva);
}

/** Plan-Eintrag + Änderungen (fchg) zusammenführen. */
export function merge(plan, changes) {
  const byId = new Map(changes.map(c => [c.id, c]));
  return plan.map(p => {
    const c = byId.get(p.id);
    return { ...p, ar: p.ar && { ...p.ar, ...(c?.ar || {}) }, dp: p.dp && { ...p.dp, ...(c?.dp || {}) } };
  });
}

// ---------- Zeit (IRIS: yyMMddHHmm in Ortszeit Europe/Berlin) ----------
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
export function berlinParts(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
const offsetMin = t => { const p = berlinParts(new Date(t)); return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(t / 60000) * 60000) / 60000; };

export function parseTime(s) {
  if (!s || s.length < 10) return null;
  const [y, mo, d, h, mi] = [2000 + +s.slice(0, 2), +s.slice(2, 4), +s.slice(4, 6), +s.slice(6, 8), +s.slice(8, 10)];
  const local = Date.UTC(y, mo - 1, d, h, mi);
  let t = local - offsetMin(local) * 60000;
  t = local - offsetMin(t) * 60000;
  return new Date(t);
}
export const planPath = date => {
  const p = berlinParts(date), z = n => String(n).padStart(2, '0');
  return `${z(p.y % 100)}${z(p.mo)}${z(p.d)}/${z(p.h)}`;
};
export const addHours = (date, h) => new Date(+date + h * 3600000);

// ---------- Abfahrten ----------
const lineName = s => (s.dp?.l || s.ar?.l) ? `${s.tl?.c || ''} ${s.dp?.l || s.ar?.l}`.replace(/^(\S+) \1/, '$1').trim() : `${s.tl?.c || ''} ${s.tl?.n || ''}`.trim();
const splitPath = p => (p ? p.split('|').filter(Boolean) : []);
export const tripKey = id => (id || '').replace(/-\d+$/, '');

export function toDepartures(stops, eva, now = new Date()) {
  const seen = new Set();
  return stops.filter(s => !seen.has(s.id) && seen.add(s.id)).filter(s => s.dp?.pt && !/^bus$/i.test(s.tl?.c || '')).map(s => {
    const planned = parseTime(s.dp.pt), actual = parseTime(s.dp.ct || s.dp.pt);
    const path = splitPath(s.dp.ppth);
    return {
      tripId: `${s.id}@${eva}@${s.dp.pt}`,
      line: { name: lineName(s) },
      direction: path[path.length - 1] || '',
      plannedWhen: planned.toISOString(), when: actual.toISOString(),
      delay: Math.round((actual - planned) / 1000),
      platform: s.dp.cp || s.dp.pp || null, plannedPlatform: s.dp.pp || null,
      cancelled: s.dp.cs === 'c',
      trainNo: s.tl?.n || null, category: s.tl?.c || null, operator: s.tl?.o || null,
      origin: splitPath(s.ar?.ppth)[0] || null, nextStops: path, previousStops: splitPath(s.ar?.ppth),
    };
  }).filter(d => +new Date(d.when) > +now - 120000).sort((a, b) => a.when.localeCompare(b.when));
}

export function toStopover(name, eva, location, s) {
  const pl = (x, k) => (x?.[k] ? parseTime(x[k]) : null);
  const iso = d => (d ? d.toISOString() : null);
  const arrP = pl(s.ar, 'pt'), arr = pl(s.ar, 'ct') || arrP, depP = pl(s.dp, 'pt'), dep = pl(s.dp, 'ct') || depP;
  return {
    stop: { id: eva, name, location },
    plannedArrival: iso(arrP), arrival: iso(arr), arrivalDelay: arr && arrP ? Math.round((arr - arrP) / 1000) : null,
    plannedDeparture: iso(depP), departure: iso(dep), departureDelay: dep && depP ? Math.round((dep - depP) / 1000) : null,
    cancelled: s.ar?.cs === 'c' || s.dp?.cs === 'c',
  };
}
export { splitPath };

const START_STOP = /^(Augsburg Hbf|München Hbf|München[- ]Pasing)/;
/** Tracking-Fenster: alle Halte ab Startbahnhof bis vor den Bahnhof + die nächsten nAfter Halte danach. */
export function trackWindow(previous, next, nAfter = 4) {
  const i = previous.findIndex(n => START_STOP.test(n));
  const from = i >= 0 ? i : 0;
  return { start: previous[from] || null, before: previous.slice(from), after: next.slice(0, nAfter) };
}
/** Plan-Stunden (Verschiebung gegenüber t0, in Stunden), in denen ein Halt k Stationen entfernt am wahrscheinlichsten liegt. */
export function hourShifts(k, dir, t0, minPerStop = 4.5) {
  const hs = d => Math.floor(+d / 3600000), est = new Date(+t0 + dir * k * minPerStop * 60000), s = hs(est) - hs(t0);
  return [...new Set([s, s - 1, s + 1])];
}
