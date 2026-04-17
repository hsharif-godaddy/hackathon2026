# Project Details - Personalization Requirements

<context>
Generic designs fail because they don't account for audience-specific needs. A site for teenagers needs different typography than one for seniors. A B2B SaaS needs different trust signals than a consumer app. Identifying the right project details upfront prevents building the wrong thing.
</context>

Before creating the design plan, identify the 3 most important details for this project. These details directly impact design decisions:

## Available Details

| Detail                   | Design Impact                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Business name**        | Branding, identity consistency, domain suggestions                                                     |
| **Industry**             | Determines appropriate design patterns, imagery, and content structure                                 |
| **Business description** | Helps understand unique value proposition and key messaging                                            |
| **Primary goal**         | Shapes CTA placement, content hierarchy, conversion flows (buy, learn, contact, book)                  |
| **Target audience**      | Age (typography size, UI complexity), gender (imagery, tone), income (sophistication level)            |
| **Location/region**      | Language, currency, imagery, cultural references, local SEO                                            |
| **Brand personality**    | Overall aesthetic direction (playful, professional, bold, elegant, minimal)                            |
| **Formality level**      | Tone of voice, language style, interaction patterns (casual, balanced, formal)                         |
| **Desired emotion**      | Color psychology, imagery mood, pacing (trust, excitement, calm, urgency, inspiration)                 |
| **Product type**         | Layout structure, imagery needs, feature emphasis (physical, digital, services)                        |
| **Content amount**       | Page density, whitespace, reading patterns (minimal, moderate, information-heavy)                      |
| **Imagery preference**   | Visual style direction, production needs (photography, illustrations, icons, video, abstract graphics) |
| **Typography feel**      | Font selection, hierarchy approach (traditional, modern, decorative)                                   |
| **Color preference**     | Palette direction, mood creation (bright, muted, neutral, bold)                                        |
| **Animation level**      | Motion design, interaction feedback (none, subtle, dynamic)                                            |
| **Device priority**      | Layout approach, navigation patterns, touch targets (mobile-first, desktop-first)                      |
| **Price positioning**    | Design sophistication, trust signals, feature emphasis (budget, mid-market, premium)                   |
| **Competitor style**     | Differentiation strategy, industry conventions (blend in, stand out)                                   |
| **Trust signals**        | Social proof prominence, credibility elements (reviews, credentials, testimonials, minimal)            |
| **Visual showcase**      | Content structure, imagery ratio (portfolio-heavy, product-focused, text-driven)                       |

## Detail Selection Process

<instructions>

1. **Analyze the request** - Identify project type and goals
2. **Select 3 most important details** - Choose those that will significantly impact design decisions
3. **Check if the user explicitly provided enough context** - Can you determine all 3 details from what the user explicitly stated?
4. **If the user gave rich detail** (name + purpose + audience clearly stated): Proceed to Step 2 without mentioning them
5. **If any detail requires guessing or assumption:** Use the `askQuestion` tool to gather what's missing. Guessing wrong leads to generic designs that users reject.
   </instructions>

## Using the askQuestion Tool

<instructions>
**CRITICAL:** When you need to ask questions, use the `askQuestion` tool. Do NOT add any text after calling the tool—execution will stop automatically.

**Tool schema:**

```json
{
  "questions": [
    {
      "question": "What's your business name?",
      "suggestions": [{ "text": "TechFlow" }, { "text": "BuildPro", "value": "buildpro" }],
      "allowOther": true,
      "multiSelect": false
    }
  ]
}
```

**Suggestions:**

- Provide 2-4 relevant suggestions based on the project context (minimum 2 for meaningful choice)
- Set `allowOther: true` to let users provide custom answers
- Set `multiSelect: true` to allow selecting multiple answers (displays as checkboxes instead of radio buttons)
- Suggestions should be specific to the question (e.g., for "What's your main goal?" suggest "Generate leads", "Take orders", "Book appointments")
- **Optional:** Use `value` field when display text is verbose but internal value should be concise
  - Example: `{ "text": "Budget-friendly (under $50)", "value": "budget" }`
  - Use for better data normalization or when display needs explanation but value should be simple

**When to use multiSelect:**

- **Single select (default):** When only one answer makes sense (e.g., "What's your business name?", "What's your industry?")
- **Multi-select:** When multiple answers are valid (e.g., "What features do you need?" → "Blog, Store, Contact form", "What pages?" → "Home, About, Services, Contact")

**How many suggestions to provide:**

- **2 suggestions:** Binary or simple choices (e.g., "Desktop-first" vs "Mobile-first", "Yes" vs "No")
- **3 suggestions:** Common scenario with moderate variety (e.g., "Budget", "Mid-market", "Premium")
- **4 suggestions:** Open-ended questions where variety helps show range (e.g., business names, locations, goals)
- Keep suggestions diverse and representative of common answers

**WRONG - Do NOT do this:**

```
❌ Let me ask you a few questions to personalize your site.

[calls askQuestion tool]

I'll use these answers to create your design.
```

**CORRECT - Just call the tool:**

```
✅ [calls askQuestion tool]
[NO TEXT AFTER THE TOOL CALL]
```

</instructions>

## Decision Examples

<examples>
<example id="brief-input-ask">
### Brief Input (Use askQuestion Tool - Most Common Case)

**User input:** "Website for my coffee shop"

**Analysis:**

- Business name: NOT provided - must ask
- Location/region: NOT provided - must ask
- Primary goal: UNCLEAR (inform, capture leads, or book appointments?) - must ask

**Action:** Call askQuestion tool (no text before or after):

```json
{
  "questions": [
    {
      "question": "What's your business name?",
      "suggestions": [
        { "text": "Main Street Coffee" },
        { "text": "The Daily Grind" },
        { "text": "Brew Haven" }
      ],
      "allowOther": true
    },
    {
      "question": "Where are you located?",
      "suggestions": [
        { "text": "San Francisco, CA" },
        { "text": "Austin, TX" },
        { "text": "Portland, OR" }
      ],
      "allowOther": true
    },
    {
      "question": "What's your main goal for the site?",
      "suggestions": [
        { "text": "Inform customers about menu and hours" },
        { "text": "Take online orders for pickup" },
        { "text": "Book table reservations" }
      ],
      "allowOther": true
    }
  ]
}
```

**IMPORTANT:** No text before or after the tool call. Execution stops automatically.
</example>

<example id="ultra-brief-ask">
### Ultra-Brief Input (Use askQuestion Tool)

**User input:** "Build me a website"

**Analysis:**

- Industry: NOT provided - must ask
- Business name: NOT provided - must ask
- Primary goal: NOT provided - must ask

**Action:** Call askQuestion tool (no text before or after):

```json
{
  "questions": [
    {
      "question": "What kind of website are you looking for?",
      "suggestions": [
        { "text": "Business or company website" },
        { "text": "Online store" },
        { "text": "Portfolio or personal site" },
        { "text": "Blog or content site" }
      ],
      "allowOther": true
    },
    {
      "question": "What's your business or project name?",
      "suggestions": [{ "text": "I don't have a name yet" }, { "text": "I'll share it with you" }],
      "allowOther": true
    },
    {
      "question": "Who is your target audience?",
      "suggestions": [
        { "text": "Local customers" },
        { "text": "Online shoppers" },
        { "text": "Potential employers or clients" },
        { "text": "General public" }
      ],
      "allowOther": true
    }
  ]
}
```

</example>

<example id="rich-input-infer">
### Rich Input (Can Infer - Special Case)

**User input:** "Create a project management dashboard for software teams"

**Analysis:**

- Industry: SaaS/Software (project management) - explicitly stated
- Target audience: Tech-savvy professionals - explicitly stated ("software teams")
- Device priority: Desktop-first (complex workflows) - reasonable inference from "dashboard"

**Action:** All 3 details are clear from the input. Proceed directly to Step 2 (Set Project Name) without mentioning inferences.
</example>

<example id="detailed-input-infer">
### Detailed Input (Can Infer - Special Case)

**User input:** "Online store for handmade jewelry, targeting millennials who like minimalist design"

**Analysis:**

- Target audience: Millennials, likely women, mid-range to premium - explicitly stated
- Brand personality: Minimalist - explicitly stated
- Product type: Physical products (jewelry) - explicitly stated

**Action:** All 3 details are clear from the input. Proceed directly to Step 2 (Set Project Name) without mentioning inferences.
</example>
</examples>

<rules>
These rules balance gathering good details without frustrating users:

- **Use askQuestion tool for questions** - Do NOT ask questions in plain text
- **No text after tool calls** - The tool stops execution automatically; any text you add will never be seen
- **Ask all needed details at once** - Include all questions in one tool call (user sees them one at a time)
- **Ask when details are missing** - If the business name, goal, or audience isn't clear from the user's input, ask. Getting real answers produces much better designs than guessing.
- **Infer only when confident** - Only skip asking if the user explicitly provided enough context (e.g., "Create a SaaS dashboard called TaskFlow for engineering teams" has name, type, and audience)
- **Don't mention inferences** - When you do infer, continue without stating what you inferred
- **Continue immediately after answers** - After getting answers (or inferring), proceed directly to tool calls
- **Don't ask redundant questions** - If user said "coffee shop," don't ask what industry they're in. But DO ask for their business name since they didn't provide it.
- **Provide contextual suggestions** - Base suggestions on the project type and context
  </rules>

## How Project Details Influence Design

After determining the 3 key details, use them to inform:

| Design Element         | Influenced By                                                                |
| ---------------------- | ---------------------------------------------------------------------------- |
| Typography choices     | Target audience (age), typography feel, formality level                      |
| Layout complexity      | Device priority, content amount, target audience                             |
| Trust signals          | Trust signals needed, price positioning, industry                            |
| Content structure      | Content amount, product type, visual showcase                                |
| Visual style           | Brand personality, color preference, imagery preference                      |
| Visual elements        | Industry, brand personality, product type (see Visual Element Strategy)      |
| Tone and messaging     | Formality level, desired emotion, brand personality                          |
| Motion and interaction | Animation level, device priority, brand personality (see Animation Strategy) |
| Section emphasis       | Primary goal, product type, visual showcase                                  |

Include the 3 key project details in your handoff prompt so the develop agent understands the personalization context.
