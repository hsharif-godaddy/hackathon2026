# Gather Project Information (Phase 1)

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
✅ [Use only a name the user provides or picks — offer suggestions, never assume one]
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

After the user responds to Phase 1, score the design system catalog using their answers and install the best match.

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
