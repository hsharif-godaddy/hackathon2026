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

# Deep Layout Guidelines

These guidelines improve the quality of implementation plans by providing layout composition rules, section rhythm requirements, and a vocabulary of named patterns. Apply them when specifying page architecture and section-by-section layouts in plans.

---

## 1. Layout Diversification

### Anti-Center Bias
Centered Hero / H1 sections are avoided for most sites. Force alternatives:
- Split Screen (50/50)
- Left-aligned content / right-aligned asset
- Asymmetric white-space
- Scroll-pinned structures

**Override:** centered hero is OK for editorial / manifesto / launch-announcement briefs where the message itself is the design.

### Section-Layout-Repetition Ban
Sections must be structurally diverse — and "structural" is judged by **skeleton, not by name**, so the rule holds even for patterns you invent (§8 escape hatch). A section's **skeleton** is: its column/split structure (1-col, 50/50, 60/40, 3-col grid…) + primary asset placement (none / left / right / top / full-bleed / background) + content alignment (left / centered) + dominant content type (cards / prose / form / list / media).

Write the one-line skeleton signature for each section as you plan, then verify:
- **No skeleton repeats more than once** on a page. Two "60/40, image-right, prose-left" sections are a repetition even if you gave them different names.
- **No two adjacent sections share a skeleton.**
- Practical target: an 8-section page should have at least 6 distinct skeletons.

Picking varied named patterns from §8 produces this naturally — the skeleton check is the backstop that also governs invented patterns. (Hero and Footer are singular page slots, not counted.)

### Zigzag Alternation Cap
Alternating "left-image + right-text" then "left-text + right-image" — the **Alternating Media Rows** pattern (§8) — is banal in bulk. Max 2 rows in a row. The 3rd consecutive image+text split must be broken with a full-width section, vertical-stack, bento grid, marquee, or a different family.

---

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

## 3. Eyebrow Restraint

An "eyebrow" is the small uppercase wide-tracking label above a section headline (e.g. `WHAT WE DO`, `OUR PROCESS`). Every AI-built site puts one above EVERY section — this is one of the strongest AI tells. Hard rules:

- **Maximum 1 eyebrow per 3 sections.** Hero counts as 1. A page with 9 sections may use at most 3 eyebrows total.
- If section A has an eyebrow, the next 2 sections cannot have one. **No consecutive eyebrows — ever.**
- **What to do instead:** drop it entirely. The headline alone is enough.
- **This applies to numbered/wayfinding eyebrows too.** A running index like `01 / WORK`, `02 / STUDIO`, `03 / CONTACT` on consecutive sections is the same violation wearing a costume — it is still an uppercase label above every headline. The numbering does not exempt it. If you want section numbering as an editorial device, commit to it as a *layout* element (e.g. a large margin numeral or a persistent side rail), not as a per-section eyebrow.
- **Self-check before finalizing:** count the eyebrows on each page. If the count exceeds `ceil(sections / 3)`, or any two adjacent sections both have one, delete eyebrows until both conditions hold.

---

## 4. Bento & Grid Rules

### Bento Cell Count Rule
A bento grid has EXACTLY as many cells as you have content for. 3 items = 3 cells. 5 items = 5 cells. No empty cells. Re-shape the grid if needed.

### Bento Background Diversity
Bento sections cannot be all white-on-white cards with text. At least 2-3 cells need real visual variation: a real image, a brand-appropriate gradient, a pattern, a tinted background.

### Bento Rhythm
Do not stack 6 identical layout rows. Vary composition: alternate full-width feature rows, asymmetric tile sizes, vertical breaks.

---

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
Use these names in your plan for **element-level** motion:
- "Scroll-reveal stagger" — items appear as they enter viewport
- "Entry cascade" — elements enter with staggered delay
- "Parallax tilt" — 3D tilt tracking mouse/scroll
- "Magnetic button" — button pulls toward cursor

**Section-scale** motion layouts (sticky-stack, horizontal-pan) are named as patterns in §8 — tag them `[motion]` and the same rules apply.

---

## 8. Pattern Vocabulary

This is a **seed vocabulary, not a closed list.** It does two jobs: (1) calibrate taste — these are good, non-default patterns to reach for first; (2) give builders precise names for the common cases. It is deliberately **not exhaustive** — real briefs (a class timetable, a long-form founder story) will need patterns not listed here.

**Pick from the seed when one fits. When none fits, invent one — see "Defining a new pattern" at the end.** Either way, the structural-difference rule (§1) — not membership in this list — is what enforces diversity, so invented patterns are first-class, not second-best.

Reading the catalog:
- **Hero** and **Footer** are singular page slots (one each per page); they don't count toward section diversity.
- The grouped families — Structural, Content & Feature, Conversion, Social Proof, Local Business — are organizing buckets and starting points, not a fixed taxonomy.
- **Card** and **Gallery** entries are *treatments* applied inside a section, not standalone sections.
- `[motion]` marks motion-heavy patterns. Don't stack them — ≤1–2 motion moments per page (§7), each with a `prefers-reduced-motion` fallback. On simple service/SMB sites, prefer the static patterns.

### Hero Paradigms (pick ONE per page)
- **Asymmetric Split Hero** — Text on one side, asset on the other, generous white space. *Use for:* most product/brand sites; the safe non-centered default.
- **Centered Classic Hero** — Headline + sub + CTA centered, single focal asset below. *Use for:* simple service businesses, single-product launches, when the message is short and direct.
- **Editorial Manifesto Hero** — Large type, no asset, almost a poster. *Use for:* agencies, manifestos, brand statements, launch announcements.
- **Full-Bleed Image Hero** — Edge-to-edge photo/video with overlaid text and a legibility scrim. *Use for:* restaurants, hospitality, travel, real estate, anything photography-led.
- **Product-Shot Hero** — Large real screenshot or product render as the focal point. *Use for:* SaaS, apps, hardware, e-commerce flagship items.
- **Form-in-Hero** — Headline beside a signup/booking/quote form. *Use for:* lead-gen, waitlists, booking-first businesses.

### Structural (page-level scaffolds)
- **Bento Grid** — Asymmetric tile grouping (Apple Control Center style). *Use for:* feature overviews, mixed-content highlights with visual variety.
- **Masonry Layout** — Staggered grid, no fixed row height. *Use for:* galleries, blog/resource indexes, varied-height cards.
- **Offset Grid** — Content pushed off-center with large empty zones on one side. *Use for:* editorial rhythm, breaking up centered monotony.
- **Full-Bleed Image Break** — Edge-to-edge image between content sections. *Use for:* visual breathing room, mood/transition moments.
- **Split-Screen Scroll** — Two halves sliding in opposite directions. *Use for:* dual narratives, before/after storytelling. `[motion]`
- **Sticky-Stack Sections** — Sections pin and stack on scroll. *Use for:* sequential feature reveals, step-through storytelling. `[motion]`
- **Horizontal Scroll Hijack** — Vertical scroll drives horizontal pan. *Use for:* portfolios, timelines, gallery showcases (sparingly). `[motion]`

### Content & Feature
- **Feature Grid** — 3- or 4-column icon/image + label + blurb. *Use for:* feature lists, service offerings, benefit summaries. The everyday workhorse.
- **Alternating Media Rows** — The image-left/image-right zigzag (capped at 2 in a row, §1). *Use for:* 2–3 flagship features each needing a sentence and a visual.
- **Single-Feature Spotlight** — One large media asset + focused copy, full section. *Use for:* the hero feature, a deep-dive on one capability.
- **Tabbed / Segmented Showcase** — Tabs or a segmented control swap the displayed content. *Use for:* use-cases, audience segments, plan-by-plan detail without stacking.
- **Steps / How-It-Works** — Numbered process or vertical timeline. *Use for:* onboarding, "how it works", recipes, multi-step services.
- **Comparison Table** — Us-vs-them or tier-vs-tier matrix. *Use for:* competitive positioning, plan comparison (keep it scannable, §5).
- **Before / After** — Paired or slider comparison. *Use for:* transformations — fitness, renovation, design, cleaning, results.
- **Content Scroll-Snap Rail** — Horizontal row of content cards that snap on swipe, next card peeking off-edge. *Use for:* browsable sets (workshops, products, posts) where breadth matters more than seeing all at once. Native scroll, low-motion — distinct from the `[motion]` Horizontal Scroll Hijack.
- **Editorial Feature + List (1 + N)** — One large featured item beside/above a short list of smaller ones. *Use for:* blog/journal/news/press sections that lead with a headline item.

### Conversion
- **CTA Split** — Left message, right action. *Use for:* mid-page or pre-footer conversion nudges.
- **Full-Bleed CTA Band** — Edge-to-edge color/image block with one dominant CTA. *Use for:* the single strongest conversion moment on the page.
- **Pricing Cards / Tiers** — 2–4 plan cards, one highlighted. *Use for:* productized pricing, membership tiers, packages.
- **FAQ Accordion** — Collapsible question/answer list. *Use for:* objection handling, support, reducing pre-sale friction.
- **Lead-Capture / Newsletter** — Inline email/contact capture strip. *Use for:* list building, gated content, launch waitlists.
- **Contact / Booking Form** — Multi-field form, often beside hours/map. *Use for:* service businesses, consultations, quote requests.
- **Announcement / Promo Bar** — Thin dismissible strip at top. *Use for:* sales, launches, shipping notices (one per page max).

### Social Proof
- **Logo Wall** — Row/grid of customer or partner logos, logos only (§6). *Use for:* "trusted by", press, integrations — placed under the hero, not in it.
- **Single Big Quote** — One oversized testimonial with attribution. *Use for:* a marquee customer, emotional weight.
- **Quote Wall** — Grid of several short testimonials. *Use for:* breadth of social proof, review aggregation.
- **Testimonial Carousel** — Rotating quotes with attribution. *Use for:* many testimonials in limited vertical space. `[motion]`
- **Video Testimonial** — Embedded customer video(s). *Use for:* high-trust B2B, case-study-led sales.
- **Stats Ribbon** — Horizontal row of key numbers. *Use for:* a compact band of headline metrics.
- **Stats Grid** — Big-number tiles, 2×2 or 3-up. *Use for:* impact/traction sections needing more room per metric.
- **Ratings / Reviews Block** — Star ratings + review snippets (Google/Yelp style). *Use for:* local businesses, e-commerce, restaurants.

### Local Business
- **Hours & Location** — Address, opening hours, contact, directions. *Use for:* any brick-and-mortar — restaurants, salons, shops, clinics.
- **Map Embed** — Interactive or static map with pin. *Use for:* location-led businesses; pair with Hours & Location.
- **Menu / Services List** — Itemized offerings with prices/descriptions. *Use for:* restaurants, salons, spas, repair/trades, clinics.
- **Team / Staff Grid** — Photo + name + role cards. *Use for:* agencies, firms, medical, salons — trust through faces.
- **Packages / Offerings** — Bundled service tiers (not SaaS pricing). *Use for:* photographers, event/wedding, fitness, consultants.

### Gallery treatments (applied inside a section)
- **Gallery Grid + Lightbox** — Tappable thumbnail grid opening full size. *Use for:* portfolios, real-photo galleries, menus, products. The static default.
- **Accordion Image Slider** — Narrow strips expanding on hover. *Use for:* curated 4–6 image showcases. `[motion]`

### Footer Patterns (pick ONE per page)
- **Sitemap Footer** — Multi-column link groups + brand + legal row. *Use for:* content-rich sites with many pages.
- **Minimal Footer** — Single row: brand, a few links, copyright. *Use for:* one-pagers, simple service sites.
- **CTA Footer** — A final conversion block sitting above the footer links. *Use for:* pages that should end on an ask.
- **Big-Type Footer** — Oversized brand wordmark or statement anchoring the page. *Use for:* brand/agency sites making a closing impression.

### Defining a new pattern (escape hatch)
When the brief needs a section the seed doesn't cover, **define one — don't jam the content into the nearest listed pattern.** A minted pattern is valid only if you specify it fully enough that the builder implements it without guessing:

- **Name** — Title Case, descriptive (e.g. "Weekly Timetable Grid").
- **What it is** — one sentence.
- **Use for** — when to reach for it.
- **Skeleton** — column/split structure + asset placement + alignment + content type. This doubles as its §1 diversity signature.
- **Responsive** — how it reflows on tablet/mobile.
- **Motion** — tag `[motion]` if motion-heavy and give the reduced-motion fallback.

Worked examples (real gaps the seed doesn't name):
- **Weekly Timetable Grid** — 7-column day grid, each column a stack of time-slotted cards; collapses to a per-day accordion on mobile. *Use for:* class schedules, clinic hours, event weeks. *Skeleton:* 7-col grid · no hero asset · left-aligned · time-slot cards.
- **Long-form Story Column** — single 65ch reading column of prose with interspersed pull-quotes and one mid-scroll full-bleed image. *Use for:* founder stories, about pages, manifestos with substance. *Skeleton:* 1-col centered · one full-bleed image break · prose.

**Spectacle & motion patterns are mint-territory.** Kinetic typography, scroll-pinned heroes, video/media-mask, parallax-tilt or spotlight-border cards, coverflow, hover-trails, glassmorphism — these are intentionally NOT in the seed because they're rarely right by default. When a genuine showpiece brief (creative agency, portfolio, launch) calls for one, mint it with a full spec. Don't reach for them on a service/SMB site.

**Hero & manifesto reuse:** the Hero paradigms double as section patterns — an Editorial Manifesto or Full-Bleed Image works as a mid-page or closing statement band, not only as the opener.

---

## 9. Pre-Flight Checks for Plans

Before finalizing the plan, verify:

- [ ] Hero discipline: fits viewport (headline ≤2 lines, subtext ≤20 words, CTA visible), `pt-24` max, ≤4 text elements, no trust-strip inside
- [ ] Eyebrow count: max ceil(sectionCount / 3) per page, none on adjacent sections — counting numbered/wayfinding labels (`01 / WORK`) as eyebrows
- [ ] No 3+ consecutive zigzag (left-right alternation) sections
- [ ] Structural diversity: each section's skeleton signature listed; none repeats more than once; no two adjacent sections share one (8 sections → ≥6 distinct skeletons)
- [ ] Any invented pattern is fully specified (name · what · use-for · skeleton · responsive · motion) per the §8 escape hatch
- [ ] Footer present: exactly one footer pattern chosen (§8)
- [ ] Motion patterns not stacked: ≤1–2 `[motion]` moments per page, each with a reduced-motion fallback
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
