// Straßenverkehr: Antworten von TomTom (Routing mit Live-Verkehr, Meldungen) und der Autobahn-API in das App-Format bringen.

/** TomTom calculateRoute → [{coords:[[lon,lat]], meters, seconds, delay, noTraffic, jams:[{from,to,cat,delay,mag}]}] */
export function parseTomTomRoutes(json) {
  return (json?.routes || []).map(r => {
    const coords = [], legStart = [];
    for (const leg of r.legs || []) { legStart.push(coords.length); for (const p of leg.points || []) coords.push([+p.longitude.toFixed(6), +p.latitude.toFixed(6)]); }
    const s = r.summary || {};
    const jams = (r.sections || []).filter(x => x.sectionType === 'TRAFFIC' && x.endPointIndex > x.startPointIndex).map(x => ({
      from: x.startPointIndex, to: x.endPointIndex, cat: x.simpleCategory || 'JAM', delay: x.delayInSeconds || 0, mag: x.magnitudeOfDelay ?? 0, speed: x.effectiveSpeedInKmh ?? null,
    }));
    return { coords, meters: s.lengthInMeters || 0, seconds: s.travelTimeInSeconds || 0, delay: s.trafficDelayInSeconds || 0, noTraffic: s.noTrafficTravelTimeInSeconds ?? null, jams };
  }).filter(r => r.coords.length > 1);
}

const TT_ICON = { 1: 'Unfall', 2: 'Nebel', 3: 'Gefahr', 4: 'Regen', 5: 'Glätte', 6: 'Stau', 7: 'Spur gesperrt', 8: 'Straße gesperrt', 9: 'Baustelle', 10: 'Wind', 11: 'Überflutung', 14: 'Liegengebliebenes Fahrzeug' };
/** TomTom incidentDetails (v5) → [{lonlat, kind, text, delay, closed}] */
export function parseTomTomIncidents(json) {
  return (json?.incidents || []).map(i => {
    const g = i.geometry || {}, c = g.type === 'Point' ? g.coordinates : g.coordinates?.[Math.floor((g.coordinates?.length || 1) / 2)], p = i.properties || {};
    if (!c) return null;
    const kind = TT_ICON[p.iconCategory] || 'Meldung', ev = (p.events || []).map(e => e.description).filter(Boolean).join(', ');
    return { lonlat: [+c[0].toFixed(5), +c[1].toFixed(5)], kind, text: [ev || kind, p.from && p.to ? `${p.from} → ${p.to}` : ''].filter(Boolean).join(' · '), delay: p.delay || 0, closed: p.iconCategory === 8 };
  }).filter(Boolean);
}

/** Autobahn-API (warning/closure/roadworks) → gleiches Format; bbox = [w,s,e,n] */
export function parseAutobahn(json, bbox) {
  const out = [];
  for (const [key, kind] of [['warning', 'Stau'], ['closure', 'Sperrung'], ['roadworks', 'Baustelle']]) {
    for (const x of json?.[key] || []) {
      const lon = Number(x.coordinate?.long), lat = Number(x.coordinate?.lat);
      if (!isFinite(lon) || !isFinite(lat) || (bbox && (lon < bbox[0] || lat < bbox[1] || lon > bbox[2] || lat > bbox[3]))) continue;
      out.push({ lonlat: [+lon.toFixed(5), +lat.toFixed(5)], kind, text: [x.title, (x.subtitle || '').trim()].filter(Boolean).join(' · '), delay: (Number(x.delayTimeValue) || 0) * 60, closed: x.isBlocked === 'true' || key === 'closure' });
    }
  }
  return out;
}

/** "lon,lat" → [lon,lat] oder null (nur plausible Koordinaten in Mitteleuropa) */
export function parseLL(s) {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(s || '');
  if (!m) return null;
  const lon = +m[1], lat = +m[2];
  return lon > 5 && lon < 16 && lat > 46 && lat < 56 ? [lon, lat] : null;
}

/** Eigene Blitzer-Meldungen: abgelaufene entfernen, neue anfügen (dicht benachbarte ersetzen), Anzahl begrenzen */
export function addReport(list, r, now = Date.now(), ttlMs = 3 * 3600e3, max = 200) {
  const near = (a, b) => Math.hypot((a[0] - b[0]) * 74000, (a[1] - b[1]) * 111320) < 150;
  const keep = (list || []).filter(x => now - x.t < ttlMs && !(r && near(x.lonlat, r.lonlat)));
  if (r) keep.push({ lonlat: [+r.lonlat[0].toFixed(5), +r.lonlat[1].toFixed(5)], t: now, id: now.toString(36) + Math.floor(r.lonlat[0] * 1e4 % 1e3).toString(36) });
  return keep.slice(-max);
}
