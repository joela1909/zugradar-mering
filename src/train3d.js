import * as THREE from 'three';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .6, metalness: 0, side: THREE.DoubleSide, ...o });
const M = { white: mat(0xf4f4f6), red: mat(0xec0016, { roughness: .4 }), dark: mat(0x1c1c1e, { roughness: .25, metalness: .4 }), roof: mat(0xc9ccd2), skirt: mat(0x3a3a3c) };

// Lokale Achsen: x = rechts, y = Fahrtrichtung (vorn), z = oben. Maße in Metern, angelehnt an einen Triebzug (~75 m).
function box(w, l, h, m, x = 0, y = 0, z = 0) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, l, h), m); b.position.set(x, y, z + h / 2); return b; }

// ---- Doppelstockzug nach Vorbild Bombardier Twindexx Vario: Steuerwagen vorn, Mittelwagen, Lok hinten ----
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

// Doppelstockwagen: Enden über den Drehgestellen hoch, Mitte tiefer (zwei Etagen), Fensterbänder, Türen und Bauchbinde
function deckCar(y0, L, g) {
  const end = 4.2, midL = L - 2 * end;
  g.add(hull(L, M.white, y0));
  g.add(box(W - .05, midL, FLOOR - .3, M.white, 0, y0 - L / 2, .3));                 // abgesenkter Mittelteil
  g.add(box(W + .04, midL - 1.6, .85, M.dark, 0, y0 - L / 2, .95));                  // unteres Fensterband
  g.add(box(W + .04, L - 2.4, .85, M.dark, 0, y0 - L / 2, 2.85));                    // oberes Fensterband
  g.add(box(W + .06, midL, .32, M.red, 0, y0 - L / 2, .35));                         // Bauchbinde
  for (const s of [1, -1]) g.add(box(W + .08, 1.4, 2.0, M.red, 0, y0 - L / 2 + s * (midL / 2 - .9), .32)); // Türen
  g.add(box(W - .5, L - 1, .18, M.roof, 0, y0 - L / 2, H - .02));                    // Dachstreifen
  for (const s of [1, -1]) g.add(box(2.3, 3, .8, M.skirt, 0, y0 - L / 2 + s * (L / 2 - 2.4), 0)); // Drehgestelle
}

function buildDouble() {
  const g = new THREE.Group(), cab = 26.5, car = 26.5, loco = 18.5, gap = .4;
  const front = 37; // Zugspitze bei y = +37 (Modell ~74 m)
  // Steuerwagen: Wagenkasten + schräge, gerundete Front mit großer Scheibe oben
  const nose = 3.1, y0 = front - nose;
  deckCar(y0, cab - nose, g);
  const P = [[0, .3], [2.3, .3], [2.95, .9], [3.1, 1.7], [2.95, 2.6], [2.5, 3.4], [1.7, 4.2], [.8, H], [0, H]];
  const n = profile(P, M.white); n.position.y = y0; g.add(n);
  // rote Front unten und große, schräge Frontscheibe – jeweils knapp vor der Nasenfläche, damit sie sichtbar sind
  const band = profile([[0, .3], [2.36, .3], [3.02, .9], [3.17, 1.7], [3.1, 2.15], [2.4, 2.15], [2.4, .3]], M.red, W + .06); band.position.y = y0; g.add(band);
  const shield = profile([[3.04, 2.45], [2.58, 3.42], [1.76, 4.26], [.95, 4.55], [.8, 4.3], [1.6, 3.9], [2.35, 3.2], [2.75, 2.4]], M.dark, W - .3); shield.position.y = y0; g.add(shield);
  for (const s of [-1, 1]) { const l = box(.5, .12, .24, lamp(), 0, 0, 0); l.position.set(s * .9, y0 + 3.2, 1.05); g.add(l); }
  // Mittelwagen
  const y1 = front - cab - gap; deckCar(y1, car, g);
  // Lok (Traxx-artig): niedriger Kasten in Betreiberfarbe, Führerstand hinten
  const y2 = y1 - car - gap, lb = y2 - loco;
  g.add(hull(loco - 1.6, M.red, y2, W + .05, FLOOR, 4.15, .6));
  g.add(box(W + .1, loco - 4, .45, M.white, 0, y2 - loco / 2 + .5, 2.0));             // weißer Zierstreifen
  g.add(box(2.0, loco - 6, .5, M.skirt, 0, y2 - loco / 2 + .4, 4.15));               // Dachausrüstung
  const ln = profile([[0, .3], [1.2, .3], [1.6, 1.4], [1.45, 3.2], [.9, 4.15], [0, 4.15]], M.red, W + .05); ln.rotation.z = Math.PI; ln.position.y = lb + 1.6; g.add(ln);
  const lg = box(W - .5, .08, 1.0, M.dark, 0, 0, 0); lg.rotation.x = .45; lg.position.set(0, lb + .55, 3.3); g.add(lg);
  for (const s of [1, -1]) g.add(box(2.3, 3, .8, M.skirt, 0, y2 - loco / 2 + s * (loco / 2 - 3), 0));
  return g;
}

export const buildTrain = buildDouble;

/** Benutzerdefinierte MapLibre-Ebene: ein 3D-Zug an einer Position, in Fahrtrichtung gedreht. */
const LIVERY = { db: 0xec0016, arverio: 0x0b5fb3, other: 0x6e6e73 };

export function createTrainLayer(maplibregl) {
  const TRAIN_LENGTH = 74, TRAIN_WIDTH = 2.9, TARGET_PX = 64, TARGET_WIDTH_PX = 15; // Modelllänge in m, gewünschte Mindestlänge auf dem Bildschirm
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
