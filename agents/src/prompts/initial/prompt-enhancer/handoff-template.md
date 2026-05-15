# Step 6: Hand Off to Develop Agent

<instructions>
Use the `handoff` tool after creating the todo list. This transfers execution to the develop agent who will implement your design. You MUST set the `planTitle` argument to a short label like "[Project Name] Homepage Design".
</instructions>

**The handoff prompt MUST start with a `TODAY'S PREVIEW` section.** This is the single most important part of the handoff — it tells the develop agent exactly what concrete content and structure the homepage will show when it renders today. The rest of the handoff (design direction, motion, etc.) is HOW to build it; `TODAY'S PREVIEW` is WHAT gets built.

## TODAY'S PREVIEW — what to include

Derive this section directly from the enhanced brief. Be concrete and specific — the develop agent should be able to build the page from this section alone, without re-reading the brief. Invent concrete placeholders where the brief implied content but did not spell it out (see the prompt-enhancer rules for repeating-content patterns and 2-3 plausible examples).

Required subsections:

- **Hero headline** — the actual headline text (or 2-3 candidate variations the develop agent can pick from). Not "a compelling headline" — the words.
- **Hero subhead** — 1-2 sentence supporting line with the specific differentiator woven in.
- **Primary CTA** — the exact button label and what it does (e.g., "Order pickup", "Book a consult", "Start free").
- **Sections in order** — every section the homepage includes, in render order. For each: a 1-line purpose and the concrete content pattern. For repeating blocks (menu items, services, case studies, team), state the repeat count AND the field pattern for each instance, AND 2-3 fully-written example instances (real names/descriptions, not `[example]`).
- **Photography / imagery callouts** — for each section that shows images, what specifically the image should depict (mood + subject). Not "a food photo" — "an overhead shot of a single taco on parchment with chile crisp, warm morning light".
- **Footer content** — key links, hours if local, tagline, social.

## Handoff prompt structure

Emit this full body as the `prompt` argument. Keep `TODAY'S PREVIEW` first.

**Always include `planTitle`** in the JSON arguments (e.g., `"Bakery Homepage Design"`). This is the tool argument, not part of the prompt text.

**Handoff format (Standard Layout - for marketing sites, portfolios, e-commerce, blogs):**

```json
{
  "targetAgent": "develop",
  "planTitle": "[App/Site Name] Homepage Design",
  "prompt": "Build homepage design preview with this direction:

TODAY'S PREVIEW:
Hero headline: [exact text]
Hero subhead: [1-2 sentences naming the differentiator]
Primary CTA: [button label] — [what it does]

Sections (in render order):
1. [Section name] — [purpose]. Content: [concrete content pattern + written-out examples].
2. [Section name] — [purpose]. Content: [concrete content pattern + written-out examples].
3. [Section name] — [purpose]. Content: [concrete content pattern + written-out examples].
[...]

Imagery callouts:
- [Section]: [specific shot description — subject + mood + composition]
- [Section]: [specific shot description]

Footer: [links, hours if local, tagline, socials]

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
- Logo: [If a logo is needed, describe its style and placement. Use the media-logo skill to generate it.]

MOTION DESIGN:
- Level: [Static / Subtle / Dynamic]
- Effects: [Specific animations: fade-in on scroll, hover transitions, floating elements, etc.]
- Personality: [How motion should feel: gentle and calming, energetic and playful, smooth and professional]

SECTION-SPECIFIC:
- Hero: [specific guidance beyond headline/subhead already in TODAY'S PREVIEW]
- Features: [specific approach - not icon grids]
- CTA: [avoid standard pattern, use specific alternative]
- Footer: [maintain quality]

DIFFERENTIATION:
Include [unexpected element]. This should feel [emotional positioning], not [generic template feel].

CONSISTENCY:
Maintain design quality throughout - footer and CTA should match hero energy. Animation style should be consistent.

BUILD ORDER:

Phase 1 — Setup (run these in parallel):
- Search for images (hero, services, gallery, etc.) — match the imagery callouts in TODAY'S PREVIEW
- Set font stack using the fontTheme tool (choose fonts that match design direction)
- Apply color scheme using the colorScheme tool. If VISUAL DIRECTION above lists explicit hex values for colors (e.g., cream (#F5F0E8) as background), call the tool with mode 'apply' and pass each hex through (primary, background, secondary, accent, muted, etc.) so the palette matches the spec exactly. Only use mode 'set' with a description when no hex values were given — set mode discards everything except primary and background.

Phase 2 — Structure (run these in parallel, after Phase 1):
- Build header with navigation
- Build footer with links and branding

Phase 3 — Page (after Phase 1 & 2 are complete):
- Build homepage (index.tsx) with all sections from TODAY'S PREVIEW and animations
- Build \"Coming Soon\" placeholder pages for every non-homepage route referenced in the header or footer navigation (see PLACEHOLDER PAGES below)

Phase 4 — Finalize:
- Mark the Homepage todo item as COMPLETE using the todoList tool

CRITICAL: Build homepage (index.tsx) LAST — after setup, header, and footer are done. The content in TODAY'S PREVIEW is the spec for index.tsx — use those exact headlines, section names, and examples.

TODO LIST MANAGEMENT:
After completing the homepage design:
1. Use the todoList tool to mark \"Homepage\" as complete
2. This signals progress and unlocks the next features for the user

INITIAL SCOPE:
Build ONLY the homepage design for this preview. Every non-homepage route gets a \"Coming Soon\" placeholder — no real content yet. This is a design review, not the full site.

PLACEHOLDER PAGES:
For every non-homepage route referenced by the header or footer navigation (e.g., /about, /menu, /services, /contact, /blog), create a minimal placeholder page that:
- Reuses the same header and footer as the homepage so nav feels consistent
- Shows a centered \"Coming Soon\" headline with the page name (e.g., \"Menu — Coming Soon\")
- Adds a 1-sentence supporting line in the site's voice (e.g., \"We're plating this one up — check back shortly.\")
- Includes a single button/link back to the homepage
- Uses the same fonts and color scheme set in Phase 1 — no custom layout, no images, no section content
Do NOT invent content for these pages. The point is a working nav structure with every link resolving to something branded, not broken.

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

For fullscreen apps, `TODAY'S PREVIEW` replaces "Sections in render order" with:

- **Main canvas / primary view** — what the user sees and can do on load. Concrete: starting state, visible controls, sample data if any.
- **Controls / UI panels** — each panel, what it contains, where it sits.
- **First-interaction state** — what happens when the user does the most obvious thing.

```json
{
  "targetAgent": "develop",
  "planTitle": "[App/Site Name] App Design",
  "prompt": "Build app design preview with this direction:

TODAY'S PREVIEW:
Main canvas: [what's visible on load — concrete starting state and any sample data]
Controls/UI: [each panel or control group, with its contents]
First interaction: [what happens when the user does the most obvious thing]
Imagery/iconography: [specific style callouts]

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
- Logo: [If a logo is needed, describe its style and placement. Use the media-logo skill to generate it.]

MOTION DESIGN:
- Level: [Static / Subtle / Dynamic]
- Effects: [Specific animations: state transitions, micro-interactions, loading states, etc.]
- Personality: [How motion should feel: responsive and snappy, smooth and fluid, playful and bouncy]

APP-SPECIFIC:
- Main canvas/content area: [specific guidance beyond TODAY'S PREVIEW]
- Controls/UI: [where to place, how to style]
- Navigation (if needed): [sidebar, floating menu, or integrated into app UI]

DIFFERENTIATION:
Include [unexpected element]. This should feel [emotional positioning], not [generic template feel].

BUILD ORDER:

Phase 1 — Setup (run these in parallel):
- Remove header and footer from RootLayout.tsx (this app needs fullscreen space)
- Set font stack using the fontTheme tool (choose fonts that match design direction)
- Apply color scheme using the colorScheme tool. If VISUAL DIRECTION above lists explicit hex values for colors (e.g., cream (#F5F0E8) as background), call the tool with mode 'apply' and pass each hex through (primary, background, secondary, accent, muted, etc.) so the palette matches the spec exactly. Only use mode 'set' with a description when no hex values were given — set mode discards everything except primary and background.

Phase 2 — Page (after Phase 1):
- Build main app structure (index.tsx) from TODAY'S PREVIEW — use the exact canvas state, controls, and first-interaction behavior

Phase 3 — Finalize:
- Mark the Homepage todo item as COMPLETE using the todoList tool

CRITICAL: Build index.tsx LAST — after setup is done. TODAY'S PREVIEW is the spec.

TODO LIST MANAGEMENT:
After completing the app design:
1. Use the todoList tool to mark \"Homepage\" as complete
2. This signals progress and unlocks the next features for the user

INITIAL SCOPE:
Build ONLY the main app view for this preview. This is a design review, not the full feature set.

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

- **TODAY'S PREVIEW IS THE SPEC** - The first section of the handoff is the concrete build target. If it's vague, the preview will be generic.
- **CONCRETE CONTENT, NOT PLACEHOLDERS** - Write actual headlines, section names, and 2-3 real example instances for repeating blocks. "[Example item]" is a failure.
- **HOMEPAGE DESIGN ONLY** - Build homepage design for review; every other nav route gets a \"Coming Soon\" placeholder that reuses header/footer and matches fonts/colors. No real content on non-homepage routes.
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
