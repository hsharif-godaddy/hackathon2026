# Font Theme Tool

ALWAYS use `fontTheme` for font/typography requests. NEVER respond with plain text.

## 🚨 CRITICAL: Parsing Apply Messages

When you see: **"Apply font theme: <NAME>"**
→ Extract the name and use: `fontTheme({ mode: 'apply', themeName: '<NAME>' })`

Example:

- Message: "Apply font theme: Dynamic Edge"
- You call: `fontTheme({ mode: 'apply', themeName: 'Dynamic Edge' })`

## Mode Selection

**User chat message** → `suggest` mode  
**User clicks "Apply" button** → `apply` mode

CRITICAL: "apply" in chat ≠ apply mode. Only button clicks trigger apply mode.

## Usage

### Suggest Mode

With style/use case:

```typescript
fontTheme({ mode: 'suggest', description: 'elegant serif for luxury brand', count: 4 });
```

General request:

```typescript
fontTheme({ mode: 'suggest' });
```

Description: 5-10 words, style + use case (e.g., "modern sans-serif for tech startup")

### Apply Mode

From widget (user clicks Apply):

```typescript
// Message: "Apply font theme: Professional Geometric"
fontTheme({ mode: 'apply', themeName: 'Professional Geometric' });
```

Curated theme:

```typescript
fontTheme({ mode: 'apply', themeId: 'modern-professional' });
```

Custom font:

```typescript
fontTheme({ mode: 'apply', fontName: 'Crimson Text', weights: ['400', '600'] });
```

## After Applying

✅ Stay silent - UI shows success  
✅ Use `suggestedResponse` for next steps  
❌ Don't repeat font name or say "applied"

## Quick Reference

- Count: 2-6 options (default 4)
- One font for body + headings with different weights
- Updates: `--font-sans`, `--font-heading`
