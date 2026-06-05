# RAG Search Tool

Keyword search tool for finding design inspiration, styles, and trends across curated design knowledge.

## Overview

The RAG (Retrieval-Augmented Generation) Search Tool searches curated design knowledge bases that are loaded fully into memory at startup. Matching is keyword-based: the query is split into terms and each design is scored by the fraction of query terms that appear in its searchable text. There are no embeddings, no external vector database, and no network calls — search runs entirely in-process.

## Features

- **Keyword Search**: Find relevant results by term overlap against design metadata
- **Multiple Collections**: Search across different knowledge bases (designs, classic styles, trends)
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

### Search Including Font Guidance

Font suggestions are embedded in design results. Query the designs collection and look at `value.typography.fonts` in each result:

```typescript
const result = await ragSearchAITool.execute({
  query: 'modern sans-serif fonts for tech startups',
  collection: 'designs',
  limit: 5,
});
// result.results[n].value.typography.fonts contains font name suggestions
```

## Parameters

| Parameter         | Type   | Default   | Description                                                                              |
| ----------------- | ------ | --------- | ---------------------------------------------------------------------------------------- |
| `query`           | string | required  | Natural language search query                                                            |
| `collection`      | string | 'designs' | Knowledge base: `'designs'`/`'design'` (all), `'classic'` (classic styles), `'trends'` |
| `limit`           | number | 5         | Maximum results to return (max: 20)                                                      |
| `score_threshold` | number | 0.7       | Minimum similarity score (0-1, higher = more relevant)                                   |

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

### Fonts

There is no `fonts` collection. Use the `designs` collection with a font-oriented query (e.g., `"sans-serif fonts for tech"`); each result includes font suggestions in `typography.fonts` and `typography.styles`.

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

## Score Threshold Guidelines

Scores are the fraction of query terms found in a design's searchable text (e.g. a 4-term query that matches 3 terms scores `0.75`). A result is returned only when its score is `>= score_threshold`.

- **1.0**: Every query term matched
- **0.7-0.9**: Most query terms matched (recommended default)
- **0.5-0.7**: About half the query terms matched (broader results)
- **< 0.5**: Few query terms matched (may include loosely related results)

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

### Typography & Font Guidance (via `designs` collection)

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
┌──────────────────────┐
│  In-memory design    │
│  data (loaded from   │
│  design-data/*.json) │
└──────────────────────┘
```

Design data is read once from `design-data/classic-styles.json` and `design-data/design-trends-rag.json` on first search, then kept in memory for the process lifetime.

## Dependencies

- **@airo/ai-lib**: Tool creation

No external services. Search is a pure in-process keyword scan; there is no vector database or embedding model.

## Environment Variables

None. The tool reads its data from the bundled `design-data/*.json` files and requires no configuration.

## Performance Considerations

- **First search**: Includes a one-time load + parse of the design-data JSON files
- **Subsequent searches**: In-memory term scan, typically sub-millisecond for the current dataset size

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

  it('should return font guidance via designs collection', async function fontGuidance() {
    const result = await ragSearchAITool.execute({
      query: 'modern sans-serif',
      collection: 'designs',
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
3. Check the collection name is correct (`designs`, `classic`, or `trends`; `fonts` currently has no backing data)

### Data Load Error

**Problem**: Search fails on first call with a file read or JSON parse error

**Solutions**:

1. Confirm `design-data/classic-styles.json` and `design-data/design-trends-rag.json` exist relative to the process working directory
2. Validate the JSON files parse cleanly
3. Review logs for the `rag.init.failed` event, which includes the underlying error
