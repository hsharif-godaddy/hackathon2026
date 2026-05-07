## Color System

All colors use CSS variables in `src/styles/globals.css`. Always use variables, never hard-code colors.

### Core Variables

**Base**: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`

**Brand**: `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--accent`, `--accent-foreground`

**UI**: `--muted`, `--muted-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`

**Dashboard**: `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-accent`, `--sidebar-border`

### Usage Examples

```tsx
// Backgrounds
<div className="bg-background">...</div>
<div className="bg-primary">...</div>
<div className="bg-card">...</div>

// Text
<p className="text-foreground">...</p>
<p className="text-muted-foreground">...</p>

// Borders
<div className="border border-border">...</div>

// Inline styles (with hsl wrapper)
<div style={{ background: `hsl(var(--primary))` }}>...</div>
```

### Image Overlays

For overlays on images, use neutral gray gradients (not brand colors):

```tsx
<div className="absolute inset-0 bg-gradient-to-b from-gray-900/60 to-gray-900/80" />
```
