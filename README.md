# Zugradar Mering St Afra

Karten-App (MapLibre, OpenFreeMap) mit planmäßiger/aktueller Abfahrt, erwarteter Ankunft/Abfahrt am Bahnhof
Mering St Afra, Zugstrecke samt Live-Position und Weg (zu Fuß/Rad/Auto) zum Bahnhof.

- Daten: offizielle DB-Timetables-API (DB API Marketplace, kostenlos). Der Worker (`worker.js`) ruft sie serverseitig ab. Dafür sind die Worker-Secrets `DB_CLIENT_ID` und `DB_API_KEY` nötig. Ohne Daten → Demo-Modus.
- Strecke/Position: aus den Nachbarhalten des Zuges (Plan + Änderungen), Koordinaten per Photon/OSM, dazwischen interpoliert.
- Position: `currentLocation` der API, sonst entlang der Strecke aus Halte-Zeiten interpoliert.
- Erwartete Zeit: Live-Prognose gewichtet mit lokal gespeicherter Historie (je Linie + Abfahrtsminute).
- Startpunkt: ◎ (Standort) oder langer Druck auf die Karte.
- `npm i && npm run dev` · `npm test` · `npm run build`

## Deploy (Cloudflare Workers/Pages)

Build command `npm run build`, Output `dist`, Deploy command `npx wrangler deploy` (Konfiguration: `wrangler.jsonc`).

_Build-Trigger 2026-10-28_

## Koordinaten

Bahnhofskoordinaten stammen aus `stations.json` (erzeugt mit `node scripts/build-stations.mjs` aus dem npm-Paket `db-stations`; Daten: Deutsche Bahn StaDa, CC BY 4.0). Mering-St Afra (EVA 8004008) liegt bei 48.274282, 10.971202. Nur unbekannte Orte werden per Photon/OSM gesucht.

## Gleisgeometrie

Hochzoll – Kissing – Mering-St Afra – Mering – Althegnenberg ist fest hinterlegt (`src/tracks.js`, geglätteter Spline durch vorgegebene Punkte). Alle übrigen Abschnitte liest das Handy aus den Vektorkacheln der Grundkarte (OpenFreeMap, OpenMapTiles-Schema, `transportation` mit `class=rail`, Daten © OpenStreetMap, ODbL; `src/tilerail.js`), Reserve ist Overpass. Kürzester Gleisweg, Verbinden über Kachelgrenzen und Glättung in `rail.js`; jeder Abschnitt wird dauerhaft im Browser gemerkt. Die Overpass-Server bedienen Cloudflare-Worker nicht, deshalb läuft die Abfrage im Browser; `/api/rail` im Worker bleibt als Reserve.

## Bahn-Kontingent

Die DB-Timetables-API erlaubt 60 Anfragen pro Minute. Ein Durable Object (`RateLimiter` in `worker.js`, Fenster in `limiter.js`) zählt alle Bahn-Anfragen aller Geräte in einem gleitenden 60-Sekunden-Fenster und gibt genau so viele frei (`DB_RATE_LIMIT`, Standard 60). Ist das Kontingent erschöpft, liefert der Worker die zuletzt gespeicherte Antwort. Echtzeitdaten werden frühestens alle 10 s neu geholt, die Halte nahe Mering-St Afra zuerst. `/api/limit` zeigt die aktuelle Auslastung.
