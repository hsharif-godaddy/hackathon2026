# Trigger Overlap Detection

## Purpose

Detect when two skills' `whenToUse` or `intents` fields would plausibly
fire on the same user input. Overlap causes the agent to guess between
skills rather than route deterministically.

## Algorithm

1. **Collect frontmatter** from all skills:
   ```bash
   find agents/src/skills -maxdepth 2 -name 'skill.md'
   ```
   Parse the YAML header of each to extract `name`, `whenToUse`, `intents`.

2. **Tokenize the target skill's trigger surface:**
   - Split `whenToUse` into keyword phrases (comma/period-separated segments)
   - Split each `intents` entry on `/` to get individual phrases
   - Normalize: lowercase, strip articles (a/an/the), collapse whitespace

3. **Compare against every other skill:**
   For each other skill, tokenize its trigger surface the same way.
   Flag overlap when:
   - **Exact phrase match** — the same multi-word phrase appears in both
     (e.g., "accept payments" in both `payment` and `commerce`)
   - **High keyword overlap** — 3+ significant keywords shared between
     the two trigger surfaces (excluding common verbs: add, create, set up,
     build, make, get, update, fix, change)
   - **Intent subsumption** — one skill's `whenToUse` explicitly names or
     describes the other skill's domain (e.g., commerce saying "checkout"
     which is payment's domain)

4. **Assess severity:**
   - Exact phrase match on a core intent → flag as overlap
   - Keyword overlap only → flag as "worth investigating"
   - One skill's `whenToUse` explicitly delegates to the other
     (e.g., "for checkout, load payment") → this is intentional routing,
     not a collision. Do NOT flag.

## Exemptions

- **Routed metaskill referencing its own sub-skills** — a router naming
  its children in `whenToUse` is expected (e.g., `commerce` mentioning
  `commerce/ui` and `payment/godaddy-payments`).
- **Explicit boundary language** — if both skills' `whenToUse` draws a
  clear line (e.g., "for product catalog use commerce; for generic
  checkout use payment"), this is disambiguation, not collision.
- **Different `allowedAgents`** — skills scoped to different agents
  cannot collide even if intents overlap.
- **Different `enablementId` or `markets`** — skills that are never
  simultaneously active cannot collide.

## Output

For each detected overlap, report:
- The two skills involved
- The overlapping phrases/keywords
- Whether it's an exact match or keyword-level
- Whether explicit boundary language exists
