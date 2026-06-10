---
allowedAgents: [deep-build]
name: deep-design
description: Design system quality guidelines for Deep Build - color calibration, typography discipline, dark mode, and anti-AI-default patterns
whenToUse: >-
  Load when creating or updating docs/design.md in Deep Build Mode.
  Provides color, typography, shadow, and dark-mode quality heuristics
  that prevent common AI-generated design system failures.
---
allowedAgents: [deep-build]

# Deep Design Quality Guidelines

These guidelines improve the quality of design systems produced for `docs/design.md`. Apply them when making color, typography, shadow, and theme decisions. They are heuristics, not rigid rules - override when the brief explicitly calls for something different.

---
allowedAgents: [deep-build]

## 1. Typography

### Font Selection
- **Discouraged as default:** `Inter`. Prefer `Geist`, `Outfit`, `Cabinet Grotesk`, `Satoshi`, or a brand-appropriate alternative.
- **Override:** Inter is acceptable when the brief explicitly asks for neutral / standard / clean feel.
- **Pairings to know:** `Geist` + `Geist Mono`, `Satoshi` + `JetBrains Mono`, `Cabinet Grotesk` + `Inter Tight`.

### Serif Discipline (strongly discouraged as default)
- Serif is only acceptable when ONE of these is true:
  - The brand brief literally names a serif font, OR
  - The aesthetic is genuinely editorial / luxury / publication / heritage AND you can articulate why
- For everything else (creative agency, modern brand, premium consumer, portfolio, lifestyle): **default sans-serif display** (Geist Display, Söhne Breit, Cabinet Grotesk Display, PP Neue Montreal, GT Walsheim).
- **Banned as defaults:** `Fraunces` and `Instrument_Serif` (the two most common AI-favorite display serifs).
- If a serif IS justified (rare): rotate from this pool, don't reuse across projects: PP Editorial New, GT Sectra Display, Reckless Neue, Tiempos Headline, Recoleta, Cormorant Garamond, Playfair Display, EB Garamond, Canela, Domaine Display.

### Display Type
- Default `text-4xl md:text-6xl tracking-tighter leading-none` for headlines.
- Body: `text-base leading-relaxed max-w-[65ch]`.
- **Italic descender clearance:** When italic is used in display type and the word contains `y g j p q`, use `leading-[1.1]` minimum and add bottom padding reserve.

### Emphasis Rule
When emphasizing a word within a headline, use **italic or bold of the SAME font**. Do NOT inject a random serif word into a sans headline (or vice versa). Mixed-family emphasis is amateur.

---
allowedAgents: [deep-build]

## 2. Color Calibration

### Core Rules
- Max 1 accent color. Saturation < 80% by default.
- **One palette per project.** Do not fluctuate between warm and cool grays.
- Never use pure gray - tint neutrals toward the brand's warmth/coolness.
- Color names should evoke character: "Aged Brass" not "Brown", "Deep Sage" not "Green".

### The LILA Rule
The "AI Purple / Blue glow" aesthetic is discouraged as default. No automatic purple button glows, no random neon gradients. Use neutral bases (Zinc / Slate / Stone) with high-contrast singular accents (Emerald, Electric Blue, Deep Rose, Burnt Orange).
- **Override:** if the brand explicitly asks for purple/violet, embrace it with intent.

### Premium-Consumer Palette Ban
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

### Color Consistency Lock
Once an accent color is chosen, it is used on the WHOLE page. A warm-grey site does not suddenly get a blue CTA in section 7. Pick one accent, lock it.

---
allowedAgents: [deep-build]

## 3. Materiality, Shadows & Shapes

- Use cards ONLY when elevation communicates real hierarchy. Otherwise group with borders or negative space.
- When a shadow is used, tint it to the background hue. No pure-black drop shadows on light backgrounds.
- **Shape Consistency Lock:** Pick ONE corner-radius scale and stick to it. Options: all-sharp (0), all-soft (12-16px), all-pill (full radius for interactive). Mixed systems need a documented rule applied everywhere.

---
allowedAgents: [deep-build]

## 4. Dark Mode Protocol

- Design for **both modes from the start**. Never ship light-only without explicit user instruction.
- Pick one token strategy per project:
  - Tailwind `dark:` variant (utility-first)
  - CSS variables with `[data-theme="dark"]` or `prefers-color-scheme`
- **No pure `#000000` and no pure `#ffffff`** - use off-black and off-white. Pure values kill depth.
- Respect `prefers-color-scheme` unless the brand insists on one mode.
- Visual hierarchy that works in light must work in dark. Brand color stays recognizable.

---
allowedAgents: [deep-build]

## 5. AI Tells to Avoid

These are signatures of AI-generated design systems. Avoid unless the brief explicitly asks for them:

### Visual
- NO neon / outer glows by default. Use inner borders or subtle tinted shadows.
- NO pure black (`#000000`). Off-black, zinc-950, or charcoal.
- NO oversaturated accents. Desaturate to blend with neutrals.
- NO excessive gradient text for large headers.

### Typography
- AVOID Inter as default (see Section 1).
- NO oversized H1s that just scream. Control hierarchy with weight + color, not raw scale.
- Serif constraints: editorial / luxury / publication only.

### Color
- NO AI-purple gradients as default brand color.
- NO warm-beige + brass for every premium brand (see Section 2).
- NO random palette switching between sections.

---
allowedAgents: [deep-build]

## 6. Pre-Flight Checks

Before finalizing design.md, verify:

- [ ] Color Consistency Lock: one accent color used everywhere
- [ ] Shape Consistency Lock: one radius system applied consistently
- [ ] Serif discipline: if used, it's justified and not Fraunces/Instrument_Serif
- [ ] Premium-consumer palette: if applicable, NOT the default beige+brass family
- [ ] No pure black or pure white anywhere
- [ ] Dark mode tokens defined (or explicit decision to skip with justification)
- [ ] Neutrals are tinted, not pure gray
- [ ] Font choice is intentional, not Inter-by-default
- [ ] Shadows are tinted to background hue
