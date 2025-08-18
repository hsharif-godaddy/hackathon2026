#!/bin/bash

# Test script for @airo/agents API
# Make sure the server is running on port 4000 before running this script

BASE_URL="http://localhost:4000"

echo "🧪 Testing @airo/agents API"
echo "================================"

echo ""
echo "1. Health Check:"
curl -s "$BASE_URL/health" | jq .

echo ""
echo "2. List Available Agents:"
curl -s "$BASE_URL/agents" | jq .

echo ""
echo "3. Get Example Agent Details:"
curl -s "$BASE_URL/agents/example-agent" | jq .

echo ""
echo "4. Get MWP Agent Details:"
curl -s "$BASE_URL/agents/mwp-agent" | jq .



echo ""
echo "5. Chat with Example Agent (non-streaming):"
curl -s -X POST "$BASE_URL/agent/example-agent/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, can you explain what you do?"}' | jq .

echo ""
echo "6. Chat with MWP Agent (non-streaming):"
curl -s -X POST "$BASE_URL/agent/mwp-agent/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, can you help me manage my WordPress site?"}' | jq .

echo ""
echo "7. Streaming Chat with Example Agent (first 10 lines):"
curl -s -X POST "$BASE_URL/agent/example-agent/chat-streaming" \
  -H "Content-Type: application/json" \
  -d '{"message": "Tell me about your capabilities"}' | head -10

echo ""
echo "================================"
echo "✅ API tests completed!"
