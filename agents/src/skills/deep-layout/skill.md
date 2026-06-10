---
allowedAgents: [deep-build]
name: deep-layout
description: Layout composition and page architecture guidelines for Deep Build planning - section rhythm, hero discipline, content density, and pattern vocabulary
whenToUse: >-
  Load when writing implementation plans in Deep Build Mode.
  Provides layout composition rules, section rhythm requirements,
  content density heuristics, and a vocabulary of named patterns
  for precise section specs.
---
allowedAgents: [deep-build]

# Deep Layout Guidelines

These guidelines improve the quality of implementation plans by providing layout composition rules, section rhythm requirements, and a vocabulary of named patterns. Apply them when specifying page architecture and section-by-section layouts in plans.

---
allowedAgents: [deep-build]

## 1. Layout Diversification

### Anti-Center Bias
Centered Hero / H1 sections are avoided for most sites. Force alternatives:
- Split Screen (50/50)
- Left-aligned content / right-aligned asset
- Asymmetric white-space
- Scroll-pinned structures

**Override:** centered hero is OK for editorial / manifesto / launch-announcement briefs where the message itself is the design.

### Section-Layout-Repetition Ban
Once you use a layout family for a section (e.g., 3-column-image-cards, full-width-quote, split-text-image), that family appears at most ONCE on the page. A landing page with 8 sections must use at least 4 different layout families.

### Zigzag Alternation Cap
Alternating "left-image + right-text" then "left-text + right-image" is banal. Max 2 sections in a row with this pattern. The 3rd consecutive image+text split must be broken with a full-width section, vertical-stack, bento grid, marquee, or different family.

---
allowedAgents: [deep-build]

## 2. Hero & Navigation Discipline

### Hero Must Fit the Initial Viewport
- Headline max 2 lines on desktop
- Subtext max **20 words** AND max 3-4 lines
- CTAs visible without scroll
- If copy is too long: reduce font scale OR cut copy

### Hero Font-Scale Discipline
Plan font size and image size together. Default sensible range: `text-4xl md:text-5xl lg:text-6xl` for most heroes; `text-6xl md:text-7xl` only when the headline is 3-5 words. A 4-line hero headline is always a font-size error.

### Hero Top Padding Cap
Max `pt-24` (approx 6rem) at desktop. More than that means the hero content floats halfway down the viewport.

### Hero Stack Discipline (max 4 text elements)
Allowed in the hero, max 4 total:
1. Eyebrow (small uppercase label) OR brand strip - pick zero or one
2. Headline (max 2 lines)
3. Subtext (max 20 words, max 4 lines)
4. CTAs (1 primary + max 1 secondary)

**Banned in the hero:** tiny tagline below CTAs, trust micro-strip ("Used by..."), pricing teaser, feature bullet list, social-proof avatar row. All move to dedicated sections below.

### "Used by" Logo Wall
Belongs UNDER the hero as its own section, never inside the hero.

### Navigation
- MUST render on a single line on desktop. If items don't fit at 1024px, condense or use hamburger.
- Height cap: 80px max desktop, default 64-72px.

---
allowedAgents: [deep-build]

## 3. Eyebrow Restraint

An "eyebrow" is the small uppercase wide-tracking label above a section headline. Every AI-built site puts one above EVERY section. Hard rules:

- **Maximum 1 eyebrow per 3 sections.** Hero counts as 1. A page with 9 sections may use at most 3 eyebrows total.
- If section A has an eyebrow, the next 2 sections cannot have one.
- **What to do instead:** drop it entirely. The headline alone is enough.

---
allowedAgents: [deep-build]

## 4. Bento & Grid Rules

### Bento Cell Count Rule
A bento grid has EXACTLY as many cells as you have content for. 3 items = 3 cells. 5 items = 5 cells. No empty cells. Re-shape the grid if needed.

### Bento Background Diversity
Bento sections cannot be all white-on-white cards with text. At least 2-3 cells need real visual variation: a real image, a brand-appropriate gradient, a pattern, a tinted background.

### Bento Rhythm
Do not stack 6 identical layout rows. Vary composition: alternate full-width feature rows, asymmetric tile sizes, vertical breaks.

---
allowedAgents: [deep-build]

## 5. Content Density

### Default Content Shape Per Section
Short headline (max 8 words) + short sub-paragraph (max 25 words) + one visual asset OR one CTA. More must be justified.

### No Data-Dump Sections
A 20-row table, 30-row award list, or giant pricing matrix on a marketing page = wrong layout. Use:
- Top 3-5 highlights + "View full list" link
- Marquee / carousel for breadth
- Different page entirely if the data is the product

### Long Lists Need a Different Component
Default `<ul>` with bullets / `divide-y` rows is lazy for > 5 items. Reach for:
- 2-column split with grouped items
- Card grid with image + label per item
- Tabs / accordion if categorizable
- Horizontal scroll-snap pills
- Carousel for breadth-heavy lists
- Marquee for "lots-of-things-that-don't-need-attention"

### Spec Sheets
Long product specification tables with `border-b` on every row are banned. Alternatives:
- 2-col card grid (each spec gets its own card)
- Scroll-snap horizontal pills
- Grouped chunks (3 logical clusters with cluster headings)
- Featured-vs-rest (3-4 hero specs as display tiles, rest collapsed)

### Copy Rules
- No "placeholder copy", "replace with real X", "TBD", "Lorem ipsum"
- Fake-precise numbers (`92%`, `4.1x`, `48k`) must come from real data or be labeled as mock
- One copy register per page (don't mix technical mono, editorial prose, and marketing punch)

---
allowedAgents: [deep-build]

## 6. Image & Visual Asset Strategy

### Priority Order (for plan's Asset Inventory)
1. **AI-generated images** — if available, specify what to generate (subject, style, aspect ratio)
2. **Stock/real images** — specify search terms, dimensions, mood
3. **Last resort: explicit placeholder slots** — do NOT plan div-based fake screenshots

### Rules
- **Hero needs a real visual.** Text + gradient blob is not a hero.
- **No div-based fake product previews.** Never plan a fake dashboard/terminal built from styled divs.
- **Real logos for social proof.** Plan for SVG logos from Simple Icons or similar, not plain text wordmarks.
- **Logo-only rule:** logo walls = logos and nothing else. No industry/category labels below each logo.

---
allowedAgents: [deep-build]

## 7. Motion Intent (for Builder Instructions)

When specifying motion in plans, describe the **intent**, not the implementation. The builder agent handles code.

### Motion Must Be Motivated
Every animation in the plan needs a one-sentence justification:
- Hierarchy (drawing attention to the right thing)
- Storytelling (revealing content in narrative sequence)
- Feedback (acknowledging user action)
- State transition (showing something changed)

"It looks cool" is not a valid justification.

### Constraints to Specify
- **Marquee:** max one per page
- **Scroll-hijack:** use sparingly, only for showcase/portfolio moments
- **All motion must honor `prefers-reduced-motion`** — specify the static fallback

### Pattern Names for Motion Specs
Instead of vague descriptions, use these names in your plan:
- "Scroll-reveal stagger" — items appear as they enter viewport
- "Sticky-stack" — cards pin and stack as user scrolls
- "Horizontal-pan" — vertical scroll drives horizontal movement
- "Parallax tilt" — 3D tilt tracking mouse
- "Magnetic button" — button pulls toward cursor
- "Entry cascade" — elements enter with staggered delay

---
allowedAgents: [deep-build]

## 8. Pattern Vocabulary

Use these precise names in section specs so builders know exactly what to implement:

### Hero Paradigms
- **Asymmetric Split Hero** — Text on one side, asset on the other, generous white space
- **Editorial Manifesto Hero** — Large type, no asset, almost-poster
- **Video / Media Mask Hero** — Type cut out as mask over video background
- **Kinetic-Type Hero** — Animated typography as the primary visual
- **Scroll-Pinned Hero** — Hero stays pinned while content scrolls behind

### Layout Patterns
- **Bento Grid** — Asymmetric tile grouping (Apple Control Center style)
- **Masonry Layout** — Staggered grid, no fixed row height
- **Split-Screen Scroll** — Two halves sliding in opposite directions
- **Sticky-Stack Sections** — Sections that pin and stack on scroll
- **Horizontal Scroll Hijack** — Vertical scroll drives horizontal pan

### Card Patterns
- **Parallax Tilt Card** — 3D tilt tracking mouse coordinates
- **Spotlight Border Card** — Borders illuminate under cursor
- **Glassmorphism Panel** — Frosted glass with inner refraction

### Section Patterns
- **Full-bleed image break** — Edge-to-edge image between content sections
- **Offset grid** — Content not centered, large empty zones on one side
- **Testimonial carousel** — Rotating quotes with attribution
- **Stats ribbon** — Horizontal row of key numbers
- **CTA split** — Left message, right action

### Gallery Patterns
- **Accordion Image Slider** — Narrow strips expanding on hover
- **Coverflow Carousel** — 3D carousel with angled edges
- **Hover Image Trail** — Mouse leaves popping image trail

---
allowedAgents: [deep-build]

## 9. Pre-Flight Checks for Plans

Before finalizing the plan, verify:

- [ ] Hero fits viewport: headline max 2 lines, subtext max 20 words, CTA visible
- [ ] Hero top padding: max `pt-24` at desktop
- [ ] Hero stack: max 4 text elements, no trust-strip inside hero
- [ ] Eyebrow count: max ceil(sectionCount / 3) across all sections
- [ ] No 3+ consecutive zigzag (left-right alternation) sections
- [ ] Section-layout-repetition: at least 4 different layout families for 8 sections
- [ ] Bento: exact cell count matches content count, 2-3 cells have visual variety
- [ ] Navigation: single line at desktop, max 80px height
- [ ] Content density: no section has > 25 words of sub-paragraph by default
- [ ] Long lists use an appropriate component (not default `ul` for > 5 items)
- [ ] Every section has explicit responsive behavior noted
- [ ] Motion is motivated: every animation has a one-sentence justification
- [ ] Marquee: max one per page
- [ ] Asset inventory: every visual is sourced (gen-tool, stock, or explicit placeholder)
- [ ] No div-based fake screenshots planned
- [ ] Copy is specific (no placeholder text, no "TBD")
