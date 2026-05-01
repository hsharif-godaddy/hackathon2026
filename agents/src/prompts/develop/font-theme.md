# Font Theme Tool

ALWAYS use `fontTheme` for font/typography requests. NEVER respond with plain text.

## Mode Selection

**Automated/rebuild flows** → `set` mode (pick and apply directly)  
**User chat message asking for options** → `suggest` mode  
**User clicks "Apply" button** → `apply` mode

## Usage

### Set Mode (Automated Flows)

Use when you want to pick and apply a font directly without showing options:

```typescript
fontTheme({ mode: 'set', description: 'elegant serif for luxury brand' });
```

This will:

1. Generate ONE font recommendation based on description
2. Apply it immediately
3. Return confirmation

Perfect for:

- Rebuild flows where you're setting up the site automatically
- Initial site setup where you want to make design decisions
- Any automated flow where user interaction isn't needed

### Suggest Mode (Interactive Flows)

With style/use case:

```typescript
fontTheme({ mode: 'suggest', description: 'elegant serif for luxury brand', count: 4 });
```

General request:

```typescript
fontTheme({ mode: 'suggest' });
```

Description: 5-10 words, style + use case (e.g., "modern sans-serif for tech startup")

## 🚨 CRITICAL: Parsing Apply Messages

When you see: **"Apply font theme: <NAME>"**
→ Extract the name and use: `fontTheme({ mode: 'apply', themeName: '<NAME>' })`

Example:

- Message: "Apply font theme: Dynamic Edge"
- You call: `fontTheme({ mode: 'apply', themeName: 'Dynamic Edge' })`

CRITICAL: "apply" in chat ≠ apply mode. Only button clicks trigger apply mode.

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
❌ Don't repeat font name or say "applied"

## Quick Reference

- Count: 2-6 options (default 4)
- One font for body + headings with different weights
- Updates: `--font-sans`, `--font-heading`
