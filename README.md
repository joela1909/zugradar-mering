# Zugradar Mering St Afra

Karten-App (MapLibre, OpenFreeMap) mit planmäßiger/aktueller Abfahrt, erwarteter Ankunft/Abfahrt am Bahnhof
Mering St Afra, Zugstrecke samt Live-Position und Weg (zu Fuß/Rad/Auto) zum Bahnhof.

- Daten: DB-Echtzeit über `v6.db.transport.rest` (Abfahrten, Fahrtverlauf, Strecke). Nicht erreichbar → Demo-Modus.
- Position: `currentLocation` der API, sonst entlang der Strecke aus Halte-Zeiten interpoliert.
- Erwartete Zeit: Live-Prognose gewichtet mit lokal gespeicherter Historie (je Linie + Abfahrtsminute).
- Startpunkt: ◎ (Standort) oder langer Druck auf die Karte.
- `npm i && npm run dev` · `npm test` · `npm run build`

## Deploy (Cloudflare Workers/Pages)

Build command `npm run build`, Output `dist`, Deploy command `npx wrangler deploy` (Konfiguration: `wrangler.jsonc`).

_Build-Trigger 2026-10-28_
