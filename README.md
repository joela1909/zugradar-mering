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
