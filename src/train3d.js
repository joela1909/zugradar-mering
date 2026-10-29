import * as THREE from 'three';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .6, metalness: 0, side: THREE.DoubleSide, ...o });
// red = Wagenkasten in Betreiberfarbe (DB rot / Arverio blau); wave = helle Welle; door = Türen; roof = dunkles Dach
const M = { red: mat(0xff2b3f, { roughness: .45 }), wave: mat(0xeef2f6), door: mat(0xe2e6ea), dark: mat(0x16181b, { roughness: .2, metalness: .4 }), roof: mat(0x2b2d31), skirt: mat(0x232427) };

// Lokale Achsen: x = rechts, y = Fahrtrichtung (vorn), z = oben. Maße in Metern, nach Vorbild Siemens Desiro HC (BR 462, ~105 m).
function box(w, l, h, m, x = 0, y = 0, z = 0) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, l, h), m); b.position.set(x, y, z + h / 2); return b; }

// ---- Desiro HC: zwei einstöckige Endwagen mit runder Nase, zwei Doppelstock-Mittelwagen ----
const W = 2.8, H = 4.55, FLOOR = .95; // Wagenbreite, Dachhöhe, Wagenboden über Schiene (Enden; Mitte abgesenkt)
const poly = pts => { const sh = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); return sh; };
// Querschnitt mit gewölbtem Dach, entlang der Fahrtrichtung (y) extrudiert: y0 = vorderes Ende, Länge L
function hull(L, m, y0, w = W, z0 = FLOOR, h = H, r = .85) {
  const sh = new THREE.Shape(), x = w / 2;
  sh.moveTo(-x, z0); sh.lineTo(x, z0); sh.lineTo(x, h - r); sh.quadraticCurveTo(x, h, x - r, h); sh.lineTo(-x + r, h); sh.quadraticCurveTo(-x, h, -x, h - r); sh.lineTo(-x, z0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(Math.PI / 2); g.translate(0, y0, 0); // Querschnitt aufrichten, Extrusion zeigt nach hinten (−y)
  return new THREE.Mesh(g, m);
}
// Seitenprofil (y nach vorn, z nach oben) über die Wagenbreite extrudiert
function profile(pts, m, w = W) {
  const g = new THREE.ExtrudeGeometry(poly(pts), { depth: w, bevelEnabled: false, curveSegments: 8 });
  g.rotateX(Math.PI / 2); g.rotateZ(Math.PI / 2); g.translate(-w / 2, 0, 0);
  return new THREE.Mesh(g, m);
}
const lamp = () => mat(0xfff3c4, { emissive: 0xfff3c4, emissiveIntensity: .9 });

// Stückweise lineare Kurve: pts = [[t, wert], …] mit t von 0 (vorderes Ende) bis 1
const lerp = pts => t => { let i = 1; while (i < pts.length - 1 && pts[i][0] < t) i++; const [t0, a] = pts[i - 1], [t1, b] = pts[i]; return a + (b - a) * Math.min(1, Math.max(0, (t - t0) / ((t1 - t0) || 1))); };
// Helle Welle auf beiden Seiten: Mittellinie zc(t) und Dicke h(t) entlang des Wagens (y0 = vorderes Ende, Länge L)
function wave(y0, L, zc, h, g, flip = false) {
  const top = [], bot = [], n = 40;
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = flip ? 1 - t : t, y = y0 - t * L, z = zc(u), d = h(u) / 2;
    top.push([y, z + d]); bot.unshift([y, z - d]);
  }
  g.add(profile([...top, ...bot], M.wave, W + .05));
}
// Fenster (dunkel, liegt über der Welle): Mitte y, Länge l, Unterkante z, Höhe hh
const win = (y, l, z, hh, g) => g.add(box(W + .1, l, hh, M.dark, 0, y, z));
// Doppeltür mit zwei Türfenstern
function doors(y, z0, g) {
  g.add(box(W + .07, 1.6, 2.1, M.door, 0, y, z0));
  for (const s of [-1, 1]) win(y + s * .38, .42, z0 + .85, .95, g);
}
function bogies(y0, L, g) { for (const s of [1, -1]) g.add(box(2.3, 2.8, .8, M.skirt, 0, y0 - L / 2 + s * (L / 2 - 2.4), 0)); }

// Doppelstock-Mittelwagen (wie am Vorbild): Fenster über den Drehgestellen, Türen, oben 4 große Fenster + Schlitze, unten 4 Fenster
function deckCar(y0, L, g) {
  const at = t => y0 - t * L;
  g.add(hull(L, M.red, y0, W, .55, 4.6, .7));
  g.add(box(W - 1.3, L - .6, .2, M.roof, 0, y0 - L / 2, 4.5));                        // dunkles Dach
  wave(y0, L, lerp([[0, 1.1], [.25, 1.75], [.33, 2.2], [.55, 2.65], [.72, 2.05], [.8, 1.65], [1, 2.0]]),
    lerp([[0, .3], [.18, .8], [.33, .6], [.5, .95], [.72, .7], [.88, .55], [1, .18]]), g);
  for (const t of [.12, .88]) win(at(t), 1.5, 2.05, .75, g);                         // Fenster über den Drehgestellen
  for (const t of [.235, .765]) win(at(t), 1.5, 3.6, .25, g);                        // schmale Schlitze oben
  for (const t of [.355, .45, .545, .64]) { win(at(t), 2.05, 3.05, .78, g); win(at(t), 2.05, 1.1, .78, g); } // obere und untere Etage
  for (const t of [.29, .71]) doors(at(t), .55, g);
  bogies(y0, L, g);
}
// Endwagen mit runder Desiro-Nase; dir = 1 vorn (Nase vorn), −1 hinten (Nase hinten)
function endCar(yFace, L, dir, g, short = false) {
  const nose = 4.8, body = L - nose;
  const yb = dir > 0 ? yFace - nose : yFace + L;                                       // vorderes Ende des Wagenkastens
  const at = t => (dir > 0 ? yb - t * body : yb - (1 - t) * body);                     // t = 0 an der Nase
  g.add(hull(body, M.red, yb, W, .95, 4.25, .75));
  g.add(box(W - 1.3, body - 1, .2, M.roof, 0, yb - body / 2, 4.15));
  wave(yb, body, lerp([[0, 1.95], [.15, 1.35], [.3, 1.4], [.5, 1.8], [.62, 2.0], [.72, 1.8], [.85, 2.1], [1, 2.4]]),
    lerp([[0, .15], [.1, .62], [.3, .65], [.5, .85], [.65, .68], [.85, .6], [1, .25]]), g, dir < 0);
  // kurzer Wagen (für die Übersicht): weniger Fenster statt gestauchter
  for (const t of short ? [.1, .5, .9] : [.07, .5, .82, .93]) win(at(t), 1.9, 2.05, .8, g);
  if (!short) win(at(.33), .8, 2.15, .6, g);                                           // kleines Fenster (Rollstuhlplatz)
  for (const t of short ? [.3, .7] : [.2, .68]) doors(at(t), .95, g);
  bogies(yb, body, g);
  // Nase: gewölbtes Seitenprofil (Dach läuft in weitem Bogen zur Front), in der Draufsicht durch schmalere Schichten gerundet
  const curve = (k, dz = 0) => {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const s = i / 12, y = 2 * (1 - s) * s * 3.4 + s * s * 4.7, z = (1 - s) * (1 - s) * 4.25 + 2 * (1 - s) * s * 4.25 + s * s * 1.7; pts.push([y * k, z + dz]); }
    return pts;
  };
  const P = (k, w) => profile([[0, .45], [4.3 * k, .45], [4.75 * k, .7], [4.85 * k, 1.2], ...curve(k).reverse(), [0, 4.25]], M.red, w);
  const tip = new THREE.Group(); tip.add(P(.8, W), P(.92, W * .8), P(1, W * .5));
  // Frontscheibe nach vorn (auf der Wölbung, zwischen 2,2 und 3,7 m Höhe) und kleines Seitenfenster am Führerstand
  const c = curve(1.02).filter(([, z]) => z > 2.2 && z < 3.7);
  tip.add(profile([...c, ...c.slice().reverse().map(([y, z]) => [y - .7, z])], M.dark, W * .62));
  tip.add(box(W + .06, .75, .6, M.dark, 0, 1.2, 2.55));
  for (const s of [-1, 1]) { const l = box(.36, .12, .18, lamp(), 0, 0, 0); l.position.set(s * .45, 4.82, 1.0); tip.add(l); }
  tip.add(box(1.2, .5, .35, M.skirt, 0, 4.6, .2));                                     // Kupplung
  if (dir < 0) tip.rotation.z = Math.PI;
  tip.position.y = dir > 0 ? yb : yb - body; g.add(tip);
}

// Zug aus vier Wagen (Endwagen, 2 Doppelstockwagen, Endwagen); jeder Wagen mit seinem vorderen Ende bei y = 0 gebaut.
// setCars(n) zeigt 4, 3 (1., 2., 4.), 2 (1. und 4.) oder 1 Wagen (kurzer Endwagen) und rückt sie mittig zusammen – beim Herauszoomen kürzer statt gestaucht.
const END_L = 26.4, MID_L = 25.4, SHORT_L = 17, GAP = .5;
export function buildTrain() {
  const mk = f => { const c = new THREE.Group(); f(c); return c; };
  const cars = [
    { g: mk(c => endCar(0, END_L, 1, c)), L: END_L },
    { g: mk(c => endCar(0, SHORT_L, 1, c, true)), L: SHORT_L },
    { g: mk(c => deckCar(0, MID_L, c)), L: MID_L },
    { g: mk(c => deckCar(0, MID_L, c)), L: MID_L },
    { g: mk(c => endCar(-END_L, END_L, -1, c)), L: END_L },
  ];
  const train = new THREE.Group(); cars.forEach(c => train.add(c.g));
  const SHOW = { 4: [0, 2, 3, 4], 3: [0, 2, 4], 2: [0, 4], 1: [1] };
  train.setCars = n => {
    if (train.cars === n) return; train.cars = n;
    const vis = SHOW[n].map(i => cars[i]), total = vis.reduce((s, c) => s + c.L, 0) + GAP * (vis.length - 1);
    let y = total / 2;
    cars.forEach(c => { c.g.visible = vis.includes(c); });
    for (const c of vis) { c.g.position.y = y; y -= c.L + GAP; }
    train.len = total;
  };
  train.setCars(4);
  return train;
}

/** Benutzerdefinierte MapLibre-Ebene: ein 3D-Zug an einer Position, in Fahrtrichtung gedreht. */
const LIVERY = { db: 0xff2b3f, arverio: 0x4aa3ff, other: 0x8e8e93 };

export function createTrainLayer(maplibregl) {
  const TRAIN_WIDTH = 2.9, WIDTH_PX = 12, MIN_WIDTH_PX = 9, MAX_LEN_PX = 110; // Zugbreite in m; Bildschirmmaße beim Herauszoomen
  const state = { lonlat: null, bearing: 0, visible: true };
  const layer = {
    id: 'train3d', type: 'custom', renderingMode: '3d',
    onAdd(map, gl) {
      this.map = map;
      this.camera = new THREE.Camera(); this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, 2.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-.4, -.7, 1).normalize(); this.scene.add(sun);
      this.train = buildTrain(); this.scene.add(this.train);
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
    },
    render(gl, args) {
      if (!state.lonlat || !state.visible) return;
      const mc = maplibregl.MercatorCoordinate.fromLngLat(state.lonlat, 0);
      // Größe an den Zoom anpassen: gleichmäßig vergrößert (nie gestaucht), weiter draußen weniger Wagen;
      // ca. WIDTH_PX breit, aber höchstens MAX_LEN_PX lang (dann schmaler, mindestens MIN_WIDTH_PX)
      const z = this.map.getZoom(), mpp = 40075016.686 * Math.cos(state.lonlat[1] * Math.PI / 180) / (512 * 2 ** z);
      this.train.setCars(z >= 18 ? 4 : z >= 16.5 ? 3 : 1);
      const s = Math.max(1, MIN_WIDTH_PX * mpp / TRAIN_WIDTH, Math.min(WIDTH_PX * mpp / TRAIN_WIDTH, MAX_LEN_PX * mpp / this.train.len));
      const unit = mc.meterInMercatorCoordinateUnits();
      // Reihenfolge (von rechts): vergrößern, in Fahrtrichtung drehen, nach Mercator (y gespiegelt)
      const model = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z)
        .multiply(new THREE.Matrix4().makeScale(unit, -unit, unit))
        .multiply(new THREE.Matrix4().makeRotationZ(-state.bearing * Math.PI / 180))
        .multiply(new THREE.Matrix4().makeScale(s, s, s));
      this.camera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix).multiply(model);
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
      // Umriss des Zugs auf dem Bildschirm (CSS-Pixel), damit das Zug-Label darüber schweben kann und andere Labels ausweichen
      const c = this.map.getCanvas(), cw = c.clientWidth, ch = c.clientHeight, h = this.train.len / 2, v = new THREE.Vector4();
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const X of [-1.5, 1.5]) for (const Y of [-h, h]) for (const Z of [0, 4.6]) {
        v.set(X, Y, Z, 1).applyMatrix4(this.camera.projectionMatrix);
        if (v.w <= 0) continue;
        const px = (v.x / v.w + 1) / 2 * cw, py = (1 - v.y / v.w) / 2 * ch;
        x1 = Math.min(x1, px); x2 = Math.max(x2, px); y1 = Math.min(y1, py); y2 = Math.max(y2, py);
      }
      state.box = x1 < Infinity ? { x1, y1, x2, y2 } : null;
    },
  };
  const setLivery = name => { const c = LIVERY[name] ?? LIVERY.other; if (state.livery !== name) { state.livery = name; M.red.color.set(c); } };
  return { layer, state, setLivery };
}
