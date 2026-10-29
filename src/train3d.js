import * as THREE from 'three';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .6, metalness: 0, side: THREE.DoubleSide, ...o });
const M = { white: mat(0xf4f4f6), red: mat(0xec0016, { roughness: .4 }), dark: mat(0x1c1c1e, { roughness: .25, metalness: .4 }), roof: mat(0xe6e8ed), skirt: mat(0x3a3a3c) };

// Lokale Achsen: x = rechts, y = Fahrtrichtung (vorn), z = oben. Maße in Metern, angelehnt an einen Triebzug (~75 m).
function box(w, l, h, m, x = 0, y = 0, z = 0) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, l, h), m); b.position.set(x, y, z + h / 2); return b; }

function nose() {
  const s = new THREE.Shape();
  [[-1.45, 0], [1.45, 0], [1.45, 1.4], [1.15, 3.2], [.55, 4.5], [0, 4.9], [-.55, 4.5], [-1.15, 3.2], [-1.45, 1.4]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const g = new THREE.Group(), body = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 3.2, bevelEnabled: false }), M.white);
  g.add(body);
  const red = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: .45, bevelEnabled: false }), M.red); red.position.z = 1.0; red.scale.set(1.012, 1.004, 1); g.add(red);
  const glass = box(2.3, 1.1, 1.0, M.dark, 0, 3.15, 1.9); glass.rotation.x = -.35; g.add(glass);
  g.add(box(.5, .05, .35, mat(0xfff3c4, { emissive: 0xfff3c4, emissiveIntensity: .8 }), -.8, 4.2, 1.0), box(.5, .05, .35, mat(0xfff3c4, { emissive: 0xfff3c4, emissiveIntensity: .8 }), .8, 4.2, 1.0));
  return g;
}

// Doppelstockzug: Lok in Betreiberfarbe vorn, drei Doppelstockwagen mit zwei Fensterbändern, Steuerwagen hinten
function buildDouble() {
  const train = new THREE.Group(), base = .9, H = 4.4;
  // Lok (19 m)
  const ly = 37 - 9.5;
  train.add(box(3.0, 17, 3.6, M.red, 0, ly - 1, base));
  train.add(box(3.04, 3, 1.1, M.dark, 0, ly + 6.8, base + 2.2));      // Führerstand
  train.add(box(3.06, 15, .35, M.white, 0, ly - 1.5, base + 1.2));     // Zierstreifen
  train.add(box(2.2, 13, .5, M.skirt, 0, ly - 1, base + 3.6));         // Dachaufbauten
  const ln = nose(); ln.scale.set(1.03, .5, 1.12); ln.position.set(0, ly + 7.5, base); train.add(ln);
  train.add(box(2.5, 17, .8, M.skirt, 0, ly - 1, 0));
  // Doppelstockwagen
  const cl = 17.8;
  for (let i = 0; i < 3; i++) {
    const y = ly - 10.5 - cl * (i + .5);
    train.add(box(2.9, cl - .5, H, M.white, 0, y, base));
    train.add(box(2.96, cl - 3, .8, M.dark, 0, y, base + .75));          // unteres Fensterband
    train.add(box(2.96, cl - 3, .8, M.dark, 0, y, base + 2.55));         // oberes Fensterband
    train.add(box(3.0, cl - .5, .3, M.red, 0, y, base + 1.9));           // Streifen zwischen den Etagen
    train.add(box(2.5, cl - .5, .26, M.roof, 0, y, base + H));
    train.add(box(2.5, cl - 2, .8, M.skirt, 0, y, 0));
  }
  const rear = nose(); rear.rotation.z = Math.PI; rear.scale.set(1, .7, 1.35); rear.position.set(0, -37 + 3.4, base); train.add(rear);
  return train;
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
  const setLivery = name => { const c = LIVERY[name] ?? LIVERY.other; if (state.livery !== name) { state.livery = name; M.red.color.set(c); M.roof.color.set(c); } };
  return { layer, state, setLivery };
}
