#!/bin/bash

# Project Setup Script
# This script ensures the project uses the standard npm registry
# regardless of user's local npm configuration
# Prefers pnpm if available, falls back to npm

set -e

echo "🚀 Setting up project with standard npm registry..."

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Detect package manager
if command_exists pnpm; then
    PACKAGE_MANAGER="pnpm"
    echo "📦 Using pnpm (detected)"
elif command_exists npm; then
    PACKAGE_MANAGER="npm"
    echo "📦 Using npm (fallback)"
else
    echo "❌ Neither pnpm nor npm found. Please install a package manager."
    exit 1
fi

# Configure registry for this project
echo "🔧 Configuring npm registry..."
if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
    # Set pnpm registry for this project
    pnpm config set registry https://registry.npmjs.org/ --location project
    echo "✅ pnpm registry configured"
else
    # Set npm registry for this project
    npm config set registry https://registry.npmjs.org/ --location project
    echo "✅ npm registry configured"
fi

# Install dependencies with explicit registry
echo "⬇️  Installing dependencies with $PACKAGE_MANAGER..."
if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
    pnpm install --registry https://registry.npmjs.org/
else
    npm install --registry https://registry.npmjs.org/
fi

# Verify installation
echo "✅ Verifying setup..."
if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
    pnpm run check
else
    npm run check
fi

echo "🎉 Project setup complete!"
echo ""
echo "Available commands:"
if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
    echo "  pnpm run dev          - Start development server"
    echo "  pnpm run dev:turbo    - Start development server with Turbopack"
    echo "  pnpm run build        - Type check and lint"
    echo "  pnpm run build:prod   - Production build"
    echo "  pnpm setup            - Re-run this setup process"
else
    echo "  npm run dev          - Start development server"
    echo "  npm run dev:turbo    - Start development server with Turbopack"
    echo "  npm run build        - Type check and lint"
    echo "  npm run build:prod   - Production build"
    echo "  npm run setup        - Re-run this setup process"
fi
echo ""
