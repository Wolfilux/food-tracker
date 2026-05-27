#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

echo "Running credential scan..."

PATTERNS='(gho_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |OPENSSH |EC |DSA |)PRIVATE KEY-----|password[[:space:]]*[:=][[:space:]]*[^[:space:]#]+|api[_-]?key[[:space:]]*[:=][[:space:]]*[^[:space:]#]+|token[[:space:]]*[:=][[:space:]]*[^[:space:]#]+|secret[[:space:]]*[:=][[:space:]]*[^[:space:]#]+)'

if git grep -nIE "$PATTERNS" -- \
  ':!package-lock.json' \
  ':!node_modules' \
  ':!dist' \
  ':!.git' \
  ':!.env.example'; then
  echo
  echo "Potential credential found. Review output above before committing or pushing."
  exit 1
fi

echo "Credential scan passed."

