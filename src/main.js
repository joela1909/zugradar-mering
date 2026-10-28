import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import * as api from './api.js';
import { prepare, positionAt } from './train.js';
import { expectedDelay, record, histKey } from './predict.js';
import { dist } from './geo.js';
import { dirOf, matchesDir, startName, timeProgress, distProgress, minutesUntil, buffer } from './progress.js';

const HOME_ADDRESS = 'Koloniestraße 26, 86399 Bobingen';
const HOME_FALLBACK = [10.8330, 48.2730]; // Bobingen (Mitte), falls die Adressuche nicht klappt

const $ = id => document.getElementById(id);
const fmt = d => (d ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–');
const sgn = m => (m >= 0.5 ? `+${Math.round(m)}` : m <= -0.5 ? `${Math.round(m)}` : '±0');
const cls = m => (m >= 5 ? 'late' : m >= 1 ? 'minor' : 'ontime');
const addMin = (d, m) => new Date(+d + m * 60000);
const same = (a, b) => a && b && Math.abs(a - b) < 30000;
const store = { get: (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const MODES = { car: ['🚗', 'Auto'], bike: ['🚲', 'Rad'], foot: ['🚶', 'zu Fuß'] };

let liveError = '';
const S = { station: api.FALLBACK_STATION, deps: [], sel: null, tr: null, live: false, demo: null, home: store.get('zr.home2', HOME_FALLBACK), mode: store.get('zr.mode2', 'car'), walk: null, trainMarker: null, board: false, markers: [], dir: store.get('zr.dir', 'muenchen'), me: null, meMarker: null, track: store.get('zr.track', false), trackTotal: 0, watch: null, lastRoute: { ll: null, t: 0 } };
const vis = () => S.deps.filter(d => matchesDir(d, S.dir));
const DIRS = { muenchen: 'München', augsburg: 'Augsburg' };

const map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', center: S.station.lonlat, zoom: 12, attributionControl: { compact: true } });
const BLANK = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8edf1' } }] };
const mapReady = new Promise(r => {
  let done = false; const go = () => { if (!done) { done = true; r(); } };
  map.on('load', go);
  map.on('error', e => { if (!done && !map.isStyleLoaded()) { console.warn('Kartenstil nicht ladbar', e.error); map.setStyle(BLANK); map.once('styledata', go); } });
});

const emptyFC = { type: 'FeatureCollection', features: [] };
const lineFeat = (c, p = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: p });
async function ensureLayers() {
  await mapReady;
  if (map.getSource('rail')) return;
  map.addSource('rail', { type: 'geojson', data: emptyFC });
  map.addSource('walk', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'walk-case', type: 'line', source: 'walk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } });
  map.addLayer({ id: 'walk', type: 'line', source: 'walk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0066cc', 'line-width': 5 } });
  map.addLayer({ id: 'rail-glow', type: 'line', source: 'rail', paint: { 'line-color': ['get', 'color'], 'line-width': 12, 'line-opacity': .2, 'line-blur': 6 } });
  map.addLayer({ id: 'rail-case', type: 'line', source: 'rail', paint: { 'line-color': '#fff', 'line-width': 6 } });
  map.addLayer({ id: 'rail', type: 'line', source: 'rail', paint: { 'line-color': ['get', 'color'], 'line-width': 3.4 } });
  map.addLayer({ id: 'rail-ties', type: 'line', source: 'rail', paint: { 'line-color': '#fff', 'line-width': 1.4, 'line-dasharray': [1, 3] } });
}
const el = (cn, html) => { const e = document.createElement('div'); e.className = cn; e.innerHTML = html; return e; };
const mk = (element, ll) => new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(ll).addTo(map);

// ---- Label-Layout: keine Überlappungen ----
let labels = [], dots = [];
const reg = (marker, ll, prio, o = {}) => { labels.push({ marker, ll, prio, ...o }); return marker; };
const rect = (cx, cy, w, h) => ({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 });
const hit = (a, b) => !(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2);
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
function layout() {
  const points = [...dots, S.station.lonlat, ...(S.me ? [S.me] : [])].map(ll => { const p = map.project(ll); return rect(p.x, p.y, 14, 14); });
  if (S.trainPos) { const p = map.project(S.trainPos); points.push(rect(p.x, p.y, 34, 34)); }
  const rail = lineRects(S.tr?.polyline), walk = lineRects(S.walk?.coords);
  const placed = [...points];
  const items = labels.filter(l => l.marker.getElement().isConnected).sort((a, b) => a.prio - b.prio);
  for (const it of items) {
    const el = it.marker.getElement(); el.style.display = '';
    const { x, y } = map.project(it.ll), w = el.offsetWidth + 8, h = el.offsetHeight + 8, gx = w / 2 + 6, gy = h / 2 + 6;
    const dirs = [[0, -1], [0, 1], [1, 0], [-1, 0], [.8, -.8], [-.8, -.8], [.8, .8], [-.8, .8]];
    const cands = it.fixed ? [[0, 0]] : [1, 1.6, 2.4].flatMap(k => dirs.map(([a, b]) => [a * gx * k, b * gy * k]));
    const free = (o, obstacles) => !obstacles.some(r => hit(r, rect(x + o[0], y + o[1], w, h)));
    const lineObs = [...rail, ...(it.onWalk ? [] : walk)];
    let pick = cands.find(o => free(o, placed) && free(o, lineObs));
    if (!pick && it.essential) pick = cands.find(o => free(o, placed));
    if (!pick) { if (!it.essential) { el.style.display = 'none'; continue; } pick = cands[0]; }
    it.marker.setOffset(pick); placed.push(rect(x + pick[0], y + pick[1], w, h));
  }
}
map.on('moveend', layout); map.on('zoomend', layout);
let stationMarker, homeMarker, walkMarker, stationDot;

function placeBase() {
  labels = labels.filter(l => l.marker !== stationMarker && l.marker !== homeMarker);
  stationMarker?.remove(); homeMarker?.remove(); stationDot?.remove();
  const st = S.tr?.stops?.find((_, i) => i === S.tr.stopIdx);
  stationMarker = reg(mk(el('pin', `🚉 ${S.station.name.replace(' (Demo)', '')}${st ? `<small>${planTimes(prediction())}</small>` : ''}`), S.station.lonlat), S.station.lonlat, 1, { essential: true });
  homeMarker = reg(mk(el('me', '🏠 Koloniestraße 26'), S.home), S.home, 1, { essential: true });
  stationDot = mk(el('dot station', ''), S.station.lonlat);
  layout();
}
function planTimes(p) { return p ? (same(p.plannedDep, p.depT) ? `<b>${fmt(p.depT)}</b>` : `${fmt(p.plannedDep)} → <b style="color:#fca5a5">${fmt(p.depT)}</b>`) : ''; }

async function loadHome() {
  if (store.get('zr.homeok', false)) return;
  try { S.home = await api.geocode(HOME_ADDRESS); store.set('zr.home2', S.home); store.set('zr.homeok', true); } catch (e) { console.warn('Adresssuche fehlgeschlagen', e); }
}

async function loadWalk() {
  await ensureLayers();
  const from = S.me || S.home;
  try { S.walk = await api.route(S.mode, from, S.station.lonlat); }
  catch { const m = dist(from, S.station.lonlat) * 1.3; S.walk = { coords: [from, S.station.lonlat], meters: m, seconds: m / ({ foot: 1.33, bike: 4.2, car: 11 }[S.mode]) }; }
  map.getSource('walk').setData(lineFeat(S.walk.coords));
  S.lastRoute = { ll: from, t: Date.now() };
  if (S.me && (!S.trackTotal || S.walk.meters > S.trackTotal)) S.trackTotal = S.walk.meters;
  labels = labels.filter(l => l.marker !== walkMarker);
  walkMarker?.remove();
  const mid = S.walk.coords[Math.floor(S.walk.coords.length / 2)];
  walkMarker = mk(el('lbl route', `${MODES[S.mode][0]} ${Math.ceil(S.walk.seconds / 60)} min · ${(S.walk.meters / 1000).toFixed(1)} km`), mid);
  walkMarker._zr = { marker: walkMarker, ll: mid, prio: 2, essential: true, onWalk: true }; labels.push(walkMarker._zr); layout();
}

async function refresh() {
  $('refresh').style.opacity = .4;
  try {
    try {
      if (!S.live) S.station = await api.findStation();
      S.deps = await api.departures(S.station); S.live = true; liveError = '';
    } catch (e) {
      console.warn('Live-Daten nicht erreichbar, Demo-Modus:', e);
      liveError = String(e?.message || e).slice(0, 200);
      S.live = false; S.demo = api.demo(); S.station = S.demo.station; S.deps = S.demo.deps;
    }
    $('mode').textContent = S.live ? 'LIVE' : 'DEMO'; $('mode').className = S.live ? 'live' : '';
    $('err').textContent = S.live ? '' : liveError;
    if (!S.sel || !vis().find(d => d.tripId === S.sel)) S.sel = pickDefault()?.tripId;
    await selectTrip(S.sel, false);
  } finally { $('refresh').style.opacity = 1; }
}

function pickDefault() {
  const now = new Date(), walkMin = S.walk ? Math.ceil(S.walk.seconds / 60) + 1 : 0;
  const list = vis(), ok = list.filter(d => !d.cancelled);
  return ok.find(d => addMin(d.actual || d.planned, -walkMin) > now) || ok.find(d => addMin(d.actual || d.planned, 1) > now) || list[0];
}

async function selectTrip(id, fit) {
  S.sel = id;
  const dep = S.deps.find(d => d.tripId === id);
  await ensureLayers();
  S.markers.forEach(m => m.remove()); S.markers = []; dots = []; labels = labels.filter(l => !l.stop);
  if (!dep) { S.tr = null; map.getSource('rail').setData(emptyFC); render(); return; }
  try {
    const t = S.live ? await api.trip(id, S.station) : await S.demo.trip(id);
    const stopIdx = t.stopovers.findIndex(s => (S.station.id && s.id === S.station.id) || /afra/i.test(s.name));
    S.tr = { ...prepare(t.stopovers, t.polyline), raw: t, dep, stopIdx };
    const worst = Math.max(0, ...t.stopovers.map(s => s.arrDelay ?? s.depDelay ?? 0));
    const color = worst >= 5 ? '#ff3b30' : worst >= 1 ? '#ff9f0a' : '#34c759';
    map.getSource('rail').setData(lineFeat(t.polyline, { color }));
    t.stopovers.forEach((s, i) => {
      if (i === stopIdx || dist(s.lonlat, S.station.lonlat) < 900) return;
      const d = s.arrDelay ?? s.depDelay ?? 0, tm = s.arr || s.dep;
      const e = el('lbl', `${s.name}<br><i class="${cls(d)}">${fmt(tm)}${d >= 1 ? ' +' + Math.round(d) : ''}</i>`);
      S.markers.push(reg(mk(e, s.lonlat), s.lonlat, 5, { stop: true }));
      S.markers.push(mk(el('dot', ''), s.lonlat)); dots.push(s.lonlat);
    });
  } catch (e) { console.warn(e); S.tr = null; map.getSource('rail').setData(emptyFC); }
  placeBase(); render(); tick();
  if (fit) fitAll();
}

function fitAll() {
  const b = new maplibregl.LngLatBounds(S.station.lonlat, S.station.lonlat);
  b.extend(S.home); if (S.me) b.extend(S.me);
  S.walk?.coords.forEach(c => b.extend(c));
  if (S.tr) { b.extend(positionAt(S.tr, new Date()).pos); S.tr.polyline.forEach(c => b.extend(c)); }
  map.fitBounds(b, { padding: { top: 80, bottom: (S.board ? 440 : 200), left: 70, right: 70 }, maxZoom: 15.5, duration: 800 });
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

function render() {
  const list = vis(), i = list.findIndex(d => d.tripId === S.sel), dep = list[i];
  $('board').hidden = !S.board;
  if (!dep) { $('tag').className = 'glass tag'; $('tag').innerHTML = `<div class="sub">Keine Abfahrten Richtung ${DIRS[S.dir]} gefunden.</div>`; $('board').hidden = true; return; }
  const p = prediction(), walkMin = S.walk ? Math.ceil(S.walk.seconds / 60) : null;
  const dMin = dep.cancelled ? 0 : (p ? p.e.min : dep.delay ?? 0);
  const leave = p && walkMin != null ? addMin(p.depT, -walkMin - 1) : null;
  $('tag').className = 'glass tag' + (S.board ? ' open' : '');
  $('tag').innerHTML = `
  <div class="row top"><span class="badge">${dep.line}</span><span class="dir">→ ${dep.direction}</span><span class="plat">Gl. ${dep.platform}</span><span class="chev">${S.board ? '⌄' : '⌃'}</span></div>
  <div class="times"><span class="big ${dep.cancelled ? 'late' : cls(dMin)}">${dep.cancelled ? 'fällt aus' : fmt(p?.depT || dep.actual || dep.planned)}</span>${dep.cancelled ? '' : `${same(p?.plannedDep || dep.planned, p?.depT || dep.actual || dep.planned) ? '' : `<s>${fmt(p?.plannedDep || dep.planned)}</s>`}<span class="chip ${cls(dMin)}">${Math.abs(dMin) < 0.5 ? 'pünktlich' : sgn(dMin) + ' min'}</span>`}</div>
  <div class="sub">${leave ? `Spätestens los <b>${fmt(leave)}</b> · ${MODES[S.mode][0]} ${walkMin} min` : 'Weg wird berechnet …'}</div>
  <div id="prog"></div>`;
  renderBoard(list, i, dep, p);
  fillProg();
  requestAnimationFrame(() => document.documentElement.style.setProperty('--tagh', $('tag').offsetHeight + 'px'));
}

function renderBoard(list, i, dep, p) {
  if (!S.board) return;
  const rows = list.slice(0, 8).map(d => {
    const m = d.delay ?? 0, t = d.actual || d.planned;
    return `<button class="brow ${d.tripId === S.sel ? 'sel' : ''}" data-id="${d.tripId}">
      <span class="bt"><b class="${d.cancelled ? 'late' : cls(m)}">${d.cancelled ? '—' : fmt(t)}</b>${m >= 1 && !d.cancelled ? `<s>${fmt(d.planned)}</s>` : ''}</span>
      <span class="badge sm">${d.line}</span><span class="bd">${d.cancelled ? 'fällt aus · ' : ''}${d.direction}</span><span class="bg">Gl. ${d.platform}</span>
      ${m >= 1 && !d.cancelled ? `<span class="chip ${cls(m)}">+${Math.round(m)}</span>` : '<span class="chip ontime">•</span>'}</button>`;
  }).join('');
  const kv = (k, v) => `<div><span>${k}</span><span>${v}</span></div>`;
  const details = [
    p && kv('Ankunft', same(p.plannedArr, p.arr) ? `<b>${fmt(p.arr)}</b>` : `${fmt(p.plannedArr)} → <b>${fmt(p.arr)}</b>`),
    p && kv('Prognose', p.e.basis),
    dep.trainNo && kv('Zug', `${dep.category || ''} ${dep.trainNo}`),
    dep.plannedPlatform && dep.platform !== dep.plannedPlatform && kv('Gleiswechsel', `<span class="late">Gl. ${dep.platform} statt ${dep.plannedPlatform}</span>`),
    (dep.previousStops?.length || dep.nextStops?.length) && kv('Verlauf', [...(dep.previousStops || []).slice(-2), '<b>Mering St Afra</b>', ...(dep.nextStops || []).slice(0, 3)].join(' › ')),
    kv('Weg zum Bahnhof', `<button id="modebtn" class="pillbtn">${MODES[S.mode][0]} ${MODES[S.mode][1]} ⇄</button>`),
    kv('Quelle', S.live ? 'DB Live' : 'Demo'),
  ].filter(Boolean).join('');
  $('board').innerHTML = `<div class="bh"><b>Nächste Verbindungen</b><span class="sub">→ ${DIRS[S.dir]}</span></div><div class="blist">${rows || '<div class="sub" style="padding:8px 4px">Keine weiteren Verbindungen.</div>'}</div><div class="bd2">${details}</div>`;
  $('board').querySelectorAll('.brow').forEach(b => b.onclick = e => { e.stopPropagation(); selectTrip(b.dataset.id, true); });
  const m = $('modebtn'); if (m) m.onclick = e => { e.stopPropagation(); const k = Object.keys(MODES); S.mode = k[(k.indexOf(S.mode) + 1) % k.length]; store.set('zr.mode2', S.mode); loadWalk().then(render); };
}

function bar(icon, left, right, frac, tone) {
  const w = Math.round(frac * 100);
  return `<div class="pbar t-${tone}"><i style="width:${w}%${w ? '' : ';border-right-width:0'}"></i><span class="pl1">${icon} ${left}</span><span class="pr1">${right}</span></div>`;
}
function fillProg() {
  const box = $('prog'); if (!box) return;
  const now = new Date(), p = S.tr && prediction(), parts = [];
  if (p && S.tr) {
    const dep = S.tr.dep, st = S.tr.raw.start, name = st?.name || startName(dep) || 'Start';
    const tStart = st?.dep || S.tr.stops[0]?.dep || S.tr.stops[0]?.arr;
    const f = timeProgress(tStart, p.arr, now);
    const arrTxt = `🚉 <b>${fmt(p.arr)}</b>${now < p.arr ? ` · ${minutesUntil(p.arr, now)} min` : ' · da'}`;
    parts.push(bar("🚆", name, arrTxt, f ?? 0, cls(p.e.min)));
  }
  if (S.me && S.walk) {
    const eta = new Date(+now + S.walk.seconds * 1000), f = distProgress(S.trackTotal, S.walk.meters);
    const buf = p ? buffer(p.depT, eta) : null;
    const bufTxt = buf == null ? '' : buf >= 0 ? ` · <b class="ontime">+${buf}</b>` : ` · <b class="late">${buf}</b>`;
    parts.push(bar('📍', 'Du', `🚉 <b>${fmt(eta)}</b> · ${Math.ceil(S.walk.seconds / 60)} min${bufTxt}`, f, buf != null && buf < 0 ? 'late' : 'me'));
  } else parts.push(`<button class="gpsbtn" id="gpsbtn">📍 Live-Standort einschalten</button>`);
  box.innerHTML = parts.join('');
  const g = $('gpsbtn'); if (g) g.onclick = e => { e.stopPropagation(); startTracking(); };
}

// ---- Live-Standort ----
function onFix(pos) {
  const ll = [pos.coords.longitude, pos.coords.latitude], first = !S.me;
  S.me = ll;
  if (!S.meMarker) S.meMarker = mk(el('gps', ''), ll); else S.meMarker.setLngLat(ll);
  const moved = S.lastRoute.ll ? dist(S.lastRoute.ll, ll) : Infinity;
  if (first || moved > 120 || Date.now() - S.lastRoute.t > 45000) loadWalk().then(() => { render(); layout(); if (first) fitAll(); });
  else fillProg();
}
function startTracking() {
  if (!navigator.geolocation) { alert('Standort wird von diesem Browser nicht unterstützt.'); return; }
  if (S.watch != null) return;
  S.track = true; store.set('zr.track', true); $('gps').classList.add('on');
  S.watch = navigator.geolocation.watchPosition(onFix, e => { console.warn(e); stopTracking(); alert('Standort nicht verfügbar. Bitte in den Browser-Einstellungen erlauben.'); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
function stopTracking() {
  if (S.watch != null) navigator.geolocation.clearWatch(S.watch);
  S.watch = null; S.track = false; store.set('zr.track', false); $('gps').classList.remove('on');
  S.meMarker?.remove(); S.meMarker = null; S.me = null; S.trackTotal = 0;
  loadWalk().then(() => { render(); layout(); });
}
$('gps').onclick = () => (S.watch != null ? stopTracking() : startTracking());

// ---- Richtung ----
function updateDirUI() { document.querySelectorAll('#dirctl button').forEach(b => b.classList.toggle('on', b.dataset.d === S.dir)); }
document.querySelectorAll('#dirctl button').forEach(b => b.onclick = async () => {
  if (S.dir === b.dataset.d) return;
  S.dir = b.dataset.d; store.set('zr.dir', S.dir); updateDirUI();
  S.sel = pickDefault()?.tripId; await selectTrip(S.sel, true);
});
updateDirUI();
$('tag').onclick = () => { S.board = !S.board; render(); };
map.on('click', () => { if (S.board) { S.board = false; render(); } });

const TRAIN_SVG = `<svg viewBox="0 0 28 84" width="28" height="84" aria-hidden="true"><defs><filter id="ts" x="-40%" y="-20%" width="180%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-opacity=".38"/></filter></defs>
<g filter="url(#ts)"><rect x="4" y="2" width="20" height="80" rx="10" fill="#fff" stroke="#c7c7cc" stroke-width="1"/>
<rect x="4" y="30" width="20" height="1.2" fill="#d1d1d6"/><rect x="4" y="56" width="20" height="1.2" fill="#d1d1d6"/>
<rect x="4" y="2" width="4" height="80" rx="2" fill="#ec0016"/><rect x="20" y="2" width="4" height="80" rx="2" fill="#ec0016"/>
<path d="M9 10c0-3 2.2-5 5-5s5 2 5 5v5H9z" fill="#2c2c2e"/><rect x="10" y="20" width="8" height="5" rx="2" fill="#e5e5ea"/><rect x="10" y="38" width="8" height="5" rx="2" fill="#e5e5ea"/><rect x="10" y="62" width="8" height="5" rx="2" fill="#e5e5ea"/></g></svg>`;

function tick() {
  if (!S.tr) { S.trainMarker?.remove(); S.trainMarker = null; S.trainLabel?.remove(); S.trainLabel = null; S.trainPos = null; return; }
  const now = new Date(), p = positionAt(S.tr, now);
  const live = S.live && S.tr.raw.currentLocation && p.state === 'fährt';
  const pos = live ? S.tr.raw.currentLocation : p.pos;
  S.trainPos = pos;
  const d = S.tr.dep.delay ?? 0, html = `${S.tr.dep.line}${d >= 1 ? ` <b>+${Math.round(d)}</b>` : ''}`;
  if (!S.trainMarker) S.trainMarker = new maplibregl.Marker({ element: el('trainmodel', TRAIN_SVG), anchor: 'center', rotationAlignment: 'map' }).setLngLat(pos).addTo(map);
  S.trainMarker.setLngLat(pos).setRotation(p.bearing || 0);
  if (!S.trainLabel) { S.trainLabel = mk(el('lbl train-l', html), pos); labels.push({ marker: S.trainLabel, ll: pos, prio: 0, essential: true, trainLabel: true }); }
  const it = labels.find(l => l.trainLabel); if (it) it.ll = pos;
  S.trainLabel.setLngLat(pos); S.trainLabel.getElement().innerHTML = html;
  layout(); fillProg();
}

function logObservation() {
  const p = prediction(); if (!p || !S.live) return;
  if (new Date() < addMin(p.plannedDep, (p.liveDelay ?? 0) + 1)) return;
  const k = `zr.logged.${S.sel}`; if (store.get(k, false)) return;
  store.set(k, true); record(p.key, p.liveDelay ?? 0);
}

$('refresh').onclick = refresh;
$('fit').onclick = fitAll;

(async () => {
  await loadHome();
  await refresh();
  await loadWalk(); placeBase();
  if (!S.sel || !S.deps.find(d => d.tripId === S.sel) || true) { const d = pickDefault(); if (d && d.tripId !== S.sel) await selectTrip(d.tripId, false); }
  render(); fitAll();
})();
if (S.track) navigator.permissions?.query({ name: 'geolocation' }).then(r => { if (r.state === 'granted') startTracking(); }).catch(() => {});
setInterval(tick, 1000);
setInterval(() => { refresh().then(logObservation); }, 30000);
