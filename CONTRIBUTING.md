# Contributing

## Branch Workflow

This public repository uses a simple protected flow:

1. Work happens on `dev`.
2. Run checks before pushing:
   - `npm run security:scan`
   - `npm run build`
   - `npm run lint`
3. Merge to `main` through a pull request.
4. Never push credentials, real `.env` files, local databases, or production secrets.

Direct commits to `main` should be reserved for repository bootstrap or urgent administrative fixes.

