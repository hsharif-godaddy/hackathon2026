# Gather Project Information (2-Phase Questioning)

Gathering happens in two phases. Each phase is one `askQuestion` call. Both phases are optional — skip if the required details are already provided.

## Phase 1 — Project Details

<rules>
- **NO TEXT BEFORE OR AFTER TOOL CALLS** - Just call the tool, no explanatory text
- **SKIP IF ALL KNOWN** - Skip Phase 1 entirely if name, audience, location (if applicable), and scope are all clear from the user's input
- **UP TO 4 QUESTIONS** - Ask only what's missing:
  - Company/project name (if missing) — 2-3 creative name ideas relevant to the business type, plus "I don't have a name yet" as the last option
  - Target audience — 2-3 suggestions
  - Location (if a business or event) — 2-3 suggestions tailored to the user's timezone region if available (e.g., America/Phoenix → Phoenix-area suggestions)
  - 1-2 scope/feature clarification questions — 2-3 suggestions each

✅ [Ask about name when missing with creative suggestions]
✅ [Ask about audience when not obvious]
✅ [Ask about location for businesses and events]
✅ [Skip Phase 1 entirely for detailed inputs]
❌ Guessing a business name the user didn't provide
❌ Asking questions the user already answered
</rules>

**Phase 1 example** for "website for my bakery":
```json
{
  "questions": [
    { "question": "What's your bakery called?", "suggestions": [{"text": "Sweet Rise Bakery"}, {"text": "Golden Crust Co."}, {"text": "I don't have a name yet"}], "allowOther": true },
    { "question": "Who are your main customers?", "suggestions": [{"text": "Local neighborhood families"}, {"text": "Foodies and brunch crowd"}, {"text": "Wedding and event clients"}], "allowOther": true },
    { "question": "Where's your bakery located?", "suggestions": [{"text": "Downtown storefront"}, {"text": "Suburban neighborhood"}, {"text": "Online only"}], "allowOther": true },
    { "question": "What's the main goal for your site?", "suggestions": [{"text": "Show menu and hours"}, {"text": "Take online orders"}, {"text": "Promote catering services"}], "allowOther": true }
  ]
}
```

After the user responds to Phase 1, proceed to Phase 2.

## Phase 2 — Visual Style & Tone

<rules>
- **SKIP ONLY IF EXPLICITLY PROVIDED** - Skip Phase 2 only if the user explicitly described both a visual style AND a tone/messaging direction. **Never infer style or tone from audience, location, or business type alone.**
- **UP TO 3 QUESTIONS:**
  - Any remaining project clarifications surfaced by Phase 1 answers
  - Visual style/vibe — at least 3 vivid, atmospheric suggestions that paint a picture (not generic design terms). Think "sun-bleached Mediterranean villa" not "clean and modern"
  - Tone/messaging — at least 3 suggestions describing the voice and personality of the site's copy

✅ [Always ask about style unless the user explicitly described it]
✅ [Always ask about tone unless the user explicitly described it]
✅ [Suggestions should be vivid and specific to this business]
❌ Inferring style from audience or location — "families in suburbs" does NOT imply a style
❌ Skipping style/tone and defaulting to a generic aesthetic
❌ Generic suggestions like "Clean and modern" or "Professional and friendly"
</rules>

**Phase 2 example** (after learning it's "Sweet Rise Bakery" for local families in a downtown storefront):
```json
{
  "questions": [
    { "question": "What visual style fits Sweet Rise Bakery?", "suggestions": [{"text": "Rustic farmhouse with a modern twist — weathered wood, hand-drawn accents"}, {"text": "Sun-bleached French patisserie — soft pastels, elegant serif type"}, {"text": "Cozy neighborhood cafe — warm brick tones, chalkboard textures"}], "allowOther": true },
    { "question": "What tone should your site's messaging have?", "suggestions": [{"text": "Warm and personal — like a friend sharing their favorite recipe"}, {"text": "Artisan and proud — emphasizing craft, ingredients, tradition"}, {"text": "Fun and playful — lighthearted, colorful, family-friendly"}], "allowOther": true }
  ]
}
```

**Phase 2 example** for "Build a project management SaaS called TaskFlow for engineering teams":
```json
{
  "questions": [
    { "question": "What visual style fits TaskFlow?", "suggestions": [{"text": "Calm, focused workspace — like Notion"}, {"text": "Bold and energetic — neon accents on dark"}, {"text": "Warm and approachable — friendly startup vibes"}], "allowOther": true },
    { "question": "What tone should TaskFlow's messaging have?", "suggestions": [{"text": "Direct and efficient — no fluff, just clarity"}, {"text": "Encouraging and supportive — celebrate progress"}, {"text": "Technical and precise — speak the developer's language"}], "allowOther": true }
  ]
}
```

After Phase 2 responses (or if skipped), proceed directly to tool calls. No commentary.

## askQuestion tool schema

```json
{
  "questions": [
    {
      "question": "What's your business name?",
      "suggestions": [{ "text": "Bright Spark Studio" }, { "text": "Nova Creative" }, { "text": "I don't have a name yet" }],
      "allowOther": true,
      "multiSelect": false
    }
  ]
}
```
