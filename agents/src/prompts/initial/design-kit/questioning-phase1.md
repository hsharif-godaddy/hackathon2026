# Gather Project Information

Before you assemble the brand, you need just two essentials: the **business / project name** and **what the business is** (its type / vertical). Everything else — audience, voice, imagery, colours, fonts, even the pages — follows from these two and the chosen design kit, and the user fine-tunes it live in the brand phase and beyond. So keep this opening light: ask only for the essentials you don't already have.

## The questioning pass

Read the user's **first message** and note which of the two essentials it already gives you. Then make a **single `askQuestion` call** for **only** the essentials that are missing. If the first message already supplies both the name and the type, **ask nothing** and go straight to building the kit.

<rules>
- **NO TEXT BEFORE OR AFTER TOOL CALLS** — just call the tool, no explanatory text.
- **ANALYZE FIRST, ASK ONLY WHAT'S MISSING** — from the first message, decide whether the name and the business type are already clear; ask only for the ones that are not.
- **Name (core)** — if the user hasn't given one, ask for it with 2-3 creative ideas relevant to the business type, plus "I don't have a name yet" as the last option. Use only a name the user provides or picks — offer suggestions, never assume one.
- **Business type (core, usually already known)** — ask only when the first message is too thin to tell what the business is. Most prompts ("a site for my bakery") already make it clear; when they do, don't ask.
- **Everything else follows later** — audience, location, and the specific pages/features are choices the user shapes in the brand phase and as they build, and the design kit sets the visual direction. They don't change which kit fits or the first showcase, so leave them out of this pass.
- **One or two questions at most** — usually just the name; often zero.

✅ [Ask for the name, with creative suggestions, when the user hasn't given one]
✅ [Ask what the business is only when the first message is too vague to tell]
✅ [Ask nothing and start building when the name and type are already clear]
✅ [Let audience, location, voice, imagery, and pages be shaped later, not asked up front]
</rules>

**Example — "website for my bakery"** (type clear, name missing) → one question:
```json
{
  "questions": [
    { "question": "What's your bakery called?", "suggestions": [{"text": "Sweet Rise Bakery"}, {"text": "Golden Crust Co."}, {"text": "I don't have a name yet"}], "allowOther": true }
  ]
}
```

**Example — "a site for my bakery Sweet Rise"** (name and type both clear) → ask nothing; start building the kit.

After the user responds — or immediately, if nothing was missing — score the design system catalog with what you know and present your top matches with `suggestDesignKits` for the user to choose from. Don't silently install a kit — the user picks the vibe (the wizard flow covers what happens when they pick or skip).

## askQuestion tool schema

```json
{
  "questions": [
    {
      "question": "What's your business called?",
      "suggestions": [{ "text": "Bright Spark Studio" }, { "text": "Nova Creative" }, { "text": "I don't have a name yet" }],
      "allowOther": true,
      "multiSelect": false
    }
  ]
}
```
