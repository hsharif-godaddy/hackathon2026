---
allowedAgents: [deep-build]
name: deep-design
description: Design system quality guidelines for Deep Build - Google-font pairings, color & contrast calibration, interactive states, dark mode, and anti-AI-default patterns
whenToUse: >-
  Load when creating or updating docs/design.md in Deep Build Mode.
  Provides font-pairing, color, contrast, state, shadow, and dark-mode
  quality heuristics that prevent common AI-generated design system failures,
  plus the required structure for design.md.
---

# Deep Design Quality Guidelines

These guidelines improve the quality of design systems produced for `docs/design.md`. Apply them when making font, color, contrast, state, shadow, and theme decisions. They are heuristics, not rigid rules - override when the brief explicitly calls for something different.

## 0. What `docs/design.md` Must Contain

Heuristics are worthless if they don't land in a concrete artifact. A finished `design.md` defines a **token system**, not a pile of adjectives. Include:

1. **Color tokens — for BOTH light and dark mode.** At minimum: `background`, `surface`, `surface-elevated`, `border`, `text`, `text-muted`, `accent`, `accent-foreground`, and the four semantic colors (`success`, `warning`, `error`, `info`). Express as CSS variables or a Tailwind theme extension. Every value must satisfy the contrast rules in §3.
2. **Typography** — header + body font (a named pairing from §1), the type scale, weight ramp, and line-heights. Both fonts MUST be available on Google Fonts (§1).
3. **Spacing scale** — one base unit (4px or 8px) and the ramp used everywhere (§5).
4. **Radius scale** — one system, applied consistently (§4).
5. **Shadow / elevation** definitions for light and dark (§4, §7).
6. **Interactive state + focus conventions** (§6) — hover, focus-visible, active, disabled.

If a token isn't defined here, downstream layout/build work will invent it inconsistently. Define it once.

## 1. Typography

### Use Google Fonts only (for now)
Every font named in `design.md` MUST be loadable from Google Fonts via `next/font/google`. Do not specify commercial/foundry fonts (Satoshi, Cabinet Grotesk, PP Neue Montreal, Söhne, GT Walsheim, GT Sectra, Reckless, Canela, Domaine, Tiempos, etc.) — the build cannot load them and the spec becomes unimplementable. When in doubt, pick from the pairing table below.

### Curated pairings (start here)
Pick the row whose vibe matches the brief. All header/body fonts are on Google Fonts and pre-vetted to pair well. Header is for display/headlines; body is for running text.

| Vibe | Header | Body | Best for |
|------|--------|------|----------|
| Bold | Oswald | Barlow | tech, startups, agencies, fitness, gyms |
| Classic | Crimson Text | Cardo | law, finance, publishing, universities, healthcare |
| Elegant | Petit Formal Script | Montserrat | weddings, bridal, salons, fine jewelry, upscale dining |
| Energetic | Racing Sans One | Roboto | sports, gaming, esports, action sports, dance |
| Industrial (western) | Arbutus | Spectral | BBQ, breweries, steakhouses, western/ranch venues |
| Industrial (gritty) | Rubik Dirt | Roboto Slab | tattoo, barbershops, makers, motorcycle, record labels |
| Luxury (heritage) | Felipa | Faustina | heritage brands, luxury hotels, bespoke, fine dining |
| Luxury (professional) | Playfair Display | Libre Baskerville | consulting, law, finance, architecture, premium services |
| Minimal | Alumni Sans | Inclusive Sans | SaaS, wellness, fashion, galleries, architecture, yoga |
| Modern / corporate | Inter | Inter | corporate, B2B, SaaS, professional services |
| Organic (literary) | Averia Serif Libre | Montserrat | bookstores, museums, galleries, libraries, cultural |
| Organic (warm) | Cedarville Cursive | Teachers | bakeries, florists, lifestyle, calligraphy, coaching |
| Playful | Chango | Teachers | kids, toys, ice cream, family, casual eateries |
| Professional (warm) | Montserrat | Hedvig Letter Sans | healthcare, coaching, non-profits, therapy, community |
| Street | Permanent Marker | Source Code Pro | streetwear, skate, food trucks, music venues |

You are not limited to this table — any well-paired Google Fonts work. The table is a vetted starting set, not a whitelist.

### Selection discipline
- **Inter** is the safe corporate/neutral default (the "Modern" row). Outside neutral/corporate/B2B briefs, prefer a more characterful pairing — Inter-everywhere is a common AI tell.
- **Serif as display** is acceptable when the aesthetic is genuinely editorial / luxury / publication / heritage (use the Classic, Luxury, or Organic-literary rows), or the brief names a serif. For creative-agency / modern-brand / portfolio / lifestyle, default to a sans or display header.
- **Banned as defaults:** `Fraunces` and `Instrument_Serif` (the two most common AI-favorite display serifs). If you want that flavor, use Playfair Display, Crimson Text, or Spectral instead.
- One project = one pairing. Don't mix more than two families.

### Display type
- Default `text-4xl md:text-6xl tracking-tighter leading-none` for headlines.
- Body: `text-base leading-relaxed max-w-[65ch]`.
- Define an explicit type scale in `design.md` (e.g. a 1.25 modular scale) plus the weight ramp — don't leave sizes ad-hoc.
- **Italic descender clearance:** When italic is used in display type and the word contains `y g j p q`, use `leading-[1.1]` minimum and add bottom padding reserve.

### Emphasis rule
When emphasizing a word within a headline, use **italic or bold of the SAME font**. Do NOT inject a random second family into a headline. Mixed-family emphasis is amateur.

## 2. Color Calibration

### Core rules
- Max 1 accent color. Saturation < 80% for **neutral-dominant** palettes (the accent itself may run hotter when the brief calls for a vivid pop — see the LILA exception).
- **One palette per project.** Do not fluctuate between warm and cool grays.
- Never use pure gray - tint neutrals toward the brand's warmth/coolness.
- Color names should evoke character: "Aged Brass" not "Brown", "Deep Sage" not "Green".
- **Proportion (60/30/10):** neutral background dominates (~60%), secondary surface/neutral (~30%), accent reserved for emphasis (~10%). The accent is a spice, not a base.

### Semantic colors
Define `success` / `warning` / `error` / `info` as part of the palette — forms, alerts, and toasts need them and they must not collide with the brand accent. Tint them toward the palette's temperature rather than using stock Bootstrap red/green. Each must pass the contrast rules in §3.

### The LILA rule
The "AI Purple / Blue glow" aesthetic is discouraged as default. No automatic purple button glows, no random neon gradients. Use neutral bases (Zinc / Slate / Stone) with high-contrast singular accents (Emerald, Electric Blue, Deep Rose, Burnt Orange).
- **Override:** if the brand explicitly asks for purple/violet, embrace it with intent.

### Premium-consumer palette ban
For premium-consumer briefs (cookware, wellness, artisan, luxury, heritage craft, DTC home goods), the following palette family is **banned as default**:
- Backgrounds: warm beige/cream/chalk/bone (`#f5f1ea`, `#f7f5f1`, `#fbf8f1` family)
- Accents: brass/clay/oxblood/ochre (`#b08947`, `#b6553a`, `#9a2436` family)
- Text: espresso/warm near-black (`#1a1714` family)

**Default alternatives (rotate):**
- Cold Luxury: silver-grey + chrome + smoke
- Forest: deep green + bone + amber accent
- Black and Tan: true off-black + warm tan, sharp contrast
- Cobalt + Cream: saturated blue against a single neutral
- Terracotta + Slate: warm rust against cool grey
- Olive + Brick + Paper: muted olive plus brick-red accent
- Pure monochrome + single saturated pop

**Override:** acceptable ONLY when the brand brief explicitly names those colors.

### Color consistency lock
Once an accent color is chosen, it is used on the WHOLE page. A warm-grey site does not suddenly get a blue CTA in section 7. Pick one accent, lock it.

## 3. Contrast & Accessibility

Low-contrast gray-on-gray text is the single most common AI design failure. Every color decision must clear these thresholds (WCAG AA) **in both light and dark mode**:

- **Body text vs its background: ≥ 4.5:1.** This is the floor for `text-muted` too — do not push muted/secondary text below 4.5:1 to make it look "subtle." Subtle is achieved with weight and size, not illegible contrast.
- **Large text (≥ 24px, or ≥ 19px bold), icons, and meaningful UI borders vs background: ≥ 3:1.**
- **Accent used as text or as an essential control** must pass the relevant threshold against the surface it sits on. A saturated accent that looks great as a fill is often illegible as text — check it.
- **Semantic colors** (success/warning/error) must pass against their backgrounds in both modes.
- **Never convey information by color alone** — pair with an icon, label, or shape (color-blind users, grayscale).
- The "desaturate to blend with neutrals" advice in §8 is bounded by these ratios: blend, but never below the floor.

State the measured contrast intent in `design.md` (e.g. "text on background = 12:1, text-muted = 5.2:1") so it survives implementation.

## 4. Materiality, Shadows & Shapes

- Use cards ONLY when elevation communicates real hierarchy. Otherwise group with borders or negative space.
- When a shadow is used, tint it to the background hue. No pure-black drop shadows on light backgrounds.
- **Dark-mode elevation comes from surface lightness, not shadow.** Drop shadows barely register on dark backgrounds — raise the surface's lightness (`surface` → `surface-elevated`) to signal elevation instead. Define both tokens.
- **Shape consistency lock:** Pick ONE corner-radius scale and stick to it. Options: all-sharp (0), all-soft (12-16px), all-pill (full radius for interactive). Mixed systems need a documented rule applied everywhere.

## 5. Spacing & Rhythm

- Pick ONE base unit — 4px or 8px — and derive the whole spacing scale from it (e.g. 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64). Define it in `design.md`.
- Use the scale for padding, gaps, and section spacing. Arbitrary one-off values (`gap-[13px]`) are a consistency leak.
- (Section-level rhythm and page composition live in the `deep-layout` skill — this skill owns the token, that skill owns the composition.)

## 6. Interactive States & Motion

A design system that only specifies the resting state is incomplete. For every interactive element (links, buttons, inputs, cards-as-links) define:

- **hover** — a subtle background/lightness/accent shift. Never a layout shift (no size or margin changes that reflow neighbors).
- **focus-visible** — ALWAYS a visible focus ring (≥ 2px, ≥ 3:1 contrast against the adjacent color). Never `outline: none` without a replacement indicator. This is keyboard-navigation accessibility, not decoration.
- **active** — a brief pressed state (slightly darker / inset).
- **disabled** — reduced opacity + `cursor: not-allowed`; if the control must stay perceivable, keep ≥ 3:1.

### Motion
- Transition state changes with `150–250ms` ease. Don't animate layout or large elements gratuitously — restraint reads as polish, over-animation reads as AI.
- **All motion must honor `prefers-reduced-motion`** — specify the static fallback (consistent with `deep-layout`).

## 7. Dark Mode Protocol

- Design for **both modes from the start**. Never ship light-only without explicit user instruction.
- Pick one token strategy per project:
  - Tailwind `dark:` variant (utility-first)
  - CSS variables with `[data-theme="dark"]` or `prefers-color-scheme`
- **No pure `#000000` and no pure `#ffffff`** - use off-black and off-white. Pure values kill depth.
- Elevation via surface lightness, not shadow (§4).
- Re-check ALL contrast ratios in dark mode (§3) — a pairing that passes in light can fail when inverted.
- Respect `prefers-color-scheme` unless the brand insists on one mode.
- Visual hierarchy that works in light must work in dark. Brand color stays recognizable (re-tune lightness/saturation if needed so the accent still passes contrast on a dark surface).

## 8. AI Tells to Avoid

These are signatures of AI-generated design systems. Avoid unless the brief explicitly asks for them:

### Visual
- NO neon / outer glows by default. Use inner borders or subtle tinted shadows.
- NO pure black (`#000000`). Off-black, zinc-950, or charcoal.
- NO oversaturated accents on neutral palettes. Desaturate to blend — but never below the §3 contrast floor.
- NO excessive gradient text for large headers.
- NO missing or default-browser focus rings (§6).

### Typography
- AVOID Inter as the default outside corporate/neutral briefs (see §1).
- NO oversized H1s that just scream. Control hierarchy with weight + color, not raw scale.
- Serif constraints: editorial / luxury / publication only.
- NO foundry/commercial fonts the build can't load — Google Fonts only (§1).

### Color
- NO AI-purple gradients as default brand color.
- NO warm-beige + brass for every premium brand (see §2).
- NO random palette switching between sections.

## 9. Pre-Flight Checks

Before finalizing `design.md`, verify:

- [ ] Color tokens defined for BOTH light and dark mode (incl. surface-elevated + semantic colors)
- [ ] Contrast: body text ≥ 4.5:1, large text/icons/UI ≥ 3:1, in BOTH modes
- [ ] `text-muted` not pushed below the 4.5:1 floor
- [ ] Fonts are a vetted/available Google-Fonts pairing — no foundry fonts
- [ ] Font choice is intentional, not Inter-by-default (unless corporate/neutral)
- [ ] Type scale, weight ramp, and line-heights defined
- [ ] Color Consistency Lock: one accent color used everywhere, ~10% proportion
- [ ] Shape Consistency Lock: one radius system applied consistently
- [ ] Spacing scale defined from a single base unit
- [ ] Interactive states defined: hover, focus-visible (visible ring), active, disabled
- [ ] Motion honors `prefers-reduced-motion`
- [ ] Serif discipline: if used, it's justified and not Fraunces/Instrument_Serif
- [ ] Premium-consumer palette: if applicable, NOT the default beige+brass family
- [ ] No pure black or pure white anywhere
- [ ] Dark-mode elevation via surface lightness, not shadow
- [ ] Neutrals are tinted, not pure gray
- [ ] Shadows are tinted to background hue
