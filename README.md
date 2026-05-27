# Food Tracker

Public repository for the Food Tracker project.

## Security Baseline

- Do not commit \`.env\` files or credentials.
- Keep real API keys, tokens, database URLs, and passwords out of the repository.
- Use \`.env.example\` only for placeholder variable names.
- Rotate any secret immediately if it is ever committed.

## Status

Initial Vite/React scaffold is available.

## Development

~~~bash
npm install
npm run dev
npm run build
npm run lint
npm run security:scan
~~~

The first version stores entries in browser local storage only. No backend, credentials, or external food database are configured yet.

Before pushing, run `npm run security:scan`. The local checkout also installs a Git pre-push hook for this scan.
