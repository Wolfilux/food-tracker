# Food Tracker

Stand: 2026-06-03

Food Tracker ist eine React/Vite-App fuer ein taegliches Ernaehrungsprotokoll. Die App kombiniert manuelle Eintraege, Lebensmittelsuche, OpenFoodFacts-Fallback, KI-Fotoanalyse, KI-Textanalyse, Wochenanalyse, optionale Garmin-Connect-Werte und eine woechentliche Analyse-Mail.

## Status

- Branch: `dev`
- Container-Image: `ghcr.io/wolfilux/food-tracker:dev`
- Standard-Port im Container: `4173`
- Persistente Daten: Docker-Volume auf `/app/data`
- Live-Healthcheck: `/healthz`

## Features

- Tagesprotokoll mit Uhrzeit, Menge, Kalorien und Makros
- Tagesziel mit Kalorien- und Makro-Fortschritt
- Lebensmittelsuche gegen lokale SQLite-Datenbank und OpenFoodFacts
- Versionierter BLS-Import fuer generische/rohe Lebensmittel und deutsche Naehrwerte
- Fotoanalyse fuer Beschreibung, geschaetztes Gewicht, Kalorien und Makros
- Textanalyse fuer freie Essensbeschreibungen
- Analyse-Seite mit Wochen-Saeulendiagrammen fuer Kalorien, Protein, Kohlenhydrate und Fett
- Manuelle KI-Wochenanalyse mit Ampel, Text-Einschaetzung und Optimierungsvorschlaegen
- Gemeinsame KI-Konfiguration mit einem API-Key und getrennten Modell-Dropdowns fuer Foto- und Wochenanalyse
- Live-Modellabruf ueber Provider-APIs, bei OpenRouter fuer Fotoanalyse nur Modelle mit Bild-Input
- Woechentliche Analyse-E-Mail montags um 01:00 Uhr Europe/Berlin fuer die vorige Woche
- Optionaler Garmin-Connect-Abruf fuer den echten Tagesverbrauch als dynamisches Kalorienziel
- Backup-Import und -Export ueber die Weboberflaeche
- Progressive Web App fuer iPhone Home-Screen-Nutzung

## Architektur

- Frontend: React + Vite
- Backend: Node/Vite-Middleware unter `server/`
- Storage: lokale SQLite-Datei unter `/app/data`
- Secrets: API-Keys und Garmin-Zugangsdaten werden serverseitig verschluesselt gespeichert
- AI Usage: Token-/Kosten-Rohwerte bleiben als JSON am Eintrag erhalten
- SMTP: Serverdaten kommen aus Env-Variablen, Zieladresse aus der Weboberflaeche
- PWA: Manifest, Icons und Service Worker liegen unter `public/`

## Lokale Entwicklung

```bash
npm install
npm run dev
```

Wichtige Checks vor Aenderungen am Release-Branch:

```bash
npm run lint
npm run build
npm run security:scan
```

Der Security-Scan prueft unter anderem, dass keine `.env`-Dateien oder offensichtlichen Secrets ins Repository geraten.

## Installation mit Docker

Build aus dem lokalen Checkout:

```bash
docker build -t food-tracker:local .
docker volume create food-tracker-data
docker run --rm \
  -p 4173:4173 \
  -v food-tracker-data:/app/data \
  -e NODE_ENV=production \
  -e HOST=0.0.0.0 \
  -e PORT=4173 \
  food-tracker:local
```

Danach ist die App auf dem Docker-Host unter Port `4173` erreichbar. Der Healthcheck liegt auf `/healthz`.

Wichtig: Das Volume `food-tracker-data` speichert die SQLite-Datenbank und den lokalen Verschluesselungs-Key fuer gespeicherte KI- und Garmin-Zugangsdaten. Dieses Volume nur loeschen, wenn die App absichtlich zurueckgesetzt werden soll.

## Installation mit Docker Compose

```bash
docker compose up -d
docker compose logs -f food-tracker
```

Die enthaltene `docker-compose.yml` nutzt das Image `ghcr.io/wolfilux/food-tracker:dev`, Port `4173:4173` und das Volume `food-tracker-data:/app/data`.

Optionale SMTP-Variablen:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Food Tracker <food-tracker@example.com>
```

Wenn `SMTP_HOST`, Empfaengeradresse oder KI-Key fehlen, laeuft der Scheduler weiter und ueberspringt nur den Mailversand.

## BLS-Datenimport

OpenFoodFacts bleibt der Fallback fuer Barcode- und Packungsprodukte. Fuer rohe/generische Lebensmittel kann der Bundeslebensmittelschluessel (BLS) versioniert in die lokale SQLite-Datenbank importiert werden:

```bash
python3 scripts/import-bls.py
```

Ohne `--source` findet das Script den aktuellen ZIP-Download auf `https://blsdb.de/download`, importiert die `BLS_4_0_Daten_2025_DE.xlsx` und speichert die Eintraege als Quelle `BLS` mit `source_version`. Ein lokaler Download kann ebenfalls genutzt werden:

```bash
python3 scripts/import-bls.py --source ./BLS_4_0_2025_DE.zip --version 4.0 --source-updated-at 2025-12-11
```

BLS muss nicht live synchronisiert werden. Sinnvoll ist ein manueller oder geplanter Import nach neuen BLS-Releases bzw. Errata, z.B. quartalsweise oder halbjaehrlich pruefen.

## Installation in Portainer

Empfohlener Weg: Portainer Git Stack.

1. In Portainer `Stacks -> Add stack` oeffnen.
2. `Repository` als Build-Methode waehlen.
3. Repository auf das Food-Tracker-Repo setzen.
4. Branch `dev` auswaehlen.
5. Compose-Pfad `docker-compose.yml` verwenden.
6. Env-Variablen fuer SMTP setzen, falls Wochenmails verschickt werden sollen.
7. Stack deployen.
8. Nach dem Deploy pruefen, ob der Container `healthy` ist und `/healthz` `{"ok":true}` liefert.

Bei Portainer-Redeploys darauf achten, dass das neue GHCR-Image wirklich gezogen wird. Wenn Portainer ein altes Image cached, das Image `ghcr.io/wolfilux/food-tracker:dev` vorher explizit pullen oder den Stack mit Pull-Option neu deployen.

## Erste Einrichtung

1. App im Browser oeffnen.
2. `Konfiguration -> Tagesziel` setzen: Kalorienziel und Makro-Preset.
3. `Konfiguration -> KI-Konfiguration` setzen:
   - Provider auswaehlen
   - API-Key speichern
   - Foto-Modell auswaehlen
   - Analyse-Modell auswaehlen
4. Optional `Konfiguration -> Garmin` setzen:
   - Garmin-Benutzer und Passwort speichern
   - Auto-Sync-Intervall auswaehlen oder manuell abrufen
5. Optional `Konfiguration -> Wochenmail` setzen:
   - Zieladresse speichern
   - SMTP muss zusaetzlich in Docker/Portainer per Env konfiguriert sein
6. Optional im Browser als PWA installieren.

## Kurze Nutzeranleitung

### Tagesprotokoll

- Im Tab `Protokoll` Lebensmittel suchen oder manuell erfassen.
- Menge, Einheit und Uhrzeit pruefen.
- Eintrag speichern.
- Bei Bedarf Foto hochladen oder eine freie Essensbeschreibung per KI analysieren lassen.

### Analyse

- Im Tab `Analyse` die Woche wechseln.
- Diagramme zeigen Kalorien und Makros fuer Montag bis Sonntag.
- Gruen bedeutet unter oder auf Ziel, rot bedeutet ueber Ziel.
- `KI-Analyse` erzeugt eine Ampel und eine kurze Wochenbewertung.
- `Garmin` aktualisiert die Tagesverbrauchswerte, falls Garmin konfiguriert ist.

### Konfiguration

- Tagesziel und Makro-Preset bestimmen die Basisziele.
- Garmin kann das Kalorienziel pro Tag durch den echten Tagesverbrauch ersetzen.
- Die KI-Konfiguration nutzt einen gemeinsamen API-Key, aber separate Modelle fuer Fotoanalyse und Wochenanalyse.
- Wochenmail versendet automatisch montags um 01:00 Uhr Europe/Berlin die Analyse der Vorwoche, wenn SMTP, Zieladresse und KI-Key vorhanden sind.

### Backup

- Unter `Konfiguration -> Backup` kann die App-Datenbank exportiert und wieder importiert werden.
- Vor riskanten Updates oder groesseren Tests immer ein Backup exportieren.

## iPhone PWA

1. App-URL in Safari oeffnen.
2. Teilen-Menue oeffnen.
3. `Zum Home-Bildschirm` auswaehlen.
4. App vom Home-Screen starten.

Die PWA nutzt `display: standalone`, iOS-Meta-Tags, Touch-Icons, sichere Viewport-Inset-Abstaende und einen Service Worker fuer App-Shell-Caching. API-Aufrufe bleiben online und werden nicht gecached.

## Roadmap

Eine Roadmap in der README ist sinnvoll als leichter Feature-Parkplatz. Verbindliche Umsetzung gehoert aber in Jira, und abgeschlossene Tickets gehoeren zusaetzlich nach Confluence.

Aktuelle Ideen:

- Kosten-/Token-Auswertung der gespeicherten AI-Usage-Daten
- Wochenanalyse als Verlauf speichern und in der UI wieder anzeigen
- Manuelle Testmail fuer die Wochenmail-Konfiguration
- Bessere Import-/Export-Historie mit Zeitstempel und Dateigroesse
- Mobile Feinschliffe fuer lange Modellnamen und kleine Displays
- Optionaler Mehrbenutzer-Modus
- Dashboard fuer Garmin-Sync-Status und letzte Fehler

## Betriebshinweise

- Keine `.env`-Dateien oder echten Secrets committen.
- API-Keys und Garmin-Credentials werden verschluesselt im Datenvolume gespeichert.
- Beim Wechsel des Datenvolumes gehen gespeicherte Zugangsdaten und Eintraege verloren.
- Nach Deploys immer `/healthz` pruefen.
- Bei Wochenmail-Problemen zuerst SMTP-Env, Zieladresse und KI-Key pruefen.
- Bei Garmin-Problemen Credentials, MFA/Tokenstatus und Sync-Fehler in der UI pruefen.

## Confluence

Die generelle Produkt- und Betriebsdoku liegt in Confluence im Space `S6SDOC` unter `Food Tracker`.
Ticketbezogene Aenderungen werden separat als OP-Seiten unter `Jira Tickets & Incidents` dokumentiert.
