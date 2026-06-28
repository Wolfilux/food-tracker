#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

echo "Running credential scan..."

PATTERNS='(gho_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |OPENSSH |EC |DSA |)PRIVATE KEY-----|(^|[^[:alnum:]_])(password|api[_-]?key|token|secret)[[:space:]]*[:=][[:space:]]*[^[:space:]#]+)'

matches="$(git grep -nIE "$PATTERNS" -- \
  ':!package-lock.json' \
  ':!node_modules' \
  ':!dist' \
  ':!.git' \
  ':!.env.example' || true)"

matches="$(printf '%s\n' "$matches" | grep -Ev '\$\{\{[[:space:]]*secrets\.[A-Za-z0-9_]+[[:space:]]*\}\}' || true)"

if [ -n "$matches" ]; then
  printf '%s\n' "$matches"
  echo
  echo "Potential credential found. Review output above before committing or pushing."
  exit 1
fi

echo "Credential scan passed."
