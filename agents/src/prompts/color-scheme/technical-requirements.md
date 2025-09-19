# Technical Requirements

## Color Palette Structure
Each palette must be compatible with v8's semantic CSS variable system using HSL values:
```json
{
  "name": "Descriptive name",
  "variables": {
    "light": {
      "--background": "26 28% 97%",
      "--foreground": "16 29% 15%",
      "--primary": "210 100% 45%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "195 50% 85%", 
      "--secondary-foreground": "195 100% 15%",
      "--accent": "195 60% 50%",
      "--accent-foreground": "0 0% 100%",
      "--muted": "210 40% 95%",
      "--muted-foreground": "215 16% 47%",
      "--card": "26 28% 97%",
      "--card-foreground": "16 29% 15%",
      "--border": "214 32% 91%",
      "--destructive": "0 84% 60%",
      "--chart-1": "210 100% 45%",
      "--chart-2": "195 60% 50%",
      "--chart-3": "180 60% 40%",
      "--sidebar": "210 40% 95%",
      "--sidebar-primary": "210 100% 45%"
    },
    "dark": {
      "--background": "222 84% 4%",
      "--foreground": "210 40% 98%",
      "--primary": "210 100% 55%",
      "...": "complete dark mode variants"
    }
  },
  "tailwindClasses": {
    "primary": "bg-primary text-primary-foreground",
    "secondary": "bg-secondary text-secondary-foreground", 
    "accent": "bg-accent text-accent-foreground",
    "gradients": "bg-gradient-to-r from-primary to-accent"
  }
}
```

## Accessibility Standards
- Ensure WCAG AA compliance (4.5:1 contrast ratio minimum)
- Test text readability on all background colors
- Provide alternative options for colorblind users
- Consider cultural color associations

## Tools Available
- `app_plan`: Store and retrieve app planning data including color palettes
- `file_edit`: Create and update v8 theme CSS files in src/styles/globals.css
- Standard file operations for saving color schemes
- Any other tools needed for the workflow

## v8 Integration Requirements

**CRITICAL**: All color palettes must integrate with v8's semantic color system:

### 1. CSS Variable Format
- Use HSL format without `hsl()` wrapper: `"210 100% 45%"`
- Ensure complete light/dark mode coverage
- Include all required semantic variables (primary, secondary, accent, muted, card, sidebar, chart-1 through chart-5)

### 2. Direct Implementation
- Update CSS variables directly in `src/styles/globals.css`
- Replace the `:root` and `.dark` variable values
- Provide Tailwind class usage examples
- Ensure WCAG AA compliance in both light and dark modes

### 3. Semantic Color Usage
Always provide usage guidelines with semantic classes:
- `bg-primary text-primary-foreground` for main actions
- `bg-secondary text-secondary-foreground` for supporting elements
- `bg-accent text-accent-foreground` for highlights
- `from-primary via-accent to-secondary` for gradients
