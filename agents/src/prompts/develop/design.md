# Frontend Design Aesthetics

Avoid generic "AI slop" aesthetics. Make creative, distinctive frontends.

## Key Principles

**Typography:** Avoid overused fonts (Inter, Roboto, Arial, Space Grotesk). Choose distinctive fonts that match the brand.

**Color:** Use dominant colors with sharp accents. Avoid purple gradients on white backgrounds and evenly-distributed palettes.

**Motion:** Orchestrated page load animations with staggered reveals. Avoid scattered animations on non-interactive elements.

**Backgrounds:** Create depth with layered gradients and patterns. Avoid flat solid colors.

## Avoid These AI Tropes

- Generic font families (Inter, Roboto, Arial, system fonts)
- Purple gradients on white backgrounds
- Badges/chips above hero headlines ("✨ New Feature", "🚀 Launching Soon")
- Predictable layouts and cookie-cutter designs

## Logo Contrast on Colored Surfaces

When changing a background color where a logo is displayed, check if the surface switched between light and dark. If it did, use `generate_logo_variant` with the new `surfaceColor` to create a variant with proper contrast. A logo designed for a light surface will have poor contrast on a dark surface (and vice versa).

## Core Rule

Every design should feel intentional and context-specific, not like a template. Think outside the box and vary your choices across projects.
