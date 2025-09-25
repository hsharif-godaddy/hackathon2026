#!/bin/bash

# Simple Dynamic License Checker
# Dynamically detects GoDaddy packages and runs license check
# NOTE: This script requires either sudo privileges or root access to install dependencies (jq).
set -e

# Detect package manager
if command -v pnpm &> /dev/null && [ -f "pnpm-lock.yaml" ] || [ -f "pnpm-workspace.yaml" ]; then
  PACKAGE_MANAGER="pnpm"
  echo "📦 Using pnpm package manager"
elif command -v yarn &> /dev/null && [ -f "yarn.lock" ]; then
  PACKAGE_MANAGER="yarn"
  echo "📦 Using yarn package manager"
else
  PACKAGE_MANAGER="npm"
  echo "📦 Using npm package manager"
fi

# Install dependencies (always use npm for global installs)
npm install -g license-checker
if ! command -v jq &> /dev/null; then
  echo "Installing jq..."
  if command -v sudo &> /dev/null; then
    sudo apt-get update && sudo apt-get install -y jq
  elif [ "$(id -u)" -eq 0 ]; then
    apt-get update && apt-get install -y jq
  else
    echo "Error: 'jq' is not installed and neither 'sudo' is available nor running as root. Please install 'jq' manually." >&2
    exit 1
  fi
else
  echo "jq already available"
fi

# Package-specific configurations
if [ "$MATRIX_PACKAGE" = "agents" ]; then
  EXCLUSIONS="argparse@2.0.1;tslib@2.8.1"
  ALLOWED_LICENSES="MIT;Apache-2.0;BSD-3-Clause;BSD-2-Clause;ISC;BlueOak-1.0.0"
elif [ "$MATRIX_PACKAGE" = "app" ]; then
  # Dynamically generate exclusions for all GoDaddy-owned packages
  echo "🔍 Detecting GoDaddy-owned packages to exclude..."
  
  # Get the list of dependencies as JSON using the appropriate package manager
  if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
    # Use pnpm list which works better with pnpm workspaces
    DEP_JSON=$(pnpm list --depth=0 --json 2>/dev/null)
  elif [ "$PACKAGE_MANAGER" = "yarn" ]; then
    # Use yarn list for yarn workspaces
    DEP_JSON=$(yarn list --depth=0 --json 2>/dev/null)
  else
    # Use npm list for npm projects
    DEP_JSON=$(npm list --depth=0 --json 2>/dev/null)
  fi
  
  # Extract GoDaddy-owned packages and their versions using jq
  # Handle both npm (object) and pnpm/yarn (array) JSON formats
  # Include both dependencies and devDependencies
  if [ "$PACKAGE_MANAGER" = "pnpm" ] || [ "$PACKAGE_MANAGER" = "yarn" ]; then
    # pnpm/yarn returns an array, get the first element
    GODADDY_DEPS=$(echo "$DEP_JSON" | jq -r '.[0].dependencies // {} | to_entries[] | select(.key | test("^(@godaddy|@ux|gd-)")) | "\(.key)@\(.value.version)"')
    GODADDY_DEV_DEPS=$(echo "$DEP_JSON" | jq -r '.[0].devDependencies // {} | to_entries[] | select(.key | test("^(@godaddy|@ux|gd-)")) | "\(.key)@\(.value.version)"')
  else
    # npm returns a single object
    GODADDY_DEPS=$(echo "$DEP_JSON" | jq -r '.dependencies // {} | to_entries[] | select(.key | test("^(@godaddy|@ux|gd-)")) | "\(.key)@\(.value.version)"')
    GODADDY_DEV_DEPS=$(echo "$DEP_JSON" | jq -r '.devDependencies // {} | to_entries[] | select(.key | test("^(@godaddy|@ux|gd-)")) | "\(.key)@\(.value.version)"')
  fi
  
  # Combine dependencies and devDependencies
  GODADDY_LIST=$(echo -e "$GODADDY_DEPS\n$GODADDY_DEV_DEPS" | grep -v '^$')
  # Join the package list with semicolons
  if [ -n "$GODADDY_LIST" ]; then
    GODADDY_PACKAGES=$(echo "$GODADDY_LIST" | paste -sd ";" -)
  else
    GODADDY_PACKAGES=""
  fi
  MANUAL_EXCLUSIONS="website@0.1.0"
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
