#!/bin/bash

# Hot Files Debug Mode Helper Script
# Usage: 
#   ./debug-hot-files.sh on   # Enable debug mode
#   ./debug-hot-files.sh off  # Disable debug mode
#   ./debug-hot-files.sh      # Show current status

case "$1" in
  "on")
    echo "🔍 Enabling Hot Files Debug Mode..."
    export HOT_FILES_DEBUG=true
    echo "Set HOT_FILES_DEBUG=true"
    echo "Start your server now to see detailed hot files logging."
    echo ""
    echo "Debug logs will show:"
    echo "  • File access tracking (reads/modifications)"
    echo "  • Hot files scoring algorithm details"
    echo "  • Token budget calculations" 
    echo "  • Content loading process"
    echo "  • Final context generation"
    echo ""
    echo "To make this permanent, add to your .env:"
    echo "HOT_FILES_DEBUG=true"
    ;;
  "off") 
    echo "❌ Disabling Hot Files Debug Mode..."
    unset HOT_FILES_DEBUG
    echo "Unset HOT_FILES_DEBUG"
    echo "Hot files will run normally without debug output."
    ;;
  *)
    echo "Hot Files Debug Mode Status:"
    if [ "$HOT_FILES_DEBUG" = "true" ]; then
      echo "✅ ENABLED - Debug logging is active"
    else
      echo "❌ DISABLED - Normal operation"
    fi
    echo ""
    echo "Usage:"
    echo "  $0 on   # Enable debug mode"
    echo "  $0 off  # Disable debug mode"
    echo ""
    echo "Or set environment variable: HOT_FILES_DEBUG=true"
    ;;
esac