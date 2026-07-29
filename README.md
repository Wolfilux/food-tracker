# Food Tracker

Stand: 2026-06-28

Food Tracker ist eine React/Vite-App fuer ein taegliches Ernaehrungsprotokoll. Die App kombiniert manuelle Eintraege, Lebensmittelsuche, OpenFoodFacts-Fallback, KI-Fotoanalyse, KI-Textanalyse, Wochenanalyse, optionale Garmin-Connect-Werte und eine woechentliche Analyse-Mail.

## Status

- Stable-Branch: `main`
- Integrations-Branch: `dev`
- Container-Images: `ghcr.io/wolfilux/food-tracker:main` und `ghcr.io/wolfilux/food-tracker:dev`
- Standard-Port im Container: `4173`
- Persistente Daten: Docker-Volume auf `/app/data`
- Live-Healthcheck: `/healthz`

Hinweis zum Repository-Stand: `main` ist der stabile Release-Branch. `dev`
bleibt der aktive Integrations- und Staging-Branch, aus dem gepruefte Releases
per Pull Request nach `main` uebernommen werden.

Die vorgeschlagene Branching- und Release-Strategie steht in
[`docs/release-strategy.md`](docs/release-strategy.md).

## Features

- Tagesprotokoll mit Uhrzeit, Menge, Kalorien und Makros
- Mobile, einklappbare Gewichtserfassung; das Datum kommt ausschließlich aus Header/Swipe
- Chronologischer Gewichtsverlauf in der Analyse mit manuellen und optional importierten Garmin-Werten
- Tagesziel mit Kalorien- und Makro-Fortschritt
- Lebensmittelsuche gegen lokale SQLite-Datenbank und OpenFoodFacts
- Versionierter BLS-Import fuer generische/rohe Lebensmittel und deutsche Naehrwerte
- Fotoanalyse fuer Beschreibung, geschaetztes Gewicht, Kalorien und Makros
- Textanalyse fuer freie Essensbeschreibungen
- Analyse-Seite mit Wochen-Saeulendiagrammen fuer Kalorien, Protein, Kohlenhydrate, Fett und Garmin-Sportaktivitaeten
- Manuelle KI-Wochenanalyse mit Ampel, strukturierten Abschnitten, tiefer Ernaehrungs-/Gewohnheits-/Timing-Einschaetzung, konkreten Empfehlungen und Wochenplan
- KI-Datenchat mit dynamischen historischen Zeitraeumen, Wochenvergleichen, Gewichts-/Ernaehrungstrends und transparentem Abfragekontext
- Gemeinsame KI-Konfiguration mit einem API-Key und getrennten Modell-Dropdowns fuer Foto- und Wochenanalyse
- Live-Modellabruf ueber Provider-APIs, bei OpenRouter fuer Fotoanalyse nur Modelle mit Bild-Input
- Woechentliche Analyse-E-Mail montags um 01:00 Uhr Europe/Berlin fuer die vorige Woche
- Optionaler Garmin-Connect-Pull fuer Tagesverbrauch, Sportaktivitaeten, Gewicht und dynamisches Kalorienziel
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
npm test
npm run security:scan
```

Der Security-Scan prueft unter anderem, dass keine `.env`-Dateien oder offensichtlichen Secrets ins Repository geraten.

Aktuelle Repository-Hygiene:

- MIT-Lizenz ist im Repository hinterlegt.
- OP-120 hat einen gitleaks Git-History-Scan ohne Leaks dokumentiert.
- OP-120 hat `npm run security:scan` erfolgreich ausgefuehrt.

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
SMTP_FROM=Food Tracker <food-tracker@luptec.de>
SMTP_TLS_SERVERNAME=
```

Wenn `SMTP_HOST`, Empfaengeradresse oder KI-Key fehlen, laeuft der Scheduler weiter und ueberspringt nur den Mailversand.
`SMTP_TLS_SERVERNAME` kann gesetzt werden, wenn ein interner Relay per IP angesprochen wird, das STARTTLS-Zertifikat aber fuer einen DNS-Namen ausgestellt ist.
Der Readiness-Endpunkt `/api/config/weekly-email/status` zeigt ohne Secrets, ob Zieladresse, SMTP und Analyse-Key vorhanden sind und wann zuletzt versendet wurde.

Optionale SoGO-/CalDAV-Kalenderanbindung fuer die Wochenanalyse:

```env
CALDAV_URL=https://mail.example.com/SOGo/dav/user@example.com/Calendar/personal/
CALDAV_USER=user@example.com
CALDAV_PASS=
CALENDAR_LOOKAHEAD_DAYS=14
```

Die KI bekommt daraus nur freie/volle Zeitbloecke und Tagesrhythmus fuer den naechsten Zeitraum. Termintitel, Beschreibungen und Orte werden nicht in den Prompt aufgenommen.

Der Datenchat arbeitet query-basiert: Explizite Angaben wie `letzte 4 Wochen`, `im Juni`, `seit Januar`, Kalenderwochen und Wochenvergleiche werden deterministisch aufgeloest. Fuer freie Formulierungen plant das Analysemodell ausschliesslich einen `query_tracker_data`-Toolcall; erst danach aggregiert der Server die freigegebenen Tracker-Daten. Der Browser sendet weder Lebensmittel-/Gewichtsdaten noch einen frei waehlbaren Benutzerkontext.

Serverseitige Grenzen:

- maximal 3 Vergleichszeitraeume
- maximal 366 Tage je Zeitraum und 400 Tage insgesamt
- Tagesdetails nur fuer insgesamt maximal 42 Tage, sonst Wochenaggregate
- maximal 12 haeufige Lebensmittel je Zeitraum
- maximal 500 Zeichen je Frage und 6 gekuerzte Chatnachrichten

Ohne klaren Zeitraum nutzt der Chat fuer Gewichtsfragen die letzten 8 Wochen, ansonsten die letzten 4 Wochen, jeweils relativ zur in `Analyse` ausgewaehlten Woche. Jede Antwort und der kompakte Kontexthinweis nennen den tatsaechlich ausgewerteten Zeitraum. Food Tracker ist derzeit als authentifiziertes Single-Tenant-Deployment ausgelegt; Datenabfragen bleiben fest im serverseitigen `default`-Datenbereich und akzeptieren keinen Benutzer-Schluessel aus dem Request.

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

- Im Header per Pfeil/Swipe den Tag waehlen, den kompakten Gewichtsbereich aufklappen und das Koerpergewicht in kg eintragen. Pro Tag wird genau ein Wert gespeichert; erneutes Speichern aktualisiert ihn.
- Im Tab `Protokoll` Lebensmittel suchen oder manuell erfassen.
- Menge, Einheit und Uhrzeit pruefen.
- Eintrag speichern.
- Bei Bedarf Foto hochladen oder eine freie Essensbeschreibung per KI analysieren lassen.

### Analyse

- Im Tab `Analyse` die Woche wechseln.
- Das Gewichtsdiagramm zeigt alle gespeicherten Werte chronologisch. Punkte unterscheiden manuelle Eingaben und Garmin-Importe.
- `Garmin-Gewicht importieren` liest die letzten 365 Tage aus Garmin Connect. Bereits vorhandene manuelle Tageswerte werden nicht ueberschrieben.
- Diagramme zeigen Kalorien und Makros fuer Montag bis Sonntag.
- Gruen bedeutet unter oder auf Ziel, rot bedeutet ueber Ziel.
- `KI-Analyse` erzeugt eine Ampel und strukturierte Abschnitte zu Kurzfazit, Mustern, Timing, Makros, Alkohol, konkreten Lebensmittelempfehlungen, Garmin-Sportkontext und Plan fuer die kommende Woche.
- Im `Datenchat` koennen Fragen zu historischen Zeitraeumen, Wochenvergleichen sowie Gewichts-, Ernaehrungs- und Aktivitaetstrends gestellt werden. Die ausgewaehlte Woche ist der zeitliche Anker; Antworten nennen Abfragezeitraum und Datenluecken und sind Orientierung, keine medizinische Diagnose.
- `Garmin` aktualisiert Tagesverbrauchswerte und importiert Sportaktivitaeten, falls Garmin konfiguriert ist.

### Konfiguration

- Tagesziel und Makro-Preset bestimmen die Basisziele.
- Garmin kann das Kalorienziel pro Tag durch aktive Kalorien erweitern und Sportaktivitaeten fuer die Analyse bereitstellen.
- Die KI-Konfiguration nutzt einen gemeinsamen API-Key, aber separate Modelle fuer Fotoanalyse und Wochenanalyse.
- Wochenmail wird ab Montag 01:00 Uhr Europe/Berlin idempotent fuer die Vorwoche nachgeholt, wenn SMTP, Zieladresse und KI-Key vorhanden sind. Dadurch uebersteht der Job Neustarts oder Ausfaelle im frueheren Ein-Minuten-Fenster; das Versandlog verhindert Doppelversand. `/api/config/weekly-email/status` zeigt die Readiness ohne Secrets.
- Optional kann die Wochenanalyse einen SoGO-/CalDAV-Kalender als reinen Busy-Kontext nutzen, wenn `CALDAV_URL`, `CALDAV_USER` und `CALDAV_PASS` gesetzt sind.

### Backup

- Unter `Konfiguration -> Backup` kann die App-Datenbank exportiert und wieder importiert werden.
- Vor riskanten Updates oder groesseren Tests immer ein Backup exportieren.

## iPhone PWA

1. App-URL in Safari oeffnen.
2. Teilen-Menue oeffnen.
3. `Zum Home-Bildschirm` auswaehlen.
4. App vom Home-Screen starten.

Die PWA nutzt `display: standalone`, iOS-Meta-Tags, Touch-Icons, sichere Viewport-Inset-Abstaende und einen Service Worker fuer App-Shell-Caching. API-Aufrufe bleiben online und werden nicht gecached.

## Garmin-Gewicht: Moeglichkeiten und Grenzen

Die installierte Integration `@gooin/garmin-connect` stellt mit `getWeightRange` einen lesenden Zugriff auf Garmin-Connect-Gewichtswerte bereit. Food Tracker nutzt diese Schnittstelle als Pull-Import:

- Manueller Import in `Analyse -> Gewichtsentwicklung`: maximal 365 Tage pro Abruf.
- Server-Auto-Sync: bei aktiviertem Garmin-Auto-Abruf werden zusaetzlich die letzten 35 Tage nachgezogen.
- Garmin liefert Gewicht in Gramm; Food Tracker validiert, konvertiert und speichert in kg mit einer Nachkommastelle.
- Manuelle Food-Tracker-Werte haben fuer dasselbe Datum Vorrang und werden durch Garmin nicht ersetzt.
- Garmin-Zugangsdaten bleiben wie beim bestehenden Kalorien-/Aktivitaetsabruf serverseitig verschluesselt.

Es gibt bewusst keinen Push zu Garmin. Obwohl die Bibliothek technisch auch eine `updateWeight`-Methode anbietet, ruft Food Tracker sie nirgends auf. In Food Tracker eingegebene Gewichte bleiben lokal; die Garmin-Erweiterung liest ausschliesslich Werte aus Garmin Connect. Garmin Connect ist eine inoffizielle, nicht von Garmin garantierte Webschnittstelle, daher koennen Login, MFA oder API-Aenderungen einen Pull voruebergehend verhindern.

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
