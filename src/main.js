import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import * as api from './api.js';
import { prepare, positionAt } from './train.js';
import { expectedDelay, record, histKey } from './predict.js';
import { dist } from './geo.js';

const $ = id => document.getElementById(id);
const fmt = d => (d ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–');
const sgn = m => (m > 0.5 ? `+${Math.round(m)} min` : m < -0.5 ? `${Math.round(m)} min` : 'pünktlich');
const cls = m => (m >= 5 ? 'late' : m >= 1 ? 'minor' : 'ontime');
const addMin = (d, m) => new Date(+d + m * 60000);
const store = { get: (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

let liveError = '';
const S = { station: api.FALLBACK_STATION, deps: [], sel: null, tr: null, live: false, demo: null, home: store.get('zr.home', null), mode: store.get('zr.mode', 'foot'), walk: null, trainMarker: null };

const map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', center: S.station.lonlat, zoom: 13.5, attributionControl: { compact: true } });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
const BLANK = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8edf1' } }] };
const mapReady = new Promise(r => {
  let done = false; const go = () => { if (!done) { done = true; r(); } };
  map.on('load', go);
  map.on('error', e => { if (!done && !map.isStyleLoaded()) { console.warn('Kartenstil nicht ladbar, nutze leeren Hintergrund', e.error); map.setStyle(BLANK); map.once('styledata', go); } });
});

const emptyFC = { type: 'FeatureCollection', features: [] };
const lineFeat = c => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: {} });
async function ensureLayers() {
  await mapReady;
  if (map.getSource('rail')) return;
  map.addSource('rail', { type: 'geojson', data: emptyFC });
  map.addSource('walk', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'rail-glow', type: 'line', source: 'rail', paint: { 'line-color': '#e30613', 'line-width': 12, 'line-opacity': .18, 'line-blur': 6 } });
  map.addLayer({ id: 'rail-case', type: 'line', source: 'rail', paint: { 'line-color': '#fff', 'line-width': 6 } });
  map.addLayer({ id: 'rail', type: 'line', source: 'rail', paint: { 'line-color': '#e30613', 'line-width': 3.2 } });
  map.addLayer({ id: 'rail-ties', type: 'line', source: 'rail', paint: { 'line-color': '#fff', 'line-width': 1.4, 'line-dasharray': [1, 3] } });
  map.addLayer({ id: 'walk-case', type: 'line', source: 'walk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } });
  map.addLayer({ id: 'walk', type: 'line', source: 'walk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2563eb', 'line-width': 5 } });
}
const el = (cn, html) => { const e = document.createElement('div'); e.className = cn; e.innerHTML = html; return e; };
let stationMarker, homeMarker;
function placeStation() {
  stationMarker?.remove();
  stationMarker = new maplibregl.Marker({ element: el('pin', '🚉 ' + S.station.name) }).setLngLat(S.station.lonlat).addTo(map);
}
function placeHome() {
  homeMarker?.remove();
  if (!S.home) return;
  homeMarker = new maplibregl.Marker({ element: el('me', '') }).setLngLat(S.home).addTo(map);
}

async function loadWalk() {
  await ensureLayers();
  if (!S.home) { S.walk = null; map.getSource('walk').setData(emptyFC); return; }
  try { S.walk = await api.route(S.mode, S.home, S.station.lonlat); }
  catch { const m = dist(S.home, S.station.lonlat) * 1.3; S.walk = { coords: [S.home, S.station.lonlat], meters: m, seconds: m / ({ foot: 1.33, bike: 4.2, car: 9 }[S.mode]) }; }
  map.getSource('walk').setData(lineFeat(S.walk.coords));
}
function setHome(ll) { S.home = ll; store.set('zr.home', ll); placeHome(); loadWalk().then(renderDetail); }

async function refresh() {
  $('refresh').style.opacity = .5;
  try {
    try {
      if (!S.live) S.station = await api.findStation();
      S.deps = await api.departures(S.station); S.live = true; liveError = '';
    } catch (e) {
      console.warn('Live-Daten nicht erreichbar, Demo-Modus:', e);
      liveError = String(e?.message || e).slice(0, 160);
      S.live = false; S.demo = api.demo(); S.station = S.demo.station; S.deps = S.demo.deps;
    }
    $('mode').textContent = S.live ? 'LIVE' : 'DEMO'; $('mode').className = 'chip' + (S.live ? ' live' : '');
    $('stName').textContent = S.station.name; placeStation();
    if (!S.sel || !S.deps.find(d => d.tripId === S.sel)) S.sel = (S.deps.find(d => addMin(d.actual || d.planned, 1) > new Date() && !d.cancelled) || S.deps[0])?.tripId;
    renderList();
    await selectTrip(S.sel, false);
  } finally { $('refresh').style.opacity = 1; }
}

function renderList() {
  $('list').innerHTML = S.deps.map(d => {
    const m = d.delay ?? 0;
    return `<button class="card ${d.tripId === S.sel ? 'sel' : ''}" data-id="${d.tripId}"><div class="l">${d.line} <span class="d">Gl. ${d.platform}</span></div>
      <div class="t ${d.cancelled ? 'late' : cls(m)}">${d.cancelled ? 'fällt aus' : fmt(d.actual || d.planned)}${m >= 1 && !d.cancelled ? `<s>${fmt(d.planned)}</s>` : ''}</div>
      <div class="d">→ ${d.direction}</div></button>`;
  }).join('') || '<div class="note">Keine Abfahrten gefunden.</div>';
  $('list').querySelectorAll('.card').forEach(b => b.onclick = () => selectTrip(b.dataset.id, true));
}

async function selectTrip(id, fit) {
  S.sel = id; renderList();
  const dep = S.deps.find(d => d.tripId === id); if (!dep) return;
  await ensureLayers();
  try {
    const t = S.live ? await api.trip(id, S.station) : await S.demo.trip(id);
    const stopIdx = t.stopovers.findIndex(s => (S.station.id && s.id === S.station.id) || /St\.? ?Afra/i.test(s.name));
    S.tr = { ...prepare(t.stopovers, t.polyline), raw: t, dep, stopIdx };
    map.getSource('rail').setData(lineFeat(t.polyline));
    if (fit) fitAll();
  } catch (e) { console.warn(e); S.tr = null; map.getSource('rail').setData(emptyFC); }
  renderDetail(); tick();
}

function fitAll() {
  const b = new maplibregl.LngLatBounds(S.station.lonlat, S.station.lonlat);
  if (S.home) b.extend(S.home);
  if (S.tr) { const p = positionAt(S.tr, new Date()); b.extend(p.pos); const near = S.tr.polyline.filter(c => dist(c, S.station.lonlat) < 6000); near.forEach(c => b.extend(c)); }
  map.fitBounds(b, { padding: { top: 90, bottom: Math.min(470, innerHeight * .55), left: 50, right: 60 }, maxZoom: 15.5, duration: 800 });
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
  const e = expectedDelay({ live: S.live ? liveDelay : liveDelay, stopsAway, hist });
  return { st, plannedArr, plannedDep, liveDelay, stopsAway, e, key,
    arr: addMin(plannedArr, e.min), depT: addMin(plannedDep, e.min) };
}

function renderDetail() {
  const dep = S.deps.find(d => d.tripId === S.sel), p = prediction();
  if (!dep) { $('detail').innerHTML = ''; return; }
  const walkMin = S.walk ? Math.ceil(S.walk.seconds / 60) : null;
  const leave = p && walkMin != null ? addMin(p.depT, -walkMin - 1) : null;
  const segs = ['foot', 'bike', 'car'].map(m => `<button data-m="${m}" class="${S.mode === m ? 'on' : ''}">${{ foot: '🚶 zu Fuß', bike: '🚲 Rad', car: '🚗 Auto' }[m]}</button>`).join('');
  $('detail').innerHTML = `<h3>${dep.line} → ${dep.direction}</h3>
  <div class="grid">
    <div class="box"><small>Abfahrt planmäßig</small><div class="v">${fmt(p?.plannedDep || dep.planned)}</div><div class="sub">Gleis ${dep.platform}</div></div>
    <div class="box"><small>Abfahrt aktuell</small><div class="v ${cls(dep.delay ?? 0)}">${dep.cancelled ? 'fällt aus' : fmt(dep.actual || dep.planned)}</div><div class="sub">${dep.cancelled ? '' : sgn(dep.delay ?? 0)}</div></div>
    ${p ? `<div class="box"><small>Ankunft erwartet</small><div class="v ${cls(p.e.min)}">${fmt(p.arr)}</div><div class="sub">plan ${fmt(p.plannedArr)} · ${sgn(p.e.min)}</div></div>
    <div class="box"><small>Abfahrt erwartet</small><div class="v ${cls(p.e.min)}">${fmt(p.depT)}</div><div class="sub">${p.e.basis}</div></div>` : ''}
  </div>
  <div class="grid" style="margin-top:8px">
    <div class="box"><small>Dein Weg</small><div class="v">${walkMin != null ? walkMin + ' min' : '–'}</div><div class="sub">${S.walk ? (S.walk.meters / 1000).toFixed(1) + ' km' : 'Langer Druck auf Karte = Startpunkt'}</div></div>
    <div class="box"><small>Spätestens los</small><div class="v">${fmt(leave)}</div><div class="sub">inkl. 1 min Puffer</div></div>
  </div>
  <div class="seg">${segs}</div>
  <div class="note">${S.live ? 'Live-Daten: DB (transport.rest). ' : `Demo-Daten – Live-Quelle nicht erreichbar${liveError ? ' (' + liveError + ')' : ''}. `}Erwartung = Live-Prognose gewichtet mit gespeicherter Historie; ${p ? p.stopsAway + ' Halt(e) bis hier.' : ''}</div>`;
  $('detail').querySelectorAll('[data-m]').forEach(b => b.onclick = () => { S.mode = b.dataset.m; store.set('zr.mode', S.mode); loadWalk().then(renderDetail); });
}

function tick() {
  if (!S.tr) { S.trainMarker?.remove(); S.trainMarker = null; return; }
  const raw = S.tr.raw, now = new Date();
  const p = positionAt(S.tr, now);
  const pos = S.live && raw.currentLocation && p.state === 'fährt' ? raw.currentLocation : p.pos;
  if (!S.trainMarker) S.trainMarker = new maplibregl.Marker({ element: el('train', '🚆') }).setLngLat(pos).addTo(map);
  else S.trainMarker.setLngLat(pos);
}

// Beobachtung für Historie: einmal pro Zug & Tag, sobald er den Bahnhof verlassen hat
function logObservation() {
  const p = prediction(); if (!p || !S.live) return;
  if (new Date() < addMin(p.plannedDep, (p.liveDelay ?? 0) + 1)) return;
  const k = `zr.logged.${S.sel}`; if (store.get(k, false)) return;
  store.set(k, true); record(p.key, p.liveDelay ?? 0);
}

$('refresh').onclick = refresh;
$('fit').onclick = fitAll;
$('locate').onclick = () => navigator.geolocation?.getCurrentPosition(pos => { setHome([pos.coords.longitude, pos.coords.latitude]); fitAll(); }, () => alert('Standort nicht verfügbar – lang auf die Karte drücken, um den Startpunkt zu setzen.'), { enableHighAccuracy: true });
map.on('contextmenu', e => setHome([e.lngLat.lng, e.lngLat.lat]));

placeHome();
refresh().then(async () => { await loadWalk(); renderDetail(); fitAll(); });
setInterval(tick, 1000);
setInterval(() => { refresh().then(logObservation); }, 30000);
