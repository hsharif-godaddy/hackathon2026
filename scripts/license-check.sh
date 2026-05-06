#!/bin/bash

# License checker using pnpm licenses list.
# Validates all workspace dependencies against an allowlist of SPDX licenses.
# Internal/private packages (GoDaddy, UX, etc.) are excluded by scope prefix.
#
# For non-pnpm projects (e.g. v8-template), falls back to license-checker.
set -e

# Allowed SPDX licenses (including common compound expressions)
ALLOWED_LICENSES=(
  "0BSD"
  "Apache-2.0"
  "BSD"
  "BSD-2-Clause"
  "BSD-3-Clause"
  "BlueOak-1.0.0"
  "CC-BY-4.0"
  "CC0-1.0"
  "ISC"
  "MIT"
  "MIT AND ISC"
  "MIT-0"
  "MPL-2.0"
  "Python-2.0"
  "Unlicence"
  "Unlicense"
  "WTFPL"
  "WTFPL OR ISC"
  "(AFL-2.1 OR BSD-3-Clause)"
  "(BSD-2-Clause OR MIT OR Apache-2.0)"
  "(BSD-3-Clause OR GPL-2.0)"
  "(MIT OR Apache-2.0)"
  "(MIT OR CC0-1.0)"
  "(MIT OR WTFPL)"
  "(MPL-2.0 OR Apache-2.0)"
)

# Internal package prefixes - these use private/custom licenses and are trusted.
INTERNAL_PREFIX_REGEX='^(@airo/|@airo-ux/|@gd-|@godaddy/|@px/|@signals/|@site/|@sso/|@switchboard/|@ux/|@venture/|@wsb/|gd-auth)'

# Packages with missing/incorrect license metadata in package.json.
# Actual licenses verified manually from LICENSE files in each package.
KNOWN_EXCEPTIONS=(
  "@ai-sdk/devtools"          # Apache-2.0 (LICENSE file present, missing package.json field)
  "@browserbasehq/sdk"        # Apache-2.0 (LICENSE file present, missing package.json field)
  "@img/sharp-libvips-darwin-arm64"  # LGPL-3.0-or-later (platform binary, dynamically linked)
  "@img/sharp-libvips-linux-arm64"
  "@img/sharp-libvips-linux-x64"
  "@img/sharp-libvips-linuxmusl-arm64"
  "@img/sharp-libvips-linuxmusl-x64"
  "only"                      # MIT (TJ Holowaychuk, missing metadata)
  "stackframe"                # Unlicense (public domain, LICENSE file present)
)

# --- Fallback for npm projects (e.g. v8-template) ---
# If the current directory has a package-lock.json (and no pnpm-lock.yaml),
# it's an npm project outside the pnpm workspace. Use license-checker directly.
if [ -f package-lock.json ] && [ ! -f pnpm-lock.yaml ]; then
  echo "🔍 npm project detected, using license-checker..."
  if ! command -v license-checker &> /dev/null; then
    npm install -g license-checker
  fi
  ALLOWED_SEMICOLON=$(printf '%s;' "${ALLOWED_LICENSES[@]}")
  ALLOWED_SEMICOLON="${ALLOWED_SEMICOLON%;}"
  license-checker --onlyAllow "$ALLOWED_SEMICOLON" --depth 0 --summary
  license-checker --onlyAllow "$ALLOWED_SEMICOLON" --depth 0 --out licenses-report.txt
  exit $?
fi

# --- Find workspace root ---
# Use git to find the repo root (which is the pnpm workspace root in this monorepo).
WORKSPACE_ROOT=""
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$GIT_ROOT" ] && [ -f "$GIT_ROOT/pnpm-lock.yaml" ]; then
  WORKSPACE_ROOT="$GIT_ROOT"
fi

if [ -z "$WORKSPACE_ROOT" ]; then
  echo "❌ Could not find pnpm workspace root"
  exit 1
fi

# --- pnpm path ---
echo "🔍 Checking licenses..."

LICENSE_JSON=$(pnpm --dir "$WORKSPACE_ROOT" licenses list --json 2>&1) || {
  echo "❌ pnpm licenses list failed:"
  echo "$LICENSE_JSON"
  exit 1
}

# Build jq arrays
EXCEPTIONS_JQ=$(printf '%s\n' "${KNOWN_EXCEPTIONS[@]}" | jq -R . | jq -s .)
ALLOWED_JQ=$(printf '%s\n' "${ALLOWED_LICENSES[@]}" | jq -R . | jq -s .)

# Find violations: packages with disallowed licenses that aren't internal or known exceptions
VIOLATIONS=$(echo "$LICENSE_JSON" | jq -r \
  --argjson allowed "$ALLOWED_JQ" \
  --argjson exceptions "$EXCEPTIONS_JQ" '
  to_entries[]
  | select(.key as $license | $allowed | index($license) | not)
  | .value[]
  | select(.name | test("'"$INTERNAL_PREFIX_REGEX"'") | not)
  | select(.name as $name | $exceptions | index($name) | not)
  | "\(.name)@\(.versions[0]) - license: \(.license // "Unknown")"
')

if [ -n "$VIOLATIONS" ]; then
  echo ""
  echo "❌ License violations found:"
  echo "$VIOLATIONS"
  echo ""
  echo "Allowed licenses: ${ALLOWED_LICENSES[*]}"
  exit 1
fi

# Write report for CI artifact upload
echo "$LICENSE_JSON" | jq -r '
  to_entries[] | "\(.key):\n" + (.value[] | "  \(.name)@\(.versions[0])") + "\n"
' > licenses-report.txt

# Summary
TOTAL=$(echo "$LICENSE_JSON" | jq '[.[][]] | length')
INTERNAL_FILTER='(.name | test("'"$INTERNAL_PREFIX_REGEX"'"))'
INTERNAL_COUNT=$(echo "$LICENSE_JSON" | jq '[.[][] | select('"$INTERNAL_FILTER"')] | length')
echo "✅ All licenses OK ($TOTAL packages checked, $INTERNAL_COUNT internal excluded)"
