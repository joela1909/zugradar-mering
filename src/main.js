import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import * as api from './api.js';
import { prepare, positionAt } from './train.js';
import { expectedDelay, record, histKey } from './predict.js';
import { dist, splitRoute, bearing as bearingTo } from './geo.js';
import { createTrainLayer } from './train3d.js';
import { createGpsFilter } from './gps.js';
import { ICON } from './icons.js';
import { corridorSegment } from './tracks.js';
import { dirOf, matchesDir, startName, timeProgress, distProgress, minutesUntil, buffer, stopFractions, livery } from './progress.js';

const HOME_ADDRESS = 'Koloniestraße 26, 86399 Bobingen';
const HOME_FALLBACK = [10.8330, 48.2730]; // Bobingen (Mitte), falls die Adressuche nicht klappt

const $ = id => document.getElementById(id);
const fmt = d => (d ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–');
const sgn = m => (m >= 0.5 ? `+${Math.round(m)}` : m <= -0.5 ? `${Math.round(m)}` : '±0');
const cls = m => (m >= 5 ? 'late' : m >= 1 ? 'minor' : 'ontime');
const addMin = (d, m) => new Date(+d + m * 60000);
const same = (a, b) => a && b && Math.abs(a - b) < 30000;
const store = { get: (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const MODES = { car: [ICON.car, 'Auto'], bike: [ICON.bike, 'Rad'], foot: [ICON.foot, 'zu Fuß'] };

let liveError = '';
const S = { station: api.FALLBACK_STATION, deps: [], sel: null, tr: null, live: false, demo: null, home: store.get('zr.home2', HOME_FALLBACK), mode: store.get('zr.mode2', 'car'), walk: null, trainMarker: null, sheet: 'half', sheetVis: 220, loading: true, updated: null, limit: null, strict: store.get('zr.strict', true), fitFull: false, nav: false, follow: true, walkRemain: null, wake: null, meShown: null, meAnim: null, camTarget: null, railLines: new Map(), stopLabels: [], d3: store.get('zr.3d', true), markers: [], dir: store.get('zr.dir', 'muenchen'), me: null, meMarker: null, track: store.get('zr.track', false), trackTotal: 0, watch: null, lastRoute: { ll: null, t: 0 } };
const vis = () => S.deps.filter(d => (S.strict ? matchesDir(d, S.dir) : dirOf(d) === S.dir));
const RULE = { augsburg: 'ab München Hbf/Pasing', muenchen: 'über München-Pasing/Hbf' };
const DIRS = { muenchen: 'München', augsburg: 'Augsburg' };

const map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', center: S.station.lonlat, zoom: 12, pitch: store.get('zr.3d', true) ? 55 : 0, maxPitch: 75, attributionControl: { compact: true } });
const BLANK = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8edf1' } }] };
const mapReady = new Promise(r => {
  let done = false; const go = () => { if (!done) { done = true; r(); } };
  map.on('load', go);
  map.on('error', e => { if (!done && !map.isStyleLoaded()) { console.warn('Kartenstil nicht ladbar', e.error); map.setStyle(BLANK); map.once('styledata', go); } });
});


// ---- Kartenfarben im Apple-Karten-Stil (hell/dunkel) ----
const PALETTE = {
  light: { land: '#f3f1ed', urban: '#ece8e1', water: '#b3d3ea', park: '#d4e8c3', building: '#e4dfd6', road: '#ffffff', casing: '#dbd6cd', motor: '#fbe3a6', motorCasing: '#e2b95f', rail: '#cfc9bf', boundary: '#cfc9bf', text: '#3a3a3c', halo: 'rgba(255,255,255,.85)', b3d: ['#ebe7df', '#e0dbd2', '#d3cec5'], railCase: '#ffffff' },
  dark: { land: '#242426', urban: '#2a2a2c', water: '#1f3b54', park: '#223a2b', building: '#323235', road: '#434347', casing: '#1b1b1d', motor: '#6e5b32', motorCasing: '#3c3220', rail: '#4b4b4f', boundary: '#4b4b4f', text: '#d6d6db', halo: 'rgba(28,28,30,.85)', b3d: ['#3a3a3e', '#323236', '#2a2a2e'], railCase: '#1c1c1e' },
};
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const P = PALETTE[darkQuery.matches ? 'dark' : 'light'], set = (id, prop, v) => { try { map.setPaintProperty(id, prop, v); } catch {} };
  let layers = []; try { layers = map.getStyle().layers; } catch { return; }
  for (const l of layers) {
    const id = l.id, t = l.type;
    if (['rail', 'walk', 'buildings-3d'].includes(l.source) || l.type === 'custom' || id.startsWith('rail') || id.startsWith('walk') || id === 'buildings-3d') continue;
    if (t === 'background') set(id, 'background-color', P.land);
    else if (t === 'fill') {
      if (/water/.test(id)) set(id, 'fill-color', P.water);
      else if (/park|wood|forest|grass|green|garden|farm|meadow|nature|cemetery|golf|pitch|scrub/.test(id)) set(id, 'fill-color', P.park);
      else if (/building/.test(id)) { set(id, 'fill-color', P.building); set(id, 'fill-outline-color', P.casing); }
      else if (/landuse|residential|suburb|commercial|industrial|neighbo|urban|aeroway|airport|pedestrian/.test(id)) set(id, 'fill-color', P.urban);
    } else if (t === 'line') {
      if (/waterway|river|stream|canal/.test(id)) set(id, 'line-color', P.water);
      else if (/motorway|trunk/.test(id)) set(id, 'line-color', /casing/.test(id) ? P.motorCasing : P.motor);
      else if (/casing/.test(id)) set(id, 'line-color', P.casing);
      else if (/highway|road|street|primary|secondary|tertiary|minor|service|path|track|bridge|tunnel/.test(id)) set(id, 'line-color', P.road);
      else if (/rail|transit/.test(id)) set(id, 'line-color', P.rail);
      else if (/boundary|admin/.test(id)) set(id, 'line-color', P.boundary);
    } else if (t === 'symbol') { set(id, 'text-color', P.text); set(id, 'text-halo-color', P.halo); set(id, 'text-halo-width', 1.3); }
  }
  set('walk-case', 'line-color', P.railCase); set('rail-case', 'line-color', P.railCase);
  set('buildings-3d', 'fill-extrusion-color', ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, P.b3d[0], 30, P.b3d[1], 80, P.b3d[2]]);
}
darkQuery.addEventListener?.('change', applyTheme);

const train3d = createTrainLayer(maplibregl);
const emptyFC = { type: 'FeatureCollection', features: [] };
const lineFeat = (c, p = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: p });
// 3D-Gebäude (OpenMapTiles-Schema) + weiches Licht, wie in Apple Karten
function add3D() {
  try {
    const src = Object.entries(map.getStyle().sources).find(([, v]) => v.type === 'vector')?.[0];
    if (!src || map.getLayer('buildings-3d')) return;
    map.addLayer({
      id: 'buildings-3d', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: 13.5,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#e9e9ee', 30, '#dcdce3', 80, '#cfcfd8'],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15, ['coalesce', ['get', 'render_height'], 6]],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15, ['coalesce', ['get', 'render_min_height'], 0]],
        'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true,
      },
    });
    map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.32, position: [1.25, 210, 55] });
  } catch (e) { console.warn('3D-Gebäude nicht verfügbar', e); }
}
// Kachel-Adresse der Grundkarte an die Gleissuche weitergeben
function shareTileTemplate() {
  try {
    const id = Object.entries(map.getStyle().sources).find(([, v]) => v.type === 'vector')?.[0];
    const t = id && map.getSource(id)?.tiles?.[0];
    if (t) { api.setTileTemplate(t); map.off('sourcedata', shareTileTemplate); }
  } catch {}
}
map.on('sourcedata', shareTileTemplate);
async function ensureLayers() {
  await mapReady;
  if (map.getSource('rail')) return;
  add3D();
  map.addSource('rail', { type: 'geojson', data: emptyFC });
  map.addSource('walk', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'walk-case', type: 'line', source: 'walk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } });
  map.addLayer({ id: 'walk', type: 'line', source: 'walk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['coalesce', ['get', 'color'], '#0066cc'], 'line-width': 5 } });
  map.addLayer({ id: 'rail-glow', type: 'line', source: 'rail', paint: { 'line-color': ['get', 'color'], 'line-width': 12, 'line-opacity': .2, 'line-blur': 6 } });
  map.addLayer({ id: 'rail-case', type: 'line', source: 'rail', paint: { 'line-color': '#fff', 'line-width': 6 } });
  map.addLayer({ id: 'rail', type: 'line', source: 'rail', paint: { 'line-color': ['get', 'color'], 'line-width': 3.4 } });
  map.addLayer({ id: 'rail-ties', type: 'line', source: 'rail', paint: { 'line-color': '#fff', 'line-width': 1.4, 'line-dasharray': [1, 3] } });
  map.addLayer(train3d.layer);
  applyTheme();
}
const shortName = n => n.replace(/\s*\(b [^)]*\)/, '').replace(/^Augsburg[ -](?!Hbf)/, '').replace(/^München[ -](?!Hbf)/, '');
const el = (cn, html) => { const e = document.createElement('div'); e.className = cn; e.innerHTML = html; return e; };
const mk = (element, ll) => new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(ll).addTo(map);

// ---- Label-Layout: keine Überlappungen ----
let labels = [], dots = [];
const reg = (marker, ll, prio, o = {}) => { labels.push({ marker, ll, prio, ...o }); return marker; };
const rect = (cx, cy, w, h) => ({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 });
const hit = (a, b) => !(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2);
// Rasterindex: Kollisionen nur gegen Hindernisse in benachbarten Zellen prüfen (statt gegen alle)
class Grid {
  constructor(c = 48) { this.c = c; this.m = new Map(); }
  cells(r, f) { const c = this.c; for (let x = Math.floor(r.x1 / c); x <= Math.floor(r.x2 / c); x++) for (let y = Math.floor(r.y1 / c); y <= Math.floor(r.y2 / c); y++) f(x + ',' + y); }
  add(r) { this.cells(r, k => { const a = this.m.get(k); a ? a.push(r) : this.m.set(k, [r]); }); return this; }
  hits(r) { let h = false; this.cells(r, k => { if (!h) h = (this.m.get(k) || []).some(o => hit(o, r)); }); return h; }
}
// Linien als kleine Rechtecke in Bildschirmkoordinaten (Hindernisse für Labels)
function lineRects(coords) {
  const out = [], W = innerWidth, H = innerHeight, inside = p => p.x > -60 && p.x < W + 60 && p.y > -60 && p.y < H + 60;
  let prev = null;
  for (const c of coords || []) {
    const p = map.project(c);
    if (prev) {
      const d = Math.hypot(p.x - prev.x, p.y - prev.y), n = Math.min(400, Math.max(1, Math.ceil(d / 12)));
      if (inside(p) || inside(prev)) for (let k = 1; k <= n; k++) { const q = { x: prev.x + (p.x - prev.x) * k / n, y: prev.y + (p.y - prev.y) * k / n }; if (inside(q)) out.push(rect(q.x, q.y, 10, 10)); }
    }
    prev = p;
  }
  return out;
}
// Linie für das Layout ausdünnen: etwa ein Punkt pro 8 Bildschirmpixel, je Zoomstufe zwischengespeichert
const decCache = new WeakMap();
function decimate(line) {
  if (!line || line.length < 3) return line;
  const zb = Math.round(map.getZoom() * 2), c = decCache.get(line);
  if (c && c.zb === zb) return c.out;
  const minM = 8 * 40075016.686 * Math.cos(line[0][1] * Math.PI / 180) / (512 * 2 ** map.getZoom());
  const out = [line[0]]; let last = line[0];
  for (const q of line) if (dist(last, q) >= minM) { out.push(q); last = q; }
  out.push(line[line.length - 1]);
  decCache.set(line, { zb, out });
  return out;
}
function layout() {
  const points = [...dots, S.station.lonlat, ...(S.me ? [S.me] : [])].map(ll => { const p = map.project(ll); return rect(p.x, p.y, 14, 14); });
  if (S.trainPos) { const p = map.project(S.trainPos); points.push(rect(p.x, p.y, 60, 60)); }
  const rail = lineRects(decimate(S.tr?.polyline)), walk = lineRects(decimate(S.walk?.coords));
  const placed = new Grid(), railG = new Grid(), walkG = new Grid();
  points.forEach(r => placed.add(r)); rail.forEach(r => railG.add(r)); walk.forEach(r => walkG.add(r));
  // Bedienelemente sind Hindernisse, und Schilder müssen ganz auf dem Bildschirm liegen
  [$('dirctl'), $('status'), $('sheet'), $('toast'), document.querySelector('.fabs')]
    .filter(e => e && !e.hidden && e.getClientRects().length)
    .forEach(e => { const b = e.getBoundingClientRect(); placed.add({ x1: b.left - 4, y1: b.top - 4, x2: b.right + 4, y2: b.bottom + 4 }); });
  const onScreen = r => r.x1 >= 6 && r.y1 >= 6 && r.x2 <= innerWidth - 6 && r.y2 <= innerHeight - 6;
  const items = labels.filter(l => l.marker.getElement().isConnected).sort((a, b) => a.prio - b.prio);
  for (const it of items) {
    const el = it.marker.getElement(); el.style.display = '';
    const { x, y } = map.project(it.ll), w = el.offsetWidth + 6, h = el.offsetHeight + 6, gx = w / 2 + 3, gy = h / 2 + 3;
    const dirs = [[0, -1], [0, 1], [1, 0], [-1, 0], [.8, -.8], [-.8, -.8], [.8, .8], [-.8, .8]];
    const cands = it.fixed ? [[0, 0]] : [1, 1.3, 1.7].flatMap(k => dirs.map(([a, b]) => [a * gx * k, b * gy * k]));
    const at = o => rect(x + o[0], y + o[1], w, h);
    let pick = cands.find(o => { const r = at(o); return onScreen(r) && !placed.hits(r) && !railG.hits(r) && (it.onWalk || !walkG.hits(r)); });
    if (!pick && it.essential) pick = cands.find(o => { const r = at(o); return onScreen(r) && !placed.hits(r); }) || cands.find(o => onScreen(at(o)));
    if (!pick) { if (!it.essential) { el.style.display = 'none'; continue; } pick = cands[0]; }
    it.marker.setOffset(pick); placed.add(at(pick));
  }
}
// höchstens alle 500 ms neu anordnen (Kamerafahrten lösen sonst bei jedem Schritt ein Layout aus)
let layoutTimer = null, layoutLast = 0;
function scheduleLayout() {
  const wait = 500 - (Date.now() - layoutLast);
  if (wait <= 0) { layoutLast = Date.now(); layout(); }
  else if (!layoutTimer) layoutTimer = setTimeout(() => { layoutTimer = null; layoutLast = Date.now(); layout(); }, wait);
}
map.on('moveend', scheduleLayout);
let stationMarker, homeMarker, walkMarker, stationDot;

function placeBase() {
  const st0 = S.tr?.stops?.find((_, i) => i === S.tr.stopIdx);
  const pinHtml = `${ICON.station} ${stName()}${st0 ? `<small>${planTimes(prediction())}</small>` : ''}`;
  const sameSpot = (m, ll) => m && m.getLngLat().lng === ll[0] && m.getLngLat().lat === ll[1];
  if (sameSpot(stationMarker, S.station.lonlat) && sameSpot(homeMarker, S.home)) { stationMarker.getElement().innerHTML = pinHtml; scheduleLayout(); return; }
  labels = labels.filter(l => l.marker !== stationMarker && l.marker !== homeMarker);
  stationMarker?.remove(); homeMarker?.remove(); stationDot?.remove();
  const st = S.tr?.stops?.find((_, i) => i === S.tr.stopIdx);
  stationMarker = reg(mk(el('pin', pinHtml), S.station.lonlat), S.station.lonlat, 1, { essential: true });
  homeMarker = reg(mk(el('me', `${ICON.home} Koloniestraße 26`), S.home), S.home, 1, { essential: true });
  stationDot = mk(el('dot station', ''), S.station.lonlat);
  stationMarker.getElement().style.zIndex = 4; homeMarker.getElement().style.zIndex = 3;
  layout();
}
function planTimes(p) { return p ? (same(p.plannedDep, p.depT) ? `<b>${fmt(p.depT)}</b>` : `${fmt(p.plannedDep)} → <b style="color:#fca5a5">${fmt(p.depT)}</b>`) : ''; }

async function loadHome() {
  if (store.get('zr.homeok', false)) return;
  try { S.home = await api.geocode(HOME_ADDRESS); store.set('zr.home2', S.home); store.set('zr.homeok', true); } catch (e) { console.warn('Adresssuche fehlgeschlagen', e); }
}

function drawWalk() {
  const src = map.getSource('walk'); if (!src || !S.walk) return;
  const r = S.nav && S.me ? splitRoute(S.walk.coords, S.me) : null;
  src.setData(r ? { type: 'FeatureCollection', features: [lineFeat(r.done, { color: '#8e8e93' }), lineFeat(r.rest, { color: '#0a84ff' })] } : lineFeat(S.walk.coords));
}
const remainM = () => S.walkRemain ?? S.walk?.meters ?? 0;
const remainS = () => (S.walk ? S.walk.seconds * (S.walk.meters ? remainM() / S.walk.meters : 1) : 0);
async function loadWalk() {
  await ensureLayers();
  const from = S.me || S.home;
  try { S.walk = await api.route(S.mode, from, S.station.lonlat); }
  catch { const m = dist(from, S.station.lonlat) * 1.3; S.walk = { coords: [from, S.station.lonlat], meters: m, seconds: m / ({ foot: 1.33, bike: 4.2, car: 11 }[S.mode]) }; }
  S.walkRemain = null; drawWalk();
  S.lastRoute = { ll: from, t: Date.now() };
  if (S.me && (!S.trackTotal || S.walk.meters > S.trackTotal)) S.trackTotal = S.walk.meters;
  labels = labels.filter(l => l.marker !== walkMarker);
  walkMarker?.remove();
  const mid = S.walk.coords[Math.floor(S.walk.coords.length / 2)];
  walkMarker = mk(el('lbl route', `${MODES[S.mode][0]} ${Math.ceil(S.walk.seconds / 60)} min · ${(S.walk.meters / 1000).toFixed(1)} km`), mid);
  walkMarker._zr = { marker: walkMarker, ll: mid, prio: 2, onWalk: true }; labels.push(walkMarker._zr); layout();
}

function updateStatus() {
  const m = $('mode'), e = $('err');
  m.textContent = S.live ? 'LIVE' : 'DEMO';
  m.className = S.live ? (S.stale ? 'stale' : 'live') : '';
  e.textContent = !S.live ? humanError(liveError) : S.stale ? `${humanError(liveError)} · Stand ${S.updated ? fmt(S.updated) : '–'}` : '';
}
let refreshing = false;
async function refresh() {
  if (refreshing) return; refreshing = true;
  $('refresh').style.opacity = .4;
  try {
    try {
      if (!S.station.id) {
        const c = store.get('zr.station', null); // Bahnhof eine Woche merken: spart beim Start eine Abfrage
        S.station = c && Date.now() - c.t < 7 * 864e5 ? c.s : await api.findStation();
        if (!c || Date.now() - c.t >= 7 * 864e5) store.set('zr.station', { s: S.station, t: Date.now() });
      }
      S.deps = await api.departures(S.station); S.live = true; S.stale = false; liveError = ''; S.updated = new Date();
    } catch (e) {
      console.warn('Live-Daten nicht erreichbar:', e);
      liveError = String(e?.message || e).slice(0, 200);
      if (S.live && S.deps.length) S.stale = true; // kurze Störung: letzte Live-Daten behalten statt auf Demo zu springen
      else { S.live = false; S.demo = api.demo(); S.station = S.demo.station; S.deps = S.demo.deps; }
    }
    S.loading = false; updateStatus();
    if (S.live) api.limit().then(l => { S.limit = l; }).catch(() => {});
    if (!S.sel || !vis().find(d => d.tripId === S.sel)) S.sel = pickDefault()?.tripId;
    await selectTrip(S.sel, false, true);
  } finally { $('refresh').style.opacity = 1; refreshing = false; }
}

function pickDefault() {
  const now = new Date(), walkMin = S.walk ? Math.ceil(S.walk.seconds / 60) + 1 : 0;
  const list = vis(), ok = list.filter(d => !d.cancelled);
  return ok.find(d => addMin(d.actual || d.planned, -walkMin) > now) || ok.find(d => addMin(d.actual || d.planned, 1) > now) || list[0];
}

const stopHtml = s => { const d = s.arrDelay ?? s.depDelay ?? 0; return `${shortName(s.name)}<br><i class="${cls(d)}">${fmt(s.arr || s.dep)}${d >= 1 ? ' +' + Math.round(d) : ''}</i>`; };
const railColorFor = t => { const worst = Math.max(0, ...t.stopovers.map(s => s.arrDelay ?? s.depDelay ?? 0)); return worst >= 5 ? '#ff3b30' : worst >= 1 ? '#ff9f0a' : '#34c759'; };

async function selectTrip(id, fit, soft = false) {
  S.sel = id;
  const dep = S.deps.find(d => d.tripId === id);
  await ensureLayers();
  // Gleicher Zug beim automatischen Aktualisieren: nur Zeiten erneuern, nichts neu aufbauen (kein Springen, kein Flackern)
  if (soft && dep && S.tr?.dep?.tripId === id) {
    try {
      const t = S.live ? await api.trip(id, S.station) : await S.demo.trip(id);
      const sig = x => x.stopovers.map(s => s.name).join('|');
      if (S.sel === id && sig(t) === sig(S.tr.raw)) {
        const line = S.railLines.get(id) || t.polyline;
        const stopIdx = t.stopovers.findIndex(s => (S.station.id && s.id === S.station.id) || /afra/i.test(s.name));
        S.tr = { ...prepare(t.stopovers, line), raw: t, dep, stopIdx };
        S.railColor = railColorFor(t);
        map.getSource('rail').setData(lineFeat(line, { color: S.railColor }));
        S.stopLabels.forEach(({ i, marker }) => { const s = t.stopovers[i]; if (s) marker.getElement().innerHTML = stopHtml(s); });
        if (!S.railLines.has(id)) refineRail(S.tr, id);
        placeBase(); render(); tick();
        return;
      }
    } catch (e) { console.warn(e); return; }
  }
  S.markers.forEach(m => m.remove()); S.markers = []; dots = []; labels = labels.filter(l => !l.stop);
  if (dep && S.tr?.dep?.tripId !== id) { S.tr = null; render(); } // Abfahrt sofort, Verlauf kommt gleich
  if (!dep) { S.tr = null; map.getSource('rail').setData(emptyFC); render(); return; }
  try {
    const t = S.live ? await api.trip(id, S.station) : await S.demo.trip(id);
    const stopIdx = t.stopovers.findIndex(s => (S.station.id && s.id === S.station.id) || /afra/i.test(s.name));
    const line = S.railLines.get(id) || t.polyline;
    S.tr = { ...prepare(t.stopovers, line), raw: t, dep, stopIdx };
    S.railColor = railColorFor(t);
    map.getSource('rail').setData(lineFeat(line, { color: S.railColor }));
    refineRail(S.tr, id); // aus dem Speicher sofort, fehlende Abschnitte werden nachgeholt
    S.stopLabels = [];
    t.stopovers.forEach((s, i) => {
      if (i === stopIdx || dist(s.lonlat, S.station.lonlat) < 900) return;
      const marker = reg(mk(el('lbl', stopHtml(s)), s.lonlat), s.lonlat, 5 + Math.abs(i - stopIdx), { stop: true });
      S.markers.push(marker); S.stopLabels.push({ i, marker });
      S.markers.push(mk(el('dot', ''), s.lonlat)); dots.push(s.lonlat);
    });
  } catch (e) { console.warn(e); S.tr = null; map.getSource('rail').setData(emptyFC); }
  placeBase(); render(); tick();
  if (fit) fitAll();
}

// Gerade Linien durch echte Gleise ersetzen: hinterlegte Abschnitte sofort, übrige aus OSM (lokal gemerkt)
function buildLine(st, segs) {
  const line = [];
  segs.forEach((c, i) => { const seg = c ? [st[i].lonlat, ...c, st[i + 1].lonlat] : [st[i].lonlat, st[i + 1].lonlat]; line.push(...(line.length ? seg.slice(1) : seg)); });
  return line;
}
async function refineRail(tr, tripId) {
  const st = tr.raw.stopovers;
  const segs = st.slice(0, -1).map((s, i) => corridorSegment(s.id, st[i + 1].id));
  let pending = null;
  const apply = () => {
    if (S.sel !== tripId || !S.tr) return false; // auch nach automatischer Aktualisierung (neues S.tr, gleiche Halte) weiterzeichnen
    const line = buildLine(st, segs);
    S.railLines.set(tripId, line); if (S.railLines.size > 30) S.railLines.delete(S.railLines.keys().next().value);
    S.tr = { ...S.tr, ...prepare(S.tr.raw.stopovers, line) };
    map.getSource('rail').setData(lineFeat(line, { color: S.railColor }));
    tick(); scheduleLayout(); return true;
  };
  if (segs.some(Boolean) && !apply()) return;
  if (!S.live) return;
  // übrige Abschnitte aus OSM, nahe Halte zuerst; jeder fertige Abschnitt wird sofort gezeichnet
  const order = segs.map((_, i) => i).filter(i => !segs[i]).sort((x, y) => Math.abs(x - tr.stopIdx) - Math.abs(y - tr.stopIdx));
  await Promise.all(order.map(i => api.rail(st[i].id, st[i + 1].id, st[i].lonlat, st[i + 1].lonlat).then(c => {
    if (!c) return;
    segs[i] = c;
    clearTimeout(pending); pending = setTimeout(apply, 150);
  })));
}

function fitAll() {
  if (S.nav && S.follow) return;
  const b = new maplibregl.LngLatBounds(S.station.lonlat, S.station.lonlat);
  b.extend(S.home); if (S.me) b.extend(S.me);
  S.walk?.coords.forEach(c => b.extend(c));
  if (S.tr) { b.extend(positionAt(S.tr, new Date()).pos); if (S.fitFull) S.tr.polyline.forEach(c => b.extend(c)); }
  map.fitBounds(b, { padding: { top: 120, bottom: S.sheetVis + 30, left: 70, right: 76 }, maxZoom: 15.5, duration: 800, pitch: S.d3 ? 55 : 0, bearing: 0 });
}

function prediction() {
  const tr = S.tr; if (!tr || tr.stopIdx < 0) return null;
  const st = tr.raw.stopovers[tr.stopIdx], dep = tr.dep;
  const plannedDep = st.plannedDep || dep.planned, plannedArr = st.plannedArr || plannedDep;
  const now = new Date();
  const passed = tr.raw.stopovers.filter((s, i) => i < tr.stopIdx && (s.dep || s.arr) < now).length;
  const stopsAway = Math.max(0, tr.stopIdx - passed);
  const liveDelay = st.depDelay ?? st.arrDelay ?? dep.delay;
  const key = histKey(dep.line, plannedDep);
  let hist = []; try { hist = JSON.parse(localStorage.getItem('zugradar.history.v1'))?.[key] || []; } catch {}
  const e = expectedDelay({ live: liveDelay, stopsAway, hist });
  return { plannedArr, plannedDep, liveDelay, stopsAway, e, key, arr: addMin(plannedArr, e.min), depT: addMin(plannedDep, e.min), platform: dep.platform };
}

const stName = () => (S.station?.name || 'Mering-St Afra').replace(' (Demo)', '');
// Verständliche Meldung statt technischer Fehlertexte
function humanError(e) {
  const t = String(e || '');
  if (/DB_CLIENT_ID|DB_API_KEY/.test(t)) return 'Bahn-Zugang nicht eingerichtet';
  if (/Kontingent|429|503/.test(t)) return 'Bahn-Limit erreicht, Daten etwas älter';
  if (/Failed to fetch|Load failed|NetworkError|network/i.test(t)) return 'Keine Internetverbindung';
  return 'Bahn gerade nicht erreichbar';
}

function render() {
  const list = vis(), i = list.findIndex(d => d.tripId === S.sel), dep = list[i];
  const peek = $('sPeek'), half = $('sHalf'), full = $('sFull');
  if (S.loading && !S.deps.length) {
    peek.innerHTML = `<div class="row top"><span class="badge skel">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="dir skel-t">Lade Abfahrten …</span></div>
      <div class="times"><span class="big skel-t">––:––</span></div><div class="sub">Verbindung zur Bahn wird aufgebaut</div>`;
    half.innerHTML = ''; full.innerHTML = ''; setSheet(S.sheet, true); return;
  }
  if (!dep) {
    const loose = S.strict ? S.deps.filter(d => dirOf(d) === S.dir && !d.cancelled).length : 0;
    peek.innerHTML = `<div class="row top"><span class="dir">Keine Abfahrten Richtung ${DIRS[S.dir]}</span></div>
      <div class="sub" style="margin-top:6px">${S.strict ? `Gefiltert: nur Züge ${RULE[S.dir]}. ` : ''}${S.deps.length ? `${S.deps.length} Abfahrten in den nächsten 4 Stunden insgesamt.` : 'Die Bahn liefert gerade keine Abfahrten.'}</div>`;
    half.innerHTML = loose ? `<button class="navbtn" id="loose">${loose} weitere Züge Richtung ${DIRS[S.dir]} zeigen</button>` : '';
    full.innerHTML = renderDetails(null, null);
    const lb = $('loose'); if (lb) lb.onclick = () => { S.strict = false; store.set('zr.strict', false); S.sel = pickDefault()?.tripId; selectTrip(S.sel, true); };
    bindDetails(); setSheet(S.sheet, true); return;
  }
  const p = prediction(), walkMin = S.walk ? Math.ceil(remainS() / 60) : null;
  const dMin = dep.cancelled ? 0 : (p ? p.e.min : dep.delay ?? 0);
  const leave = p && walkMin != null ? addMin(p.depT, -walkMin - 1) : null;
  const depShown = p?.depT || dep.actual || dep.planned, depPlan = p?.plannedDep || dep.planned;
  if (S.nav) {
    const eta = S.walk ? new Date(Date.now() + remainS() * 1000) : null;
    peek.innerHTML = `<div class="row top"><span class="navico">${MODES[S.mode][0]}</span><span class="dir">Zum Bahnhof</span>${S.follow ? '' : '<button class="pillbtn" id="recenter">Zentrieren</button>'}</div>
      <div class="times"><span class="big">${fmt(eta)}</span><span class="chip">${Math.ceil(remainS() / 60)} min</span><span class="sub" style="margin-left:auto">${(remainM() / 1000).toFixed(1)} km</span></div>
      <div class="sub">${p ? `Zug ${dep.line} ab <b>${fmt(p.depT)}</b> · Gl. ${dep.platform}` : ''}</div>`;
    half.innerHTML = `<div id="prog"></div><button class="navbtn end" id="navend">Beenden</button>`;
  } else {
    peek.innerHTML = `<div class="row top"><span class="badge" data-livery="${livery(dep)}">${dep.line}</span><span class="dir">${dep.direction}</span><span class="plat">Gl. ${dep.platform}</span></div>
      <div class="times"><span class="big ${dep.cancelled ? 'late' : cls(dMin)}">${dep.cancelled ? 'fällt aus' : fmt(depShown)}</span>${dep.cancelled ? '' : `${same(depPlan, depShown) ? '' : `<s>${fmt(depPlan)}</s>`}<span class="chip ${cls(dMin)}">${Math.abs(dMin) < 0.5 ? 'pünktlich' : sgn(dMin) + ' min'}</span>`}</div>
      <div class="sub">${leave ? `Spätestens los <b>${fmt(leave)}</b> · ${MODES[S.mode][0]} ${walkMin} min` : 'Weg wird berechnet …'}</div>`;
    half.innerHTML = `<div id="prog"></div>${S.walk ? `<button class="navbtn" id="navstart">${MODES[S.mode][0]} Route starten</button>` : ''}`;
  }
  full.innerHTML = S.nav ? renderDetails(dep, p) : renderList(list) + renderDetails(dep, p);
  const on = (id, f) => { const b = $(id); if (b) b.onclick = e => { e.stopPropagation(); f(); }; };
  on('navstart', startNav); on('navend', stopNav); on('recenter', () => { S.follow = true; render(); updateNav(); });
  full.querySelectorAll('.brow').forEach(b => b.onclick = () => { setSheet('half'); selectTrip(b.dataset.id, true); });
  bindDetails();
  fillProg();
  setSheet(S.sheet, true);
}

function renderList(list) {
  const rows = list.slice(0, 12).map(d => {
    const m = d.delay ?? 0, t = d.actual || d.planned;
    return `<button class="brow ${d.tripId === S.sel ? 'sel' : ''}" data-id="${d.tripId}">
      <span class="bt"><b class="${d.cancelled ? 'late' : cls(m)}">${d.cancelled ? '—' : fmt(t)}</b>${m >= 1 && !d.cancelled ? `<s>${fmt(d.planned)}</s>` : ''}</span>
      <span class="badge sm" data-livery="${livery(d)}">${d.line}</span><span class="bd">${d.cancelled ? 'fällt aus · ' : ''}${d.direction}</span><span class="bg">Gl. ${d.platform}</span>
      ${m >= 1 && !d.cancelled ? `<span class="chip ${cls(m)}">+${Math.round(m)}</span>` : '<span class="chip ontime">•</span>'}</button>`;
  }).join('');
  return `<div class="bh"><b>Nächste Verbindungen</b><span class="sub">Richtung ${DIRS[S.dir]}</span></div><div class="blist">${rows || '<div class="sub" style="padding:8px 4px">Keine weiteren Verbindungen.</div>'}</div>`;
}

function renderDetails(dep, p) {
  const kv = (k, v) => `<div><span>${k}</span><span>${v}</span></div>`;
  const rows = [
    p && kv('Ankunft in ' + stName(), same(p.plannedArr, p.arr) ? `<b>${fmt(p.arr)}</b>` : `${fmt(p.plannedArr)} → <b>${fmt(p.arr)}</b>`),
    p && kv('Prognose', p.e.basis),
    dep?.trainNo && kv('Zug', `${dep.category || ''} ${dep.trainNo}`),
    dep?.plannedPlatform && dep.platform !== dep.plannedPlatform && kv('Gleiswechsel', `<span class="late">Gl. ${dep.platform} statt ${dep.plannedPlatform}</span>`),
    dep && (dep.previousStops?.length || dep.nextStops?.length) && kv('Verlauf', [...(dep.previousStops || []).slice(-2), `<b>${stName()}</b>`, ...(dep.nextStops || []).slice(0, 3)].join(' › ')),
    !S.nav && kv('Weg zum Bahnhof', `<button id="modebtn" class="pillbtn">${MODES[S.mode][0]} ${MODES[S.mode][1]}</button>`),
    !S.nav && kv('Richtungsfilter', `<span class="kvcol"><button id="strictbtn" class="pillbtn">${S.strict ? 'An' : 'Aus'}</button><small>${S.strict ? 'nur Züge ' + RULE[S.dir] : 'alle Züge'}</small></span>`),
    kv('Daten', S.live ? `DB live${S.updated ? ` · ${S.updated.toLocaleTimeString('de-DE')}` : ''}` : 'Demo'),
    S.limit && S.limit.used != null && kv('Bahn-Abfragen', `${S.limit.used} von ${S.limit.limit} pro Minute`),
    liveError && kv('Technik', `<small class="tech">${liveError.replace(/</g, '&lt;')}</small>`),
  ].filter(Boolean).join('');
  return `<div class="bd2">${rows}</div>`;
}
function bindDetails() {
  const sb = $('strictbtn'); if (sb) sb.onclick = e => { e.stopPropagation(); S.strict = !S.strict; store.set('zr.strict', S.strict); S.sel = vis().some(d => d.tripId === S.sel) ? S.sel : pickDefault()?.tripId; selectTrip(S.sel, false); };
  const m = $('modebtn'); if (m) m.onclick = e => { e.stopPropagation(); const k = Object.keys(MODES); S.mode = k[(k.indexOf(S.mode) + 1) % k.length]; store.set('zr.mode2', S.mode); loadWalk().then(render); };
}

// ---- Blatt mit drei Höhen (wie Apple Karten): klein · mittel · groß; ziehen oder tippen ----
const SHEET_TOP = 64;
function sheetHeights() {
  const sh = $('sheet'), H = sh.offsetHeight, grab = $('grab').offsetHeight, pad = 14;
  const peek = Math.min(H, grab + $('sPeek').offsetHeight + pad), half = Math.min(H, peek + $('sHalf').offsetHeight);
  return { H, peek, half: Math.max(half, peek), full: H };
}
function setSheet(state, instant = false) {
  if (S.nav && state === 'full') state = 'half';
  S.sheet = state;
  const sh = $('sheet'), h = sheetHeights(), vis = h[state];
  sh.classList.toggle('isfull', state === 'full'); document.body.classList.toggle('sheetfull', state === 'full');
  sh.style.transition = instant ? 'none' : '';
  sh.style.transform = `translateY(${h.H - vis}px)`;
  if (instant) { sh.offsetHeight; sh.style.transition = ''; }
  S.sheetVis = vis;
  document.documentElement.style.setProperty('--sheetvis', vis + 'px');
  $('grab').firstElementChild.className = state;
  setTimeout(scheduleLayout, instant ? 0 : 460);
}
(function sheetGestures() {
  const sh = $('sheet');
  let start = null;
  const down = e => {
    const inFull = e.target.closest('#sFull');
    if (inFull && (S.sheet !== 'full' || $('sFull').scrollTop > 0)) return; // im großen Blatt zuerst scrollen
    if (e.target.closest('button') && !e.target.closest('#grab')) return;
    const m = /translateY\(([-\d.]+)px\)/.exec(sh.style.transform);
    start = { y: e.clientY, t: performance.now(), base: m ? +m[1] : 0, moved: false };
  };
  const move = e => {
    if (!start) return;
    const dy = e.clientY - start.y;
    if (!start.moved && Math.abs(dy) < 6) return;
    start.moved = true; sh.style.transition = 'none';
    const h = sheetHeights();
    sh.style.transform = `translateY(${Math.min(h.H - 90, Math.max(0, start.base + dy))}px)`;
  };
  const up = e => {
    if (!start) return;
    const s0 = start; start = null; sh.style.transition = '';
    const order = S.nav ? ['peek', 'half'] : ['peek', 'half', 'full'];
    if (!s0.moved) { // Tippen: eine Stufe größer, ganz oben wieder kleiner
      if (!e.target.closest('#grab') && !e.target.closest('#sPeek')) return;
      const i = order.indexOf(S.sheet); setSheet(order[i === order.length - 1 ? i - 1 : i + 1]); return;
    }
    const h = sheetHeights(), y = /translateY\(([-\d.]+)px\)/.exec(sh.style.transform), vis = h.H - (y ? +y[1] : 0);
    const v = (e.clientY - s0.y) / Math.max(1, performance.now() - s0.t); // px/ms, positiv = nach unten
    let target = order.reduce((a, b) => (Math.abs(h[b] - vis) < Math.abs(h[a] - vis) ? b : a));
    if (Math.abs(v) > 0.45) { const i = order.indexOf(S.sheet); target = order[Math.max(0, Math.min(order.length - 1, i + (v < 0 ? 1 : -1)))]; }
    setSheet(target);
  };
  sh.addEventListener('pointerdown', down);
  addEventListener('pointermove', move, { passive: true });
  addEventListener('pointerup', up); addEventListener('pointercancel', () => { if (start) { start = null; setSheet(S.sheet); } });
  addEventListener('resize', () => setSheet(S.sheet, true));
})();

function bar(icon, left, right, frac, tone, ticks = []) {
  const px = Math.max(240, ($('sheet').clientWidth || 360) - 32), pos = f => `calc(10px + (100% - 20px) * ${f.toFixed(4)})`;
  const dot = (f, cls) => `<b class="tk ${cls}" style="left:${pos(f)}"></b>`;
  const dots = ticks.length || frac != null ? [dot(0, 'start p'), ...ticks.map(t => dot(t.f, t.f <= frac ? 'p' : '')), dot(1, 'end' + (frac >= 1 ? ' p' : ''))].join('') : '';
  let last = -99;
  const names = ticks.filter(t => { const x = t.f * px; if (t.f < .14 || t.f > .86 || x - last < 56) return false; last = x; return true; })
    .map(t => `<span style="left:${pos(t.f)}">${shortName(t.name).slice(0, 13)}</span>`).join('');
  return `<div class="pbar t-${tone}"><i style="width:${frac > 0 ? pos(frac) : '0px'}"></i><u class="base"></u>${dots}<span class="pl1">${icon} ${left}</span><span class="pr1">${right}</span></div>${names ? `<div class="tklabels">${names}</div>` : ''}`;
}
function trainStops(dep, tStart, tEnd) {
  const raw = S.tr.raw.stopovers, idx = S.tr.stopIdx;
  const prev = dep.previousStops?.length ? dep.previousStops : raw.slice(0, Math.max(0, idx)).map(s => s.name);
  const from = prev.indexOf(startName(dep));
  const names = prev.slice(from >= 0 ? from + 1 : 0);
  const times = new Map(raw.slice(0, Math.max(0, idx)).map(s => [s.name, +(s.dep || s.arr)]));
  return stopFractions(names, times, +tStart, +tEnd);
}
function fillProg() {
  const box = $('prog'); if (!box) return;
  const now = new Date(), p = S.tr && prediction(), parts = [];
  if (p && S.tr) {
    const dep = S.tr.dep, st = S.tr.raw.start, name = st?.name || startName(dep) || 'Start';
    const tStart = st?.dep || S.tr.stops[0]?.dep || S.tr.stops[0]?.arr;
    const f = timeProgress(tStart, p.arr, now);
    const arrTxt = `${ICON.station} <b>${fmt(p.arr)}</b>${now < p.arr ? ` · ${minutesUntil(p.arr, now)} min` : ' · da'}`;
    parts.push(bar(ICON.train, name, arrTxt, f ?? 0, cls(p.e.min), tStart ? trainStops(dep, tStart, p.arr) : []));
  }
  if (S.me && S.walk) {
    const eta = new Date(+now + remainS() * 1000), f = distProgress(S.trackTotal, remainM());
    const buf = p ? buffer(p.depT, eta) : null;
    const bufTxt = buf == null ? '' : buf >= 0 ? ` · <b class="ontime">+${buf}</b>` : ` · <b class="late">${buf}</b>`;
    parts.push(bar(ICON.me, 'Du', `${ICON.station} <b>${fmt(eta)}</b> · ${Math.ceil(remainS() / 60)} min${bufTxt}`, f, buf != null && buf < 0 ? 'late' : 'me'));
  }
  box.innerHTML = parts.join('');
}

// ---- Live-Standort ----
const gpsOk = createGpsFilter();
function onFix(pos) {
  const ll = [pos.coords.longitude, pos.coords.latitude], first = !S.me;
  if (!gpsOk({ ll, t: pos.timestamp || Date.now(), acc: pos.coords.accuracy ?? 999 })) return; // alte/grobe/springende Positionen ignorieren
  S.me = ll;
  if (!S.meMarker) { S.meMarker = mk(el('gps', ''), ll); S.meShown = ll; }
  const moved = S.lastRoute.ll ? dist(S.lastRoute.ll, ll) : Infinity;
  const r = S.nav && S.walk ? splitRoute(S.walk.coords, ll) : null;
  const off = r && r.off > 45;                       // von der Route abgekommen → neu berechnen
  if (r) { S.walkRemain = r.remaining; drawWalk(); }
  // Punkt gleitet zur neuen Position; in der Navigation auf die Route eingerastet (wie Navi-Apps)
  const target = r && r.off < 25 ? r.rest[0] : ll, now = performance.now();
  S.meAnim = { from: S.meShown || target, to: target, t0: now, dur: Math.min(1500, Math.max(400, now - (S.meAnim?.t0 ?? now - 1000))) };
  if (first || off || (!S.nav && (moved > 120 || Date.now() - S.lastRoute.t > 45000))) loadWalk().then(() => { if (S.nav) updateNav(pos); render(); layout(); if (first && !S.nav) fitAll(); });
  else { fillProg(); if (S.nav) updateNav(pos, r); }
  if (S.nav && dist(ll, S.station.lonlat) < 70) { stopNav(); const p = prediction(); toast(p ? `Angekommen. ${S.tr.dep.line} fährt um ${fmt(p.depT)} von Gleis ${S.tr.dep.platform}.` : 'Angekommen.'); }
}

// ---- Navigation: Karte folgt dir, geneigt und nach vorn gedreht, ohne Abbiegehinweise ----
function updateNav(pos, r) {
  if (!S.nav || !S.me || !S.follow) return;
  r ||= S.walk ? splitRoute(S.walk.coords, S.me) : null;
  // Fahrtrichtung: Richtung der Route, sonst Blick Richtung Bahnhof
  const toStation = bearingTo(S.me, S.station.lonlat);
  const brg = r && r.off < 60 ? r.bearing : toStation;
  // Ausschnitt: du + Zug + Bahnhof immer sichtbar, Neigung je nach Zoom (nah = steil geneigt, weit = flacher)
  const b = new maplibregl.LngLatBounds(S.me, S.me); b.extend(S.station.lonlat); if (S.trainPos) b.extend(S.trainPos);
  const pad = { top: 110, bottom: S.sheetVis + 36, left: 56, right: 76 };
  const pitchFor = z => Math.max(20, Math.min(62, 20 + (z - 10) * 6.5));
  let cam = map.cameraForBounds(b, { padding: pad, bearing: brg, pitch: 0, maxZoom: 17.2 });
  if (!cam) { S.camTarget = { center: S.me, zoom: 15, bearing: brg, pitch: 45 }; return; }
  const pitch = pitchFor(cam.zoom);
  cam = map.cameraForBounds(b, { padding: pad, bearing: brg, pitch, maxZoom: 17.2 }) || cam;
  const c = maplibregl.LngLat.convert(cam.center);
  S.camTarget = { center: [c.lng, c.lat], zoom: cam.zoom, bearing: brg, pitch };
}

// Ein Animationsloop: Standortpunkt gleitet linear, Kamera folgt weich (keine sich unterbrechenden easeTo-Fahrten)
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  const A = S.meAnim;
  if (A && S.meMarker) {
    const f = Math.min(1, (now - A.t0) / A.dur);
    S.meShown = [A.from[0] + (A.to[0] - A.from[0]) * f, A.from[1] + (A.to[1] - A.from[1]) * f];
    S.meMarker.setLngLat(S.meShown);
    if (f >= 1) S.meAnim = null;
  }
  const T = S.camTarget;
  if (S.nav && S.follow && T && !map.isMoving()) {
    const k = 1 - Math.exp(-dt / 0.6), c = map.getCenter(), z = map.getZoom(), b = map.getBearing(), p = map.getPitch();
    const db = ((T.bearing - b + 540) % 360) - 180;
    const settled = Math.abs(T.center[0] - c.lng) < 2e-7 && Math.abs(T.center[1] - c.lat) < 2e-7 && Math.abs(T.zoom - z) < .002 && Math.abs(db) < .05 && Math.abs(T.pitch - p) < .05;
    if (!settled) { navJumping = true; map.jumpTo({ center: [c.lng + (T.center[0] - c.lng) * k, c.lat + (T.center[1] - c.lat) * k], zoom: z + (T.zoom - z) * k, bearing: b + db * k, pitch: p + (T.pitch - p) * k }); navJumping = false; }
  }
  requestAnimationFrame(frame);
}
let navJumping = false;
requestAnimationFrame(frame);
async function startNav() {
  S.nav = true; S.follow = true; document.body.classList.add('nav');
  if (S.watch == null) startTracking();
  try { S.wake = await navigator.wakeLock?.request('screen'); } catch {}
  S.sheet = 'half'; render();
  if (S.me) { await loadWalk(); updateNav(); } // sonst übernimmt der erste GPS-Fix
}
function stopNav() {
  S.nav = false; document.body.classList.remove('nav');
  try { S.wake?.release(); } catch {} S.wake = null;
  S.camTarget = null;
  drawWalk(); render(); fitAll();
}
// Wer selbst schiebt, zoomt oder dreht, übernimmt die Kamera; „Zentrieren“ gibt sie zurück
const userTook = e => { if (S.nav && S.follow && e.originalEvent && !navJumping) { S.follow = false; render(); } };
['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach(ev => map.on(ev, userTook));
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && S.nav) { try { S.wake = await navigator.wakeLock?.request('screen'); } catch {} } });
function toast(text, ms = 6000) {
  const t = $('toast'); t.textContent = text; t.hidden = false; requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.hidden = true), 300); }, ms);
}
function startTracking() {
  if (!navigator.geolocation) { alert('Standort wird von diesem Browser nicht unterstützt.'); return; }
  if (S.watch != null) return;
  S.track = true; store.set('zr.track', true); $('gps').classList.add('on');
  S.watch = navigator.geolocation.watchPosition(onFix, e => {
    console.warn('GPS', e.code, e.message);
    if (e.code === 1) { stopNav(); stopTracking(); alert('Standort nicht erlaubt. Bitte in den Einstellungen für diese Seite freigeben.'); } // nur bei verweigerter Berechtigung beenden; Zeitlimit/Funkloch ignorieren
  }, { enableHighAccuracy: true, maximumAge: 0 });
}
function stopTracking() {
  if (S.watch != null) navigator.geolocation.clearWatch(S.watch);
  S.watch = null; S.track = false; store.set('zr.track', false); $('gps').classList.remove('on');
  S.meMarker?.remove(); S.meMarker = null; S.me = null; S.meShown = null; S.meAnim = null; S.trackTotal = 0;
  loadWalk().then(() => { render(); layout(); });
}
$('gps').onclick = () => { if (S.nav) { S.follow = true; render(); updateNav(); return; } S.watch != null ? stopTracking() : startTracking(); };

// ---- Richtung ----
function updateDirUI() { document.querySelectorAll('#dirctl button').forEach(b => b.classList.toggle('on', b.dataset.d === S.dir)); }
document.querySelectorAll('#dirctl button').forEach(b => b.onclick = async () => {
  if (S.dir === b.dataset.d) return;
  S.dir = b.dataset.d; store.set('zr.dir', S.dir); updateDirUI();
  S.sel = pickDefault()?.tripId; await selectTrip(S.sel, true);
});
updateDirUI();
map.on('click', () => { if (S.sheet === 'full') setSheet('half'); });

const TRAIN_SVG = `<svg viewBox="0 0 28 84" width="28" height="84" aria-hidden="true"><defs><filter id="ts" x="-40%" y="-20%" width="180%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-opacity=".38"/></filter></defs>
<g filter="url(#ts)"><rect x="4" y="2" width="20" height="80" rx="10" fill="#fff" stroke="#c7c7cc" stroke-width="1"/>
<rect x="4" y="30" width="20" height="1.2" fill="#d1d1d6"/><rect x="4" y="56" width="20" height="1.2" fill="#d1d1d6"/>
<rect x="4" y="2" width="4" height="80" rx="2" fill="#ec0016"/><rect x="20" y="2" width="4" height="80" rx="2" fill="#ec0016"/>
<path d="M9 10c0-3 2.2-5 5-5s5 2 5 5v5H9z" fill="#2c2c2e"/><rect x="10" y="20" width="8" height="5" rx="2" fill="#e5e5ea"/><rect x="10" y="38" width="8" height="5" rx="2" fill="#e5e5ea"/><rect x="10" y="62" width="8" height="5" rx="2" fill="#e5e5ea"/></g></svg>`;

// Das 3D-Modell ist immer sichtbar (größenangepasst), das flache Symbol bleibt verborgen
function syncTrainLook() {
  train3d.state.visible = true;
  if (S.trainMarker) S.trainMarker.getElement().style.visibility = 'hidden';
  map.triggerRepaint();
}
map.on('zoom', syncTrainLook);

function tick() {
  if (document.hidden && !S.nav) return; // Akku schonen, wenn die Seite nicht sichtbar ist
  if (!S.tr) { S.trainMarker?.remove(); S.trainMarker = null; S.trainLabel?.remove(); S.trainLabel = null; S.trainPos = null; return; }
  const now = new Date(), p = positionAt(S.tr, now);
  const live = S.live && S.tr.raw.currentLocation && p.state === 'fährt';
  const pos = live ? S.tr.raw.currentLocation : p.pos;
  S.trainPos = pos;
  const d = S.tr.dep.delay ?? 0, html = `${S.tr.dep.line}${d >= 1 ? ` <b>+${Math.round(d)}</b>` : ''}`;
  if (!S.trainMarker) S.trainMarker = new maplibregl.Marker({ element: el('trainmodel', TRAIN_SVG), anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(pos).addTo(map);
  S.trainMarker.setLngLat(pos).setRotation(p.bearing || 0);
  const lv = livery(S.tr.dep); train3d.setLivery(lv);
  train3d.state.lonlat = pos; train3d.state.bearing = p.bearing || 0; syncTrainLook();
  if (!S.trainLabel) { S.trainLabel = mk(el('lbl train-l', html), pos); labels.push({ marker: S.trainLabel, ll: pos, prio: 0, essential: true, trainLabel: true }); }
  const it = labels.find(l => l.trainLabel); if (it) it.ll = pos;
  S.trainLabel.setLngLat(pos); S.trainLabel.getElement().innerHTML = html; S.trainLabel.getElement().dataset.livery = lv;
  scheduleLayout(); fillProg();
  if (S.nav && S.follow && ++navTicks % 2 === 0) updateNav();
}
let navTicks = 0;

function logObservation() {
  const p = prediction(); if (!p || !S.live) return;
  if (new Date() < addMin(p.plannedDep, (p.liveDelay ?? 0) + 1)) return;
  const k = `zr.logged.${S.sel}`; if (store.get(k, false)) return;
  store.set(k, true); record(p.key, p.liveDelay ?? 0);
}

const setD3 = () => { $('d3').classList.toggle('on', S.d3); $('d3').textContent = S.d3 ? '3D' : '2D'; };
$('d3').onclick = () => { S.d3 = !S.d3; store.set('zr.3d', S.d3); setD3(); syncTrainLook(); map.easeTo({ pitch: S.d3 ? 55 : 0, bearing: S.d3 ? map.getBearing() : 0, duration: 700 }); setTimeout(layout, 750); };
setD3();
$('refresh').onclick = refresh;
$('fit').onclick = () => { S.fitFull = !S.fitFull; $('fit').title = S.fitFull ? 'Näher heran' : 'Ganze Strecke'; fitAll(); };

(async () => {
  render(); // Ladezustand sofort zeigen
  await loadHome();
  await Promise.all([refresh(), loadWalk()]); placeBase();
  if (!S.sel || !S.deps.find(d => d.tripId === S.sel) || true) { const d = pickDefault(); if (d && d.tripId !== S.sel) await selectTrip(d.tripId, false); }
  render(); fitAll();
})();
if (S.track) navigator.permissions?.query({ name: 'geolocation' }).then(r => { if (r.state === 'granted') startTracking(); }).catch(() => {});
if (location.hash === '#debug') Object.assign(window, { __map: map, __S: S, __t3d: train3d, __layout: layout });
setInterval(tick, 1000);
// alle 10 s: der Worker teilt die 60 Bahn-Abfragen pro Minute auf und liefert sonst den letzten Stand
setInterval(() => { if (!document.hidden) refresh().then(logObservation); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
