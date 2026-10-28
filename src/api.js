const BASE = '/api';
const j = async (u, o) => {
  const r = await fetch(u, o);
  if (!r.ok) { let d = ''; try { const b = await r.json(); d = `${b.error || ''} ${b.detail || ''}`; } catch {} throw new Error(`${r.status} ${d || u}`.trim()); }
  return r.json();
};
const D = s => (s ? new Date(s) : null);
const minutes = s => (s == null ? null : s / 60);

export const FALLBACK_STATION = { id: null, name: 'Mering St Afra', lonlat: [10.971202, 48.274282] };

export async function findStation() {
  const r = await j(`${BASE}/locations?query=${encodeURIComponent('Mering St Afra')}&results=5&v=3`, { cache: 'no-store' });
  const s = r.find(x => /afra/i.test(x.name)) || r[0];
  if (!s) throw new Error('Station nicht gefunden');
  return { id: s.id, name: s.name, lonlat: [s.location.longitude, s.location.latitude] };
}

export async function geocode(q) { const r = await j(`${BASE}/geocode?q=${encodeURIComponent(q)}`); return [r.longitude, r.latitude]; }

export async function departures(station) {
  const r = await j(`${BASE}/stops/${station.id}/departures?duration=150&results=14&language=de&remarks=false`);
  return r.departures.map(d => ({
    tripId: d.tripId, line: d.line?.name || '?', direction: d.direction || '', platform: d.platform || d.plannedPlatform || '–', plannedPlatform: d.plannedPlatform || null,
    trainNo: d.trainNo || null, category: d.category || null, origin: d.origin || null, nextStops: d.nextStops || [], previousStops: d.previousStops || [],
    planned: D(d.plannedWhen), actual: D(d.when), delay: minutes(d.delay), cancelled: !!d.cancelled,
  })).filter(d => d.planned);
}

export async function trip(tripId, station) {
  const r = await j(`${BASE}/trips/${encodeURIComponent(tripId)}?stopovers=true&polyline=true&language=de`);
  const t = r.trip || r;
  const stopovers = (t.stopovers || []).filter(s => s.stop?.location).map(s => ({
    name: s.stop.name, id: s.stop.id, lonlat: [s.stop.location.longitude, s.stop.location.latitude],
    arr: D(s.arrival || s.plannedArrival), dep: D(s.departure || s.plannedDeparture),
    plannedArr: D(s.plannedArrival), plannedDep: D(s.plannedDeparture),
    arrDelay: minutes(s.arrivalDelay), depDelay: minutes(s.departureDelay), cancelled: !!s.cancelled,
  }));
  const st = t.start && { name: t.start.stop.name, dep: D(t.start.departure || t.start.plannedDeparture), plannedDep: D(t.start.plannedDeparture), depDelay: minutes(t.start.departureDelay) };
  const polyline = (t.polyline?.features || []).map(f => f.geometry.coordinates);
  const line = polyline.length > 1 ? polyline : stopovers.map(s => s.lonlat);
  return { stopovers, start: st || null, polyline: line, currentLocation: t.currentLocation ? [t.currentLocation.longitude, t.currentLocation.latitude] : null };
}

const ROUTERS = { foot: 'routed-foot', bike: 'routed-bike', car: 'routed-car' };
export async function route(mode, from, to) {
  const p = ROUTERS[mode] || ROUTERS.foot;
  const r = await j(`https://routing.openstreetmap.de/${p}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`);
  const x = r.routes[0];
  return { coords: x.geometry.coordinates, meters: x.distance, seconds: x.duration };
}

/* ---------- Demo-Daten (offline, grob vereinfachte Geometrie) ---------- */
export function demo(now = new Date()) {
  const station = { ...FALLBACK_STATION, name: 'Mering St Afra (Demo)' };
  const names = [['Augsburg Hbf', [10.8855, 48.3654]], ['Augsburg-Hochzoll', [10.9330, 48.3430]], [station.name, station.lonlat],
    ['Mering', [10.9830, 48.2670]], ['Althegnenberg', [11.1040, 48.2160]], ['Maisach', [11.2300, 48.2060]], ['München Hbf', [11.5600, 48.1400]]];
  const polyline = [];
  for (let i = 0; i < names.length - 1; i++) {
    const [a, b] = [names[i][1], names[i + 1][1]];
    for (let k = 0; k < 12; k++) polyline.push([a[0] + (b[0] - a[0]) * k / 12 + Math.sin(i + k) * 0.0006, a[1] + (b[1] - a[1]) * k / 12 + Math.cos(i + k) * 0.0004]);
  }
  polyline.push(names[names.length - 1][1]);
  // Haltepunkte exakt auf die Linie legen
  const snap = p => polyline.reduce((b, q) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(b[0] - p[0], b[1] - p[1]) ? q : b));
  const mk = (off, delays, rev = false) => {
    const base = new Date(now); base.setSeconds(0, 0);
    const mins = [0, 6, 12, 15, 24, 31, 52];
    const stopovers = (rev ? [...names].reverse() : names).map(([n, ll], i) => {
      const p = new Date(+base + (off + mins[i]) * 60000), dl = delays[i] ?? delays[delays.length - 1];
      return { name: n, lonlat: snap(ll), plannedArr: p, plannedDep: new Date(+p + 60000), arr: new Date(+p + dl * 60000), dep: new Date(+p + 60000 + dl * 60000), arrDelay: dl, depDelay: dl };
    });
    return { stopovers, polyline: rev ? [...polyline].reverse() : polyline, start: { name: stopovers[0].name, dep: stopovers[0].dep, plannedDep: stopovers[0].plannedDep, depDelay: stopovers[0].depDelay } };
  };
  const trips = [
    { line: 'RE 9', direction: 'München Hbf', trip: mk(-9, [2, 3, 4, 5]) },
    { line: 'RB 86', direction: 'München Hbf', trip: mk(14, [0, 1, 3, 6]) },
    { line: 'RE 80', direction: 'München Hbf', trip: mk(38, [0, 0, 0, 0]) },
    { line: 'RE 9', direction: 'Ulm Hbf', trip: mk(-5, [0, 1, 2], true), rev: true },
  ];
  const deps = trips.map((t, i) => { const s = t.trip.stopovers[t.trip.stopovers.findIndex(x => /afra/i.test(x.name))]; const names2 = t.trip.stopovers.map(x => x.name), k = names2.findIndex(n => /afra/i.test(n)); return { tripId: 'demo' + i, line: t.line, direction: t.direction, platform: String(i + 1), planned: s.plannedDep, actual: s.dep, delay: s.depDelay, cancelled: false, previousStops: names2.slice(0, k), nextStops: names2.slice(k + 1), origin: names2[0] }; });
  return { station, deps, trip: id => Promise.resolve({ ...trips[+id.slice(4)].trip, currentLocation: null }) };
}
