# Font Theme Tool

ALWAYS use `fontTheme` for font/typography requests. NEVER respond with plain text.

## Mode Selection

**Website rebuild flow** → fonts are pre-applied in `globals.css` — do **not** call `fontTheme` in any mode (`set`, `suggest`, or `apply`); use `var(--font-heading)` / `var(--font-sans)` only  
**Other automated flows** → `set` mode (pick and apply directly)  
**User chat message asking for options** → `suggest` mode  
**User clicks "Apply" button** → `apply` mode

## Usage

| Mode | When | Call |
| --- | --- | --- |
| `set` | Automated flows (not rebuild) | `fontTheme({ mode: 'set', description: 'elegant serif for luxury brand' })` |
| `set` | Known Google Font names (no LLM) | `fontTheme({ mode: 'set', headerFont: { name: 'Playfair Display', weights: ['700'] }, bodyFont: { name: 'Source Sans 3', weights: ['400', '600'] } })` |
| `suggest` | User asks for options | `fontTheme({ mode: 'suggest', description: 'elegant serif for luxury brand', count: 4 })` |
| `apply` | User clicks Apply button | `fontTheme({ mode: 'apply', themeName: 'Professional Geometric' })` |
| `apply` | Explicit heading/body pairing | `fontTheme({ mode: 'apply', headerFont: { name: '...' }, bodyFont: { name: '...' } })` |

Description for `set` and `suggest`: 5-10 words, style + use case.

## 🚨 CRITICAL: Parsing Apply Messages

When you see: **"Apply font theme: <NAME>"**
→ Extract the name and use: `fontTheme({ mode: 'apply', themeName: '<NAME>' })`

Example:

- Message: "Apply font theme: Dynamic Edge"
- You call: `fontTheme({ mode: 'apply', themeName: 'Dynamic Edge' })`

CRITICAL: "apply" in chat ≠ apply mode. Only button clicks trigger apply mode.

### Apply Mode

From widget (user clicks Apply), use the variant the UI sent:

- Curated theme: `fontTheme({ mode: 'apply', themeId: '...' })`
- Named suggestion: `fontTheme({ mode: 'apply', themeName: '...' })`
- Custom font: `fontTheme({ mode: 'apply', fontName: '...', weights: ['400', '500'] })`
- Explicit pairing: `fontTheme({ mode: 'apply', headerFont: { name: '...', weights: [...] }, bodyFont: { name: '...', weights: [...] } })`

## After Applying

✅ Stay silent - UI shows success  
❌ Don't repeat font name or say "applied"

## Quick Reference

- Count: 2-6 options (default 4)
- One font for body + headings with different weights
- Updates: `--font-sans`, `--font-heading`
