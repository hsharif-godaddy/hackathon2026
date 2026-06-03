# Skill Creator Guide

How to structure a new skill. There are three patterns — pick the one that fits, not the most complex one available.

---

## Decision tree

```
Does the user's intent name this capability directly and unambiguously?
("generate a logo", "add a blog", "set up a database")
  └── YES → Pattern 1: Flat independent skill

Is this one large logical capability whose skill.md would exceed ~300 lines?
Sub-topics share the same tools, templates, and feature flag?
  └── YES → Pattern 2: Sections within a single skill

Do users ask for a broad concept that needs routing to one of several distinct
implementations, where each sub-skill has its own tools, feature flag, or template
install step?
  └── YES → Pattern 3: Category directory
```

---

## Pattern 1 — Flat independent skill

The default. Use it unless you have a specific reason for Pattern 2 or 3.

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

**Examples in the codebase:** `database`, `email`, `seo`, `blog`, `media-logo`, `media-image`, `media-video`

---

## Pattern 2 — Sections within a single skill

Use when a single logical capability is too large for one `skill.md` but all sub-topics share the same tools, templates, and feature flag.

**When to use:**
- `skill.md` would exceed ~300 lines
- Sub-topics are instruction differences, not capability differences
- No sub-topic needs its own tool registration or separate `skill({ action: "install" })` step

**How it works:**

`skill.md` is a thin orchestrator. Steps end with `→ Read templates/sections/NN-slug.md`. The agent loads only the section it needs rather than the full detail upfront.

```
agents/src/skills/online-appointments/
├── skill.md                         ← orchestrator (~5K tokens base)
└── templates/
    └── sections/
        ├── 01-discovery-questions.md
        ├── 08-payment-integration.md  ← loaded on demand, ~5K tokens
        └── ...
```

**From `online-appointments/skill.md`:**
```
## Step 8: Payment Integration ⚠️ COMPLEX
→ Read `templates/sections/08-payment-integration.md` (REQUIRED).
```

The agent loads section 8, completes payment integration fully, then moves to section 9 (email). All sections will eventually be loaded — the benefit is not skipping sections, it's **completing each logical step with focused context before moving to the next**. A 19K token blob loaded upfront competes with active working context; the same content loaded one step at a time keeps the agent focused on what it's doing right now.

**Key constraint:** sections are markdown only. If a sub-topic needs its own TypeScript tools or a separate template install step, use Pattern 3 instead.

---

## Pattern 3 — Category directory with routed sub-skills

Use when users ask for a broad concept and need routing to one of several distinct implementations, where each sub-skill has independent tools, a feature flag, or a template install step.

**When to use:**
- The user says "add payments" or "set up e-commerce" — not a specific implementation
- Sub-skills have different tools, `enablementId` flags, or `skill-deps`
- The catalog would otherwise show N confusingly similar entries to the agent

**Structure:**
```
agents/src/skills/payment/
├── skill.md              ← category entry point + routing instructions
├── stripe/
│   ├── skill.md
│   └── tools/
└── square/
    ├── skill.md
    └── tools/
```

**Discovery flow:**
```
skill({ action: "load", skill: "payment" })        // agent reads category skill.md
skill({ action: "load", skill: "payment/stripe" }) // agent loads the right sub-skill
```

The category `skill.md` body is the sub-skill manifest — it describes each sub-skill and tells the agent exactly which path to load based on user intent. No `list-category` action needed.

**Infrastructure note:** `validateSkillName` must allow `category/skill-name` paths (one `/` maximum). This supports future nesting (`payment/stripe/subscriptions`) with the same validation logic.

**Examples (planned):** `payment/stripe`, `payment/square`

---

## Adversary example — why `media/` is not a category

`media-logo`, `media-image`, and `media-video` look like natural candidates for a `media/` category. They are not. Adding a `media/` router would make things worse:

**Intent already disambiguates at the first hop:**

| User says | Routes to |
|---|---|
| "generate a logo" | `media-logo` via `whenToUse` |
| "generate an image" | `media-image` via `whenToUse` |
| "make a video" | `media-video` via `whenToUse` |

A `media/skill.md` router would say exactly what the `whenToUse` frontmatter on each skill already says — duplicated instructions with zero new information.

**No shared prerequisite:**

`commerce/storefront` must load `commerce` first to get store/catalog data — there's a real data dependency. The media skills have no such relationship. Logo generation, image generation, and video generation are fully independent operations with no shared setup step.

**The cost is real:**

Adding a `media/` category introduces an extra `load` round-trip on every request:
```
// Without category (current — correct)
skill({ action: "load", skill: "media-logo" })   // 1 hop, done

// With category (wrong)
skill({ action: "load", skill: "media" })         // hop 1: routing instructions
skill({ action: "load", skill: "media/media-logo" }) // hop 2: actual skill
```

More tokens, more latency, identical outcome.

**The test for whether a category adds value:**

> Remove the router and let the agent pick sub-skills directly using `whenToUse`. If routing quality is identical — the category adds no value and must not be added.

---

## PR review checklist

When reviewing a PR that adds or restructures skills:

- [ ] **Pattern choice is justified** — flat for direct-intent skills, sections for large single-capability skills, category only when routing across tools/flags/templates is genuinely needed
- [ ] **No category for parallel independent skills** — apply the "remove the router" test; if routing quality is unchanged, reject the category
- [ ] **`whenToUse` and `intents` carry routing for flat skills** — frontmatter does the routing, not extra hops
- [ ] **Sections used for instruction-only splitting** — sections must not carry tools or selective template installs; escalate to Pattern 3 if they do
- [ ] **Each category sub-skill has an independent reason to exist** — separate feature flag, separate tools, or separate template install step
- [ ] **Cross-skill name references updated** — if a skill is renamed or moved, grep all `skill.md` files for the old name and update them
