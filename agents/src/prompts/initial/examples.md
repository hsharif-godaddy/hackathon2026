# Design-Focused Example Patterns

<context>
These examples show the complete workflow from analysis to handoff. They are PATTERNS to adapt, not templates to copy. Always tailor to the user's specific request and discovered attributes.
</context>

---

## Example 1: SaaS Project Management Tool

**User:** "A project management tool for small teams"

### Attribute Discovery

**Selected attributes:** Tech savviness, B2B vs. B2C, Mobile vs. desktop
**Can infer:** Tech-savvy (project management users), B2B (teams), desktop-primary (PM workflows)
**Action:** Continue without asking—document assumptions

### Set Project Name (Use `setProjectName` tool)

```json
{
  "name": "TaskFlow"
}
```

### Design Analysis

| Aspect                | Decision                                                       |
| --------------------- | -------------------------------------------------------------- |
| Product category      | SaaS productivity tool                                         |
| Target audience       | Small team leads, project managers, startups                   |
| Emotional positioning | Organized, approachable, efficient, trustworthy                |
| Key content needs     | Product benefits, feature showcase, integrations, testimonials |

### Design Direction

**Overall aesthetic:** Clean and capable with purposeful whitespace. Modern without being trendy, professional without being corporate. Should feel like a well-funded startup, not a generic SaaS template.

**Visual direction:**

- **Color:** Light base (off-white) with ONE vibrant accent color (warm tones like coral or teal, NOT default blue). Use accent sparingly.
- **Typography:** Friendly but professional—approachable without being playful. Mix weights confidently.
- **Layout:** DO NOT use icon grids. Staggered two-column with alternating product screenshots and text.

**Differentiation:** Oversized typography in hero that breaks the grid for immediate impact.

### Todo List (Use `todoList` tool)

```json
{
  "todos": [
    "Apply design direction: Clean, capable aesthetic with staggered layout and oversized hero typography. Color: Light base with ONE vibrant accent (not blue). Typography: Friendly but professional. Avoid icon grids.",
    "Search for product UI screenshots showing project management interface in action",
    "Build homepage (index.tsx) with asymmetric hero (text left, UI right), features via alternating screenshot sections (not icon grid), small team testimonials, and asymmetric CTA. Include oversized typography.",
    "Add product screenshots to hero and feature sections with proper context",
    "Update header, footer, and page title with clean, friendly styling that maintains design quality",
    "Choose color scheme that matches organized, approachable aesthetic for small teams",
    "Ask user if they want to build: pricing page, integrations page, about page"
  ]
}
```

### Handoff (Use `handoff` tool)

```json
{
  "targetAgent": "develop",
  "prompt": "Build a single-page preview with this design direction:

KEY ATTRIBUTES:
- Tech savviness: High (software teams)
- B2B vs. B2C: B2B
- Mobile vs. desktop: Desktop-primary

DESIGN DIRECTION: Clean, capable aesthetic for small teams. Modern with purposeful whitespace. Well-funded startup feel, not generic template.

VISUAL DIRECTION:
- Color: Light base with ONE vibrant accent (coral/teal, NOT blue). Use sparingly.
- Typography: Friendly but professional. Mix weights confidently.
- Layout: NO icon grids. Staggered two-column with alternating screenshots/text.

SECTION-SPECIFIC:
- Hero: Text left, product UI right, oversized typography breaking grid
- Features: Actual UI screenshots, not icon cards
- CTA: Asymmetric layout, not centered-on-band
- Footer: Maintain friendly-professional tone

DIFFERENTIATION: Oversized typography in hero breaks grid for impact.

CONSISTENCY: Maintain quality through footer—don't let design get safer.

After color-scheme handoff, ask about: pricing page, integrations page, about page."
}
```

---

## Example 2: Creative Portfolio

**User:** "Personal portfolio to showcase my design work"

### Attribute Discovery

**Selected attributes:** Visual showcase intensity, Brand personality, Target audience
**Can infer:** Portfolio-heavy (design work), bold/creative (designer), professional audience (clients/hiring managers)
**Action:** Continue without asking

### Set Project Name (Use `setProjectName` tool)

```json
{
  "name": "Creative Portfolio"
}
```

### Design Analysis

| Aspect                | Decision                                                |
| --------------------- | ------------------------------------------------------- |
| Product category      | Creative portfolio                                      |
| Target audience       | Potential clients, hiring managers, creative directors  |
| Emotional positioning | Bold, confident, creative, distinctive                  |
| Key content needs     | Project showcase, brief about, skills/services, contact |

### Design Direction

**Overall aesthetic:** Bold and creative with strong visual hierarchy. Should feel like a designer's portfolio, not a generic template. Confident use of whitespace and unexpected layouts.

**Visual direction:**

- **Color:** Monochrome base (true black and white) with ONE bold accent used as punctuation. Let the work be the color.
- **Typography:** Bold with dramatic size contrasts. Mix weights and sizes creatively—oversized headings, tight leading.
- **Layout:** Bento-style grid for projects with varied card sizes. DO NOT use uniform grid.

**Differentiation:** Bento layout where project card sizes vary significantly, creating hierarchy through asymmetry.

### Todo List

```json
{
  "todos": [
    "Apply design direction: Bold creative portfolio with bento grid and dramatic typography. Color: Monochrome base with ONE bold accent. Typography: Oversized with dramatic contrasts. Avoid uniform project grids.",
    "Search for portfolio project images with varied compositions and aspect ratios",
    "Build homepage (index.tsx) with oversized typographic hero, bento-style project grid (varied sizes), integrated about section, and bold footer. Include distinctive hover states.",
    "Add project images to bento grid with varied sizes based on project importance",
    "Update header, footer, and page title with bold, minimal styling that matches creative energy",
    "Choose color scheme that matches bold, confident creative aesthetic",
    "Ask user if they want to build: individual project case study pages, contact page"
  ]
}
```

### Handoff

```json
{
  "targetAgent": "develop",
  "prompt": "Build a single-page preview with this design direction:

KEY ATTRIBUTES:
- Visual showcase: Portfolio-heavy
- Brand personality: Bold/creative
- Target audience: Professional (clients, hiring managers)

DESIGN DIRECTION: Bold creative portfolio with strong hierarchy. Designer's portfolio feel, not template. Confident whitespace use.

VISUAL DIRECTION:
- Color: Monochrome base (black/white) with ONE bold accent for punctuation.
- Typography: Bold with dramatic size contrasts. Oversized headings, tight leading.
- Layout: NO uniform grid. Bento-style with varied card sizes.

SECTION-SPECIFIC:
- Hero: Oversized name/title with grid-breaking typography
- Projects: Bento grid with varied sizes, distinctive hover states
- About: Integrated into page flow, not separate section
- Footer: As bold as hero, not an afterthought

DIFFERENTIATION: Bento layout creates hierarchy through asymmetry.

CRITICAL: Maintain creative energy throughout. Footer as bold as hero.

After color-scheme handoff, ask about: project case study pages, contact page."
}
```

---

## Example 3: Local Business (Needs to Ask)

**User:** "Website for my coffee shop"

### Attribute Discovery

**Selected attributes:** Business Name, Geographic location, Scheduling dependency
**Cannot infer:** Name not provided, location not provided, unclear if needs ordering/reservations
**Action:** Ask ONE question

**Response:** "To personalize your coffee shop site, I need to know:

1. What's your business name?
2. Where are you located?
3. Do you need online ordering or table reservations?"

### After User Responds

**User:** "It's called 'Morning Grounds,' we're in Portland, and yes we want online ordering"

### Set Project Name (Use `setProjectName` tool)

```json
{
  "name": "Morning Grounds"
}
```

### Design Analysis

| Aspect                | Decision                                                               |
| --------------------- | ---------------------------------------------------------------------- |
| Product category      | Local business, food service                                           |
| Target audience       | Local coffee lovers, regulars, tourists                                |
| Emotional positioning | Warm, welcoming, artisanal, community-focused                          |
| Key content needs     | Menu preview, location/hours, online ordering CTA, atmosphere showcase |

### Design Direction

**Overall aesthetic:** Warm and inviting with generous whitespace. Should feel like stepping into a cozy coffee shop. Local and artisanal, not corporate chain.

**Visual direction:**

- **Color:** Warm neutrals (cream, warm browns, terracotta). Avoid pure white—use warm off-white.
- **Typography:** Friendly and approachable. Mix serif (warmth) and sans-serif (clarity).
- **Layout:** Full-bleed imagery sections. Asymmetric product/atmosphere photos.

**Differentiation:** Full-bleed imagery that breaks vertical rhythm, creating an editorial feel.

### Todo List

```json
{
  "todos": [
    "Apply design direction: Warm, inviting aesthetic for local coffee shop with full-bleed imagery and friendly typography. Color: Warm neutrals (cream, browns). Typography: Serif headings, sans body. Avoid corporate chain feel.",
    "Search for artisanal coffee shop interior and product photos with warm natural lighting",
    "Build homepage (index.tsx) with full-bleed hero image, menu highlights section, location/hours with map, and prominent online ordering CTA. Include warm, generous spacing.",
    "Add coffee shop atmosphere and product photos with editorial treatment",
    "Update header, footer, and page title with 'Morning Grounds' branding and Portland location",
    "Choose color scheme that matches warm, welcoming coffee shop aesthetic",
    "Ask user if they want to build: full menu page, about/story page, online ordering integration"
  ]
}
```

---

## Key Patterns

| Pattern                       | Application                                                  |
| ----------------------------- | ------------------------------------------------------------ |
| **Attribute inference**       | When context is clear, document assumptions and continue     |
| **Single question**           | When asking, use numbered list for all needed attributes     |
| **Set project name**          | Always use `setProjectName` tool after gathering information |
| **Specific design direction** | Always include what to avoid AND what to use instead         |
| **Differentiation element**   | Every design needs one unexpected element                    |
| **Consistent quality**        | Explicitly note that footer should match hero quality        |
| **Deferred features**         | Always list what to build in future phases                   |

These are patterns to adapt. Analyze each request and create tailored design direction that avoids AI clichés while matching the user's specific needs and discovered attributes.
