#!/bin/bash

# Airo Builder - Advanced Setup Runner
# This script runs the TypeScript setup application

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Airo Builder Advanced Setup...${NC}"
echo ""

# Check if we're in the setup directory
if [ ! -f "package.json" ]; then
    echo "Error: Please run this script from the setup/ directory"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}📦 Installing dependencies...${NC}"
    pnpm install
fi

# Run the setup application
echo -e "${GREEN}✨ Launching setup application...${NC}"
pnpm start
