# RUBICON-343/344 Schema & AEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the develop agent emit a business-appropriate JSON-LD baseline (`WebSite`+`Organization`+`WebPage`) on the homepage (RUBICON-343) and page-appropriate, entity-linked schema on new pages (RUBICON-344), driven entirely by always-loaded prompt context.

**Architecture:** Generation-only, prompt-driven. Only two product files change: the cached develop SEO primer (`agents/src/prompts/develop/seo.md`) and the always-loaded v8 worked example (`agents/src/prompts/template-descriptions/v8.md`). Verification is staged: a static prompt-assertion eval pins the guidance (cheap, durable); a **scored Chrome DevTools rubric run on real build artifacts both before and after the change (main vs branch)** is the behavioral before/after + iteration loop; the **existing gosym-probe suite is run last, read-only, purely to confirm no regression** in the agent's core build quality. We do NOT add evaluators or scenarios to gosym-probe in this PR. All production publish-time validation is out of scope (RUBICON-345).

**Tech Stack:** TypeScript (ESM, `.js` import extensions, named exports only), Vitest, the Chrome DevTools MCP tools + `local-dev-browser` skill, the existing `gosym-probe` eval harness (`evals/gosym-probe/`) for the regression check, markdown prompt fragments.

---

## Spec references

- Design: `docs/superpowers/specs/2026-06-05-rubicon-343-344-schema-aeo-design.md`
- AC coverage: `docs/superpowers/specs/2026-06-05-rubicon-343-344-ac-coverage.md`

## Prior art — we are extending the RUBICON-98 prompt surface (read this first)

This work deliberately reuses the delivery mechanism RUBICON-98 established. Do not invent a new approach.

- **`agents/src/prompts/develop/seo.md` IS the RUBICON-98 cached primer** — created by commit `077fda026` "[RUBICON-98] Lift seo workflow into cached develop primer (#4385)". Task 2 edits this same file. **Before editing, read the whole file** and match the existing bullet voice, terseness, and formatting; RUBICON-98 deliberately kept it lean (force-loading the SEO skill was tried and walked back). The new content is an extension of that primer, not a new section.
- **`agents/src/prompts/template-descriptions/v8.md` is the always-loaded worked example** (injected as the first system message by `context-manager.ts`). It is NOT itself a RUBICON-98 file — its SEO content predates 98 — but we extend it the same prompt-only way. **Read its existing SEO/Helmet section before editing** so the new `@graph` example matches the surrounding TSX style.
- **Same philosophy as 98:** ship via prompt guidance only; the SEO skill stays untouched and unloaded at create; verification is DevTools-on-artifacts (Task 4). The static-eval phrases Task 2 must preserve (`application/ld+json`, `@context`, `at minimum populate`, `don't fabricate`, etc.) are the RUBICON-98 primer's own wording — keep them intact.

## Boundary reminders (do not violate)

- **No production validator changes.** Do NOT touch `agents/src/services/SeoValidator.ts`, `seo-audit.ts`, or `seo-audit-labels.ts` — that is RUBICON-345.
- **SEO skill (revised during review):** the original plan kept `agents/src/skills/seo/skill.md` untouched (it is not loaded at create). Review found its JSON-LD section taught a conflicting single-`@type`-per-page pattern, and the skill loads on-demand during SEO/audit sessions — so its schema section was synced to the triad/`@id` baseline. The static eval now pins that sync (and still pins the skill's identity/auto-load markers).
- **No gosym-probe contributions.** Do NOT add evaluators, scenarios, or registry entries to `evals/gosym-probe/`. It is used read-only in Task 5 to confirm no regression. New schema-specific eval coverage is deferred to a future PR.
- **Keep the primer lean.** The only prose growth allowed is the reworded JSON-LD bullet in Task 2. Reference depth (per-type required-property tables, category→type maps) does not belong in the primer.

## Verification strategy (why this order)

1. **Static eval (Task 1)** — pins the new guidance phrases; free, durable, runs anywhere. The red/green gate for the prompt edit.
2. **Chrome DevTools rubric, branch-vs-main (Task 4)** — the behavioral before/after. Build the same fake businesses twice in one phase — once on main's prompts ("before") and once on this branch's prompts ("after") — and score each rendered artifact against a fixed 10-check rubric. The before→after delta on the new-behavior checks (triad, dates, conditional LocalBusiness, entity refs) is the primary evidence that the changes work. High fidelity; mirrors the RUBICON-98 manual workflow. Also the iteration loop — if the branch doesn't clearly beat main, refine Tasks 2/3 and re-run.
3. **gosym-probe regression check (Task 5)** — run the *existing* suite read-only against its committed baseline to confirm the prompt edits don't regress the agent's core build quality. No new eval code. Not the iteration loop.

## File structure

Only two product files change. The static eval is the durable guard; gosym-probe is run, not modified.

| File | Responsibility | Action |
| --- | --- | --- |
| `agents/src/evals/seo-generation.spec.ts` | New AC-keyed static assertions for the reworded primer | Modify |
| `agents/src/prompts/develop/seo.md` | Reword JSON-LD bullet → baseline `@graph` + page-purpose + dates | Modify (`:20`) |
| `agents/src/prompts/template-descriptions/v8.md` | Add homepage `@graph` example; link sub-page example to the site Organization | Modify (`:152-188`) |

## Environment note (Tasks 4 & 5 — running locally)

Both need a locally running AAB instance (`pnpm run dev` from repo root; UI at `https://local.gasket.dev-godaddy.com:8443/`). Task 5 (gosym-probe regression check) additionally needs AWS SSO (`aws sso login --profile airobuild-dev-private-sso`) and `evals/gosym-probe/.env`. If this environment is unavailable in the execution session, the engineer runs Tasks 4 and 5 on a machine that has it; Tasks 1-3 are pure code and run anywhere.

---

## PHASE 1 — Prompt change (static-eval TDD)

## Task 1: Add failing static assertions for the reworded primer

**Files:**
- Modify: `agents/src/evals/seo-generation.spec.ts`

- [ ] **Step 1: Add the new assertions**

In `agents/src/evals/seo-generation.spec.ts`, inside the `describe('develop primer — AC coverage', ...)` block, add this test after the existing `AC3` anti-fabrication test (after line 75):

```typescript
    it('RUBICON-343: homepage emits the WebSite/Organization/WebPage baseline @graph with dates', () => {
      // Failure prevented: agent emits a single fitting type instead of the
      // required universal baseline triad on the homepage.
      expect(primer).toContain('@graph');
      expect(primer).toContain('WebSite');
      expect(primer).toContain('WebPage');
      expect(primer).toContain('Organization');
      expect(primer).toContain('datePublished');
      expect(primer).toContain('dateModified');
      expect(primerLower).toContain('only when the brief gives a real location');
    });

    it('RUBICON-344: new pages use a page-purpose type and reference the site Organization', () => {
      // Failure prevented: sub-pages re-declare Organization or omit the
      // page-purpose type / entity reference.
      expect(primer).toContain('AboutPage');
      expect(primer).toContain('ContactPage');
      expect(primer).toContain('@id');
      expect(primerLower).toContain('rather than re-declaring');
    });
```

- [ ] **Step 2: Run the static eval to verify the new tests fail**

Run: `pnpm --filter @airo/agents test:unit "seo-generation"`
Expected: the two new tests FAIL (current primer lacks `@graph`, `WebSite`, `WebPage`, `datePublished`, etc.); all pre-existing assertions still PASS.

- [ ] **Step 3: Commit the failing tests**

```bash
git add agents/src/evals/seo-generation.spec.ts
git commit -m "test(agents): pin RUBICON-343/344 baseline-graph + page-purpose primer assertions"
```

---

## Task 2: Reword the develop SEO primer

**Files:**
- Modify: `agents/src/prompts/develop/seo.md:20`

- [ ] **Step 1: Read the existing primer, then replace the JSON-LD bullet**

First `Read` the whole of `agents/src/prompts/develop/seo.md` (it's the RUBICON-98 primer — see "Prior art" above) so the replacement matches its established voice and terseness. Then replace the single bullet on line 20 (beginning `- One \`<script type="application/ld+json">\``) with:

```markdown
- **Structured data** — `<script type="application/ld+json">`:
  - **Homepage (`/`):** emit one `@graph` with the baseline trio — `WebSite`, `Organization`, and `WebPage` — plus the schema.org business type that fits (`Restaurant`, `LocalBusiness`, `Organization`, `SoftwareApplication`, `FAQPage`, `BlogPosting`, `Product`, etc.). Use `LocalBusiness` (or the closest subtype) **only when the brief gives a real location**. Link nodes with `@id`. A worked example is in the template description.
  - **Other pages:** emit a `WebPage` or page-purpose type (`AboutPage`, `ContactPage`, `FAQPage`, service types) that references the homepage `Organization`/`WebSite` by `@id` — **rather than re-declaring** them.
  - At minimum populate `@context`, `@type`, `name`, `url`; add `datePublished`/`dateModified` on the homepage. Add optional fields (`address`, `telephone`, `priceRange`, `openingHours`, etc.) **only when the user's brief gives you real values** — don't fabricate phone numbers, addresses, hours, prices, or customer/stat content. Better to omit a field than to placeholder it; crawlers index this data as authoritative business identity.
```

This preserves every phrase the pre-existing static assertions check (`application/ld+json`, `@context`, `@type`, `at minimum populate`, `Restaurant`, `Organization`, `FAQPage`, `only when the user`, `don't fabricate`, `omit a field`, `authoritative business identity`) and adds the new ones.

- [ ] **Step 2: Run the full static eval**

Run: `pnpm --filter @airo/agents test:unit "seo-generation"`
Expected: ALL tests PASS — the two added in Task 1 and every pre-existing assertion.

- [ ] **Step 3: Commit**

```bash
git add agents/src/prompts/develop/seo.md
git commit -m "feat(agents): drive homepage schema @graph + page-purpose types in develop SEO primer (RUBICON-343/344)"
```

---

## Task 3: Update the v8 worked example

**Files:**
- Modify: `agents/src/prompts/template-descriptions/v8.md:152-188`

- [ ] **Step 1: Read the existing v8 SEO section, then add a homepage `@graph` example before the existing AboutPage example**

First `Read` the existing SEO/Helmet section of `agents/src/prompts/template-descriptions/v8.md` (see "Prior art" above) so the new example matches the surrounding TSX style. Then, immediately before the existing `import { Helmet } ...` / `export default function AboutPage()` code block (before line 152), insert:

````markdown
**Homepage baseline schema** — the homepage (`/`) emits one `@graph` with `WebSite` + `Organization` + `WebPage`. Add a business type (`LocalBusiness` etc.) **only when you have a real location**. Reference nodes by `@id`; fill only values the brief gives you.

```tsx
const site = 'https://acme.example';
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': `${site}/#website`, name: 'Acme', url: `${site}/` },
    { '@type': 'Organization', '@id': `${site}/#organization`, name: 'Acme', url: `${site}/` },
    {
      '@type': 'WebPage',
      '@id': `${site}/#webpage`,
      url: `${site}/`,
      isPartOf: { '@id': `${site}/#website` },
      about: { '@id': `${site}/#organization` },
      datePublished: '2026-06-09',
      dateModified: '2026-06-09',
    },
  ],
};
// Render inside <Helmet>: <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
```
````

- [ ] **Step 2: Link the existing AboutPage example to the site Organization**

In the same file, replace the existing AboutPage `const jsonLd = { ... }` block (lines 162-167) with:

```tsx
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: title,
    url: canonicalUrl,
    isPartOf: { '@id': 'https://acme.example/#website' },
    about: { '@id': 'https://acme.example/#organization' },
  };
```

- [ ] **Step 3: Verify the agents package still builds**

Run: `pnpm --filter @airo/agents build`
Expected: build succeeds (prompt files are bundled/copied; no TS error).

- [ ] **Step 4: Commit**

```bash
git add agents/src/prompts/template-descriptions/v8.md
git commit -m "feat(agents): add homepage @graph worked example and link sub-page schema to site Organization (RUBICON-343/344)"
```

---

## PHASE 2 — Behavioral before/after via Chrome DevTools rubric (requires local env)

## Task 4: Score schema generation against the rubric — branch vs main

**No file changes.** Build the same three fake businesses twice in this one phase — once on **main's** prompts (the "before") and once on **this branch's** prompts (the "after") — and score each rendered artifact against the fixed rubric below. The before→after delta is the PR's behavioral evidence. Use the **`local-dev-browser` skill** for the login + app-creation flow (do not hand-roll the create steps).

**Branch-toggle mechanism (why it's just two files):** the only runtime-affecting difference between this branch and `main` is the two prompt files (Task 1 is test-only; everything else is docs). So we reproduce main's agent behavior by checking out *just those two files* from `main`, rather than switching the whole tree. This requires Tasks 2 & 3 to be **committed** already (they are, per their commit steps).

**The three briefs:**
- **B1 local:** "Build a homepage for Sunrise Bakery, a neighborhood bakery in Austin, Texas selling fresh sourdough and pastries." → homepage (343).
- **B2 online:** "Build a homepage for Flowstate, a SaaS app that helps remote teams track focus time. No physical location." → homepage (343).
- **B3 new page (344):** after B1 builds, ask "Add an About page." → `/about` route.

**The rubric** (score each check 1/0 per brief; score = passed ÷ applicable):

| # | Check | Pass condition | B1 | B2 | B3 |
| --- | --- | --- | --- | --- | --- |
| 1 | `WebSite` present | `types` ∋ `WebSite` | ✓ | ✓ | inherits |
| 2 | `Organization` (or subtype) present | `types` ∋ Org/LocalBusiness/… | ✓ | ✓ | — |
| 3 | `WebPage` present | `types` ∋ `WebPage` | ✓ | ✓ | ✓ |
| 4 | Valid JSON | no `PARSE_ERROR` block | ✓ | ✓ | ✓ |
| 5 | Single H1 | `h1Count === 1` | ✓ | ✓ | ✓ |
| 6 | Homepage dates | `datePublished`+`dateModified` on the `WebPage` node | ✓ | ✓ | n/a |
| 7 | **Conditional** LocalBusiness | present **iff** the brief gave a location | present | **absent** | n/a |
| 8 | No fabricated contact/address | no invented phone/address/hours in `blocks` | ✓ | ✓ | ✓ |
| 9 | Page-purpose type (344) | `types` ∋ `AboutPage` | n/a | n/a | ✓ |
| 10 | Entity ref, not re-declared (344) | block has `isPartOf`/`about`/`@id` → homepage `#organization`/`#website`, NOT a fresh full `Organization` node | n/a | n/a | ✓ |

Expectation: on **main**, checks 1/2/6/7/10 mostly fail (single non-graph type, no dates, no conditional logic, sub-pages re-declare); on the **branch**, all applicable checks pass. That gap is the evidence.

- [ ] **Step 1: Start the app (on the branch)**

Run (repo root, separate shell): `pnpm run dev`
Expected: UI reachable at `https://local.gasket.dev-godaddy.com:8443/`.

- [ ] **Step 2: The JSON-LD extraction script (used for every brief, both runs)**

With Chrome DevTools pointed at a preview URL, run this in `evaluate_script` and keep the returned object for scoring:

```javascript
() => {
  const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => { try { return JSON.parse(s.textContent || ''); } catch { return { PARSE_ERROR: s.textContent }; } });
  const types = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      if (Array.isArray(n['@graph'])) n['@graph'].forEach(walk);
      if (n['@type']) types.push(...[].concat(n['@type']));
    }
  };
  blocks.forEach(walk);
  return { blockCount: blocks.length, types, h1Count: document.querySelectorAll('h1').length, blocks };
}
```

Score the returned object against the rubric: `types` covers checks 1/2/3/7/9; `h1Count` is check 5; presence of a `PARSE_ERROR` key fails check 4; inspect `blocks` for checks 6/8/10.

- [ ] **Step 3: Capture the BEFORE run (main's prompts)**

Swap in main's prompt files, rebuild, and restart so the agent loads the old prompts:

```bash
git checkout main -- agents/src/prompts/develop/seo.md agents/src/prompts/template-descriptions/v8.md
pnpm --filter @airo/agents build   # if your dev setup bundles prompts
# then restart the running `pnpm run dev` so the agent reloads the swapped files
```

Then, using the `local-dev-browser` skill, run all three briefs: create B1, build, run the Step-2 script on its preview, score; same for B2; then in the B1 app ask "Add an About page" and score the `/about` route. Record the three rubric rows as **BEFORE**.

- [ ] **Step 4: Capture the AFTER run (branch's prompts)**

Restore the branch's committed prompt files, rebuild, and restart:

```bash
git checkout HEAD -- agents/src/prompts/develop/seo.md agents/src/prompts/template-descriptions/v8.md
pnpm --filter @airo/agents build   # if your dev setup bundles prompts
# then restart the running `pnpm run dev`
```

Confirm the working tree is clean (`git status` shows no changes to the two prompt files). Run the same three briefs again (fresh apps), score, and record as **AFTER**.

- [ ] **Step 5: Build the before/after comparison + decide**

Produce a comparison table — for each brief, each rubric check, main vs branch — and a per-brief score (passed ÷ applicable). This is the PR's behavioral evidence. Save it to a scratch note for the PR description (no commit — local artifacts).
Expected: branch scores strictly higher than main, with the gap concentrated on checks 1/2/6/7/10. **If the branch does not clearly beat main, iterate on Tasks 2/3 and re-run this phase** before proceeding.

---

## PHASE 3 — gosym-probe regression check (existing suite, read-only, requires local env)

## Task 5: Run the existing gosym-probe suite to confirm no regression

**No file changes.** This runs the *already-committed* gosym-probe scenarios against their saved baseline to confirm the primer/v8 edits don't regress the agent's core website-build quality. We are NOT adding evaluators or scenarios here — if the harness has no relevant committed baseline, capture a qualitative before/after instead and note it in the PR rather than contributing new eval code.

- [ ] **Step 1: Start AAB + authenticate**

Run (repo root, separate shell): `pnpm run dev`
Run: `aws sso login --profile airobuild-dev-private-sso`
Expected: AAB up; SSO active. Ensure `evals/gosym-probe/.env` exists (copy `.env.example`, set `OPENAI_BASE_URL` + `PROBE_OPENAI_API_KEY`).

- [ ] **Step 2: Identify the established regression suite**

Run: `cd evals/gosym-probe && grep -n "suite:" src/scenarios/*.ts src/scenarios/**/*.ts`
Pick the existing golden/baseline suite the team already gates on (e.g. the golden-light / airo-baseline scenarios registered in `src/scenarios/registry.ts`). Do not create a new suite.

- [ ] **Step 3: Run the existing suite against its baseline**

Run: `cd evals/gosym-probe && pnpm run eval --suite <existing-suite>` (omit `--skip-baseline` so the `RegressionComparator` compares against the most recent committed baseline).
Expected: run completes; the run report shows no evaluator flagged as a regression versus baseline.

- [ ] **Step 4: Read the regression verdict for the PR**

Open the run report under `evals/gosym-probe/results/runs/<run-dir>/` (markdown report + per-scenario `aggregated.json`). Confirm no regression was flagged. Capture the summary line(s) for the PR description.
Expected: no regressions. If a regression appears, refine Tasks 2/3 and re-run before opening the PR.

---

## PHASE 4 — Final checks and PR

## Task 6: Final checks and PR

**Files:** none (verification + PR).

- [ ] **Step 1: Typecheck, lint, build (agents)**

Run: `pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents lint && pnpm --filter @airo/agents build`
Expected: all pass.

- [ ] **Step 2: Full static SEO eval once more**

Run: `pnpm --filter @airo/agents test:unit "seo-generation"`
Expected: all pass.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin tgottigundala/rubicon-343-344-schema-aeo
gh pr create --fill --title "RUBICON-343/344: schema & AEO generation (prompt-driven)"
```

PR description MUST include:
- The Task 4 before/after rubric comparison table (main vs branch, per brief) and the gosym-probe regression verdict (Task 5 — no regression vs baseline).
- A note that no new gosym-probe evaluators/scenarios were added; durable schema-specific eval coverage is deferred to a future PR.
- The AC-interpretation notes from the spec: (1) 343 is schema-only despite its title; (2) 343/344 own first-time correctness while production validation/audit is RUBICON-345; (3) "a mechanism for selecting the type" = model judgment + primer nudge + worked example, since the SEO skill is not loaded at create.
- A note tagging the reporter (Susan Gunn) to confirm the 343/344 ↔ 345 boundary.

---

## Self-review notes

- **Spec coverage:** 343 baseline triad + dates + type nudge → Tasks 1-3; 344 page-purpose + entity refs → Tasks 1-3; behavioral before/after evidence (scored rubric, main vs branch) → Task 4; no-regression confirmation → Task 5; static-eval guard → Task 1; "no validator / no skill changes" boundary → enforced by the untouched `seo-generation.spec.ts` "unchanged from main" blocks + Boundary reminders.
- **No production validator/skill edits, and no gosym-probe contributions** appear in any task (RUBICON-345 boundary held; gosym-probe is run read-only).
- **Behavioral coverage for both 343 and 344** lives in Task 4 (manual DevTools on the homepage + the `/about` route across three briefs). This is the primary first-time-correctness evidence for the PR; gosym-probe (Task 5) only guards against core-build regression.
- **Verification ordering** matches the agreed approach: static eval + Chrome DevTools artifacts for iteration and first-time-correctness evidence; the existing gosym-probe suite last, read-only, as the regression guard. Durable schema-specific eval coverage is deferred to a future PR rather than contributed here.
