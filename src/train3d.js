import * as THREE from 'three';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .6, metalness: 0, side: THREE.DoubleSide, ...o });
// red = Wagenkasten in Betreiberfarbe (DB rot / Arverio blau); wave = helle Welle; door = Türen; roof = dunkles Dach
const M = { red: mat(0xec0016, { roughness: .45 }), wave: mat(0xdfe4ea), door: mat(0xd3d8de), dark: mat(0x16181b, { roughness: .2, metalness: .4 }), roof: mat(0x2b2d31), skirt: mat(0x232427) };

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

// Helle Welle auf beiden Seiten: Band, das entlang des Wagens auf und ab schwingt und an den Enden spitz ausläuft
function wave(y0, L, zMid, amp, thick, phase, g) {
  const top = [], bot = [], n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = y0 - t * L, zc = zMid + amp * Math.sin(Math.PI * 2 * t * .9 + phase), h = thick * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), .6) + .04;
    top.push([y, zc + h / 2]); bot.unshift([y, zc - h / 2]);
  }
  g.add(profile([...top, ...bot], M.wave, W + .05));
}
// Fensterreihe aus Einzelfenstern zwischen yA (vorn) und yB (hinten), liegt über der Welle
function windows(yA, yB, z, h, g, w = 1.7, step = 2.25) {
  for (let y = yA - w / 2 - .3; y - w / 2 > yB + .2; y -= step) g.add(box(W + .1, w, h, M.dark, 0, y, z));
}
function doors(y, z0, g) { g.add(box(W + .07, 1.5, 2.05, M.door, 0, y, z0)); g.add(box(W + .09, .06, 1.7, M.skirt, 0, y, z0 + .2)); }
function bogies(y0, L, g) { for (const s of [1, -1]) g.add(box(2.3, 2.8, .8, M.skirt, 0, y0 - L / 2 + s * (L / 2 - 2.4), 0)); }

// Doppelstock-Mittelwagen: hoher Kasten, zwei Fensterreihen, Türen im abgesenkten Teil
function deckCar(y0, L, g) {
  g.add(hull(L, M.red, y0, W, .55, 4.6, .7));
  g.add(box(W - 1.3, L - .6, .2, M.roof, 0, y0 - L / 2, 4.5));                        // dunkles Dach
  const dA = y0 - 5.4, dB = y0 - L + 5.4;                                             // Türen
  windows(y0 - 6.4, y0 - L + 6.4, 3.05, .8, g);                                       // obere Etage
  windows(dA - 1, dB + 1, 1.15, .8, g);                                               // untere Etage zwischen den Türen
  windows(y0 - .6, dA + 1, 2.15, .8, g, 2.4, 3); windows(dB - 1, y0 - L + .6, 2.15, .8, g, 2.4, 3); // über den Drehgestellen
  wave(y0 - 1, L - 2, 2.25, .55, 1.0, .4, g);
  for (const yd of [dA, dB]) doors(yd, .55, g);
  bogies(y0, L, g);
}
// Endwagen (einstöckig, hoch) mit Desiro-Nase; dir = 1 vorn, −1 hinten
function endCar(yFace, L, dir, g) {
  const nose = 3.6, body = L - nose, y0 = yFace - nose;                               // vorn: Übergang Nase/Wagenkasten
  const yb = dir > 0 ? y0 : yFace + nose + body;                                       // vorderes Ende des Kastens
  g.add(hull(body, M.red, yb, W, .95, 4.25, .75));
  g.add(box(W - 1.3, body - 1, .2, M.roof, 0, yb - body / 2, 4.15));
  windows(yb - 1, yb - body + 1, 2.15, .85, g, 2.2, 2.9);                             // Fenster
  wave(yb - .5, body - 1, 1.95, .45, .85, dir > 0 ? 2.2 : 0, g);
  for (const s of [1, -1]) doors(yb - body / 2 + s * (body / 2 - 6), .95, g);
  bogies(yb, body, g);
  // Nase: Seitenprofil, in der Draufsicht durch eine schmalere, längere Mittelschicht gerundet
  const P = (k, w) => { const m = profile([[0, .45], [2.4 * k, .45], [3.25 * k, .95], [3.55 * k, 1.6], [3.35 * k, 2.5], [2.6 * k, 3.45], [1.4 * k, 4.05], [0, 4.25]], M.red, w); return m; };
  const tip = new THREE.Group(); tip.add(P(.86, W), P(1, W * .62));
  const glass = new THREE.Group();
  glass.add(profile([[3.42, 2.05], [3.32, 2.6], [2.62, 3.5], [1.6, 4.04], [1.2, 3.85], [2.2, 3.3], [2.9, 2.5], [3.0, 2.05]], M.dark, W * .64));
  glass.add(profile([[2.95, 2.0], [2.85, 2.5], [2.2, 3.4], [1.3, 3.95], [1.0, 3.75], [2.0, 3.2], [2.6, 2.4], [2.6, 2.0]], M.dark, W + .02));
  tip.add(glass);
  for (const s of [-1, 1]) { const l = box(.42, .12, .2, lamp(), 0, 0, 0); l.position.set(s * .62, 3.38, 1.05); tip.add(l); }
  tip.add(box(1.4, .5, .35, M.skirt, 0, 3.0, .25));                                  // Kupplung/Schürze
  if (dir < 0) tip.rotation.z = Math.PI;
  tip.position.y = dir > 0 ? y0 : yb - body; g.add(tip);
}

function buildDesiro() {
  const g = new THREE.Group(), endL = 26.4, midL = 25.4, gap = .5, front = 52.5;
  endCar(front, endL, 1, g);
  const y1 = front - endL - gap; deckCar(y1, midL, g);
  const y2 = y1 - midL - gap; deckCar(y2, midL, g);
  endCar(y2 - midL - gap - endL, endL, -1, g);
  return g;
}
export const buildTrain = buildDesiro;

/** Benutzerdefinierte MapLibre-Ebene: ein 3D-Zug an einer Position, in Fahrtrichtung gedreht. */
const LIVERY = { db: 0xec0016, arverio: 0x2b7fd4, other: 0x6e6e73 };

export function createTrainLayer(maplibregl) {
  const TRAIN_LENGTH = 105, TRAIN_WIDTH = 2.9, TARGET_PX = 64, TARGET_WIDTH_PX = 15; // Modelllänge in m, gewünschte Mindestlänge auf dem Bildschirm
  const state = { lonlat: null, bearing: 0, visible: true };
  const layer = {
    id: 'train3d', type: 'custom', renderingMode: '3d',
    onAdd(map, gl) {
      this.map = map;
      this.camera = new THREE.Camera(); this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, 2.1));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-.4, -.7, 1).normalize(); this.scene.add(sun);
      this.scene.add(buildTrain());
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
    },
    render(gl, args) {
      if (!state.lonlat || !state.visible) return;
      const mc = maplibregl.MercatorCoordinate.fromLngLat(state.lonlat, 0);
      // Größe an den Zoom anpassen: mindestens TARGET_PX lang, bei starkem Zoom echte Größe
      const mpp = 40075016.686 * Math.cos(state.lonlat[1] * Math.PI / 180) / (512 * 2 ** this.map.getZoom());
      const unit = mc.meterInMercatorCoordinateUnits();
      // Reihenfolge (von rechts): erst Länge/Breite entlang der Zugachsen strecken, dann in Fahrtrichtung drehen, dann nach Mercator (y gespiegelt)
      const model = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z)
        .multiply(new THREE.Matrix4().makeScale(unit, -unit, unit))
        .multiply(new THREE.Matrix4().makeRotationZ(-state.bearing * Math.PI / 180))
        .multiply(new THREE.Matrix4().makeScale(Math.max(1, TARGET_WIDTH_PX * mpp / TRAIN_WIDTH), Math.max(1, TARGET_PX * mpp / TRAIN_LENGTH), Math.max(1, TARGET_WIDTH_PX * mpp / TRAIN_WIDTH)));
      this.camera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix).multiply(model);
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
    },
  };
  const setLivery = name => { const c = LIVERY[name] ?? LIVERY.other; if (state.livery !== name) { state.livery = name; M.red.color.set(c); } };
  return { layer, state, setLivery };
}
