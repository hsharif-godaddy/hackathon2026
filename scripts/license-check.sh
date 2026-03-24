#!/bin/bash

# Simple Dynamic License Checker
# Dynamically detects internal packages and runs license check
set -e

# Install license-checker if not already available
if ! command -v license-checker &> /dev/null; then
  echo "📦 Installing license-checker..."
  npm install -g license-checker
fi

# Define allowed licenses globally
ALLOWED_LICENSES="MIT;Apache-2.0;0BSD;BSD-3-Clause;BSD-2-Clause;ISC;BlueOak-1.0.0;Python-2.0;Unlicense;CC0-1.0;CC-BY-4.0;MPL-2.0"

# Dynamically detect and exclude internal packages (@airo-ux/*, @godaddy/*, @ux/*, gd-*)
echo "🔍 Detecting internal packages to exclude..."

# Get the list of dependencies as JSON using pnpm
DEP_JSON=$(pnpm list --depth=0 --json 2>/dev/null)

# Extract internal packages (@airo-ux/*, @godaddy/*, @ux/*, gd-*) and their versions using jq
# Include both dependencies and devDependencies
INTERNAL_DEPS=$(echo "$DEP_JSON" | jq -r '.[0].dependencies // {} | to_entries[] | select(.key | test("^@airo-ux|^@godaddy|^@ux|^gd-|^@venture")) | "\(.key)@\(.value.version)"')
INTERNAL_DEV_DEPS=$(echo "$DEP_JSON" | jq -r '.[0].devDependencies // {} | to_entries[] | select(.key | test("^@airo-ux|^@godaddy|^@ux|^gd-|^@venture")) | "\(.key)@\(.value.version)"')

# Combine dependencies and devDependencies
INTERNAL_LIST=$(echo -e "$INTERNAL_DEPS\n$INTERNAL_DEV_DEPS" | grep -v '^$' || true)

# Join the package list with semicolons
if [ -n "$INTERNAL_LIST" ]; then
  INTERNAL_PACKAGES=$(echo "$INTERNAL_LIST" | paste -sd ";" -)
else
  INTERNAL_PACKAGES=""
fi

# Package-specific manual exclusions (including transitive internal dependencies)
# Also set check depth (0 = direct dependencies only, no limit = all transitive deps)
if [ "$MATRIX_PACKAGE" = "root" ]; then
  MANUAL_EXCLUSIONS="airo-app-builder-root@1.0.0;gd-auth-client@2.1.1"
  CHECK_DEPTH=""
elif [ "$MATRIX_PACKAGE" = "agents" ]; then
  MANUAL_EXCLUSIONS="tslib@2.8.1;gd-auth@1.4.1;gd-auth-client@2.1.1;@godaddy/agent-observability-events@1.4.0;@godaddy/goknowb-client@1.0.8;@godaddy/agent-otel-sdk@1.0.1;@signals/otel-sdk@0.1.1"
  CHECK_DEPTH=""
elif [ "$MATRIX_PACKAGE" = "app" ]; then
  MANUAL_EXCLUSIONS="website@0.1.0;@wsb/image-manager-loader@1.3.0;@godaddy/agent-observability-events@1.4.0;@godaddy/agent-otel-sdk@1.0.1;@signals/otel-sdk@0.1.1;@px/checkouts@1.7.2;@site/buttons@6.3.11;@site/domain-services@4.5.14"
  CHECK_DEPTH=""
elif [ "$MATRIX_PACKAGE" = "v8-template" ]; then
  MANUAL_EXCLUSIONS=""
  CHECK_DEPTH="--depth 0"  # Only check direct dependencies for v8-template
else
  MANUAL_EXCLUSIONS="gd-auth-client@2.1.1;@godaddy/agent-observability-events@1.4.0;@godaddy/agent-otel-sdk@1.0.1;@signals/otel-sdk@0.1.1"
  CHECK_DEPTH=""
fi

# Combine internal packages with manual exclusions
if [ -n "$INTERNAL_PACKAGES" ] && [ -n "$MANUAL_EXCLUSIONS" ]; then
  EXCLUSIONS="${INTERNAL_PACKAGES};${MANUAL_EXCLUSIONS}"
elif [ -n "$INTERNAL_PACKAGES" ]; then
  EXCLUSIONS="$INTERNAL_PACKAGES"
elif [ -n "$MANUAL_EXCLUSIONS" ]; then
  EXCLUSIONS="$MANUAL_EXCLUSIONS"
else
  EXCLUSIONS=""
fi

echo "🚫 Excluding packages: $EXCLUSIONS"
echo "✅ Allowed licenses: $ALLOWED_LICENSES"
echo "🔍 Check depth: ${CHECK_DEPTH:-all dependencies}"

# Run license checker
if [ -n "$EXCLUSIONS" ]; then
  license-checker --onlyAllow "$ALLOWED_LICENSES" --excludePackages "$EXCLUSIONS" $CHECK_DEPTH --summary
  license-checker --onlyAllow "$ALLOWED_LICENSES" --excludePackages "$EXCLUSIONS" $CHECK_DEPTH --out licenses-report.txt
else
  license-checker --onlyAllow "$ALLOWED_LICENSES" $CHECK_DEPTH --summary
  license-checker --onlyAllow "$ALLOWED_LICENSES" $CHECK_DEPTH --out licenses-report.txt
fi
