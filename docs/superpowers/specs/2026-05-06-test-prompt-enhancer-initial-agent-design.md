# Test Prompt Enhancer — Initial Agent Variant

> **Retired (AIROBUILD-3487).** The `prompt-enhancer` initial-agent variant (profile + `agents/src/prompts/initial/prompt-enhancer/`) was removed. This spec is retained for historical context only.

> **Historical note (2026-05-11):** This spec captures the original design
> exploration and still uses the working name `test-prompt-enhancer`. The
> shipped variant is named **`prompt-enhancer`** (lives at
> `agents/src/prompts/initial/prompt-enhancer/`, registered via the agent
> profile `prompt-enhancer`) and its manifest uses `src: "variant"` (not
> `"template"`). It also overrides `handoff-template.md` in addition to
> `questioning.md` and `prompt-enhancer.md`. See the current files under
> `agents/src/prompts/initial/prompt-enhancer/manifest.json` and
> `agents/src/profiles/prompt-enhancer.json` for the as-implemented layout.

## Goal

Create a new initial-agent prompt variant, `test-prompt-enhancer`, that adapts a three-stage external-LLM flow (clarifying questions → enhanced brief → handoff) into a single AAB initial agent. Uses the prompt-manifest system (separate PR) with `3.0` as its base. Purpose is to validate whether up-front structured questioning plus an opinionated "enhance the brief" synthesis step produces better downstream results than the current conversational 3.0 flow.

This is explicitly a test agent. It is not replacing 3.0 and not on any default path.

## Dependencies

- Prompt manifest loader (`{ base, files: [{ src: "base" | "template", file }] }`) from the separate in-flight PR. This spec targets the world after that PR merges.
- No changes to the manifest loader itself are part of this spec.

## Layout

New directory: `agents/src/prompts/initial/test-prompt-enhancer/`

```
manifest.json
questioning.md          # overrides base: single-form 3–6 chip/text questions
prompt-enhancer.md      # new: enhance-brief instructions + "Decide for me" variant
```

`manifest.json`:

```json
{
  "base": "3.0",
  "files": [
    { "src": "base", "file": "identity.md" },
    { "src": "template", "file": "questioning.md" },
    { "src": "template", "file": "prompt-enhancer.md" },
    { "src": "base", "file": "project-name.md" },
    { "src": "base", "file": "feature-list.md" },
    { "src": "base", "file": "handoff-template.md" }
  ]
}
```

Intentionally omitted from 3.0: `design-direction.md`, `design-reference.md`, `examples.md`. The enhanced brief absorbs visual/voice direction into prose. Keeping the base design-fragment guidance alongside would create redundant/conflicting instructions for this variant. If the experiment shows the enhanced brief is weak on design direction, reintroduce them.

## askQuestion tool extension

Additive, backwards-compatible changes. Existing callers are unaffected; no existing field semantics change.

### Tool schema (`agents/src/tools/ai-lib-tools/ask-question.ts`)

Add three optional fields to each question object:

| Field         | Type                                                   | Purpose                                                       |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `subtitle`    | `string` (optional)                                    | Small helper text rendered under the question.                |
| `type`        | `'chips_single' \| 'chips_multi' \| 'text'` (optional) | Explicit input mode. Default behavior preserved when omitted. |
| `placeholder` | `string` (optional)                                    | Forwarded to the free-text input.                             |

### Type → existing-field mapping

| `type`         | `multiSelect` | `suggestions` | `allowOther` | UI                                        |
| -------------- | ------------- | ------------- | ------------ | ----------------------------------------- |
| `chips_single` | `false`       | required, ≥1  | `true`       | buttons + optional free-text              |
| `chips_multi`  | `true`        | required, ≥1  | `true`       | multi-select buttons + optional free-text |
| `text`         | n/a           | `[]` allowed  | `true`       | input only, no buttons                    |

When `type` is omitted, existing derivation rules apply (kept for back-compat).

Constraint relaxation: the current schema enforces `suggestions: min 1`. That minimum becomes conditional — required when `type` is absent, `chips_single`, or `chips_multi`; optional when `type === 'text'`. Existing callers (who omit `type`) are unaffected.

### "Decide for me" sentinel

For every `chips_single` and `chips_multi` question the agent emits, the last suggestion is `{ text: "Decide for me", value: "__decide__" }`. The agent inspects the returned `value` (not the display text) when deciding which enhancer variant / per-field commit behavior to apply.

### UI (`app/src/app/[market]/develop/components/tool-renderers/`)

- `AskQuestionToolRenderer.tsx`:
  - If `subtitle` present, render it below the question text.
  - If `type === 'text'`, skip the button grid and render `OptionInput` only.
  - Otherwise behavior unchanged.
- `OptionInput.tsx`:
  - Accept a `placeholder` prop sourced from `question.placeholder`; fall back to the existing translation key when absent.
- `OptionButton.tsx`: no change (button visuals stay as-is; this spec does not add "chip" styling).

No breaking changes. Existing 3.0 flows render identically.

## `questioning.md` (template override)

One `askQuestion` call, 3–6 questions generated per these rules (adapted from the original external-LLM question prompt):

1. Questions target the PRODUCT, never the user.
2. Order: biggest decisions first; optional/open-ended last. Flow: Type → Differentiator → Vibe → Palette → Typography → Voice → Scope → Primary Action → Audience → (text last: Location, then Details/Naming).
3. Mostly chip questions. Text questions go at the end. For local/physical businesses, Location gets its own text question (up to two text questions total).
4. Every chip question ends with the "Decide for me" sentinel option.
5. Vertical detection and archetype-substitution rules (freight, restaurant, e-commerce, SaaS, professional services, real estate, healthcare/wellness, events/venues, portfolio) carried over verbatim from the original prompt. Vertical questions count toward the 3–6 total.
6. Always keep DIFFERENTIATOR and at least one design archetype.
7. Chip option rules: 3–6 options plus "Decide for me", 1–4 words each, concrete not abstract, mutually distinct.

### Agent behavior specific to this variant

- Emit a one-or-two-sentence acknowledgment as an assistant message BEFORE the `askQuestion` tool call. This overrides the base 3.0 "no text before tool calls" rule for this variant only; the acknowledgment is part of the UX.
- Exactly one `askQuestion` turn — no multi-phase questioning.
- Skip the questioning turn entirely if the original user prompt is already fully specified (vertical, differentiator, design direction, scope, and primary action all present). Flow straight into the enhancer in that case.

Full rule text, archetype list, and vertical detection rules inline in the file (the original prompt's body, re-tuned from "respond with JSON" to "call askQuestion with these fields"). Examples of good chip options included.

## `prompt-enhancer.md` (new)

Activated after the `askQuestion` response returns (or immediately if questioning was skipped). Produces a 1–2 paragraph first-person project brief the agent will treat as authoritative for the rest of the conversation.

### Three sub-behaviors

| Condition                                                                                       | Variant                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User answered normally (no `__decide__` values)                                                 | **Standard enhancer**                                                                                                                                                          |
| User asked at the prompt level to "decide everything," or all/most chip values are `__decide__` | **Decide-for-me enhancer** (stronger opinionation, explicit instruction to invent a concrete differentiator)                                                                   |
| Mixed — some answers concrete, some `__decide__`                                                | Standard enhancer with per-field rule: for each `__decide__` value, commit to a specific concrete choice consistent with the other answers; never hedge, never leave ambiguity |

### Standard enhancer rules (inline in file)

- Preserve user's original intent completely.
- Weave into prose — no bullets, no headers, no lists.
- Be SPECIFIC and CONCRETE; a generic template should not be able to satisfy this brief.
- Name sections/pages explicitly when scope was provided.
- For repeating content blocks (drinks, services, case studies, team, plans), specify the per-instance content pattern.
- For categories named without specifics, invent 2–3 plausible concrete examples matching the brand direction and write them in.
- Describe visual direction, tone, and differentiators in actionable terms (e.g., "restrained palette with lots of whitespace" not "modern").
- State primary CTA explicitly when known.
- State device priority: mobile-first for consumer/transactional, desktop-balanced for B2B/content/research.
- For `__decide__` answers: commit to a specific concrete choice and write it in as if the user specified it.
- For skipped answers: omit that dimension entirely; do not invent.
- First person, 1–2 paragraphs.

### Decide-for-me enhancer rules (inline in file)

- Make ALL decisions: type, differentiator, vibe, palette, typography, voice, scope.
- Differentiator must be concrete and slightly unexpected — not "crafted with care" / "community-focused" / "quality ingredients". Example prompts: "seasonal syrup flights changing every Friday", "fixed-fee packages instead of billable hours", "one chef's tasting menu, changes weekly".
- Palette: real color names. Typography: named style pairings. Vibe/voice/scope: concrete and actionable.
- 1–2 paragraphs, first person, no meta-commentary about having made decisions.

### Authoritative-brief rule

Final section of the file: "From this point forward, treat the enhanced brief above as the user's actual request. Use it as the basis for the project-name step, feature-list step, and the handoff prompt. Do not refer back to the original raw prompt."

### User veto checkpoint

After synthesizing, emit the enhanced brief as a short assistant message with a line like "Here's what I'm building to — let me know if this isn't right, otherwise I'll keep going." No new tool. If the user replies with corrections, incorporate them into the brief; if they don't reply or reply positively, continue to project-name.

## Handoff wiring

No change to `handoff-template.md`. The enhanced brief is already in conversation context as the authoritative reference, which is what the template reads from. The `prompt-enhancer.md` "authoritative-brief rule" (above) is what actually drives the substitution — no template placeholder substitution exists in the loader today, and we don't need one.

## Agent registration

`test-prompt-enhancer` added to the registered initial modular agent id set (same mechanism used for profile-specific 3.x variants). Selectable via `/agent test-prompt-enhancer` or profile mapping. Not touched by default agent selection.

## Explicit non-goals

- No new chip-styling UI. Buttons stay as-is; the schema extension unlocks the form modes the prompt requires, not a visual refresh.
- No changes to manifest loader, agent router, default agent selection, or handoff tool.
- No variable-substitution engine in the prompt loader.
- No reintroduction of design-direction / design-reference / examples fragments in this variant (reconsidered after the experiment runs).
- No E2E test changes. This agent is opt-in and off the default path; regression risk is scoped to the askQuestion schema extension, which is backwards-compatible.

## Testing

- Unit test for `ask-question.ts` schema: the three new optional fields parse; omitting them yields identical behavior to today's schema.
- Unit test for `AskQuestionToolRenderer`: `type: 'text'` hides the button grid; `subtitle` renders; `placeholder` forwards to `OptionInput`.
- Manual smoke test: `/agent test-prompt-enhancer` in local dev with three seed prompts (one local physical business, one SaaS, one fully-"decide for me"). Verify question count 3–6, "Decide for me" present on every chip question, and the enhanced brief is surfaced before project-name.

## Risks / open questions

- **Acknowledgment message breaks the base "no text before tool calls" rule** — accepted tradeoff for this variant's UX; scoped to `questioning.md`, does not leak to other agents.
- **Dropping design fragments** may produce briefs that under-specify visuals. If that happens, re-add `design-reference.md` from base to the manifest.
- **Enhanced-brief veto UX** is a plain assistant message, not a dedicated tool — users may not realize they can correct it. If this becomes a problem, add a lightweight confirm tool later; out of scope here.
