# Release Strategy

Stand: 2026-06-28

## Aktueller Stand

`dev` ist aktuell der aktive Integrations- und Deploy-Branch fuer Food Tracker.
Das Container-Image `ghcr.io/wolfilux/food-tracker:dev` wird aus diesem Branch
gebaut und ist in `docker-compose.yml` referenziert.

`main` ist derzeit nicht aktuell und nicht release-fuehrend. Nach dem letzten
Abgleich ist `main` 0 Commits vor und `dev` 77 Commits vor `main`.
Bis ein gepruefter Merge oder Fast-Forward erfolgt, sollten Anwender und
Deployments deshalb `dev` als aktuellen Stand betrachten.

## Zielbild

Food Tracker sollte eine einfache GitHub-Flow-Variante nutzen:

1. Neue Arbeit startet auf Feature- oder Ticket-Branches, z.B.
   `feature/OP-121-release-docs`.
2. Aenderungen gehen per Pull Request in `dev`.
3. `dev` ist Integration und Staging. Pushes nach `dev` bauen das
   `ghcr.io/wolfilux/food-tracker:dev` Image.
4. Gepruefte Releases gehen per Pull Request oder Fast-Forward von `dev` nach
   `main`.
5. `main` ist stable und release-fuehrend. Pushes nach `main` bauen das
   `ghcr.io/wolfilux/food-tracker:main` Image.
6. Direkte Pushes nach `main` sind nicht vorgesehen.
7. Release-Tags sind optional und koennen als `vX.Y.Z` gesetzt werden, sobald
   Versionierung und Changelog gebraucht werden.

## Release-Checkliste

Vor einer Uebernahme nach `main` sollten mindestens diese Checks gruen sein:

- `npm run security:scan`
- `npm run build`
- `npm run lint`
- GitHub Actions CI auf dem Release-PR
- Keine `.env`-Dateien, Datenbanken, Keys oder Inhalte aus `data/` im Commit

## CI und Images

Die GitHub Actions CI laeuft auf Pull Requests nach `main` sowie auf Pushes nach
`dev` und `main`. Auf Pushes baut und pusht sie Container-Images nach GHCR mit
Branch-Tag und Commit-SHA:

- `ghcr.io/wolfilux/food-tracker:dev`
- `ghcr.io/wolfilux/food-tracker:main`
- `ghcr.io/wolfilux/food-tracker:<commit-sha>`

## Repository-Hygiene

OP-120 hat die Basis-Hygiene verbessert:

- MIT-Lizenz ergaenzt.
- gitleaks Git-History-Scan ohne Leaks ausgefuehrt.
- `npm run security:scan` erfolgreich ausgefuehrt.
