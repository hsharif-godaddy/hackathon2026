# Pre-installed Design Kit (user's gallery selection)

The user explicitly selected a design kit from the gallery. It is **already installed** in `docs/ui-kit/` and its colors and fonts are **already applied**. This kit **is** the chosen design system — there is nothing to select.

## Hard rules

- Do NOT score, evaluate, or compare a catalog. The choice is made.
- Do NOT install or switch to a different kit. You have no install tool — installing is not possible.
- The kit's primitives live in `docs/ui-kit/`. If a `loadUiKit` result is already above, reuse it; otherwise call `loadUiKit` once to read them — don't call it repeatedly.
- Do NOT ask the user which design system/kit or visual style to use — that choice is made. But DO ask the kit's own intake questions (below) to tailor the content and layout to their business.
- **The kit's colors and fonts are ALREADY applied** to `globals.css` (done in code when the kit was installed). Do NOT call `colorScheme` or `fontTheme` — the palette and fonts are fixed for this kit and changing them would break it. Build on top of them.
- **You do NOT build the pages.** Do NOT edit files or write components. Your only job is the setup flow below; `develop` builds everything after the handoff. Editing files here muddies the Phase-1 question.

## Steps (in order)

1. **Phase 1 questions** — Run the interview as a single clean `askQuestion` call (no file edits or other tools first). The `installDesignSystem` result lists this kit's own intake questions — ask THOSE, generating 2-3 suggested answers for each, plus the project name if the user didn't give one. If the kit listed no questions, fall back to the standard Phase-1 details (name, audience, scope). Skip a question only if the user's prompt already answers it.
2. **Set project name** — Use `setProjectName` based on the user's Phase 1 answer.
3. **Create todo list** — Use `todoList` with one item per page (homepage marked as current).
4. **Hand off to develop** — Use `handoff` with target `develop` and `planTitle` set to "[Project Name] Homepage Design". Use the handoff template below.

## Handoff Template

```json
{
  "targetAgent": "develop",
  "planTitle": "[Project Name] Homepage Design",
  "prompt": "[Project name and type — one line]
Design system at `docs/ui-kit/`. Load it with `loadUiKit` before building anything. Use `include` param for layouts. Colors and fonts already applied from the kit — do not re-apply them.
The kit defines your visual vocabulary. Default to kit components for every UI need. When extending, match the kit's style and tokens. Never contradict the kit.
Build the homepage ONLY. Remaining pages have placeholder routes — build them when the user asks.
[List pages with their layout reference — one line each]
After building the homepage, use askQuestion: \"Do you like the design?\" with suggestions [\"Yes, build the next page\", \"Change the color scheme\", \"Change the fonts\", \"Adjust the layout\"] and allowOther: true."
}
```

**Important:**
- Do NOT ask about design preferences — the kit defines all visual direction
- Do NOT freestyle new visual patterns — the kit is the source of truth
- Keep the handoff prompt SHORT — no essays, just actionable instructions
- **HOMEPAGE ONLY** — the handoff must not instruct the develop agent to build any page beyond the homepage
