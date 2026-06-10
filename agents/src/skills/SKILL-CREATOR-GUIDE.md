# Skill Creator Guide

How to structure a new skill. Three patterns exist. Pick the simplest one that fits.

---

## Decision Tree

```
Does the user's intent name this capability directly and unambiguously?
("generate a logo", "add a blog", "set up a database")
  └── YES → Standalone (default)

Is this one large logical capability whose skill.md would exceed the line budget?
Sub-topics share the same tools, templates, and feature flag?
  └── YES → Chained metaskill (sections loaded in sequence)

Do users ask for a broad concept that needs routing to one of several distinct
implementations, where each sub-skill has its own tools, feature flag, or template?
  └── YES → Routed metaskill (dispatches to independent sub-skills)
```

---

## Line Budget

Target 200-300 lines. Skills in the 300-500 range are acceptable but
should justify their length. 500 is the hard ceiling, reached only when
every line carries essential context. The code review workflow flags >300
as a prompt to consider splitting.

Shorter skills produce better agent performance and reduce context
competition. If you find yourself near 300, push reference material and
deterministic logic into bundled resources (Layer 3) before expanding the
body.

---

## Standalone (default)

The default. Use unless you have a specific reason for chained or routed.

**When to use:**
- User phrasing directly names the capability
- The skill is independently useful with no sibling prerequisite
- `whenToUse` and `intents` frontmatter are sufficient to route the agent here

**Structure:**
```
agents/src/skills/my-skill/
├── skill.md
├── templates/   (optional)
└── tools/       (optional)
```

**Examples in the codebase:** grep `agents/src/skills/*/skill.md` for
standalone skills (most skills use this pattern).

**Anti-pattern:** Unconditionally loading multiple reference files from
skill.md to work around the line limit. If every invocation loads all
references regardless of context, the skill is just a large skill split
across files for cosmetic reasons. This needs a legitimate redesign
(chained or routed), not a line-count workaround. Reference files should
load conditionally based on what the current task actually needs.

---

## Chained (metaskill)

A thin orchestrator that coordinates sections in sequence. Use when a
single logical capability exceeds the line budget but all sub-topics
share the same tools, templates, and feature flag.

**When to use:**
- `skill.md` would exceed the line budget
- Sub-topics are instruction differences, not capability differences
- No sub-topic needs its own tool registration or separate install step

**How it works:**

`skill.md` is a thin orchestrator (~200 lines or less). Steps end with
`→ Read templates/sections/NN-slug.md`. The agent loads only the section
it needs rather than the full detail upfront.

```
agents/src/skills/my-complex-skill/
├── skill.md                         ← orchestrator
└── templates/
    └── sections/
        ├── 01-discovery-questions.md
        ├── 08-payment-integration.md  ← loaded on demand
        └── ...
```

**Example from a chained skill.md:**
```
## Step 8: Payment Integration
→ Read `templates/sections/08-payment-integration.md` (REQUIRED).
```

The agent loads section 8, completes payment integration fully, then
moves to the next section. The benefit is not skipping sections but
completing each logical step with focused context before moving on.
A large blob loaded upfront competes with active working context; the
same content loaded one step at a time keeps the agent focused.

**Key constraint:** Sections are markdown only. If a sub-topic needs its
own TypeScript tools or a separate template install step, use routed
instead. For section files exceeding 300 lines, include a table of
contents at the top so the agent can navigate to the relevant part.

---

## Routed (metaskill)

A thin dispatcher that routes to independent sub-skills. Use when users
ask for a broad concept and need routing to one of several distinct
implementations.

**When to use:**
- Sub-skills have different tools, `enablementId` flags, or `skill-deps`
- AND at least one of these routing signals is present:
  1. A skill's `whenToUse`/description references another skill for
     disambiguation ("for general requests, load X instead")
  2. A skill's prompt body contains conditional instructions to load
     another skill (routing logic in the wrong place)
  3. Two skills' `whenToUse`/intents overlap on the same phrases and
     the agent must guess which to pick at selection time

**When NOT to use (standalone is sufficient):**
- User intent already disambiguates at the first hop via `whenToUse`
  (each skill matches distinct phrases with no overlap)
- No skill references another skill in its frontmatter or body
- The "remove the metaskill" test passes: routing quality is identical
  without the extra entry point

**Structure:**
```
agents/src/skills/payment/
├── skill.md              ← routing instructions only
├── stripe/
│   ├── skill.md
│   └── tools/
└── square/
    ├── skill.md
    └── tools/
```

**Discovery flow:**
```
skill({ action: "load", skill: "payment" })        // agent reads routing skill.md
skill({ action: "load", skill: "payment/stripe" }) // agent loads the right sub-skill
```

The routing `skill.md` describes each sub-skill and tells the agent
which path to load based on user intent. No `list-category` action
needed.

**Physical nesting guarantees selection isolation.** The skill loader
only reads direct children of `agents/src/skills/`. Sub-skills nested
inside a metaskill directory are invisible to top-level selection. The
only way to reach them is through the metaskill.

---

## Worked Examples

Both examples apply the same decision criteria from "When to use" and
"When NOT to use" above.

### No metaskill needed (standalone is correct)

Three skills share a domain (e.g., media generation) but each matches
a distinct user phrase:

| User says | Routes to | Ambiguous? |
|---|---|---|
| "generate a logo" | skill-A via `whenToUse` | No |
| "generate an image" | skill-B via `whenToUse` | No |
| "make a video" | skill-C via `whenToUse` | No |

- Intent disambiguates at first hop — no phrase overlap
- No skill references another in frontmatter or body
- No shared prerequisite between skills

A router would duplicate what `whenToUse` already does, adding a load
round-trip for identical routing outcome.

### Routed metaskill needed

Two skills serve the same broad intent (e.g., appointment booking) but
with different implementations (built-in vs third-party integration).
They hit routing signals:

| Signal | Evidence |
|--------|----------|
| Cross-reference | Skill-B whenToUse: "for general requests, load skill-A instead" |
| Routing in body | Skill body conditionally directs agent to load another skill |
| Phrase overlap | Both fire on the same keywords ("booking", "appointment") |

Intent does NOT disambiguate — "I need appointment booking" matches
both. The routing decision (which implementation?) is embedded in
standalone frontmatter rather than centralized.

**Correct structure:**

```
agents/src/skills/domain/
├── skill.md              ← routing decision (~50 lines)
├── builtin/
│   ├── skill.md
│   ├── tools/
│   └── templates/
└── integration/
    ├── skill.md
    ├── tools/
    └── templates/
```

---

## PR Review Checklist

When reviewing a PR that adds or restructures skills:

- [ ] **Pattern choice is justified** — standalone for direct-intent skills, chained metaskill for large single-capability skills, routed metaskill only when routing across tools/flags/templates is genuinely needed
- [ ] **No routed metaskill for parallel independent skills** — apply the "remove the metaskill" test; if routing quality is unchanged, reject the metaskill
- [ ] **`whenToUse` and `intents` carry routing for standalone skills** — frontmatter does the routing, not extra hops
- [ ] **Chained sections are instruction-only** — sections must not carry tools or selective template installs; escalate to routed if they do
- [ ] **Each routed sub-skill has an independent reason to exist** — separate feature flag, separate tools, or separate template install step
- [ ] **Cross-skill name references updated** — if a skill is renamed or moved, grep all `skill.md` files for the old name and update them
- [ ] **Line budget respected** — body under 300 (ideal) or justified up to 500 (hard max)
