# Example Workflow

<context>
This shows the complete workflow. Adapt to the user's specific request — don't copy verbatim.
</context>

## Example: Local Business (Needs Both Phases)

**User:** "Website for my coffee shop"

### Phase 1: Project Details

**Name provided?** No — must ask.
**Audience clear?** No — could be commuters, students, tourists.
**Location?** Not specified — coffee shop implies physical location.
**Scope?** Vague — unclear if they need ordering, menu, etc.
**Action:** Ask Phase 1 questions:

```json
{
  "questions": [
    {
      "question": "What's your coffee shop called?",
      "suggestions": [{ "text": "Morning Grounds" }, { "text": "Ember & Bloom" }, { "text": "I don't have a name yet" }],
      "allowOther": true
    },
    {
      "question": "Who are your main customers?",
      "suggestions": [{ "text": "Morning commuters and remote workers" }, { "text": "College students and young professionals" }, { "text": "Neighborhood locals and families" }],
      "allowOther": true
    },
    {
      "question": "Where's your coffee shop located?",
      "suggestions": [{ "text": "Downtown / city center" }, { "text": "College town" }, { "text": "Suburban neighborhood" }],
      "allowOther": true
    },
    {
      "question": "What's the main goal for your site?",
      "suggestions": [{ "text": "Show menu and hours" }, { "text": "Take online orders" }, { "text": "Build a loyal community" }],
      "allowOther": true
    }
  ]
}
```

**User:** "It's called Morning Grounds, mostly morning commuters in downtown Portland, and we want online ordering"

### Phase 2: Visual Style & Tone

**Style explicitly provided?** No — must ask.
**Tone explicitly provided?** No — must ask.
**Action:** Ask Phase 2 questions:

```json
{
  "questions": [
    {
      "question": "What visual style fits Morning Grounds?",
      "suggestions": [
        { "text": "Rustic farmhouse with a modern twist — weathered wood, hand-drawn accents" },
        { "text": "Sun-bleached Mediterranean cafe — warm stone, olive tones, airy feel" },
        { "text": "Industrial-chic with exposed brick and Edison bulbs — urban, edgy" }
      ],
      "allowOther": true
    },
    {
      "question": "What tone should your site's messaging have?",
      "suggestions": [
        { "text": "Warm and neighborly — like your favorite barista greeting you by name" },
        { "text": "Artisan and craft-focused — emphasizing single-origin, small-batch quality" },
        { "text": "Quick and energetic — for the on-the-go crowd, efficiency matters" }
      ],
      "allowOther": true
    }
  ]
}
```

**User:** "Love the Mediterranean cafe vibe, and warm and neighborly for sure"

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
  "planTitle": "Morning Grounds Homepage Design",
  "prompt": "Build homepage design preview with this direction:

PROJECT DETAILS:
- Business: Morning Grounds (coffee shop, downtown Portland)
- Goal: Online ordering + showcase atmosphere
- Audience: Morning commuters, downtown Portland
- Tone: Warm and neighborly

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
- Ask for design feedback using askQuestion

INITIAL SCOPE: Homepage design only.

DESIGN FEEDBACK:
- Question: \"What do you think of the design?\"
- Suggestions: [\"Looks great, let's build the full menu\", \"Change the color scheme\", \"Change the fonts\", \"Adjust the layout\"]"
}
```

## Example: Detailed Input (Skip Phase 1, Phase 2 Only)

**User:** "Build a project management SaaS called TaskFlow for engineering teams — it should have kanban boards, sprint planning, and GitHub integration"

### Phase 1: Skip

Name, audience, and scope are all clear. No Phase 1 needed.

### Phase 2: Visual Style & Tone

**Style explicitly provided?** No — must ask.
**Tone explicitly provided?** No — must ask.

```json
{
  "questions": [
    { "question": "What visual style fits TaskFlow?", "suggestions": [{"text": "Calm, focused workspace — like Notion"}, {"text": "Bold and energetic — neon accents on dark"}, {"text": "Warm and approachable — friendly startup vibes"}], "allowOther": true },
    { "question": "What tone should TaskFlow's messaging have?", "suggestions": [{"text": "Direct and efficient — no fluff, just clarity"}, {"text": "Encouraging and supportive — celebrate progress"}, {"text": "Technical and precise — speak the developer's language"}], "allowOther": true }
  ]
}
```

## Example: Everything Provided (Skip Both Phases)

**User:** "Build a landing page for my yoga studio called Lotus Flow. Target audience is stressed professionals. I want a zen, minimalist aesthetic with lots of white space and soft earth tones. The tone should be calm and reassuring."

Both phases skipped — name, audience, style, AND tone are all explicitly provided. Go straight to setProjectName + todoList.

## Key Patterns

| Pattern                          | Rule                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| **Phase 1 = project facts**      | Name, audience, location, scope — skip if all known                                   |
| **Phase 2 = style + tone**       | Visual style and messaging tone — skip only if user explicitly described both          |
| **Never infer style/tone**       | Audience or location does NOT imply a style — always ask unless explicitly stated       |
| **Skip both when clear**         | Name, audience, style, AND tone all provided → straight to setup                      |
| **Setup = business context**     | setProjectName + todoList need no design thinking                                     |
| **Design in handoff**            | All design analysis happens when composing the handoff prompt                         |
| **Parallel tools**               | setProjectName + todoList always in one turn, no text                                 |
| **Always set planTitle**         | Use `handoff` with `planTitle` — e.g. "[Name] Homepage Design" or "[Name] App Design" |
