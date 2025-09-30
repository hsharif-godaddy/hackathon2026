#!/bin/bash

# Tool Summaries Debug Mode Helper Script
# Usage: 
#   ./debug-tool-summaries.sh on   # Enable debug mode
#   ./debug-tool-summaries.sh off  # Disable debug mode
#   ./debug-tool-summaries.sh      # Show current status

case "$1" in
  "on")
    echo "🔍 Enabling Tool Summaries Debug Mode..."
    export TOOL_SUMMARY_DEBUG=true
    echo "Set TOOL_SUMMARY_DEBUG=true"
    echo "Start your server now to see detailed tool summary logging."
    echo ""
    echo "Debug logs will show:"
    echo "  • Tool call rendering from full results to summaries"
    echo "  • Integration of tool summaries into conversation history"  
    echo "  • Comparison of original vs summary content lengths"
    echo "  • Tool message processing in both new and legacy paths"
    echo ""
    echo "To make this permanent, add to your .env:"
    echo "TOOL_SUMMARY_DEBUG=true"
    echo ""
    echo "Note: Debug flags are now managed through the centralized features system"
    echo "in src/services/features.ts for consistent configuration."
    ;;
  "off") 
    echo "❌ Disabling Tool Summaries Debug Mode..."
    unset TOOL_SUMMARY_DEBUG
    echo "Unset TOOL_SUMMARY_DEBUG"
    echo "Tool summaries will run normally without debug output."
    ;;
  *)
    echo "Tool Summaries Debug Mode Status:"
    if [ "$TOOL_SUMMARY_DEBUG" = "true" ]; then
      echo "✅ ENABLED - Debug logging is active"
    else
      echo "❌ DISABLED - Normal operation"
    fi
    echo ""
    echo "Usage:"
    echo "  $0 on   # Enable debug mode"
    echo "  $0 off  # Disable debug mode"
    echo ""
    echo "Or set environment variable: TOOL_SUMMARY_DEBUG=true"
    ;;
esac