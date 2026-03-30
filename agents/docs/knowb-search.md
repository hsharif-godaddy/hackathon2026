# KnowB Search Tool

## Overview

The KnowB Search Tool integrates with GoDaddy's knowledge base API to search for deployment documentation, application setup guides, and technical resources.

## Features

- **Semantic Search**: Finds relevant documentation using natural language queries
- **Score-based Ranking**: Returns results sorted by relevance score
- **Configurable Search**: Control result count and quality thresholds
- **Context-aware Logging**: Tracks searches by application ID when available

## Configuration

### Environment Variables

Required:

- `SSO_JWT`: GoDaddy SSO JWT token for authentication

Optional:

- `KNOWB_API_URL`: Knowledge base API endpoint (defaults to `https://knowb.api.int.test-godaddy.com/v1/search`)

### Example `.env` Configuration

```bash
# Required for KnowB search
SSO_JWT=your_sso_jwt_token_here

# Optional - override default API endpoint
KNOWB_API_URL=https://knowb.api.int.test-godaddy.com/v1/search
```

## Usage

### As AI-Lib Tool (Recommended)

The tool is automatically available in the develop agent:

```typescript
import { knowBSearchAITool } from './tools/ai-lib-tools/knowb-search.js';

// The tool is already registered in develop-agent.ts
// AI agents can use it directly
```

### Tool Parameters

| Parameter        | Type     | Required | Default         | Description                             |
| ---------------- | -------- | -------- | --------------- | --------------------------------------- |
| `query`          | string   | Yes      | -               | Search query describing what to find    |
| `kbNodeIds`      | string[] | No       | `["/airo_sys"]` | Specific knowledge base nodes to search |
| `maxResults`     | number   | No       | 5               | Maximum number of results (1-10)        |
| `scoreThreshold` | number   | No       | 0.35            | Minimum similarity score (0.0-1.0)      |

### Direct Usage

```typescript
import { searchKnowB } from './tools/knowb-search-tool.js';

// Simple search
const result = await searchKnowB('How to publish an app');

// Advanced search with options
const result = await searchKnowB('deployment process', {
  maxResults: 10,
  scoreThreshold: 0.35,
  kbNodeIds: ['/airo_sys'],
});

if (result.success) {
  console.log(`Found ${result.totalResults} results`);
  result.results?.forEach((item) => {
    console.log(`[${item.score}] ${item.location.kbNodeId}`);
    console.log(item.content.text.substring(0, 200));
  });
}
```

## API Response Format

```typescript
{
  success: true,
  totalResults: 3,
  results: [
    {
      location: {
        kbNodeId: "/airo_sys/deployment.md"
      },
      content: {
        text: "# Deployment & Publishing\n## Current Status...",
        type: "TEXT"
      },
      score: 0.4208281,
      metadata: {}
    }
  ]
}
```

## Common Use Cases

### Finding Deployment Information

```typescript
await searchKnowB('How do I deploy my application?');
await searchKnowB('Publishing to production');
await searchKnowB('Environment variables setup');
```

### Configuration and Setup

```typescript
await searchKnowB('Configure database connection');
await searchKnowB('SSL certificate setup');
await searchKnowB('OAuth integration');
```

### Troubleshooting

```typescript
await searchKnowB('Deployment failed error');
await searchKnowB('Server not starting');
await searchKnowB('Build process issues');
```

## Logging

The tool uses structured logging with context awareness:

```typescript
// Logs include:
// - knowb-search.search.start: Search initiated
// - knowb-search.api.request: API request made
// - knowb-search.search.success: Results retrieved
// - knowb-search.search.error: Error occurred
```

## Error Handling

The tool handles various error scenarios:

- **Missing SSO_JWT**: Returns error indicating authentication is not configured
- **Empty Query**: Validates query is non-empty string
- **API Errors**: Captures HTTP errors and response issues
- **Network Failures**: Handles connection and timeout errors

## Integration in Agents

The KnowB search tool is automatically available in the develop agent:

```typescript
// In develop-agent.ts
tools: {
  // ... other tools
  knowBSearch: allAILibTools.knowBSearch,
}
```

AI agents can use it to help users find documentation:

- **User asks**: "How do I publish my app?"
- **Agent uses**: `knowBSearch` tool to search knowledge base
- **Agent provides**: Relevant documentation and step-by-step guides

## Security Considerations

- SSO_JWT tokens are sensitive - never log or expose them
- API URL should point to approved GoDaddy endpoints
- Search queries are logged (not sensitive)
- Results may contain internal documentation

## Testing

```bash
# Run tests with valid SSO_JWT
export SSO_JWT="your_test_token"
npm test -- knowb-search
```

## Troubleshooting

### "SSO_JWT is not configured" Error

**Solution**: Ensure `SSO_JWT` is set in your `.env` file:

```bash
echo "SSO_JWT=your_token" >> .env
```

### API Returns 401 Unauthorized

**Solution**: Your SSO_JWT may be expired. Obtain a new token from GoDaddy SSO.

### No Results Found

**Solution**:

- Try more general queries
- Reduce `scoreThreshold` (e.g., 0.1 instead of 0.2)
- Verify the knowledge base contains relevant documents

### Connection Timeout

**Solution**:

- Check VPN/network connectivity to GoDaddy internal services
- Verify `KNOWB_API_URL` is correct for your environment

## Related Documentation

- [RAG Search Tool](./rag-search-tool.md) - Local vector search
