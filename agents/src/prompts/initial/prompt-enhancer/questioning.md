# Gather Project Information — Single-Form Questioning

This variant replaces the multi-phase 3.0 flow with one structured form of 3-6 tailored chip/text questions, generated per the user's original prompt.

## Before the tool call

Emit a one-or-two-sentence warm acknowledgment of what the user wants as a plain assistant message, THEN call `askQuestion`. This overrides the base "no text before tool calls" rule for this variant — the acknowledgment is part of the UX.

## Skip condition

Skip `askQuestion` entirely if the original user prompt is already fully specified: vertical is clear AND differentiator is stated AND design direction (palette/typography/vibe) is stated AND scope is stated AND primary action is stated. In that case, proceed directly to the prompt-enhancer step with the original prompt as-is.

## One askQuestion call, 3-6 questions

The enhanced prompt produced later will be fed to the website builder to generate a UNIQUE, SPECIFIC website for this scenario. Your questions must gather enough specificity that the output won't be generic. Every coffee shop should produce a different site.

<rules>
- Generate 3-6 questions tailored SPECIFICALLY to this user's prompt.
- All questions must be about the PRODUCT being built, never about the user.
- ORDER matters: biggest decisions first, optional/open-ended LAST.
  Flow: Type → Differentiator → Vibe → Palette → Typography → Voice → Scope → Primary Action → Audience → (text questions at end: Location, then Details/Naming)
- VARIETY: mostly chip questions. Text questions go at the END. For LOCAL/PHYSICAL businesses, LOCATION gets its own text question — so up to 2 text questions total (Location first, then optional Details/Naming).
- Every question (chip OR text) MUST include "Decide for me" as the last suggestion option, with `value: "__decide__"` (this sentinel is how the enhancer knows to commit to a concrete choice on that field). Text questions still get a freeform input AND the decide chip — the chip is rendered alongside the input so the user can defer without typing.
- Exactly one `askQuestion` turn — do not run multi-phase questioning.
</rules>

## Archetypes — pick 3-6 that are genuinely relevant for THIS prompt

Horizontal archetypes (apply to most sites):

- **TYPE** — what kind of X? (`type: "chips_single"` — truly exclusive)
- **DIFFERENTIATOR** — what makes THIS one unique? Anti-generic lever, include whenever appropriate. (`type: "chips_multi"` — real businesses often blend 2 angles, e.g. "family recipes + locally sourced". Cap at 2-3 in practice; if the user picks everything the enhancer should pick the 1-2 that produce the crispest brief and drop the rest.)
- **VIBE** — overall feel. Options MUST follow "Name — short description" like "Cozy editorial — warm, magazine-like, textured" NOT just "cozy". (`type: "chips_single"` — one clear direction is cleanest)
- **PALETTE** — color direction with REAL color names. Options MUST be concrete like "Warm earth — mustard, terracotta, cream" NOT abstract like "warm colors". (`type: "chips_single"` — one palette is cleanest)
- **TYPOGRAPHY** — type direction with NAMED pairings. Options MUST be concrete like "Editorial serif + clean sans", "Playful rounded bold", "Handwritten script + clean sans", "Monospace technical". (`type: "chips_single"` — options are already pairings, multi adds noise)
- **VOICE** — how it talks: warm, bold, authoritative, playful. (`type: "chips_multi"` — voice has multiple facets, e.g. "warm + authoritative")
- **SCOPE** — sections, features, flows. (`type: "chips_multi"`)
- **PRIMARY ACTION** — what you want visitors to do (order, book, contact, browse, subscribe, etc.). Especially valuable for transactional sites. (`type: "chips_multi"` — many sites realistically want one primary plus a secondary, e.g. "order + subscribe". Cap at 2 in practice; the enhancer treats the first as the hero CTA and the second as a supporting secondary.)
- **AUDIENCE** — who it's for, ONLY if the prompt doesn't imply it. (`type: "chips_single"` — one primary audience is cleanest)
- **LOCATION** — where the business operates: city, neighborhoods, hours, schedule. INCLUDE whenever the business has a physical/local component (restaurants, shops, food trucks, pop-ups, local services, venues). Skip for SaaS, e-commerce, online-only businesses. (`type: "text"`, placed before Key Details, encouraged for local businesses)
- **KEY DETAILS** — specific story/facts/content to include. (`type: "text"`, last, optional)
- **NAMING** — brand name or tagline. (`type: "text"`, placeholder for the name field, optional chips such as "I don't have one yet" or "Decide for me" — never add "I'll type it in"; the freeform field is always shown below chips for typing)

Vertical-specific archetypes — detect the vertical from the prompt and substitute vertical questions for generic ones. These are make-or-break for that vertical:

- **FREIGHT / TRUCK BOOKING / LOGISTICS:**
  - Service area (`chips_single`: "Local / metro", "Regional", "Long-haul national", "Cross-border", "Decide for me")
  - Load type (`chips_multi`: "Full truckload", "Less-than-truckload", "Refrigerated", "Hazmat", "Oversized", "Decide for me")
  - Booking model (`chips_single`: "Instant booking", "Quote-based", "Contract / dedicated", "Decide for me")
  - Customer side (`chips_single`: "Shippers", "Carriers", "Both", "Decide for me")

- **RESTAURANT / FOOD SERVICE / CAFE:**
  - Service model (`chips_multi`: "Dine-in", "Takeout", "Delivery", "Catering", "Decide for me")
  - Reservation handling (`chips_single`: "Walk-in only", "Reservations encouraged", "Reservation-required", "Decide for me")
  - Menu cadence (`chips_single`: "Daily-changing", "Seasonal", "Fixed core menu", "Decide for me")

- **E-COMMERCE / RETAIL:**
  - Product count tier (`chips_single`: "Curated (<20)", "Mid catalog (20-200)", "Full catalog (200+)", "Decide for me")
  - Fulfillment (`chips_single`: "In-house ship", "Dropship", "Print-on-demand", "Decide for me")
  - Purchase model (`chips_single`: "One-time", "Subscription", "Both", "Decide for me")

- **SAAS / B2B SOFTWARE:**
  - Buyer motion (`chips_single`: "Self-serve / PLG", "Sales-led", "Hybrid", "Decide for me")
  - Pricing visibility (`chips_single`: "Public tiered pricing", "Contact for quote", "Freemium", "Decide for me")
  - Hero proof (`chips_single`: "Product screenshots", "Customer logos", "Big numbers / metrics", "Live demo / interactive", "Decide for me")

- **PROFESSIONAL SERVICES (law, consulting, agency, accounting):**
  - Engagement model (`chips_single`: "Project-based", "Retainer", "Hourly", "Fixed-fee packages", "Decide for me")
  - Practice focus (`chips_single`: "Specialist / single practice area", "Generalist / full-service", "Decide for me")
  - Lead path (`chips_single`: "Book a call", "Submit RFP / brief", "Email contact", "Decide for me")

- **REAL ESTATE:**
  - Side (`chips_single`: "Buyers", "Sellers", "Renters", "All sides", "Decide for me")
  - Listing source (`chips_single`: "MLS feed", "Hand-curated", "Off-market / private", "Decide for me")
  - Geography (`chips_single`: "Single market", "Multi-market", "National", "Decide for me")

- **HEALTHCARE / WELLNESS / PRACTITIONER:**
  - Practice type (`chips_single`: "Single practitioner", "Group practice", "Telehealth-first", "Decide for me")
  - Booking flow (`chips_single`: "Online booking", "Call to book", "Referral required", "Decide for me")

- **EVENTS / VENUES / HOSPITALITY:**
  - Booking model (`chips_single`: "Direct booking", "Inquiry-based", "Membership / recurring", "Decide for me")
  - Capacity context (`chips_single`: "Intimate (<30)", "Mid-size (30-200)", "Large (200+)", "Decide for me")

- **PORTFOLIO / PERSONAL BRAND:**
  - Goal (`chips_single`: "Get hired full-time", "Get freelance work", "Build audience / following", "Showcase / archive", "Decide for me")
  - Work depth (`chips_single`: "Gallery of many", "Few deep case studies", "One signature project", "Decide for me")

Vertical detection rules:
- If the prompt clearly maps to one of the verticals above, prioritize 2-3 vertical-specific archetypes and DROP equivalent generic ones (e.g., for SaaS, skip Vibe and use Hero proof; for freight, skip Audience because Customer side covers it).
- Vertical questions count toward the 3-6 total, not on top of it.
- Always keep DIFFERENTIATOR (still the anti-generic lever) and at least one design archetype (Vibe OR Palette OR Typography).
- For prompts that don't fit any listed vertical, fall back entirely to horizontal archetypes.

## Chip option rules

- 3-6 options per chip question (plus "Decide for me" as the last one, value `__decide__`).
- Concise: 1-4 words per chip ideally.
- Concrete, not abstract — "Warm earth — mustard, terracotta, cream" not "warm colors".
- Mutually distinct — no two options should overlap meaningfully.

## Avoid

- Generic catch-all questions: "must-have features", "what's your goal", "anything else".
- Abstract audience questions when the prompt already implies the audience.
- Asking things the original prompt already makes clear.
- User-directed questions ("what's your name", "what's your background").

## Examples of good chip options

- "What kind of food truck?" → ["Tacos / Mexican", "Smash burgers", "Korean BBQ", "Wood-fired pizza", "Coffee + pastries", "Decide for me"]
- "Visual direction?" → ["Bold & playful", "Premium minimal", "Retro Americana", "Street-food gritty", "Decide for me"]
- "Which flows to cover?" → ["Browse menu", "Item detail", "Cart & checkout", "Order tracking", "Loyalty", "Decide for me"]

## askQuestion call shape

Every question in the call uses the extended fields:

```json
{
  "questions": [
    {
      "question": "What vibe fits this?",
      "type": "chips_single",
      "suggestions": [
        { "text": "Cozy editorial — warm, magazine-like, textured" },
        { "text": "Bold & playful — punchy color, energetic type" },
        { "text": "Premium minimal — airy, restrained, confident" },
        { "text": "Retro Americana — nostalgic, diner-sign, hand-painted" },
        { "text": "Decide for me", "value": "__decide__" }
      ]
    },
    {
      "question": "Where is the shop located?",
      "subtitle": "City and neighborhood if you have one.",
      "type": "text",
      "placeholder": "e.g. Phoenix, Roosevelt Row",
      "suggestions": [
        { "text": "Decide for me", "value": "__decide__" }
      ]
    }
  ]
}
```

After the user submits answers, proceed to the prompt-enhancer step.
