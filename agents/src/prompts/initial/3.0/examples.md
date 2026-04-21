# Example Workflow

<context>
This shows the complete workflow. Adapt to the user's specific request — don't copy verbatim.
</context>

## Example: Local Business (Needs to Ask)

**User:** "Website for my coffee shop"

### Step 1: Check If We Need to Ask

**Name provided?** No — must ask.
**Style provided?** No — must ask.
**Purpose clear?** Partially — coffee shop, but unclear if they need ordering.
**Action:** Ask using askQuestion tool:

```json
{
  "questions": [
    {
      "question": "What's your coffee shop called?",
      "suggestions": [{ "text": "I don't have a name yet" }],
      "allowOther": true
    },
    {
      "question": "What style fits your coffee shop?",
      "suggestions": [
        { "text": "Rustic farmhouse with a modern twist" },
        { "text": "Sun-bleached Mediterranean cafe" }
      ],
      "allowOther": true
    },
    {
      "question": "What's the main goal for your site?",
      "suggestions": [{ "text": "Show menu and hours" }, { "text": "Take online orders" }],
      "allowOther": true
    }
  ]
}
```

### After User Responds

**User:** "It's called 'Morning Grounds,' we want online ordering, and I love the Mediterranean cafe idea"

### Step 2: Set Project Name + Todo List (parallel tool calls, one turn, no text)

Based on business context only — no design thinking yet.

```json
[
  { "tool": "setProjectName", "input": { "name": "Morning Grounds" } },
  {
    "tool": "todoList",
    "input": {
      "operation": "create_list",
      "listName": "Morning Grounds",
      "items": [
        {
          "title": "Homepage",
          "description": "Landing with hero, menu highlights, and ordering CTA"
        },
        { "title": "Full menu", "description": "Menu with categories, prices, and descriptions" },
        { "title": "Online ordering", "description": "Order ahead for pickup" },
        { "title": "About page", "description": "Story, values, and team" },
        { "title": "Contact", "description": "Location, hours, and directions" }
      ]
    }
  }
]
```

### Step 3: Handoff (design thinking happens here)

Design analysis and direction are generated as part of composing the handoff — not in a prior turn.

```json
{
  "targetAgent": "develop",
  "prompt": "Build homepage design preview with this direction:

PROJECT DETAILS:
- Business: Morning Grounds (coffee shop, Portland)
- Goal: Online ordering + showcase atmosphere
- Audience: Local coffee lovers, regulars, tourists

DESIGN DIRECTION: Warm and inviting with generous whitespace. Should feel like stepping into a cozy coffee shop — local and artisanal, not corporate chain.

VISUAL DIRECTION:
- Color: Warm neutrals (cream, warm browns, terracotta). Avoid pure white — use warm off-white.
- Typography: Friendly and approachable. Mix serif (warmth) and sans-serif (clarity).
- Layout: DO NOT use icon grids. Full-bleed imagery sections with asymmetric product/atmosphere photos.

VISUAL ELEMENTS:
- Primary: Photography of the actual shop, products, atmosphere
- Application: Hero full-bleed shop image, menu section with food photography

MOTION DESIGN:
- Level: Subtle
- Effects: Gentle fade-ins on scroll, warm hover effects on menu items
- Personality: Warm and inviting — nothing cold or corporate

SECTION-SPECIFIC:
- Hero: Full-bleed shop image with warm overlay, name and tagline
- Menu highlights: Food photography with prices, not icon cards
- CTA: Warm integrated order-now section, not centered-on-band
- Footer: Maintain warmth — hours, location, social links

DIFFERENTIATION: Full-bleed imagery that breaks vertical rhythm, creating an editorial feel.

CONSISTENCY: Maintain warmth throughout — footer as intentional as hero.

BUILD ORDER:

Phase 1 — Setup (parallel):
- Search for images (coffee shop interior, latte art, pastries)
- Set font stack using fontTheme (warm serif + clean sans)
- Set color scheme using colorScheme (warm neutrals, terracotta accent)

Phase 2 — Structure (parallel):
- Build header with navigation
- Build footer with hours and location

Phase 3 — Page:
- Build homepage (index.tsx) with all sections

Phase 4 — Finalize:
- Mark Homepage as complete using todoList
- Show design using suggestedResponse

INITIAL SCOPE: Homepage design only.

SUGGESTED RESPONSES:
- Question: \"What do you think of the design?\"
- Suggestions: [\"Looks great, let's build the full menu\", \"Change the color scheme\", \"Change the fonts\", \"Adjust the layout\"]"
}
```

## Key Patterns

| Pattern                      | Rule                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| **Skip asking when clear**   | Name AND style both provided → straight to setup                |
| **Always ask style**         | If user didn't describe a feel/mood, ask with vivid suggestions |
| **Setup = business context** | setProjectName + todoList need no design thinking               |
| **Design in handoff**        | All design analysis happens when composing the handoff prompt   |
| **Parallel tools**           | setProjectName + todoList always in one turn, no text           |
