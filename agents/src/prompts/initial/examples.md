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
| Visual elements       | Product UI screenshots (they have a product to show)           |
| Animation level       | Subtle—professional but not stiff                              |

### Design Direction

**Overall aesthetic:** Clean and capable with purposeful whitespace. Modern without being trendy, professional without being corporate. Should feel like a well-funded startup, not a generic SaaS template.

**Visual direction:**

- **Color:** Light base (off-white) with ONE vibrant accent color (warm tones like coral or teal, NOT default blue). Use accent sparingly.
- **Typography:** Friendly but professional—approachable without being playful. Mix weights confidently.
- **Layout:** DO NOT use icon grids. Staggered two-column with alternating product screenshots and text.
- **Visual elements:** Real product UI screenshots. Subtle geometric accents in brand colors.
- **Animation:** Subtle—fade-in on scroll for sections, gentle hover lifts on cards, smooth button transitions. Nothing bouncy.

**Differentiation:** Oversized typography in hero that breaks the grid for immediate impact.

### Todo List (Use `todoList` tool)

```json
{
  "operation": "create_list",
  "listName": "TaskFlow Website",
  "items": [
    { "title": "Homepage", "description": "Landing page with hero, features, testimonials, and CTA" },
    { "title": "Pricing page", "description": "Pricing tiers with feature comparison" },
    { "title": "Features page", "description": "Detailed feature breakdown with screenshots" },
    { "title": "Integrations page", "description": "List of supported integrations and how they work" },
    { "title": "Sign up / Login", "description": "User authentication flow" }
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

VISUAL ELEMENTS:
- Primary: Product UI screenshots
- Style: Clean product mockups with subtle geometric accents
- Application: Hero shows main UI, features section shows specific screens

MOTION DESIGN:
- Level: Subtle
- Effects: Fade-in on scroll (300ms), hover lift on cards (translate-y + shadow), smooth button color transitions (200ms)
- Personality: Professional and refined—no bouncing or playful easing

SECTION-SPECIFIC:
- Hero: Text left, product UI right, oversized typography breaking grid. Fade-in entrance.
- Features: Actual UI screenshots with staggered scroll reveal, not icon cards
- CTA: Asymmetric layout, not centered-on-band
- Footer: Maintain friendly-professional tone

DIFFERENTIATION: Oversized typography in hero breaks grid for impact.

CONSISTENCY: Maintain quality through footer—don't let design get safer. Animation timing consistent throughout.

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
| Visual elements       | Portfolio work (the work IS the visual)                 |
| Animation level       | Dynamic—showcase creative capability                    |

### Design Direction

**Overall aesthetic:** Bold and creative with strong visual hierarchy. Should feel like a designer's portfolio, not a generic template. Confident use of whitespace and unexpected layouts.

**Visual direction:**

- **Color:** Monochrome base (true black and white) with ONE bold accent used as punctuation. Let the work be the color.
- **Typography:** Bold with dramatic size contrasts. Mix weights and sizes creatively—oversized headings, tight leading.
- **Layout:** Bento-style grid for projects with varied card sizes. DO NOT use uniform grid.
- **Visual elements:** Portfolio project images with varied compositions.
- **Animation:** Dynamic—creative hover effects on project cards, scroll-triggered reveals, smooth parallax on images.

**Differentiation:** Bento layout where project card sizes vary significantly, creating hierarchy through asymmetry.

### Todo List

```json
{
  "operation": "create_list",
  "listName": "Creative Portfolio",
  "items": [
    { "title": "Homepage", "description": "Portfolio landing with bento grid, oversized typography, and bold aesthetic" },
    { "title": "Project case studies", "description": "Individual project pages with process, outcomes, and visuals" },
    { "title": "About page", "description": "Personal story, skills, and background" },
    { "title": "Contact page", "description": "Contact form and social links" }
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

VISUAL ELEMENTS:
- Primary: Portfolio project images
- Style: High-quality project screenshots/mockups with varied aspect ratios
- Application: Bento grid showcasing work, hero can be typographic

MOTION DESIGN:
- Level: Dynamic
- Effects: Creative hover on project cards (scale + reveal project title), staggered entrance animation, smooth parallax on scroll, cursor interactions if appropriate
- Personality: Creative and confident—showcases design capability through interaction

SECTION-SPECIFIC:
- Hero: Oversized name/title with grid-breaking typography, animated entrance
- Projects: Bento grid with varied sizes, distinctive hover states that reveal info
- About: Integrated into page flow, not separate section
- Footer: As bold as hero, not an afterthought

DIFFERENTIATION: Bento layout creates hierarchy through asymmetry. Hover effects showcase creativity.

CRITICAL: Maintain creative energy throughout. Footer as bold as hero. Animation demonstrates design skill.

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

**Response:** Use askQuestion tool with:
1. What's your business name?
2. Where are you located?
3. Do you need online ordering or table reservations?

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
| Visual elements       | Photography of actual space and products                               |
| Animation level       | Subtle—warm and inviting, not distracting                              |

### Design Direction

**Overall aesthetic:** Warm and inviting with generous whitespace. Should feel like stepping into a cozy coffee shop. Local and artisanal, not corporate chain.

**Visual direction:**

- **Color:** Warm neutrals (cream, warm browns, terracotta). Avoid pure white—use warm off-white.
- **Typography:** Friendly and approachable. Mix serif (warmth) and sans-serif (clarity).
- **Layout:** Full-bleed imagery sections. Asymmetric product/atmosphere photos.
- **Visual elements:** Photography of the actual shop, products, atmosphere.
- **Animation:** Subtle—gentle fade-ins, warm hover effects. Nothing that feels cold or corporate.

**Differentiation:** Full-bleed imagery that breaks vertical rhythm, creating an editorial feel.

### Todo List

```json
{
  "operation": "create_list",
  "listName": "Morning Grounds",
  "items": [
    { "title": "Homepage", "description": "Landing with hero image, menu highlights, location/hours, and ordering CTA" },
    { "title": "Full menu page", "description": "Complete menu with categories, prices, and descriptions" },
    { "title": "About/story page", "description": "Coffee shop story, values, and team" },
    { "title": "Online ordering integration", "description": "Order ahead functionality for pickup" },
    { "title": "Contact/location page", "description": "Map, hours, contact form, and directions" }
  ]
}
```

---

## Example 4: Wellness Brand (Organic Shapes + Motion)

**User:** "Website for a yoga studio focused on community"

### Attribute Discovery

**Selected attributes:** Brand personality, Target audience, Primary goal
**Can infer:** Wellness/community-focused, health-conscious adults, likely booking classes
**Action:** Continue without asking

### Set Project Name (Use `setProjectName` tool)

```json
{
  "name": "Flow Studio"
}
```

### Design Analysis

| Aspect                | Decision                                                                  |
| --------------------- | ------------------------------------------------------------------------- |
| Product category      | Local wellness business                                                   |
| Target audience       | Health-conscious adults seeking community                                 |
| Emotional positioning | Warm, welcoming, calm, organic, alive                                     |
| Key content needs     | Class types, schedule, community testimonials, booking CTA                |
| Visual elements       | **Organic shapes** — wellness brands benefit from soft, flowing graphics  |
| Animation level       | Subtle to moderate — gentle motion that feels calming                     |

### Design Direction

**Overall aesthetic:** Warm and organic with flowing shapes that mirror the fluidity of yoga practice. Should feel calm and welcoming, like entering a peaceful studio space. The page should feel gently alive, not static.

**Visual direction:**

- **Color:** Earthy, muted palette—sage greens, warm terracottas, soft creams, gentle yellows. Nothing harsh or saturated.
- **Typography:** Soft serif for headings (warmth, elegance), clean sans for body (readability). Generous letter-spacing and line-height.
- **Layout:** Asymmetric with organic shapes creating visual flow between sections. Generous whitespace.
- **Visual elements:** Soft blob shapes in brand colors, layered with transparency. Shapes should frame content and create depth. Mix of organic shapes and minimal, authentic photography.
- **Animation:** Gentle ambient motion—floating shapes, soft fade-ins, smooth parallax. Movement should feel like breathing: slow, rhythmic, calming.

**Differentiation:** Overlapping transparent organic shapes that gently float, creating depth and a sense of living, breathing design.

### Todo List

```json
{
  "operation": "create_list",
  "listName": "Flow Studio",
  "items": [
    { "title": "Homepage", "description": "Landing with organic shapes, class highlights, testimonials, and booking CTA" },
    { "title": "Class schedule page", "description": "Weekly schedule with class types, times, and instructors" },
    { "title": "Instructor profiles", "description": "Team bios with photos and specialties" },
    { "title": "Membership/pricing page", "description": "Membership tiers, drop-in rates, and packages" },
    { "title": "Contact/location page", "description": "Studio location, parking info, and contact form" }
  ]
}
```

### Handoff

```json
{
  "targetAgent": "develop",
  "prompt": "Build a single-page preview with this design direction:

KEY ATTRIBUTES:
- Brand personality: Warm, organic, community-focused
- Target audience: Health-conscious adults seeking connection
- Primary goal: Class bookings and community building

DESIGN DIRECTION: Warm and organic with flowing shapes mirroring yoga's fluidity. Calm, welcoming, like entering a peaceful studio. The page should feel gently alive.

VISUAL DIRECTION:
- Color: Earthy, muted—sage greens, warm terracottas, soft creams. Nothing harsh.
- Typography: Soft serif headings (warmth), clean sans body (clarity). Generous spacing.
- Layout: Asymmetric with organic shapes creating flow. Generous whitespace.

VISUAL ELEMENTS:
- Primary: Organic shapes (soft blobs, flowing curves)
- Style: Rounded, overlapping shapes with gradient fills and transparency
- Application: Hero background, section transitions, decorative accents throughout. Shapes should frame content, not compete. Use brand colors (sage, terracotta, cream).
- Secondary: Minimal authentic photography where needed (instructor photos, studio shots)

MOTION DESIGN:
- Level: Subtle to moderate
- Effects: 
  - Floating organic shapes (slow, 8-12s duration, gentle up/down movement)
  - Fade-in on scroll for content sections (400ms, ease-out)
  - Soft parallax on background shapes
  - Gentle hover effects (opacity shifts, subtle scale)
- Personality: Like breathing—slow, rhythmic, calming. Never jarring or fast.

SECTION-SPECIFIC:
- Hero: Layered organic shapes creating depth, headline with soft entrance animation
- Classes: Cards with gentle hover lift, shapes as section accents
- Testimonials: Organic shape frames around quotes
- CTA: Warm, integrated design (not harsh colored band), subtle button hover
- Footer: Maintain organic feel, shapes as accents

DIFFERENTIATION: Floating organic shapes create living, breathing feel. Transparency and layering add depth.

CONSISTENCY: Organic warmth throughout—footer as intentional as hero. Animation timing consistent (slow, calming).

CRITICAL: Shapes should use brand colors, create depth through layering, and move slowly enough to calm rather than distract.

After color-scheme handoff, ask about: class schedule page, instructor profiles, membership page."
}
```

---

## Example 5: Tech Startup (Geometric Graphics)

**User:** "Landing page for an AI-powered analytics platform"

### Attribute Discovery

**Selected attributes:** Industry, Target audience, Product type
**Can infer:** Tech/SaaS, B2B data professionals, digital product (no physical shots needed)
**Action:** Continue without asking

### Set Project Name (Use `setProjectName` tool)

```json
{
  "name": "InsightAI"
}
```

### Design Analysis

| Aspect                | Decision                                                           |
| --------------------- | ------------------------------------------------------------------ |
| Product category      | B2B SaaS, analytics                                                |
| Target audience       | Data analysts, business intelligence teams                         |
| Emotional positioning | Intelligent, precise, modern, trustworthy                          |
| Key content needs     | Value prop, feature highlights, integrations, demo CTA             |
| Visual elements       | **Geometric graphics** — tech benefits from precise, modern shapes |
| Animation level       | Subtle — professional with moments of delight                      |

### Design Direction

**Overall aesthetic:** Modern and precise with clean geometric elements. Should feel intelligent and capable without being cold. Premium SaaS, not generic tech template.

**Visual direction:**

- **Color:** Light base with unexpected accent (NOT blue/purple gradient). Consider warm coral or teal as primary accent against clean whites and subtle grays.
- **Typography:** Clean, modern sans-serif with confident weight mixing. Technical feel without being cold.
- **Layout:** Asymmetric with geometric shapes creating structure. Avoid icon grids entirely.
- **Visual elements:** Geometric shapes (circles, lines, grids, nodes) suggesting data/connections. Product UI screenshots where showing features.
- **Animation:** Subtle but precise—crisp transitions, data-visualization-inspired motion, smooth scroll reveals.

**Differentiation:** Geometric grid/node patterns that suggest data connections, animated subtly to feel like a living network.

### Todo List

```json
{
  "operation": "create_list",
  "listName": "InsightAI",
  "items": [
    { "title": "Homepage", "description": "Landing with geometric patterns, value prop, feature highlights, and demo CTA" },
    { "title": "Features page", "description": "Detailed feature breakdown with UI screenshots and use cases" },
    { "title": "Pricing page", "description": "Pricing tiers with feature comparison for different team sizes" },
    { "title": "Integrations page", "description": "Supported data sources and third-party integrations" },
    { "title": "Demo request / Sign up", "description": "Lead capture form and free trial signup" }
  ]
}
```

### Handoff

```json
{
  "targetAgent": "develop",
  "prompt": "Build a single-page preview with this design direction:

KEY ATTRIBUTES:
- Industry: Tech/AI analytics
- Target audience: B2B data professionals
- Product type: Digital SaaS platform

DESIGN DIRECTION: Modern, precise, intelligent. Premium SaaS feel, not generic tech template. Should feel capable and trustworthy.

VISUAL DIRECTION:
- Color: Light base with unexpected accent (coral or teal, NOT blue/purple). Clean whites, subtle grays.
- Typography: Clean modern sans-serif, confident weight mixing. Technical but not cold.
- Layout: Asymmetric, NO icon grids. Show features through UI examples.

VISUAL ELEMENTS:
- Primary: Geometric graphics (circles, lines, grid patterns, connected nodes)
- Style: Clean, precise shapes suggesting data connections and networks
- Application: Hero background pattern, section accents, feature illustrations. Shapes should feel like data visualization.
- Secondary: Product UI screenshots for feature sections

MOTION DESIGN:
- Level: Subtle
- Effects:
  - Geometric patterns with subtle animation (nodes connecting, lines drawing)
  - Crisp fade-in on scroll (250ms, ease-out)
  - Smooth hover states on interactive elements
  - Optional: data-viz inspired micro-animations
- Personality: Precise and intelligent—smooth, never bouncy or playful

SECTION-SPECIFIC:
- Hero: Geometric network pattern as background, strong headline, product UI preview
- Features: Real UI screenshots with staggered reveal, not icon cards
- Social proof: Client logos, metrics, enterprise testimonials
- CTA: Clean, confident design with subtle hover animation
- Footer: Maintain modern feel, geometric accents

DIFFERENTIATION: Animated geometric network pattern suggests AI/data intelligence—subtle movement makes it feel alive.

CONSISTENCY: Modern precision throughout. Animation timing consistent and crisp.

After color-scheme handoff, ask about: features page, pricing page, integrations page."
}
```

---

## Key Patterns

| Pattern                       | Application                                                              |
| ----------------------------- | ------------------------------------------------------------------------ |
| **Attribute inference**       | When context is clear, document assumptions and continue                 |
| **Single question**           | When asking, use numbered list for all needed attributes                 |
| **Set project name**          | Always use `setProjectName` tool after gathering information             |
| **Specific design direction** | Always include what to avoid AND what to use instead                     |
| **Visual element choice**     | Explicitly decide: photography, organic shapes, geometric, illustrations |
| **Animation level**           | Explicitly specify: static, subtle, or dynamic with specific effects     |
| **Differentiation element**   | Every design needs one unexpected element                                |
| **Consistent quality**        | Explicitly note that footer should match hero quality                    |
| **Deferred features**         | Always list what to build in future phases                               |

These are patterns to adapt. Analyze each request and create tailored design direction that avoids AI clichés while matching the user's specific needs and discovered attributes.
