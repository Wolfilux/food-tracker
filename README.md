# Food Tracker

Food Tracker ist eine Vite/React-App fuer ein taegliches Ernaehrungsprotokoll. Die App kombiniert manuelle Eintraege, SQLite-basierte Lebensmittelsuche, OpenFoodFacts-Fallback und eine optionale Fotoanalyse per LLM.

## Features

- Tagesprotokoll mit Uhrzeit, Menge, Kalorien und Makros
- Tagesziel mit Kalorien- und Makro-Fortschritt
- Analyse-Seite mit Wochen-Saeulendiagrammen fuer Kalorien und Makros, Tagesziel-Markern und roter/gruener Ueber-/Unterdeckung
- Lebensmittelsuche gegen lokale SQLite-Datenbank und OpenFoodFacts
- Fotoanalyse fuer Beschreibung, ungefaehres Gewicht, Kalorien und Makros
- AI-Textanalyse fuer freie Essensbeschreibungen wie Omelette mit Schinken und Pilzen
- AI-Konfiguration mit Provider, Modell-Dropdown und sicher gespeicherten API-Keys
- Live-Modellabruf ueber Provider-APIs
- Rohspeicherung von AI-Usage-Daten am Fotoeintrag
- Optionaler Garmin-Connect-Abruf fuer den echten Tagesverbrauch als dynamisches Kalorienziel
- Progressive Web App fuer iPhone Home-Screen-Nutzung

## Architecture

- Frontend: React + Vite
- Backend: Vite Middleware unter `server/`
- Storage: lokale SQLite-Datei unter `data/`
- Secrets: API-Keys werden serverseitig mit AES-GCM verschluesselt und nicht im Browser gespeichert
- AI Usage: Token-/Kosten-Rohwerte werden als JSON am Eintrag gespeichert; OpenRouter-Generation-Stats bleiben unveraendert fuer spaetere Auswertung erhalten
- Garmin: optionale serverseitige Garmin-Connect-Anbindung; Login-Daten werden in der WebUI gepflegt, verschluesselt gespeichert und Tokens im persistenten `data/`-Volume wiederverwendet
- PWA: `manifest.webmanifest`, App-Icons und Service Worker unter `public/`

## Security Baseline

- Do not commit \`.env\` files or credentials.
- Keep real API keys, tokens, database URLs, and passwords out of the repository.
- Use \`.env.example\` only for placeholder variable names.
- Rotate any secret immediately if it is ever committed.

## Development

~~~bash
npm install
npm run dev
npm run build
npm run lint
npm run security:scan
~~~

Before pushing, run `npm run security:scan`. The local checkout also installs a Git pre-push hook for this scan.

## Docker / Portainer

The repository includes a production `Dockerfile` and `docker-compose.yml`. The container serves the built PWA and the SQLite API from one Node process.

~~~bash
docker build -t food-tracker:local .
docker run --rm -p 4173:4173 -v food-tracker-data:/app/data food-tracker:local
~~~

Default URL: `http://localhost:4173`

Persistent files live in the named Docker volume `food-tracker-data`, mounted at `/app/data`. This stores the SQLite database and the local encryption key used for saved AI provider credentials. Do not delete or recreate this volume unless you intentionally want to reset the app data and saved API keys.

Optional Garmin Connect:

Configure Garmin in the app under `Konfiguration -> Garmin`. The app stores the login server-side with the same encrypted local secret storage used for AI credentials. When configured, `/api/garmin/daily-summary?date=YYYY-MM-DD` reads Garmin's daily calories burned and the frontend uses that value as the day's calorie target. If Garmin is not configured or the login fails, the app falls back to the manually configured calorie target.

For Portainer, use the repository as a Git stack. The compose file pulls `ghcr.io/wolfilux/food-tracker:dev`, which is published by GitHub Actions after the quality gate passes. The exposed host port is `4173`; change the left side of `4173:4173` if the host already uses that port.

## iPhone PWA

1. Dev- oder Produktiv-URL in Safari oeffnen.
2. Teilen-Menue oeffnen.
3. "Zum Home-Bildschirm" auswaehlen.
4. App vom Home-Screen starten.

Die PWA nutzt `display: standalone`, iOS-Meta-Tags, Touch-Icons, sichere Viewport-Inset-Abstaende und einen Service Worker fuer App-Shell-Caching. API-Aufrufe bleiben online und werden nicht gecached.
