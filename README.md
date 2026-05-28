# Food Tracker

Food Tracker ist eine Vite/React-App fuer ein taegliches Ernaehrungsprotokoll. Die App kombiniert manuelle Eintraege, SQLite-basierte Lebensmittelsuche, OpenFoodFacts-Fallback und eine optionale Fotoanalyse per LLM.

## Features

- Tagesprotokoll mit Uhrzeit, Menge, Kalorien und Makros
- Tagesziel mit Kalorien- und Makro-Fortschritt
- Lebensmittelsuche gegen lokale SQLite-Datenbank und OpenFoodFacts
- Fotoanalyse fuer Beschreibung, ungefaehres Gewicht, Kalorien und Makros
- AI-Textanalyse fuer freie Essensbeschreibungen wie Omelette mit Schinken und Pilzen
- AI-Konfiguration mit Provider, Modell-Dropdown und sicher gespeicherten API-Keys
- Live-Modellabruf ueber Provider-APIs
- Rohspeicherung von AI-Usage-Daten am Fotoeintrag
- Progressive Web App fuer iPhone Home-Screen-Nutzung

## Architecture

- Frontend: React + Vite
- Backend: Vite Middleware unter `server/`
- Storage: lokale SQLite-Datei unter `data/`
- Secrets: API-Keys werden serverseitig mit AES-GCM verschluesselt und nicht im Browser gespeichert
- AI Usage: Token-/Kosten-Rohwerte werden als JSON am Eintrag gespeichert; OpenRouter-Generation-Stats bleiben unveraendert fuer spaetere Auswertung erhalten
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

## iPhone PWA

1. Dev- oder Produktiv-URL in Safari oeffnen.
2. Teilen-Menue oeffnen.
3. "Zum Home-Bildschirm" auswaehlen.
4. App vom Home-Screen starten.

Die PWA nutzt `display: standalone`, iOS-Meta-Tags, Touch-Icons, sichere Viewport-Inset-Abstaende und einen Service Worker fuer App-Shell-Caching. API-Aufrufe bleiben online und werden nicht gecached.
