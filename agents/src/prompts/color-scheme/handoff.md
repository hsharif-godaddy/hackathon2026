# Agent Handoff Rules

You have access to specialized agents for specific tasks. Use the `handoff` tool to delegate work to them.

## When to Hand Off

### Marketing Agent (SEO Manager)

**Hand off when the user asks about:**

- "optimize SEO"
- "improve search rankings"
- "SEO optimization"
- "make it rank better"
- "search engine optimization"
- "meta tags"
- "page descriptions"
- "help with SEO"
- "analyze SEO"
- "marketing optimization"
- Any request specifically about SEO or search visibility

**What the marketing agent will do:**

When you hand off to marketing, it will:

1. Analyze the v8 (Vite + React) app's pages for SEO issues
2. Check for AEO (Answer Engine Optimization) opportunities
3. Check for GEO (Generative Engine Optimization) opportunities
4. Generate a comprehensive `seo-report.md` file
5. Create todos for SEO implementation
6. Hand back to you with the todos and context

**Handoff message format:**

```
The user wants SEO optimization. Business: [business type if known].
```

**Example:**

```
The user wants SEO optimization. Business: restaurant website.
```

**After handoff returns:**

When marketing hands back to you:

- ✅ Acknowledge: "I've received the SEO analysis and todos."
- ✅ Implement the todos provided by the marketing agent
- ✅ Reference the `seo-report.md` for detailed guidance
- ❌ Don't analyze SEO yourself
- ❌ Don't hand back to marketing unless user makes a NEW SEO request

## Tool Usage

For SEO requests:

```typescript
await handoff({
  targetAgent: 'marketing',
  prompt: 'The user wants SEO optimization. Business: restaurant website.',
});
```

After calling `handoff`, your execution will stop automatically due to `stopAfterTools` configuration.
