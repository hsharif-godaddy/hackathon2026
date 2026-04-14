#!/usr/bin/env bash
# Generates RAG test queries for a knowledge base document using gpt-4o-mini
# via the GoDaddy CaaS OpenAI proxy.
#
# Usage (from repo root):
#   knowledge-service/scripts/generate-rag-queries.sh <doc_name> <doc_file> <caas_jwt> [caas_base_url]
#
# Example:
#   knowledge-service/scripts/generate-rag-queries.sh \
#     email knowledge-base/email.md "$CAAS_JWT"
#
# Output: knowledge-service/rag-tests/<doc_name>.json
set -euo pipefail

DOC_NAME="$1"
DOC_FILE="$2"
CAAS_JWT="$3"
CAAS_BASE_URL="${4:-https://api.gocode.caas.gdcorp.tools/v1}"

OUTPUT_FILE="knowledge-service/rag-tests/${DOC_NAME}.json"

if [ ! -f "$DOC_FILE" ]; then
  echo "ERROR: Document file not found: $DOC_FILE"
  exit 1
fi

mkdir -p "knowledge-service/rag-tests"

echo "Generating RAG test queries for: $DOC_NAME"

payload=$(jq -n \
  --arg content "$(cat "$DOC_FILE")" \
  --arg name "$DOC_NAME" \
  '{
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: "You generate test queries for a RAG (retrieval-augmented generation) system. Given a document, output exactly 8 diverse natural-language questions that a user would ask where this specific document should be the top search result. Vary the phrasing: some short, some longer, some technical, some conversational. Return ONLY a valid JSON array of 8 strings. No markdown, no code fences, no explanation."
      },
      {
        role: "user",
        content: ("Document name: " + $name + "\n\nDocument content:\n" + $content)
      }
    ]
  }')

response=$(curl -s -f -X POST "${CAAS_BASE_URL}/chat/completions" \
  -H "Authorization: Bearer ${CAAS_JWT}" \
  -H "Content-Type: application/json" \
  -d "$payload")

raw_content=$(echo "$response" | jq -r '.choices[0].message.content // empty')

if [ -z "$raw_content" ]; then
  echo "ERROR: Empty response from LLM"
  echo "API response: $response"
  exit 1
fi

# Strip markdown code fences if the model included them despite instructions
clean_content=$(printf '%s' "$raw_content" \
  | sed 's/^```json[[:space:]]*//' \
  | sed 's/^```[[:space:]]*//' \
  | sed 's/[[:space:]]*```$//')

if ! echo "$clean_content" | jq -e 'type == "array" and (map(type == "string") | all)' > /dev/null; then
  echo "ERROR: LLM did not return a JSON array of strings"
  echo "Raw content: $raw_content"
  exit 1
fi

queries=$(echo "$clean_content" | jq '.')
query_count=$(echo "$queries" | jq 'length')
if [ "$query_count" -lt 4 ]; then
  echo "ERROR: Expected at least 4 queries, got $query_count"
  exit 1
fi

jq -n \
  --arg docName "$DOC_NAME" \
  --arg generatedAt "$(date -u +%Y-%m-%d)" \
  --argjson queries "$queries" \
  '{docName: $docName, generatedAt: $generatedAt, queries: $queries}' \
  > "$OUTPUT_FILE"

echo "Generated $query_count queries → $OUTPUT_FILE"
cat "$OUTPUT_FILE"
