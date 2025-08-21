#!/bin/bash

# V3 App Template Setup Script
# This script ensures the project uses the standard npm registry
# regardless of user's local npm configuration
# Prefers npm, with pnpm as alternative

set -e

echo "🚀 Setting up V3 App Template with standard npm registry..."

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Detect package manager and handle potential issues
if command_exists pnpm; then
    PACKAGE_MANAGER="pnpm"
    echo "📦 Using pnpm (preferred)"
    
    # Test pnpm to ensure it's working (fix for corepack signature issues)
    if ! pnpm --version >/dev/null 2>&1; then
        echo "⚠️  pnpm detected but not working, trying to fix..."
        corepack disable pnpm >/dev/null 2>&1 || true
        npm install -g pnpm@latest >/dev/null 2>&1 || true
        
        # Test again
        if ! pnpm --version >/dev/null 2>&1; then
            echo "❌ pnpm still not working, falling back to npm"
            PACKAGE_MANAGER="npm"
        else
            echo "✅ pnpm fixed and ready"
        fi
    fi
elif command_exists npm; then
    PACKAGE_MANAGER="npm"
    echo "📦 Using npm (fallback)"
else
    echo "❌ Neither npm nor pnpm found. Please install Node.js and npm."
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

# Install dependencies with explicit registry and error handling
echo "⬇️  Installing dependencies with $PACKAGE_MANAGER..."
if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
    if ! pnpm install --registry https://registry.npmjs.org/; then
        echo "❌ pnpm install failed, falling back to npm..."
        PACKAGE_MANAGER="npm"
        npm install --registry https://registry.npmjs.org/
    fi
else
    npm install --registry https://registry.npmjs.org/
fi

# Run type checking and linting
echo "✅ Verifying setup..."
if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
    echo "Running type check..."
    pnpm run type-check
    echo "Running linter..."
    pnpm run lint
else
    echo "Running type check..."
    npm run type-check
    echo "Running linter..."
    npm run lint
fi

# Initialize shadcn/ui if components.json doesn't exist yet
if [ ! -f "components.json" ]; then
    echo "🎨 Initializing shadcn/ui..."
    if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
        pnpm dlx shadcn@latest init --yes
    else
        npx shadcn@latest init --yes
    fi
    echo "✅ shadcn/ui initialized"
else
    echo "✅ shadcn/ui already configured (components.json exists)"
fi

echo "🎉 V3 App Template setup complete!"
echo ""
echo "Available commands:"
if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
    echo "  pnpm run dev          - Start development servers with automatic port detection"
    echo "  pnpm run dev:client   - Start client development server only"
    echo "  pnpm run dev:server   - Start server development server only"
    echo "  pnpm run build        - Build for production"
    echo "  pnpm run preview      - Preview production build"
    echo "  pnpm run test         - Run tests"
    echo "  pnpm run lint         - Run ESLint"
    echo "  pnpm run format       - Format code with Prettier"
    echo "  pnpm run type-check   - Run TypeScript type checking"
else
    echo "  npm run dev          - Start development servers with automatic port detection"
    echo "  npm run dev:client   - Start client development server only"
    echo "  npm run dev:server   - Start server development server only"
    echo "  npm run build        - Build for production"
    echo "  npm run preview      - Preview production build"
    echo "  npm run test         - Run tests"
    echo "  npm run lint         - Run ESLint"
    echo "  npm run format       - Format code with Prettier"
    echo "  npm run type-check   - Run TypeScript type checking"
fi
echo ""
echo "Get started:"
echo "  $PACKAGE_MANAGER run dev"
echo ""
