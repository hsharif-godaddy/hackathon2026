# Design RAG

Experimental RAG data processing pipelines for KnowB knowledge base.

## Overview

This package provides CLI tools and utilities for:

- **Uploading** content to KnowB knowledge base
- **Searching** KnowB using semantic similarity
- **Processing** data files for RAG pipelines

Use this package for experimenting with different RAG datasets without polluting the main agents codebase.

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Configure environment:

```bash
cp .env.example .env
# Edit .env with your SSO_JWT token
```

## CLI Commands

### Upload

Upload files to KnowB:

```bash
# Upload a markdown file
pnpm upload ./data/guide.md --node /airo_info

# Upload with custom resource ID
pnpm upload ./data/guide.md --id my-guide --node /airo_info

# Upload JSON items (each item becomes a separate document)
pnpm upload ./data/styles.json --node /airo_design

# Upload and sync
pnpm upload ./data/guide.md --node /airo_info --sync
```

Options:

- `-n, --node <kbNodeId>` - Target KB node (default: /airo_info)
- `-i, --id <resourceId>` - Resource ID (default: filename)
- `-s, --strategy <type>` - Chunking: KNOWB001, KNOWB002, KNOWBAOSSSEMANTIC300
- `--json-transform <field>` - For JSON: field to use as content
- `--json-id-field <field>` - For JSON: field to use as ID
- `--sync` - Trigger sync after upload

### Search

Search KnowB knowledge base:

```bash
# Basic search
pnpm search "modern minimalist design"

# Search specific node
pnpm search "typography guidelines" --node /airo_design

# Adjust results
pnpm search "color schemes" --max 10 --threshold 0.5

# Output as JSON
pnpm search "fonts" --json
```

Options:

- `-n, --node <kbNodeId>` - KB node to search (default: /airo_info)
- `-m, --max <number>` - Maximum results (default: 5)
- `-t, --threshold <number>` - Score threshold 0-1 (default: 0.35)
- `--json` - Output as JSON

### Process

Transform data files for RAG:

```bash
# Process and output as JSON
pnpm process ./raw/trends.json

# Extract specific fields
pnpm process ./raw/trends.json --extract "name,description,useCases"

# Output as markdown
pnpm process ./raw/trends.json --format markdown

# Format for KnowB upload
pnpm process ./raw/trends.json --format knowb -o ./processed/trends-knowb.json
```

Options:

- `-o, --output <file>` - Output file
- `-f, --format <type>` - Output format: json, markdown, knowb
- `--extract <fields>` - Comma-separated fields to extract
- `--flatten` - Flatten nested objects
- `--add-metadata` - Add processing metadata

## Programmatic Usage

```typescript
import { KnowBClient } from "@airo/design-rag";

const client = new KnowBClient();

// Search
const results = await client.search({
  query: "modern design trends",
  kbNodeIds: ["/airo_design"],
  maxResults: 5,
  scoreThreshold: 0.35,
});

// Upload
await client.upload({
  kbNodeId: "/airo_design",
  resourceId: "trend-brutalism",
  content: "# Brutalism\n\nRaw, unpolished design aesthetic...",
  kbStrategy: "KNOWB002", // No chunking
});

// Delete
await client.delete({
  kbNodeId: "/airo_design",
  resourceId: "trend-brutalism",
});

// Sync
await client.sync("/airo_design");
```

## KnowB Node Structure

Recommended node structure for design RAG:

```
/airo_info         - General Airo documentation (existing)
/airo_design       - Design styles, trends, guidelines
/airo_fonts        - Font/typography data
/airo_media        - Media analysis cache (existing)
```

## Authentication

### Local Development

Get an SSO JWT token from an authenticated browser session and set in `.env`:

```bash
SSO_JWT=your-token-here
```

### Hosted/Production

Use S2S authentication:

```bash
GOCODE_USE_S2S_AUTH=true
SSO_HOST=sso.godaddy.com
```

## Example: Design Trends Pipeline

```bash
# 1. Process raw design trends data
pnpm process ./raw/design-trends.json \
  --extract "name,description,visualStyle,keyCharacteristics,useCases" \
  --format knowb \
  -o ./processed/trends-knowb.json

# 2. Upload to KnowB
pnpm upload ./processed/trends-knowb.json \
  --node /airo_design \
  --sync

# 3. Test search
pnpm search "minimalist modern" --node /airo_design
```

## Related

- `agents/src/tools/rag-tool.ts` - Generic in-memory RAG tool
- `agents/scripts/knowb-cli.ts` - Agents KnowB CLI
- `packages/design-extractor/` - PDF design extraction (legacy)
- `.github/workflows/knowledge_base.yml` - KnowB upload workflow
