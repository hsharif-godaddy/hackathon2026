# Attribute Discovery - Personalization Requirements

<context>
Generic designs fail because they don't account for audience-specific needs. A site for teenagers needs different typography than one for seniors. A B2B SaaS needs different trust signals than a consumer app. Identifying the right attributes upfront prevents building the wrong thing.
</context>

Before creating the design plan, identify the 3 most important attributes for this project. These attributes directly impact design decisions:

## Available Attributes

| Attribute                | Design Impact                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| **Business name**        | Branding, identity consistency, domain suggestions                                          |
| **Industry**             | Determines appropriate design patterns, imagery, and content structure                      |
| **Business description** | Helps understand unique value proposition and key messaging                                 |
| **Primary goal**         | Shapes CTA placement, content hierarchy, conversion flows (buy, learn, contact, book)       |
| **Target audience**      | Age (typography size, UI complexity), gender (imagery, tone), income (sophistication level) |
| **Location/region**      | Language, currency, imagery, cultural references, local SEO                                 |
| **Brand personality**    | Overall aesthetic direction (playful, professional, bold, elegant, minimal)                 |
| **Formality level**      | Tone of voice, language style, interaction patterns (casual, balanced, formal)              |
| **Desired emotion**      | Color psychology, imagery mood, pacing (trust, excitement, calm, urgency, inspiration)      |
| **Product type**         | Layout structure, imagery needs, feature emphasis (physical, digital, services)             |
| **Content amount**       | Page density, whitespace, reading patterns (minimal, moderate, information-heavy)           |
| **Imagery preference**   | Visual style direction, production needs (photography, illustrations, icons, video)         |
| **Typography feel**      | Font selection, hierarchy approach (traditional, modern, decorative)                        |
| **Color preference**     | Palette direction, mood creation (bright, muted, neutral, bold)                             |
| **Animation level**      | Motion design, interaction feedback (none, subtle, dynamic)                                 |
| **Device priority**      | Layout approach, navigation patterns, touch targets (mobile-first, desktop-first)           |
| **Price positioning**    | Design sophistication, trust signals, feature emphasis (budget, mid-market, premium)        |
| **Competitor style**     | Differentiation strategy, industry conventions (blend in, stand out)                        |
| **Trust signals**        | Social proof prominence, credibility elements (reviews, credentials, testimonials, minimal) |
| **Visual showcase**      | Content structure, imagery ratio (portfolio-heavy, product-focused, text-driven)            |

## Attribute Selection Process

<explicit_instruction>

1. **Analyze the request** - Identify project type and goals
2. **Select 3 most important attributes** - Choose those that will significantly impact design decisions
3. **Check if you can infer answers** - Often the user's description contains enough context
4. **If you can infer all 3:** Document assumptions briefly and continue immediately
5. **If you cannot infer all 3:** Ask ONE question with a numbered list that covers all needed attributes, then continue after response
   </explicit_instruction>

## Decision Examples

### Example 1: Can Infer All (Continue Immediately)

**User:** "Create a project management dashboard for software teams"

**Analysis:**

- Industry: SaaS/Software (project management) ✓
- Target audience: Tech-savvy professionals, all ages, mid-range to premium ✓
- Device priority: Desktop-first (complex workflows) ✓

**Action:** Continue with brief documentation: "I'm designing for a SaaS project management tool targeting tech-savvy professionals on desktop—proceeding with the design."

### Example 2: Need to Ask (One Question)

**User:** "Website for my coffee shop"

**Analysis:**

- Business name: NOT provided ✗
- Location/region: NOT provided ✗
- Primary goal: UNCLEAR (inform, capture leads, or book appointments?) ✗

**Action:** Ask ONE question with numbered list:

"To personalize your coffee shop site, I need to know:

1. What's your business name?
2. Where are you located?
3. What's your main goal—inform customers, take online orders, or book reservations?"

### Example 3: Partial Inference

**User:** "Online store for handmade jewelry, targeting millennials who like minimalist design"

**Analysis:**

- Target audience: Millennials (young to middle-aged), likely women, mid-range to premium ✓
- Brand personality: Minimalist ✓
- Product type: Physical products (jewelry) ✓

**Action:** Continue without asking—all key attributes can be inferred: "I'm designing a minimalist e-commerce site for handmade jewelry targeting millennials—proceeding with the design."

<important_rules>
These rules exist because asking too many questions frustrates users:

- **ONLY ask 1 question** - Never ask multiple questions in sequence
- **Use numbered lists for clarity** - When asking for multiple attributes, format as numbered list
- **Ask for all needed attributes at once** - Combine into one question with numbered items
- **Prefer inference over asking** - If you can reasonably determine an attribute, do so
- **Document assumptions** - State what you inferred so user can correct if wrong
- **Continue immediately** - After getting answers (or inferring), proceed with design
- **Don't ask for obvious attributes** - If user said "coffee shop," don't ask what industry they're in
  </important_rules>

## How Attributes Influence Design

After determining the 3 key attributes, use them to inform:

| Design Element         | Influenced By                                           |
| ---------------------- | ------------------------------------------------------- |
| Typography choices     | Target audience (age), typography feel, formality level |
| Layout complexity      | Device priority, content amount, target audience        |
| Trust signals          | Trust signals needed, price positioning, industry       |
| Content structure      | Content amount, product type, visual showcase           |
| Visual style           | Brand personality, color preference, imagery preference |
| Tone and messaging     | Formality level, desired emotion, brand personality     |
| Motion and interaction | Animation level, device priority, brand personality     |
| Section emphasis       | Primary goal, product type, visual showcase             |

Include the 3 discovered attributes in your handoff prompt so the develop agent understands the personalization context.
