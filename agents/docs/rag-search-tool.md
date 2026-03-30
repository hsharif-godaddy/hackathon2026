# RAG Search Tool

Semantic search tool for finding design inspiration, styles, and Google Fonts using vector similarity.

## Overview

The RAG (Retrieval-Augmented Generation) Search Tool provides semantic search capabilities across curated design knowledge bases. It uses vector embeddings to find relevant design styles, trends, and typography based on natural language queries.

## Features

- **Semantic Search**: Find relevant results based on meaning, not just keywords
- **Multiple Collections**: Search across different knowledge bases (designs, fonts)
- **Configurable Relevance**: Adjust score threshold for more or fewer results
- **Rich Metadata**: Results include detailed design characteristics, colors, typography, and use cases

## Usage

### Basic Search

```typescript
import { ragSearchAITool } from './tools/ai-lib-tools/rag-search.js';

// Search for design inspiration
const result = await ragSearchAITool.execute({
  query: 'minimalist professional design',
  collection: 'designs',
  limit: 5,
  score_threshold: 0.7,
});
```

### Search for Fonts

```typescript
// Search for Google Fonts
const fonts = await ragSearchAITool.execute({
  query: 'modern sans-serif fonts for tech startups',
  collection: 'fonts',
  limit: 10,
  score_threshold: 0.6,
});
```

## Parameters

| Parameter         | Type   | Default   | Description                                            |
| ----------------- | ------ | --------- | ------------------------------------------------------ |
| `query`           | string | required  | Natural language search query                          |
| `collection`      | string | 'designs' | Knowledge base to search ('designs' or 'fonts')        |
| `limit`           | number | 5         | Maximum results to return (max: 20)                    |
| `score_threshold` | number | 0.7       | Minimum similarity score (0-1, higher = more relevant) |

## Collections

### `designs` Collection

Contains curated design styles and trends including:

- Classic design styles (Brutalism, Swiss Design, Art Deco, etc.)
- Modern design trends (Glassmorphism, Neumorphism, etc.)
- Visual characteristics
- Color schemes
- Typography guidance
- Layout principles
- Industry use cases

### `fonts` Collection

Contains Google Fonts data including:

- Font names and categories
- Visual characteristics
- Use cases and industries
- Font pairing suggestions
- Style descriptions

## Response Format

### Design Results

```typescript
{
  success: true,
  results: [
    {
      key: 'design.classic-style.brutalism',
      score: 0.89,
      value: {
        name: 'Brutalism',
        type: 'classic-style',
        description: '...',
        visualCharacteristics: ['Bold', 'Raw', 'Geometric'],
        colors: {
          schemes: ['Monochrome', 'High contrast'],
          guidance: 'Use stark contrasts...'
        },
        typography: {
          styles: ['Heavy sans-serif', 'Monospace'],
          fonts: ['Roboto Mono', 'Space Mono'],
          guidance: 'Bold, impactful typography...'
        },
        useCases: ['Tech', 'Creative agencies'],
        industries: ['Technology', 'Design'],
        keyElements: ['Geometric shapes', 'Grid systems']
      }
    }
  ]
}
```

### Font Results

```typescript
{
  success: true,
  results: [
    {
      key: 'font.inter',
      score: 0.92,
      value: {
        name: 'Inter',
        category: 'sans-serif',
        description: 'Modern, clean, excellent readability',
        characteristics: ['Geometric', 'Neutral', 'Versatile'],
        useCases: ['UI design', 'Tech products', 'Dashboards'],
        pairsWith: ['Merriweather', 'Lora', 'Georgia'],
        variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900']
      }
    }
  ]
}
```

## Score Threshold Guidelines

- **0.9+**: Very high relevance (exact matches)
- **0.7-0.9**: High relevance (recommended default)
- **0.5-0.7**: Moderate relevance (broader results)
- **< 0.5**: Low relevance (may include unrelated results)

## Error Handling

```typescript
try {
  const result = await ragSearchAITool.execute({ query: 'modern design' });

  if (!result.success) {
    console.error('Search failed:', result.error);
  }

  if (!result.results || result.results.length === 0) {
    console.log('No results found, try broader search terms');
  }
} catch (error) {
  console.error('Tool execution error:', error);
}
```

## Example Queries

### Design Inspiration

- "minimalist color schemes"
- "professional corporate design trends"
- "playful colorful design for children"
- "modern e-commerce layout principles"
- "healthcare app visual style"

### Font Search

- "modern sans-serif fonts for tech"
- "elegant serif fonts for luxury brands"
- "readable fonts for long-form content"
- "geometric fonts for logos"
- "monospace fonts for code editors"

## Integration with Agents

### Design Agent Example

```typescript
import { createTool } from '@airo/ai-lib';
import { allAILibTools } from './tools/ai-lib-tools/index.js';

const designAgent = {
  name: 'Design Agent',
  tools: {
    ragSearch: allAILibTools.ragSearch,
    imageSearch: allAILibTools.imageSearch,
    memorySet: allAILibTools.memorySet,
  },
};
```

## Architecture

```
┌─────────────────┐
│   RAG Search    │
│   Tool (AI-Lib) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    RAG Tool     │
│  (Core Logic)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Qdrant Service  │
│ (Vector Search) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Qdrant Database │
│  (Vector Store) │
└─────────────────┘
```

## Dependencies

- **@airo/ai-lib**: Tool creation and embedding generation
- **@qdrant/js-client-rest**: Vector database client
- **OpenAI text-embedding-3-small**: Embedding model (1536 dimensions)

## Environment Variables

```bash
# Required
QDRANT_URL=http://localhost:6333

# Optional (for OpenAI embeddings)
OPENAI_API_KEY=your-api-key-here
```

## Performance Considerations

- **Embedding Generation**: ~100-200ms per query
- **Vector Search**: ~10-50ms depending on collection size
- **Total Latency**: ~150-300ms per search

## Best Practices

1. **Use Specific Queries**: More specific queries yield better results

   - ✅ "modern minimalist healthcare app design"
   - ❌ "design"

2. **Adjust Score Threshold**: Lower threshold for exploration, higher for precision

   - Exploration: `score_threshold: 0.5`
   - Precision: `score_threshold: 0.8`

3. **Limit Results**: Request only what you need

   - Initial search: `limit: 5`
   - Detailed exploration: `limit: 10-20`

4. **Handle Empty Results**: Always provide fallback logic

   ```typescript
   if (!results || results.length === 0) {
     // Use default design system or ask for clarification
   }
   ```

5. **Cache Results**: Store frequently searched terms to reduce API calls

## Testing

```typescript
import { ragSearchAITool } from './rag-search.js';
import { describe, it } from 'node:test';
import assume from 'assume';

describe('RAG Search Tool', function tests() {
  it('should search designs successfully', async function searchDesigns() {
    const result = await ragSearchAITool.execute({
      query: 'minimalist design',
      collection: 'designs',
      limit: 5,
    });

    assume(result.success).equals(true);
    assume(result.results).exists();
    assume(result.results.length).is.greaterThan(0);
  });

  it('should search fonts successfully', async function searchFonts() {
    const result = await ragSearchAITool.execute({
      query: 'modern sans-serif',
      collection: 'fonts',
      limit: 5,
    });

    assume(result.success).equals(true);
    assume(result.results).exists();
  });

  it('should respect score threshold', async function scoreThreshold() {
    const result = await ragSearchAITool.execute({
      query: 'brutalism',
      score_threshold: 0.9,
      limit: 10,
    });

    if (result.results) {
      result.results.forEach((r) => {
        assume(r.score).is.greaterThan(0.9);
      });
    }
  });
});
```

## Troubleshooting

### No Results Found

**Problem**: Search returns empty results

**Solutions**:

1. Lower the `score_threshold` (try 0.5)
2. Use broader search terms
3. Check collection name is correct ('designs' or 'fonts')
4. Verify Qdrant is running and collections are populated

### Qdrant Connection Error

**Problem**: Cannot connect to Qdrant

**Solutions**:

1. Check `QDRANT_URL` environment variable
2. Verify Qdrant service is running: `curl http://localhost:6333/health`
3. Check Docker container: `docker ps | grep qdrant`
4. Review logs: `docker logs qdrant`

### Slow Response Times

**Problem**: Searches take too long

**Solutions**:

1. Reduce `limit` parameter
2. Check Qdrant performance metrics
3. Ensure embeddings are being cached
4. Consider using a dedicated Qdrant instance
