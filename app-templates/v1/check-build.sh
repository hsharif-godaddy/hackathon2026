#!/bin/bash

# Script to safely check build without breaking dev server
# Usage: ./check-build.sh

echo "🔍 Checking TypeScript and Linting..."

# Check if dev server is running
DEV_PID=$(pgrep -f "next dev" 2>/dev/null)

if [ ! -z "$DEV_PID" ]; then
    echo "⚠️  Dev server is running (PID: $DEV_PID)"
    echo "📋 Running safe checks (TypeScript + Linting only)..."
    
    # Run TypeScript check
    echo "🔄 Checking TypeScript..."
    if npx tsc --noEmit; then
        echo "✅ TypeScript check passed"
    else
        echo "❌ TypeScript check failed"
        exit 1
    fi
    
    # Run linting
    echo "🔄 Running ESLint..."
    if npm run lint; then
        echo "✅ Linting passed"
    else
        echo "❌ Linting failed"
        exit 1
    fi
    
    echo "✅ All checks passed! Dev server is still running."
    
else
    echo "ℹ️  No dev server detected, running full build..."
    
    # Run full build since no dev server is running
    if npm run build; then
        echo "✅ Full build successful!"
    else
        echo "❌ Build failed"
        exit 1
    fi
fi
