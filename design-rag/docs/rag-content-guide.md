# RAG-Friendly Content Guide for Font Pairings

This document explains the changes made to the font pairing content to optimize it for RAG (Retrieval-Augmented Generation) search.

## Why These Changes Matter

RAG systems work by:

1. Converting your content into numerical vectors (embeddings)
2. Converting user search queries into vectors
3. Finding content whose vectors are most similar to the query

The key insight: **users don't search the way content is traditionally written**.

### The Problem with Original Content

The original descriptions were written in third person, describing what users "should" do:

> "This font pairing should be used by small business owners who want their website to feel playful, approachable, bold, and energetic. Their small business is likely casual, youth-oriented, family-friendly..."

But users search with direct queries like:

- "fonts for a bakery"
- "playful fonts"
- "wedding planner typography"

The third-person framing creates a semantic gap between content and queries.

## Changes Made

### 1. Direct, Keyword-Rich Titles

**Before:** "This font pairing should be used..."

**After:**

```markdown
# Chango + Teachers

A playful, approachable, bold, and energetic font pairing.
```

The title and opening line now contain the key descriptors users search for.

### 2. "Best For" Bullet Lists

**Before:** Prose describing business types in sentences

**After:**

```markdown
## Best For

- Children's boutiques
- Toy stores
- Ice cream shops
- Bakeries
- Family-friendly businesses
```

Bullet lists are more effective for RAG because:

- Each item is a discrete, searchable term
- No filler words diluting the semantic meaning
- Direct match potential with user queries

### 3. Style Keywords Section

**Added:**

```markdown
## Style Keywords

Playful, fun, energetic, bold, approachable, casual, joyful, youthful, friendly, informal, vibrant, cheerful
```

This creates a dense cluster of related terms that improve matching for various query phrasings.

### 4. Concise Target Audience

**Before:** Multiple sentences describing the audience in third person

**After:**

```markdown
## Target Audience

Families with young children, Gen Z consumers, anyone seeking an informal and joyful brand experience.
```

One focused line with key terms.

### 5. Structured YAML Frontmatter

```yaml
---
style: Playful
headerFont: Chango
bodyFont: Teachers
---
```

Metadata enables filtering and structured queries beyond semantic search.

## Content Structure Template

For future font pairing content, use this structure:

```markdown
---
style: [Style Category]
headerFont: [Header Font Name]
bodyFont: [Body Font Name]
---

# [Header Font] + [Body Font]

[One-line description with key style adjectives].

## Best For

- [Business type 1]
- [Business type 2]
- [Business type 3]
- [etc. - aim for 6-10 items]

## Style Keywords

[Comma-separated list of 10-15 relevant adjectives and descriptors]

## Target Audience

[One concise sentence describing who this appeals to]

## Design Pairings

[What colors, layouts, imagery, and design elements work well with these fonts]

## Header Font: [Name]

[Brief technical description of the font's characteristics]

## Body Font: [Name]

[Brief technical description of the font's characteristics]
```

## Tips for Writing RAG-Friendly Content

### Do:

- Use the exact words users would search for
- Front-load important terms (put them early in sections)
- Use bullet lists for enumerable items
- Include synonyms and related terms
- Keep sections focused and concise

### Don't:

- Write in third person ("users should...", "their business...")
- Bury keywords in long prose paragraphs
- Use filler phrases ("It is important to note that...")
- Assume context - be explicit about what this is for

## Testing Your Content

After uploading content to KnowB, test with realistic queries:

```bash
pnpm --filter @airo/design-rag search "your query" -n /airo_design_system/fonts
```

Good queries to test:

- Direct business types: "bakery fonts", "law firm typography"
- Style descriptors: "elegant fonts", "bold modern"
- Combined: "professional healthcare fonts"

If your content doesn't appear in top results for expected queries, consider:

- Adding more keyword variations
- Making the "Best For" list more comprehensive
- Including industry-specific terminology

## Example: Before and After

### Before (Original)

> This font pairing should be used by small business owners who want their website to feel trustworthy, professional, and timeless. Their small business is likely established, credible, and traditional (think law firms, financial advisors, publishing houses, educational consultants, non-profit organizations, or medical practices). Their target audience is discerning professionals and clients who value substance, authority, and institutional credibility over trends.

### After (RAG-Optimized)

```markdown
# Crimson Text + Cardo

A trustworthy, professional, and timeless font pairing.

## Best For

- Law firms
- Financial advisors
- Publishing houses
- Educational consultants
- Non-profit organizations
- Medical practices
- Universities
- Accounting firms
- Insurance agencies

## Style Keywords

Trustworthy, professional, timeless, classic, traditional, authoritative, credible, institutional, established, reliable, conservative, formal

## Target Audience

Discerning professionals and clients who value substance, authority, and institutional credibility over trends.
```

The optimized version:

- Puts searchable terms at the top
- Uses bullet lists for business types
- Adds a dedicated keywords section
- Removes third-person framing
- Is easier to scan and parse

## Questions?

For questions about RAG optimization or font pairing content, contact the engineering team.
