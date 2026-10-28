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
const store = { get: (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const MODES = { car: ['🚗', 'Auto'], bike: ['🚲', 'Rad'], foot: ['🚶', 'zu Fuß'] };

let liveError = '';
const S = { station: api.FALLBACK_STATION, deps: [], sel: null, tr: null, live: false, demo: null, home: store.get('zr.home2', HOME_FALLBACK), mode: store.get('zr.mode2', 'car'), walk: null, trainMarker: null, open: false, markers: [], dir: store.get('zr.dir', 'muenchen'), me: null, meMarker: null, track: store.get('zr.track', false), trackTotal: 0, watch: null, lastRoute: { ll: null, t: 0 } };
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
function layout() {
  const placed = [...dots, ...(S.me ? [S.me] : [])].map(ll => { const p = map.project(ll); return rect(p.x, p.y, 14, 14); });
  const items = labels.filter(l => l.marker.getElement().isConnected).sort((a, b) => a.prio - b.prio);
  for (const it of items) {
    const el = it.marker.getElement(); el.style.display = '';
    const { x, y } = map.project(it.ll), w = el.offsetWidth + 8, h = el.offsetHeight + 8, gx = w / 2 + 8, gy = h / 2 + 8;
    const cands = it.fixed ? [[0, 0]] : [[0, -gy], [0, gy], [gx, 0], [-gx, 0], [gx * .8, -gy], [-gx * .8, -gy], [gx * .8, gy], [-gx * .8, gy], [0, -gy * 1.9], [0, gy * 1.9]];
    let pick = cands.find(o => !placed.some(r => hit(r, rect(x + o[0], y + o[1], w, h))));
    if (!pick) { if (!it.essential) { el.style.display = 'none'; continue; } pick = cands[0]; }
    it.marker.setOffset(pick); placed.push(rect(x + pick[0], y + pick[1], w, h));
  }
}
map.on('moveend', layout); map.on('zoomend', layout);
let stationMarker, homeMarker, walkMarker;

function placeBase() {
  labels = labels.filter(l => l.marker !== stationMarker && l.marker !== homeMarker);
  stationMarker?.remove(); homeMarker?.remove();
  const st = S.tr?.stops?.find((_, i) => i === S.tr.stopIdx);
  stationMarker = reg(mk(el('pin', `🚉 ${S.station.name.replace(' (Demo)', '')}${st ? `<small>${planTimes(prediction())}</small>` : ''}`), S.station.lonlat), S.station.lonlat, 1, { essential: true });
  homeMarker = reg(mk(el('me', '🏠 Koloniestraße 26'), S.home), S.home, 1, { essential: true });
  layout();
}
function planTimes(p) { return p ? `${fmt(p.plannedDep)} → <b style="color:#fca5a5">${fmt(p.depT)}</b>` : ''; }

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
  walkMarker._zr = { marker: walkMarker, ll: mid, prio: 2, essential: true }; labels.push(walkMarker._zr); layout();
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
  map.fitBounds(b, { padding: { top: 80, bottom: (S.open ? 300 : 160), left: 70, right: 70 }, maxZoom: 15.5, duration: 800 });
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
  if (!dep) { $('tag').innerHTML = `<div class="sub">Keine Abfahrten Richtung ${DIRS[S.dir]} gefunden.</div>`; return; }
  const p = prediction(), walkMin = S.walk ? Math.ceil(S.walk.seconds / 60) : null;
  const dMin = dep.cancelled ? 0 : (p ? p.e.min : dep.delay ?? 0);
  const leave = p && walkMin != null ? addMin(p.depT, -walkMin - 1) : null;
  const buffer = dep.delay >= 1 ? ` · Zug <b class="${cls(dep.delay)}">+${Math.round(dep.delay)} min</b> → so viel mehr Zeit` : '';
  $('tag').className = 'glass tag' + (S.open ? ' open' : '');
  $('tag').innerHTML = `
  <div class="row top"><button class="nav" id="prev" ${i <= 0 ? 'disabled' : ''}>‹</button><span class="badge">${dep.line}</span><span class="dir">→ ${dep.direction}</span><button class="nav" id="next" ${i >= list.length - 1 ? 'disabled' : ''}>›</button></div>
  <div class="times"><span class="big ${dep.cancelled ? 'late' : cls(dMin)}">${dep.cancelled ? 'fällt aus' : fmt(p?.depT || dep.actual || dep.planned)}</span>${dep.cancelled ? '' : `<s>${fmt(p?.plannedDep || dep.planned)}</s><span class="d ${cls(dMin)}">${sgn(dMin)} min</span>`}<span class="sub" style="margin-left:auto">Gl. ${dep.platform}</span></div>
  <div class="sub">${leave ? `Spätestens los <b>${fmt(leave)}</b> (${MODES[S.mode][0]} ${walkMin} min)` : 'Weg wird berechnet …'}${buffer}</div>
  <div id="prog"></div>
  <div class="more">
    ${p ? `<div><span>Ankunft planmäßig / erwartet</span><span>${fmt(p.plannedArr)} / <b>${fmt(p.arr)}</b></span></div>
    <div><span>Abfahrt planmäßig / aktuell</span><span>${fmt(p.plannedDep)} / <b>${fmt(dep.actual || dep.planned)}</b></span></div>
    <div><span>Prognose-Basis</span><span>${p.e.basis}</span></div>
    <div><span>Halte bis hier</span><span>${p.stopsAway}</span></div>` : ''}
    ${dep.trainNo ? `<div><span>Zug</span><span>${dep.category || ''} ${dep.trainNo}</span></div>` : ''}
    ${dep.plannedPlatform && dep.platform !== dep.plannedPlatform ? `<div><span>Gleiswechsel</span><span class="late">Gl. ${dep.platform} statt ${dep.plannedPlatform}</span></div>` : ''}
    ${dep.origin ? `<div><span>Von → Nach</span><span>${dep.origin} → ${dep.direction}</span></div>` : ''}
    ${(dep.previousStops?.length || dep.nextStops?.length) ? `<div><span>Verlauf</span><span style="text-align:right;max-width:68%">${[...(dep.previousStops || []).slice(-3), '<b>Mering St Afra</b>', ...(dep.nextStops || [])].join(' › ')}</span></div>` : ''}
    ${list.slice(i + 1, i + 3).length ? `<div><span>Danach</span><span style="text-align:right">${list.slice(i + 1, i + 3).map(n => `${fmt(n.actual || n.planned)} ${n.line}${n.delay >= 1 ? ' +' + Math.round(n.delay) : ''}`).join(' · ')}</span></div>` : ''}
    <div><span>Verkehrsmittel zum Bahnhof</span><span><button id="modebtn" style="background:var(--line);padding:2px 10px">${MODES[S.mode][0]} ${MODES[S.mode][1]} ⇄</button></span></div>
    <div><span>Startpunkt</span><span>Koloniestraße 26, Bobingen</span></div>
    <div><span>Quelle</span><span>${S.live ? 'DB Live' : 'Demo'}</span></div>
  </div>`;
  $('prev').onclick = e => { e.stopPropagation(); selectTrip(list[i - 1].tripId, true); };
  $('next').onclick = e => { e.stopPropagation(); selectTrip(list[i + 1].tripId, true); };
  fillProg();
  const m = $("modebtn"); if (m) m.onclick = e => { e.stopPropagation(); const k = Object.keys(MODES); S.mode = k[(k.indexOf(S.mode) + 1) % k.length]; store.set('zr.mode2', S.mode); loadWalk().then(render); };
}

function bar(icon, left, right, frac, tone) {
  const w = Math.round(frac * 100);
  return `<div class="prog"><div class="pl"><span>${icon} ${left}</span><span>${right}</span></div><div class="track ${tone}"><i style="width:${w}%"></i><u style="left:${w}%"></u></div></div>`;
}
function fillProg() {
  const box = $('prog'); if (!box) return;
  const now = new Date(), p = S.tr && prediction(), parts = [];
  if (p && S.tr) {
    const dep = S.tr.dep, st = S.tr.raw.start, name = st?.name || startName(dep) || 'Start';
    const tStart = st?.dep || S.tr.stops[0]?.dep || S.tr.stops[0]?.arr;
    const f = timeProgress(tStart, p.arr, now);
    const arrTxt = `Mering St Afra <b>${fmt(p.arr)}</b>${now < p.arr ? ` · in ${minutesUntil(p.arr, now)} min` : ' · da'}`;
    parts.push(bar('🚆', name.replace(/ Hbf.*/, ' Hbf'), arrTxt, f ?? 0, cls(p.e.min)));
  }
  if (S.me && S.walk) {
    const eta = new Date(+now + S.walk.seconds * 1000), f = distProgress(S.trackTotal, S.walk.meters);
    const buf = p ? buffer(p.depT, eta) : null;
    const bufTxt = buf == null ? '' : buf >= 0 ? ` · <b class="ontime">${buf} min Puffer</b>` : ` · <b class="late">${-buf} min zu spät</b>`;
    parts.push(bar('📍', 'Du', `Mering St Afra <b>${fmt(eta)}</b> · in ${Math.ceil(S.walk.seconds / 60)} min${bufTxt}`, f, buf != null && buf < 0 ? 'late' : 'me'));
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
$('tag').onclick = () => { S.open = !S.open; render(); };

function tick() {
  if (!S.tr) { S.trainMarker?.remove(); S.trainMarker = null; return; }
  const now = new Date(), p = positionAt(S.tr, now);
  const pos = S.live && S.tr.raw.currentLocation && p.state === 'fährt' ? S.tr.raw.currentLocation : p.pos;
  const d = S.tr.dep.delay ?? 0, html = `<span>🚆</span>${S.tr.dep.line}${d >= 1 ? ` <b>+${Math.round(d)}</b>` : ''}`;
  if (!S.trainMarker) { S.trainMarker = mk(el('train', html), pos); S.trainMarker._zr = { marker: S.trainMarker, ll: pos, prio: 0, fixed: true, essential: true, keep: true }; labels.push(S.trainMarker._zr); }
  else { S.trainMarker.setLngLat(pos); S.trainMarker._zr.ll = pos; S.trainMarker.getElement().innerHTML = html; }
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
