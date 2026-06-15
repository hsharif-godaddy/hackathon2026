<!--
EXAMPLE EVAL PROMPT VARIANT — disposable, NOT production guidance.

This file exists only to demonstrate the develop-agent eval-prompt-variant
plumbing end to end. Its variant row (develop.exampleArm, position: append) ships
in develop-prompt-variants.ts, but NO registered profile sets that flag — the
example profile is intentionally absent from agents/src/profiles/index.ts — so
this file is inert in every deployed build and cannot reach a real session.

You do NOT need to keep this in sync with any production prompt — it is not a
copy of one. Delete this file and its row in EVAL_PROMPT_VARIANTS once you have a
real variant to A/B. See ./README.md for the full workflow.

NOTE: a variant file is injected verbatim, so this comment block becomes part of
the system prompt when the variant is active. Harmless for an eval, but if you
author a real variant where the leading comment shouldn't be in the prompt
bytes, omit it (or keep it short).
-->

# Example Eval Prompt Variant

This text is appended to the develop agent's system prompt only when the
`develop.exampleArm` variant flag is set. Replace it with the prompt change you
want to A/B, add a row to `EVAL_PROMPT_VARIANTS`, and activate its flag from your
gosym eval setup via a profile (not the shipped registry).
