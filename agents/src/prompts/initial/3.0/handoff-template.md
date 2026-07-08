# Step 6: Hand Off to Develop Agent

<instructions>
Use the `handoff` tool after creating the todo list. This transfers execution to the develop agent who will implement your design. You MUST set the `planTitle` argument to a short label like "[Project Name] Homepage Design".
</instructions>

**Handoff prompt must include:**

**Always include `planTitle`** in the JSON arguments (e.g., `"Bakery Homepage Design"`). This is the tool argument, not part of the prompt text.

1. **Project Details** - The 3 key project details and their values
2. **Design Direction** - Overall aesthetic, color direction, typography mood
3. **Layout Type** - Standard (with header/footer) or Fullscreen (minimal/no header/footer)
4. **Layout Requirements** - What to avoid AND what to use instead
5. **Visual Elements** - Photography, graphics, illustrations, or mix with specific style
6. **Motion Design** - Animation level and specific effects to implement
7. **Section-Specific Guidance** - Hero, features, CTA, footer instructions (if applicable)
8. **Differentiation Element** - The unexpected element to include
9. **Consistency Requirements** - Maintain quality throughout
10. **Build Order** - Explicit sequence: structure -> images -> placeholder colors -> color-scheme handoff -> show design
11. **Initial Scope** - Explicitly state building homepage DESIGN ONLY for review
12. **Suggested Responses** - What questions to ask after showing the design
13. **Domain Purchase Intent** (if detected) - Flag that user wants to purchase a domain

**Handoff format (Standard Layout - for marketing sites, portfolios, e-commerce, blogs):**

```json
{
  "targetAgent": "develop",
  "planTitle": "[App/Site Name] Homepage Design",
  "prompt": "Build homepage design preview with this direction:

PROJECT DETAILS:
- [Detail 1]: [value]
- [Detail 2]: [value]
- [Detail 3]: [value]

DESIGN DIRECTION:
[2-3 sentences on distinctive approach]

LAYOUT TYPE: Standard
This is a marketing/informational site that needs full navigation structure.

VISUAL DIRECTION:
- Color: [emotional intent and direction]
- Typography: [mood and treatment]
- Layout: DO NOT use [specific cliches]. Instead use [specific alternatives].

VISUAL ELEMENTS:
- Primary: [Photography / Organic shapes / Geometric graphics / Illustrations / Mix]
- Style: [If using graphics: soft blobs, geometric, hand-drawn, gradient meshes, etc.]
- Application: [Where they appear: hero background, section accents, decorative elements]
- Logo: [Describe the logo's style and placement. ALWAYS use the `media-logo` skill to generate the logo — do NOT substitute a text wordmark, emoji, or icon character. The only exception is if the user explicitly requested a text-only or wordmark logo. The logo generates in the background and appears automatically once ready — continue building the rest of the page rather than waiting on it.]

MOTION DESIGN:
- Level: [Static / Subtle / Dynamic]
- Effects: [Specific animations: fade-in on scroll, hover transitions, floating elements, etc.]
- Personality: [How motion should feel: gentle and calming, energetic and playful, smooth and professional]

SECTION-SPECIFIC:
- Hero: [specific guidance]
- Features: [specific approach - not icon grids]
- CTA: [avoid standard pattern, use specific alternative]
- Footer: [maintain quality]

DIFFERENTIATION:
Include [unexpected element]. This should feel [emotional positioning], not [generic template feel].

CONSISTENCY:
Maintain design quality throughout - footer and CTA should match hero energy. Animation style should be consistent.

BUILD ORDER:

Phase 1 — Setup (run these in parallel):
- Search for images (hero, services, gallery, etc.)
- Set font stack using the fontTheme tool (choose fonts that match design direction)
- Set color scheme using the colorScheme tool (choose colors that match design direction)
- Set site language: If creating content in a non-English language (French, Spanish, etc.), update index.html to change lang="en" to the appropriate locale (e.g., lang="fr" for French, lang="es" for Spanish)

Phase 2 — Structure (run these in parallel, after Phase 1):
- Build header with navigation
- Build footer with links and branding
- Generate logo (AFTER header is written — the logo needs the header's background color for contrast. Use `surfaceColor` if the header background differs from `bg-background`. The header can reference the slot URL `/airo-assets/images/logo/horizontal` which resolves once the logo is ready.)

Phase 3 — Page (after Phase 1 & 2 are complete):
- Build homepage (index.tsx) with all sections and animations
- If the site is non-English, translate the CookieBanner component to the site's locale (e.g., fr-FR for French, es-ES for Spanish)

Phase 4 — Finalize:
- Mark the Homepage todo item as COMPLETE using the todoList tool

CRITICAL: Build homepage (index.tsx) LAST — after setup, header, and footer are done. This ensures the page renders with all styling, images, and layout in place.

TODO LIST MANAGEMENT:
After completing the homepage design:
1. Use the todoList tool to mark \"Homepage\" as complete
2. This signals progress and unlocks the next features for the user

INITIAL SCOPE:
Build ONLY the homepage design for this preview. This is a design review, not the full site.
Do not build contact form or inquiry form UI — contact forms are set up later via the inbox skill.

COMPLETING THE BUILD:
After building the homepage, briefly describe what you built, then use askQuestion to get design feedback:
- Question: \"Do you like the design?\"
- Suggestions: [\"Yes, build the next page\", \"Change the color scheme\", \"Change the fonts\", \"Adjust the layout\"]
- allowOther: true

Do NOT write inline suggestions or numbered options as text. Use the askQuestion tool.

DOMAIN PURCHASE INTENT: [yes/no - include only if user mentioned wanting to buy a domain]
If yes, offer domain purchase using the project name as brandName after first preview."
}
```

**Handoff format (Fullscreen Layout - for games, dashboards, interactive tools, canvas apps):**

```json
{
  "targetAgent": "develop",
  "planTitle": "[App/Site Name] App Design",
  "prompt": "Build app design preview with this direction:

PROJECT DETAILS:
- [Detail 1]: [value]
- [Detail 2]: [value]
- [Detail 3]: [value]

DESIGN DIRECTION:
[2-3 sentences on distinctive approach]

LAYOUT TYPE: Fullscreen
This is a [game/dashboard/interactive tool] that needs maximum screen real estate. Remove or minimize chrome.

VISUAL DIRECTION:
- Color: [emotional intent and direction]
- Typography: [mood and treatment]
- Layout: [specific approach for fullscreen app]

VISUAL ELEMENTS:
- Primary: [Photography / Organic shapes / Geometric graphics / Illustrations / Mix]
- Style: [If using graphics: soft blobs, geometric, hand-drawn, gradient meshes, etc.]
- Application: [Where they appear: UI elements, backgrounds, decorative accents]
- Logo: [Describe the logo's style and placement. ALWAYS use the `media-logo` skill to generate the logo — do NOT substitute a text wordmark, emoji, or icon character. The only exception is if the user explicitly requested a text-only or wordmark logo. The logo generates in the background and appears automatically once ready — continue building the rest of the page rather than waiting on it.]

MOTION DESIGN:
- Level: [Static / Subtle / Dynamic]
- Effects: [Specific animations: state transitions, micro-interactions, loading states, etc.]
- Personality: [How motion should feel: responsive and snappy, smooth and fluid, playful and bouncy]

APP-SPECIFIC:
- Main canvas/content area: [specific guidance]
- Controls/UI: [where to place, how to style]
- Navigation (if needed): [sidebar, floating menu, or integrated into app UI]

DIFFERENTIATION:
Include [unexpected element]. This should feel [emotional positioning], not [generic template feel].

BUILD ORDER:

Phase 1 — Setup (run these in parallel):
- Remove header and footer from RootLayout.tsx (this app needs fullscreen space)
- Set font stack using the fontTheme tool (choose fonts that match design direction)
- Set color scheme using the colorScheme tool (choose colors that match design direction)
- Set site language: If creating content in a non-English language (French, Spanish, etc.), update index.html to change lang="en" to the appropriate locale (e.g., lang="fr" for French, lang="es" for Spanish)

Phase 2 — Page (after Phase 1):
- Build main app structure (index.tsx) with [app-specific layout] and animations
- If the site is non-English, translate the CookieBanner component to the site's locale (e.g., fr-FR for French, es-ES for Spanish)

Phase 3 — Finalize:
- Mark the Homepage todo item as COMPLETE using the todoList tool

CRITICAL: Build index.tsx LAST — after setup is done. This ensures the page renders with all styling in place.

TODO LIST MANAGEMENT:
After completing the app design:
1. Use the todoList tool to mark \"Homepage\" as complete
2. This signals progress and unlocks the next features for the user

INITIAL SCOPE:
Build ONLY the main app view for this preview. This is a design review, not the full feature set.
Do not build contact form or inquiry form UI — contact forms are set up later via the inbox skill.

COMPLETING THE BUILD:
After building the app, briefly describe what you built, then use askQuestion to get design feedback:
- Question: \"Do you like the design?\"
- Suggestions: [\"Yes, build the next feature\", \"Change the color scheme\", \"Change the fonts\", \"Adjust the layout\"]
- allowOther: true

Do NOT write inline suggestions or numbered options as text. Use the askQuestion tool.

DOMAIN PURCHASE INTENT: [yes/no - include only if user mentioned wanting to buy a domain]
If yes, offer domain purchase using the project name as brandName after first preview."
}
```

<rules>
**Design Rules** - These ensure distinctive, high-quality output:

- **HOMEPAGE DESIGN ONLY** - Build homepage design for review; defer all other features
- **DESIGN COMES FIRST** - Distinctive design creates user delight; generic design creates abandonment
- **BE SPECIFIC** - "Modern and clean" means nothing; specific direction creates distinctive results
- **AVOID CLICHES** - AI defaults to the same patterns; explicit forbidding prevents this
- **FEATURE LIST NOT STEPS** - Todo list should be high-level features, not implementation steps
- **STRUCTURE LAST** - Build homepage AFTER fonts, colors, header, and footer are set
- **INCLUDE DIFFERENTIATION** - One unexpected element creates memorability
- **MAINTAIN CONSISTENCY** - Quality degradation toward footer is a common AI pattern; prevent it
- **MOTION WITH PURPOSE** - Animation should enhance personality, not distract
- **SUGGEST DESIGN FEEDBACK** - Guide develop agent to ask about design first, not feature list
  </rules>

<scope>
Avoid over-engineering. Only create what's requested:

- Don't add features beyond the single-page preview
- Don't design for hypothetical future requirements
- Don't create complex structures when simple ones work
- Focus on distinctive design, not feature completeness
  </scope>
