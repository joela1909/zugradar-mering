import { cumulative, nearestIndex, pointAt, bearing } from './geo.js';

/** stopovers: [{name, lonlat, arr, dep}] mit Date-Objekten (aktuelle Prognose). polyline: [[lon,lat]] */
export function prepare(stopovers, polyline) {
  const cum = cumulative(polyline);
  let idx = 0;
  const stops = stopovers.map(s => {
    idx = nearestIndex(polyline, s.lonlat, idx);
    return { ...s, d: cum[idx] };
  });
  return { stops, polyline, cum };
}

/** Live-Position: zwischen Stopps nach (prognostizierten) Zeiten entlang der Strecke interpoliert. */
export function positionAt(tr, now) {
  const { stops, polyline, cum } = tr;
  const t = +now;
  const first = stops[0], last = stops[stops.length - 1];
  const t0 = +(first.dep || first.arr), t1 = +(last.arr || last.dep);
  if (t < t0) return { state: 'wartet', pos: polyline[0], bearing: 0, progress: 0 };
  if (t > t1) return { state: 'angekommen', pos: polyline[polyline.length - 1], bearing: 0, progress: 1 };
  let d = last.d, state = 'fährt';
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    const dep = +(a.dep || a.arr), arr = +(b.arr || b.dep);
    if (t >= dep && t <= arr) { d = a.d + (b.d - a.d) * (t - dep) / ((arr - dep) || 1); break; }
    const bdep = +(b.dep || b.arr);
    if (t > arr && t < bdep) { d = b.d; state = 'hält'; break; }
  }
  const pos = pointAt(polyline, cum, d), ahead = pointAt(polyline, cum, d + 30);
  return { state, pos, bearing: bearing(pos, ahead), progress: d / cum[cum.length - 1], dist: d };
}
