# Project Name

The project needs a real name before hand-off. **Do not invent a generic name** (e.g. "Boutique Clothing Store", "Bakery Website", "Restaurant Site"). Generic names poison the downstream brief and design work — the user opted into Deep Build because they want craft, not placeholder copy.

## Decision tree

1. **Did the user's initial prompt contain an explicit brand name?** Look for phrases like "called <Name>", "named <Name>", "for my company <Name>", "<Name> is a boutique that…". If yes, call `setProjectName` with that exact name (in title case) and skip to the summary step.

2. **No explicit name?** Call `askQuestion` with a single question asking for the brand name. Offer 3–4 distinctive suggestions specific to the project type the user described, plus the default "Other" option so the user can type their own.

## askQuestion rules for the name question

- **Exactly one question**, not stacked with the summary question.
- `multiSelect: false`, `allowOther: true` (implicit default, but be explicit in the call).
- **Suggestions must be distinctive**, not descriptive. A descriptive name ("Fashion Forward", "The Clothing Store", "Style Hub") tells you what the business is; a distinctive name ("Lumen & Ash", "Verdigris", "Sable House") tells you what the brand feels like. Generate suggestions in the distinctive register.
- Tune suggestions to the project's vibe if the user's prompt gives you tonal cues (luxury vs. playful vs. minimalist vs. rustic). If no tonal cues, offer a range of 3 contrasting options so the user's pick is informative.
- Keep each suggestion to **1–3 words**, title case, no trailing punctuation.

## Example

User prompt: *"Build an online store for my boutique clothing brand with product pages, shopping cart, and checkout"*

Wrong — generic auto-generation:
```json
{ "name": "Boutique Clothing Store" }
```

Right — ask with distinctive suggestions:
```json
{
  "questions": [{
    "question": "What's the brand called?",
    "suggestions": [
      { "text": "Lumen & Ash" },
      { "text": "Verdigris" },
      { "text": "Sable House" },
      { "text": "Foundry Seven" }
    ],
    "allowOther": true,
    "multiSelect": false
  }]
}
```

After the user picks or types their name, call `setProjectName` with the selected value verbatim. Title-case it if they typed it in all-lowercase; otherwise preserve casing.

## Hard rules

- If the user picks a suggestion, use it exactly. Do not "improve" it.
- If the user types their own via Other, use it exactly. Do not rename it.
- Never call `setProjectName` with a generic descriptor like "Online Store", "Cafe Website", "Portfolio Site".
