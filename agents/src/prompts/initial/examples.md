# Design-Focused Example Patterns

These examples show how to analyze product ideas and create design-focused single-page preview plans.

**Remember:**

- These are PATTERNS to adapt, not templates to copy. Always tailor to the user's specific request.
- **ALWAYS defer features requiring APIs or database to future phases** (auth, forms, dynamic data, etc.)
- Focus on creating distinctive design direction, not just feature lists

---

## Example 1: SaaS Project Management Tool

**User wants:** "A project management tool for small teams"

### Design Analysis

**Product category:** SaaS productivity tool  
**Target audience:** Small team leads, project managers, startup teams  
**Emotional positioning:** Organized, approachable, efficient, trustworthy  
**Key content needs:** Product benefits, feature showcase, integrations, pricing preview, testimonials from teams

### Design Direction

**Overall aesthetic:** Clean and capable with purposeful whitespace. Modern without being trendy, professional without being corporate. Should feel like a well-funded startup, not a generic SaaS template.

**Visual direction:**

- **Color:** Light base (off-white) with ONE vibrant accent color (consider warm tones like coral or teal, NOT default blue). Use accent sparingly for CTAs and highlights to create focus.
- **Typography:** Friendly but professional—approachable without being playful. Mix weights confidently (light for large display, medium/bold for emphasis).
- **Layout:** DO NOT use icon grids for features. Use staggered two-column layout with alternating product screenshots and text. Hero should have text left, product UI screenshot right.

**Section-specific:**

- **Hero:** Include small teams logo bar or stat below fold ("Trusted by 500+ small teams")
- **Features:** Show through actual UI examples or inline screenshots, not icon cards
- **Social proof:** Small team testimonials with company names
- **CTA:** Asymmetric layout with visual element, not centered-text-on-band

**Differentiation:** Include oversized typography in hero—display text that breaks the grid for immediate impact.

**Consistency:** Footer should maintain the friendly-professional tone, not fade to generic links.

### Todo List

1. Apply design direction: Clean, capable aesthetic for small teams with staggered layout and oversized hero typography. Color: Light base with ONE vibrant accent (not blue). Typography: Friendly but professional. Avoid icon grids.
2. Search for product UI screenshots showing project management interface in action
3. Build homepage (index.tsx) with asymmetric hero (text left, UI right), features via alternating screenshot sections (not icon grid), small team testimonials, and asymmetric CTA. Include oversized typography.
4. Add product screenshots to hero and feature sections with proper context
5. Update header, footer, and page title with clean, friendly styling that maintains design quality
6. Choose color scheme that matches organized, approachable aesthetic for small teams
7. Ask user if they want to build: pricing page, integrations page, about page

**Deferred:** Pricing page, integrations page, about page, contact page

### Handoff Prompt

```
DESIGN DIRECTION: Clean, capable aesthetic for small teams. Modern with purposeful whitespace. Well-funded startup feel, not generic template.

VISUAL DIRECTION:
- Color: Light base with ONE vibrant accent (coral/teal, NOT blue). Use sparingly.
- Typography: Friendly but professional. Mix weights confidently.
- Layout: NO icon grids. Staggered two-column with alternating screenshots/text.

SECTION-SPECIFIC: Hero with text left/UI right, oversized typography. Features via actual UI screenshots. Asymmetric CTA. Maintain quality through footer.

DIFFERENTIATION: Oversized typography in hero breaks grid for impact.

After color-scheme handoff, ask about: pricing page, integrations page, about page.
```

---

## Example 2: Creative Portfolio

**User wants:** "Personal portfolio to showcase my design work"

### Design Analysis

**Product category:** Creative portfolio  
**Target audience:** Potential clients, hiring managers, creative directors  
**Emotional positioning:** Bold, confident, creative, distinctive  
**Key content needs:** Project showcase, brief about section, skills/services, contact method

### Design Direction

**Overall aesthetic:** Bold and creative with strong visual hierarchy. Should feel like a designer's portfolio, not a generic template. Confident use of whitespace and unexpected layouts.

**Visual direction:**

- **Color:** Start with monochrome base (true black #0A0A0A and white) with ONE bold accent color used as punctuation. Let the work be the color.
- **Typography:** Bold and confident with dramatic size contrasts. Mix weights and sizes creatively—oversized headings, tight leading on display text.
- **Layout:** Bento-style grid for projects with varied card sizes. DO NOT use uniform grid. Asymmetric compositions throughout.

**Section-specific:**

- **Hero:** Oversized name/title with distinctive typographic treatment. Minimal text, maximum impact.
- **Projects:** Bento grid with varied sizes (some projects larger than others). Hover states should be distinctive, not generic fades.
- **About:** Integrated into page flow, not separate section. Could be overlaid on project grid or between projects.
- **Footer:** Should be as bold as hero, not an afterthought

**Differentiation:** Use an unusual grid structure—bento layout where project card sizes vary significantly based on project importance.

**Consistency:** CRITICAL: Maintain creative energy throughout. Footer should be as intentional as hero.

### Todo List

1. Apply design direction: Bold creative portfolio with bento grid layout and dramatic typography. Color: Monochrome base with ONE bold accent. Typography: Oversized with dramatic contrasts. Avoid uniform project grids.
2. Search for portfolio project images with varied compositions and aspect ratios
3. Build homepage (index.tsx) with oversized typographic hero, bento-style project grid (varied sizes), integrated about section, and bold footer. Include distinctive hover states.
4. Add project images to bento grid with varied sizes based on project importance
5. Update header, footer, and page title with bold, minimal styling that matches creative energy
6. Choose color scheme that matches bold, confident creative aesthetic
7. Ask user if they want to build: individual project case study pages, contact page

**Deferred:** Individual project detail pages, contact page

### Handoff Prompt

```
DESIGN DIRECTION: Bold creative portfolio with strong hierarchy. Designer's portfolio feel, not template. Confident whitespace use.

VISUAL DIRECTION:
- Color: Monochrome base (black/white) with ONE bold accent for punctuation. Let work provide color.
- Typography: Bold with dramatic size contrasts. Oversized headings, tight leading.
- Layout: NO uniform grid. Bento-style with varied card sizes (some 2x larger).

SECTION-SPECIFIC: Oversized name/title hero with grid-breaking typography. Bento grid with varied sizes. Distinctive hover states. Integrated about section. Bold footer matching hero energy.

DIFFERENTIATION: Bento layout creates hierarchy through asymmetry, not uniform repetition.

CRITICAL: Maintain creative energy throughout. Footer as bold as hero.

After color-scheme handoff, ask about: project case study pages, contact page.
```

---

## Example 3: E-commerce Product Showcase

**User wants:** "Online store for handmade ceramics"

### Design Analysis

**Product category:** E-commerce, artisan goods  
**Target audience:** Design-conscious consumers, gift buyers, home decor enthusiasts  
**Emotional positioning:** Warm, artisanal, premium-but-approachable, crafted  
**Key content needs:** Product showcase, artist story, trust signals, shopping features preview

### Design Direction

**Overall aesthetic:** Warm and artisanal with generous whitespace. Premium without being pretentious. Should feel handcrafted and intentional, not mass-market.

**Visual direction:**

- **Color:** Warm neutrals (cream, terracotta, warm grays) as base. Earth tones that feel natural and handmade. Avoid pure white—use warm off-white (#FAF8F5).
- **Typography:** Elegant but approachable. Serif for headings (warmth and craft), sans-serif for body (clarity). Generous spacing.
- **Layout:** Asymmetric product grid with varied image sizes. DO NOT use standard e-commerce grid. Full-bleed imagery sections.

**Section-specific:**

- **Hero:** Full-bleed product photography with overlaid text. Should feel editorial, not commercial.
- **Products:** Asymmetric grid with varied sizes. Some products featured larger. Include pricing and brief descriptions on cards.
- **Story:** Integrated section about the artist/process. Could include process photos.
- **Trust:** Subtle trust signals (shipping, returns) integrated into design, not badge section

**Differentiation:** Full-bleed imagery sections that break the vertical rhythm. Product photography should feel editorial and artistic.

**Consistency:** Maintain warm, artisanal feel throughout. Footer should feel as crafted as hero.

### Todo List

1. Apply design direction: Warm artisanal aesthetic with asymmetric product grid and full-bleed imagery. Color: Warm neutrals and earth tones. Typography: Elegant serif headings. Avoid standard e-commerce grids.
2. Search for artisanal ceramic product photos with natural lighting and editorial quality
3. Build homepage (index.tsx) with full-bleed hero image, asymmetric product grid (varied sizes), integrated artist story section, and crafted footer. Include warm, generous spacing.
4. Add ceramic product photos to hero and asymmetric grid with varied prominence
5. Update header, footer, and page title with elegant, minimal styling using warm neutrals
6. Choose color scheme that matches warm, artisanal aesthetic
7. Ask user if they want to build: individual product pages, shopping cart, checkout flow

**Deferred:** Individual product pages, shopping cart, checkout, about page

### Handoff Prompt

```
DESIGN DIRECTION: Warm, artisanal aesthetic. Premium without pretentious. Handcrafted feel, not mass-market template.

VISUAL DIRECTION:
- Color: Warm neutrals (cream, terracotta, warm grays). Earth tones. NO pure white.
- Typography: Elegant but approachable. Serif headings (warmth), sans body (clarity).
- Layout: NO standard e-commerce grid. Asymmetric with varied sizes (some 2x larger).

SECTION-SPECIFIC: Full-bleed hero with editorial product photography. Asymmetric product grid with pricing. Integrated artist story. Subtle trust signals. Crafted footer.

DIFFERENTIATION: Full-bleed imagery breaks vertical rhythm. Editorial, not commercial photography.

Maintain warm, artisanal feel throughout. Generous whitespace consistent.

After color-scheme handoff, ask about: product pages, shopping cart, checkout flow.
```

---

## Key Patterns to Apply

**Always include:** Design analysis, specific visual direction, cliché avoidance, section guidance, differentiation element, consistency requirements.

**Always defer:** Additional pages, API/database features, e-commerce checkout, user accounts, backend integrations.

These are patterns to adapt, not templates to copy. Analyze each request and create tailored design direction.
