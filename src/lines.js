// Bahnhöfe der Strecke Dinkelscherben – Augsburg – Mering – München in Reihenfolge (EVA, Name, Länge, Breite; DB-Stationsdaten).
// Lange Abschnitte ohne Halt werden an diesen Bahnhöfen geteilt, damit jedes Teilstück fein genug geladen werden kann.
const LINE = [
  ['8001468', "Dinkelscherben", 10.588002, 48.342225],
  ['8002263', "Gessertshausen", 10.732382, 48.333715],
  ['8001439', "Diedorf (Schwab)", 10.776823, 48.35609],
  ['8006378', "Westheim (Schwab)", 10.818233, 48.385991],
  ['8004318', "Neusäß", 10.83352, 48.394392],
  ['8000662', "Augsburg-Oberhausen", 10.872533, 48.380772],
  ['8000013', "Augsburg Hbf", 10.88557, 48.365441],
  ['8000658', "Augsburg Haunstetterstraße", 10.900985, 48.355285],
  ['8000661', "Augsburg-Hochzoll", 10.943376, 48.352977],
  ['8003299', "Kissing", 10.959553, 48.300922],
  ['8004008', "Mering-St Afra", 10.971202, 48.274282],
  ['8003982', "Mering", 10.988291, 48.262698],
  ['8000545', "Althegnenberg", 11.063003, 48.236374],
  ['8002623', "Haspelmoor", 11.098784, 48.223263],
  ['8004204', "Mammendorf", 11.174618, 48.216826],
  ['8003828', "Malching (Oberbay)", 11.219064, 48.21545],
  ['8003824', "Maisach", 11.256393, 48.214147],
  ['8002247', "Gernlinden", 11.300378, 48.212765],
  ['8001996', "Esting", 11.317322, 48.212196],
  ['8004667', "Olching", 11.335602, 48.209995],
  ['8002377', "Gröbenzell", 11.374107, 48.194919],
  ['8004153', "München-Lochhausen", 11.407895, 48.176505],
  ['8004152', "München-Langwied", 11.432508, 48.163112],
  ['8004158', "München-Pasing", 11.461872, 48.149852],
  ['8000261', "München Hbf", 11.558335, 48.140232],
].map(([eva, name, lon, lat]) => ({ eva, name, ll: [lon, lat] }));
const at = new Map(LINE.map((s, i) => [s.eva, i]));

/** Bahnhöfe von a nach b (einschließlich), wenn beide auf der Strecke liegen und dazwischen weitere Bahnhöfe sind; sonst null */
export function viaStations(aEva, bEva) {
  const i = at.get(String(aEva)), j = at.get(String(bEva));
  if (i == null || j == null || Math.abs(i - j) < 2) return null;
  return i < j ? LINE.slice(i, j + 1) : LINE.slice(j, i + 1).reverse();
}
