#!/bin/bash

# Simple Dynamic License Checker
# Dynamically detects GoDaddy packages and runs license check
set -e

# Install dependencies
npm install -g license-checker

# Package-specific configurations
if [ "$MATRIX_PACKAGE" = "root" ]; then
  EXCLUSIONS="airo-app-builder-root@1.0.0"
  ALLOWED_LICENSES="MIT;Apache-2.0;BSD-3-Clause;BSD-2-Clause;ISC;BlueOak-1.0.0"
elif [ "$MATRIX_PACKAGE" = "agents" ]; then
  EXCLUSIONS="argparse@2.0.1;tslib@2.8.1"
  ALLOWED_LICENSES="MIT;Apache-2.0;BSD-3-Clause;BSD-2-Clause;ISC;BlueOak-1.0.0"
elif [ "$MATRIX_PACKAGE" = "app" ]; then
  # Dynamically generate exclusions for all GoDaddy-owned packages
  echo "🔍 Detecting GoDaddy-owned packages to exclude..."

  # Get the list of dependencies as JSON using pnpm
  DEP_JSON=$(pnpm list --depth=0 --json 2>/dev/null)

  # Extract GoDaddy-owned packages and their versions using jq
  # Include both dependencies and devDependencies
  GODADDY_DEPS=$(echo "$DEP_JSON" | jq -r '.[0].dependencies // {} | to_entries[] | select(.key | test("^@godaddy")) | "\(.key)@\(.value.version)"')
  GODADDY_DEV_DEPS=$(echo "$DEP_JSON" | jq -r '.[0].devDependencies // {} | to_entries[] | select(.key | test("^@godaddy")) | "\(.key)@\(.value.version)"')

  # Combine dependencies and devDependencies
  GODADDY_LIST=$(echo -e "$GODADDY_DEPS\n$GODADDY_DEV_DEPS" | grep -v '^$')
  # Join the package list with semicolons
  if [ -n "$GODADDY_LIST" ]; then
    GODADDY_PACKAGES=$(echo "$GODADDY_LIST" | paste -sd ";" -)
  else
    GODADDY_PACKAGES=""
  fi
  MANUAL_EXCLUSIONS="website@0.1.0;@ux/alert@2500.3.4;@ux/box@2500.3.4;@ux/button@2500.3.4;@ux/disrupt@2500.3.5;@ux/flyout@2500.3.4;@ux/icon@2500.3.4;@ux/intents@2500.3.2;@ux/menu@2500.3.5;@ux/modal@2500.3.5;@ux/spinner@2500.3.4;@ux/tag@2500.3.4;@ux/tailwind-intents@2500.3.2;@ux/text@2500.3.4;@ux/postcss-intents@2500.3.2;gd-auth@1.4.1;gd-auth-client@2.1.1"
  ALLOWED_LICENSES="MIT;Apache-2.0;BSD-3-Clause;BSD-2-Clause;ISC"
  if [ -n "$GODADDY_PACKAGES" ]; then
    EXCLUSIONS="${GODADDY_PACKAGES};${MANUAL_EXCLUSIONS}"
  else
    EXCLUSIONS="$MANUAL_EXCLUSIONS"
  fi
else
  EXCLUSIONS=""
  ALLOWED_LICENSES="MIT;Apache-2.0;BSD-3-Clause;BSD-2-Clause;ISC"
fi

echo "🚫 Excluding packages: $EXCLUSIONS"
echo "✅ Allowed licenses: $ALLOWED_LICENSES"

# Run license checker
if [ -n "$EXCLUSIONS" ]; then
  license-checker --onlyAllow "$ALLOWED_LICENSES" --excludePackages "$EXCLUSIONS" --summary
  license-checker --onlyAllow "$ALLOWED_LICENSES" --excludePackages "$EXCLUSIONS" --out licenses-report.txt
else
  license-checker --onlyAllow "$ALLOWED_LICENSES" --summary
  license-checker --onlyAllow "$ALLOWED_LICENSES" --out licenses-report.txt
fi
