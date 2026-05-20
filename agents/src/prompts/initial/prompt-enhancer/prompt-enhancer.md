# Step 2.5: Enhance the Brief

After the user submits their answers to the single-form questioning (or immediately if questioning was skipped), synthesize a single 1-2 paragraph first-person project brief. This enhanced brief becomes the authoritative project description from this point forward — treat it as if the user had given you this brief directly.

## Which variant to apply

Look at the user's answers. An answer of "Decide for me" (case-insensitive, the literal text — the renderer emits the chip's display label, not the underlying sentinel value) means the user deferred that field to you:

- **All / most chip answers are "Decide for me", or the original prompt explicitly asked you to decide everything** → use the **Decide-for-me enhancer** below.
- **No "Decide for me" answers** → use the **Standard enhancer** below.
- **Mixed** → use the Standard enhancer, and for each "Decide for me" answer commit to a specific concrete choice consistent with the other answers. Never hedge, never leave ambiguity.

## Standard enhancer rules

Write an enhanced version that:

- Preserves the user's original intent completely.
- Weaves details naturally into prose — NO bullets, headers, or mechanical listing.
- Is SPECIFIC and CONCRETE — a generic template shouldn't be able to satisfy this brief.
- Names sections/pages explicitly when scope was provided.
- For REPEATING CONTENT BLOCKS (drinks, services, case studies, team members, plans), specify the content PATTERN each instance should follow — e.g., "each drink gets a name, a 1-2 sentence tasting-note-style description, and a price".
- When the user named a CATEGORY WITHOUT SPECIFICS (e.g., "signature drinks" without drink names, "case studies" without naming them), INVENT 2-3 plausible concrete examples that match the brand direction and write them in as if the user provided them. The user can accept, edit, or reject — but never leave it as vague placeholder.
- Describes visual direction, tone of voice, and any differentiators in terms a website builder can act on (e.g., "restrained palette with lots of whitespace" not just "modern").
- Suggests content hierarchy or hero emphasis when the differentiator is known (e.g., lead with the sourcing story), and states the PRIMARY CTA explicitly when known. If the user picked multiple differentiators, pick the 1-2 that together tell the crispest single story and weave them in; drop the rest rather than listing everything — a brief that leads with four equally-weighted angles reads generic again.
- For PRIMARY ACTION, if the user picked multiple actions, treat the FIRST selected as the hero CTA and the SECOND as a supporting secondary CTA. Drop anything beyond the second. Example: "order + subscribe" → hero button is "Order pickup", a secondary "Join the list" link sits below. The homepage must not lead with three equally-weighted CTAs.
- States DEVICE PRIORITY: default mobile-first for consumer/transactional sites (ordering, booking, shopping, services); desktop-balanced for B2B, content, or research sites.
- For "Decide for me" answers: YOU must commit to a specific concrete choice based on the other answers and the overall direction. Write it in as if the user specified it. Never hedge, never say "your choice," never leave ambiguity. Example: if typography was "Decide for me" on a bold playful coffee shop, commit to something like "rounded bold sans for headlines paired with a warm humanist sans for body" and drop it in naturally.
- For skipped answers (user left blank or dismissed the question): omit that dimension entirely — the user didn't want to specify it, so don't invent one.
- Reads in first person, like a founder briefing a builder.
- Is one or two paragraphs, not longer.

## Decide-for-me enhancer rules (stronger opinionation)

Produce a UNIQUE, SPECIFIC, opinionated brief — not a generic template. Make ALL the decisions — type, differentiator, vibe, palette, typography, voice, scope, everything.

CRITICAL — on DIFFERENTIATOR (the anti-generic lever):

- Do NOT invent bland, mushy differentiators like "crafted with care", "community-focused", "quality ingredients", "passion for what we do". These produce identical sites.
- ONE strong angle beats four mild ones. If synthesizing from scratch (decide-for-me) pick one; if the user picked multiple, pick the 1-2 that combine into the crispest single story and drop the rest.
- DO invent ONE specific, slightly unexpected angle that could plausibly be real and gives the site content to lean into. Examples:
  - Coffee shop → "seasonal syrup flights changing every Friday" / "single-origin Ethiopian beans with tasting notes on every cup" / "all drinks $5 or less"
  - Law firm → "fixed-fee packages instead of billable hours"
  - Portfolio → "one deep case study per quarter, not a gallery"
  - Restaurant → "one chef's tasting menu, changes weekly"

The rule: concrete enough that the user can accept it, edit it, or use it as a jumping-off point.

Commit to specifics everywhere else:

- PALETTE: real color names, e.g. "warm earth — mustard, terracotta, cream".
- TYPOGRAPHY: named style pairings, e.g. "editorial serif for display paired with a warm humanist sans for body".
- VIBE, VOICE, SCOPE: concrete and actionable.

Write it in one or two paragraphs, in first person, as if the user briefed all of this themselves. No bullets, no headers, no meta-commentary about having made decisions. Just the brief.

## After synthesizing the enhanced brief

1. Emit the enhanced brief as an assistant message. No confirmation prompt — proceed directly to the project-name step.

2. **From this point forward, treat the enhanced brief as the user's actual request.** Use it as the basis for the project-name step, the feature-list step, and the handoff prompt. Do NOT refer back to the original raw prompt — the enhanced brief supersedes it.
