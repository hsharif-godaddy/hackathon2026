---
name: skill-creator
description: "Design or create a new agent skill for the Airo ecosystem."
argument-hint: "<description> [--pattern standalone|chained|routed]"
---

# Skill Writing Guide

Create a new skill for the Airo App Builder ecosystem.

When the user describes what they want, understand the intent,
determine which ecosystem it belongs to, and produce a well-crafted
skill file that follows the conventions below.

## Two Ecosystems

| Aspect | Agent skill | Dev skill |
|--------|-------------|-----------|
| Purpose | Helps end-users build apps at runtime | Automates developer workflows via Claude Code |
| Location | `agents/src/skills/<name>/skill.md` | `.claude/skills/<name>/SKILL.md` |
| Filename | lowercase `skill.md` | uppercase `SKILL.md` |
| Loaded by | AAB agent via `skill({ action: "load" })` | Claude Code on `/skill-name` |
| Triggering field | `whenToUse` (read by AAB agent) | `description` (read by Claude Code) |
| Examples | `media-image`, `database`, `authentication` | `create-jira-ticket`, `local-dev-browser` |

Determine the ecosystem from context. If the skill helps end-users
add capabilities to their app (payments, blog, auth, SEO), it is an
agent skill. If it automates something a developer does (ticket
creation, PR checks, scaffolding), it is a dev skill.

For dev skills, follow the structure of this skill as a reference
(frontmatter with `name`, `description`, and optionally `argument-hint`,
then a guide-style body). Claude Code routes dev skills by `description`
— `whenToUse` is an agent-skill field consumed by `buildSkillsPromptSection()`
that Claude Code ignores. A dev skill that puts its triggering only in
`whenToUse` will never fire. The rest of this document focuses on agent
skill authoring, though the grouping principle below applies to both.

### Skill Anatomy

Both ecosystems share this general structure:

```
skill-name/
├── skill.md or SKILL.md (required)
│   ├── YAML frontmatter (name, description/whenToUse required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    ├── assets/     - Files used in output (templates, icons, fonts)
    ├── templates/  - Code/content templates (agent skills)
    └── tools/      - Custom runtime tools (agent skills)
```

For domain-variant skills, organize references by variant:
```
cloud-deploy/
├── SKILL.md (workflow + selection logic)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```
Claude reads only the relevant reference file based on context.

For large reference files (>300 lines), include a table of contents
at the top so Claude can jump to the relevant section.

## Metaskills

A **metaskill** is a thin skill (~200 lines or less) that manages a
group of related skills. There are two metaskill patterns:

- **Chained**: coordinates steps in sequence or parallel (e.g., a
  "publish" metaskill that chains build, deploy, and verify)
- **Routed**: disambiguates intent and loads the right sub-skill
  (e.g., user says "add payments" and the metaskill routes to Stripe
  vs Square based on context)

Use a metaskill when related skills risk selection collision, or when
a workflow requires coordinating multiple skills in order.

The metaskill encodes only the decision tree or workflow sequence and
delegates domain knowledge to the managed skills. Each managed skill
is independently invocable and self-contained.

This directly improves selection accuracy as the catalog grows.
Without metaskills, N related skills compete for the same intents.
With a metaskill, intent resolves to one entry point that routes or
chains precisely.

**Recognize when standalone skills need consolidation:**
- A skill's `whenToUse`/description references another skill ("for
  general requests, load X instead") — disambiguation in frontmatter
- A skill's prompt body conditionally loads another skill — routing
  logic masquerading as instructions
- Two skills' `whenToUse`/intents fire on the same phrases — implicit
  collision forcing the agent to guess

All three mean routing logic exists but is scattered rather than
centralized. A routed metaskill makes the decision explicit.

---

## Agent Skill Authoring

### Process

1. **Capture intent.** Understand what the user wants the skill to do.
   The current conversation may already contain a workflow to capture
   (e.g., "turn this into a skill"). If so, extract answers from
   conversation history first -- tools used, sequence of steps,
   corrections made, input/output formats observed. Key questions:
   - What should this skill enable the agent to do?
   - When should it trigger? (what user phrases/contexts)
   - What is the expected output format?
   - Are there success criteria we can verify?

2. **Interview and research.** Proactively ask about edge cases, input
   formats, example scenarios, dependencies, and boundaries with
   adjacent skills. Check existing skills in `agents/src/skills/` and
   available MCPs for prior art. Come prepared with context to reduce
   burden on the user.

3. **Check for redundancy.** Scan `agents/src/skills/*/skill.md`
   frontmatter. If a skill already covers this intent, extend it
   rather than creating a duplicate.

4. **Choose a structural pattern** (see Patterns below).

5. **Draft frontmatter.** Get `whenToUse` right. This is the single
   most important field for skill reliability (see Selection Accuracy).

6. **Write the skill body.** Follow the writing principles below.

7. **Confirm with user** before generating files. Present ecosystem,
   name, pattern, frontmatter, section outline, and estimated lines.

8. **Generate and verify.** Create the skill directory, then run
   `pnpm --filter @airo/agents typecheck`. Confirm self-containment
   (no skill name referenced outside its directory).

### Line Budget

Target 200-300 lines. Skills in the 300-500 range are acceptable but
should justify their length. 500 is the hard ceiling, reached only
when every line carries essential context. Push reference material and
deterministic logic into bundled resources (Layer 3) before expanding
the body.

### Frontmatter

```yaml
---
name: <kebab-case, matches directory name>
description: <one-line summary>
whenToUse: <one sentence: when should the agent load this?>
intents:
  - <short trigger phrase>
  - <another phrase>
dependencies:      # npm packages (if needed)
  - <package>
skill-deps:        # other skills this depends on (if needed)
  - <other-skill>
enablementId: <feature-flag>  # if feature-gated
templateMappings:  # custom template destination paths (if needed)
  <prefix>: <destination>
---
```

#### templateMappings

When a skill's templates need to land somewhere other than the
default `src/{templatePath}`, declare `templateMappings` in
frontmatter. This keeps path-routing self-contained in the skill
instead of adding branches to shared loader code.

```yaml
templateMappings:
  components: "src/components/blog/"   # prefix match
  drizzle.config.ts: ""                # exact match → project root
```

Rules are evaluated top-to-bottom, first match wins:
- **Exact match** (`templatePath === prefix`): destination + basename
- **Prefix match** (`templatePath` starts with `prefix/`): destination + remainder after prefix
- **Wildcard `*`**: destination + full templatePath (catch-all)

If no rule matches (or field is omitted), the default `src/{templatePath}` applies.
An empty string destination (`""`) means project root. Only add
`templateMappings` when the default `src/` prefix is wrong for some
templates — most skills don't need it.

Required fields: `name`, `description`, `whenToUse`.

### How Skill Triggering Works

Skills appear in the agent's context as metadata (name + whenToUse).
The agent decides whether to load a skill based on that metadata. The
key insight: the agent only consults skills for tasks it cannot easily
handle on its own with basic tools. Simple, one-step tasks may never
trigger a skill even if the description matches perfectly.

This means:
- Skills covering trivial operations may never fire regardless of
  description quality
- Descriptions must convey that the skill adds value beyond baseline
- Test queries for triggering should be substantive multi-step tasks,
  not "read file X" one-liners

### Selection Accuracy

`whenToUse` determines whether the agent picks the right skill. This
is where most skill reliability issues originate.

**The dominant failure mode is undertriggering** -- not firing when it
should, rather than misfiring on the wrong intent. To combat this,
make `whenToUse` assertively inclusive. A payments skill should mention
"payments, checkout, subscriptions, pricing, Stripe, billing" so it
fires on related intents, not just the exact phrase.

- Be precise enough to avoid collisions with adjacent skills
- Be broad enough to counter undertriggering -- err toward recall
- If two skills could match the same intent, either sharpen both
  `whenToUse` fields until the boundary is unambiguous, or group them
  under a metaskill that disambiguates
- The `intents` array feeds the dynamic quick-intent map. Use short
  phrases that cover synonyms and variations

#### Validating Trigger Accuracy

To verify `whenToUse` works in practice, draft 8-10 should-trigger
and 8-10 should-not-trigger test queries:

- **Should-trigger**: different phrasings of the same intent (formal,
  casual), cases where the user doesn't name the skill explicitly,
  and uncommon use cases the skill covers
- **Should-not-trigger**: near-misses that share keywords but need a
  different skill, adjacent domains, ambiguous phrasing where a naive
  keyword match would trigger but shouldn't

Make queries realistic and concrete -- include file paths, context,
casual speech. "Add payments" is too generic. "I need to let users
pay for premium features in my recipe app, probably Stripe" is
testable.

### Writing Principles

**Explain the why, direct the what.** Explain reasoning so the model
adapts to edge cases. Write action steps as imperatives ("Create the
file"), not suggestions ("You should consider creating").

Avoid heavy-handed MUST/NEVER/ALWAYS-in-caps directives. They produce
brittle behavior -- the model follows the letter but not the spirit.
When you explain *why* something matters, the model generalizes to
edge cases you didn't enumerate. If you find yourself writing walls of
caps-lock rules, reframe as reasoning.

**Progressive disclosure.** Skills use a three-level loading system
with different token budgets:
- Layer 1: Frontmatter (name + whenToUse) -- always in context (~100
  words). This is what the agent uses for selection decisions.
- Layer 2: Skill body -- loaded when triggered (<500 lines / line
  budget). This is the working instructions.
- Layer 3: Bundled resources (sections, references, scripts) -- loaded
  on demand. Scripts can execute without being loaded into context,
  so they cost zero tokens until their output is needed.

Not everything belongs in the main body. Push reference material and
deterministic logic into Layer 3 to keep the body lean.

**Define output formats** when the skill produces structured output.
Use explicit templates so output is consistent.

**Include realistic examples** showing inputs and expected outputs.
Toy examples don't help the model generalize.

→ See `references/best-practices.md` for additional guidelines (degrees
of freedom, feedback loops, terminology consistency, nested references,
model awareness).

### Patterns

Three structural patterns: **standalone** (default), **chained**
(metaskill), and **routed** (metaskill).

→ Read `agents/src/skills/SKILL-CREATOR-GUIDE.md` for the decision
tree, pattern definitions, worked examples, and the "remove the
metaskill" test.

### Self-Containment

Everything about a skill lives in its directory. No skill names in
shared code, no per-skill switches in agent prompts, no external
registries.

The `intents` frontmatter feeds the dynamic intent map built by
`buildSkillsPromptSection()`. Disabled skills drop out automatically
via `enablementId` filtering.

### Safety

Skills must not contain malware, exploit code, or content that could
compromise system security. A skill's contents should not surprise the
user in their intent if described. Do not create skills designed to
facilitate unauthorized access, data exfiltration, or misleading
behavior.

### Tools

If the skill needs custom runtime tools, create `tools/index.ts`.
Import `SkillToolDefinition` from `@airo/ai-skills`, validate inputs
with Zod. Reference existing tools in `agents/src/skills/*/tools/`
for conventions.

---

## Proactive Evaluation

Use **gosym-probe** (`evals/gosym-probe/`) to write quick local evals
that validate skill behavior with synthetic users. It drives a
simulated user through scripted scenarios against a locally running
AAB instance, records transcripts, and scores with LLM-as-judge
evaluators. See its docs and existing scenarios for patterns.

**goarena** (`evals/goarena/`) is the release gate platform that runs
in CI. Not for local iteration, but skills that pass gosym-probe
locally graduate to goarena scenarios for continuous validation.

When creating or modifying agent skills, write a gosym-probe scenario
that exercises the skill's happy path and edge cases before shipping.
