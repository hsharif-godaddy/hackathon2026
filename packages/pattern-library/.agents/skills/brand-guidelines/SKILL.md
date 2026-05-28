---
name: brand-guidelines
description: GoDaddy Brand Identity Guidelines for creative design. Use when creating GoDaddy-branded designs, choosing brand colors, selecting typography, applying logo rules, writing in brand voice, selecting photography style, using illustrations, or ensuring brand consistency across any channel.
license: Proprietary
metadata:
  author: godaddy-platform
  version: "1.0"
  category: design
  platform: brand
---

# GoDaddy Brand Identity Guidelines

This skill contains the official GoDaddy Brand Identity Guidelines, distilled from the [Brand Portal](https://www.assets.godaddy/guidelines/guide/3a3fdf70-f3ca-486e-8545-d968800bb009/page/6b745da8-4a00-4b5b-86b6-166bfec07201). It guides AI agents in creating designs, content, and assets that are consistent with the GoDaddy brand.

> Our brand strategy is the foundation for our brand expression, from our visual identity to our brand personality, voice and tone.

## When to Use

Use this skill when working with **GoDaddy's brand identity** — the visual and personality layer that defines how GoDaddy looks and feels as a brand:

- **Designing GoDaddy assets** — selecting colors, typography, or layout for any GoDaddy-branded material
- **Choosing brand colors** — looking up HEX, RGB, CMYK, or Pantone values for the GoDaddy palette (for design reference; use UXCore intents in code)
- **Applying typography** — selecting the right typeface (GD Sherpa Display, GD Sherpa Text, GD Sage) and understanding hierarchy (use `@ux/text` components in code)
- **Writing brand copy** — applying GoDaddy's brand personality (The Doubt Slayer) and voice pillars for campaigns, marketing, and brand materials
- **Using the logo** — understanding lockup rules, clear space, placement, and trademark guidelines
- **Selecting photography** — choosing the right photography style (Campaign, Makers, Icons, Guides, Products, Stock)
- **Creating illustrations** — following hand-drawn illustration style, diversity guidelines, and usage rules
- **Reviewing brand compliance** — checking if a design follows GoDaddy brand standards

**For writing in-product UX content** (UI copy, error messages, headlines, buttons, tooltips), use the `ux-content-guidelines` skill — it provides the practical writing rules and style guidance for applying the Doubt Slayer voice to product surfaces.

## Reference Loading Policy

DO NOT open any `references/*.md` file unless the user request matches a trigger below.
When a trigger matches, open exactly ONE reference file.

| Trigger keywords | Reference to load |
|------------------|-------------------|
| logo, lockup, GO icon, trademark, brand ecosystem, brand hierarchy, clear space, placement, registry logo, acquired brands, business units, product names, team names | `references/LOGO.md` |
| color, palette, HEX, RGB, CMYK, Pantone, teal, black, white, brand colors, color combos, color scale, accent, primary, secondary | `references/COLOR.md` |
| typography, typeface, font, GD Sherpa, GD Sage, Display, Text, headline, body copy, type hierarchy, leading, tracking, variable typeface | `references/TYPOGRAPHY.md` |
| voice, tone, personality, copy, writing, brand voice, doubt slayer, forward-thinking, energizing, demystifying, content strategy, brand funnel | `references/VOICE-AND-TONE.md` |
| photography, photo, campaign, makers, icons, guides, stock, attribution, portrait, product photography, lifestyle, ecosystem | `references/PHOTOGRAPHY.md` |
| illustration, hand-drawn, illustration library, diversity, editorial illustration, concept illustration | `references/ILLUSTRATION.md` |
| composition, layout, storytelling, type rules, show it off, accessibility, contrast, brand assets, all together | `references/COMPOSITION.md` |

If no trigger matches, answer from this file only.

## Quick Reference

### Primary Brand Colors

| Color | HEX | Usage |
|-------|-----|-------|
| Everyday Teal 400 | `#1BDBDB` | Primary brand color, fresh design mood |
| Cash Black | `#111111` | Cornerstone, high contrast |
| Space White | `#FFFFFF` | Cornerstone, clean backgrounds |

### Typography Quick Guide

| Typeface | Usage | Min Size |
|----------|-------|----------|
| **GD Sherpa Display** | Headlines, callouts | 20pt+ |
| **GD Sherpa Text** | Body copy, captions | Any |
| **GD Sage** | Callouts only (advertising) | Limited use |

Always set tracking to **optical**.

### Voice Pillars

| Pillar | Characteristics | Sounds Like |
|--------|----------------|-------------|
| **Forward-Thinking** | Visionary, Experienced, Approachable | Guidance that knows what's ahead |
| **Energizing** | Catalyzing, Passionate, Optimistic | Motivation + confidence to take the next step |
| **Demystifying** | Empathetic, Simplifying, Insightful | Everyday language to clarify technical subjects |

### Brand Personality: The Doubt Slayer

GoDaddy's brand personality is **The Doubt Slayer** — turning "too complicated" into "totally doable." We reshape technology to remove uncertainty, confusion, and friction, turning overwhelming digital complexity into unstoppable confidence.

## Non-Negotiable Rules

1. **Never modify the logo** — Do not stretch, rotate, recolor, add effects, or alter the GoDaddy lockup or GO icon in any way
2. **Use brand colors only** — Only use colors from the official palette; never approximate or substitute
3. **Respect clear space** — The lockup and GO icon require clear space equal to the width of the "o" in GoDaddy
4. **Never hardcode colors or fonts in code** — Use the UXCore intent system (`intent('ux.box.foregroundColor')`) and `@ux/text` components. The GoDaddy theme delivers brand colors and typefaces automatically. See the `uxcore` skill for implementation
5. **GD Sherpa Display for headlines only** — Never use it for body copy; minimum 20pt
6. **GD Sage is restricted** — Only for callouts and advertising; not for digital channels or everyday use
7. **Photography must feel authentic** — Capture genuine people in real environments; avoid stock cliches
8. **Always attribute photography** — Makers, Icons, and Guides photos require attribution

## Common Mistakes

| Mistake | Correction |
|---------|------------|
| Using GD Sage for headlines | Use GD Sherpa Display for headlines |
| Using GD Sherpa Display for body text | Use GD Sherpa Text for body copy |
| Placing logo on busy/low-contrast images | Logo must be focal point and fully readable |
| Using non-palette colors | Only use official brand palette colors |
| Overusing secondary colors as primary | Secondary palette is for accents only |
| Using too many colors in product UI | Product uses white/gray dominant with Teal accent |
| Creating custom partnership lockups | All partnership lockups require Brand Team approval |
| Using campaign photography for non-campaign | Campaign photography is exclusively for campaign use |

## Color Scale by Channel

- **Advertising** — Full color palette, especially brights and bolds
- **Front of Site** — Leans heavily on white; secondary colors for accents and illustrations only
- **Product** — White and gray dominant, Everyday Teal as key accent; other colors used sparingly

## Related Skills

- `uxcore` — **Required for code implementation.** Brand colors and typography are delivered through the UXCore intent/theme system. Never hardcode HEX values or font-family names — use intents and `@ux/text` components instead. See `uxcore` references for THEMING.md (color intents) and TYPOGRAPHY.md (`@ux/text` components)
- `ux-content-guidelines` — UX Content Design Playbook for writing in-product copy (voice, tone, style rules for UI text)
- `accessibility` — WCAG 2.1 accessibility standards for UI

## Resources

- [Brand Portal](https://www.assets.godaddy/guidelines/guide/3a3fdf70-f3ca-486e-8545-d968800bb009/page/6b745da8-4a00-4b5b-86b6-166bfec07201) — Full interactive brand guidelines (SSO required)
- [Brand Assets](https://assets.godaddy/) — Logos, photography, illustrations, and more
- Slack: `#brand_help` — Brand Team support channel
