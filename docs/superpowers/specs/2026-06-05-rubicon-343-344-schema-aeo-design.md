# RUBICON-343 + 344 — Schema & AEO (prompt-driven)

**Date:** 2026-06-05
**Tickets:** [RUBICON-343](https://godaddy-corp.atlassian.net/browse/RUBICON-343) (Schema & AEO on site create — homepage), [RUBICON-344](https://godaddy-corp.atlassian.net/browse/RUBICON-344) (Schema & AEO on add new page)
**Epic:** RUBICON-97 — [airo-marketing] Visibility: SEO, GEO, AEO
**Base branch:** `tgottigundala/rubicon-98v2-cached-primer` (RUBICON-98, awaiting review)
**Delivery:** one combined PR

## Summary

Make every Airo App Builder site ship with correct, business-appropriate JSON-LD
structured data — a universal baseline on the homepage (RUBICON-343) and
page-appropriate schema + AEO structure on newly added pages (RUBICON-344).

The work follows the established post-RUBICON-98 SEO pattern: **a light inline nudge
in the cached develop primer drives a mostly-shippable baseline at create time; the
heavy reference material lives in the SEO skill and is consulted only on the
post-publish/audit path; the post-publish validator is the advisory backstop.** The
develop agent's primary job is building a good website, so create-time guidance stays
deliberately lean and the 593-line SEO skill is **not** loaded during the initial
build.

## Context: what already exists (RUBICON-98 lineage)

- **`agents/src/prompts/develop/seo.md`** (~29 lines, always loaded, cached): already
  requires, on every public page — `<Helmet>` with title/description/canonical/OG/Twitter,
  **one JSON-LD block** (`@context`/`@type`/`name`/`url` minimum, no fabricated values),
  image attributes, **exactly one `<h1>`**, heading hierarchy, and sitemap auto-sync.
- **`agents/src/skills/seo/skill.md`** (~593 lines, loaded on demand): full SEO reference.
  Force-loading at create was tried (`3144a7351`) and **walked back** in favor of the
  cached lightweight primer. The MarketingAgent force-loads it for SEO audits.
- **`agents/src/services/SeoValidator.ts`**: post-publish, **advisory (non-blocking)**.
  `checkJsonLd` (`:93`) verifies presence/parseability/non-empty; `checkH1` (`:89`) checks
  ≥1 H1 only; `runSeoHtmlChecks` (`:142`) runs the 13-check suite. Invoked via
  `logPublishedSeoAudit()` from `agents/src/server/routes/publish.ts`.
- **`agents/src/prompts/template-descriptions/v8.md`** (`:163`): current JSON-LD worked
  example is a minimal `AboutPage` — does not show the baseline triad.
- **`agents/src/evals/seo-generation.spec.ts`**: static prompt-assertion file that pins
  AC-coverage phrases present in the primer/skill (not a runtime gate).

**Therefore the delta these tickets add is narrow** — the primer already covers most of
the mechanical AEO asks. The new weight lands in the skill (depth) and the validator
(enforcement), both on the post-publish path.

## AC interpretation notes (to confirm with reporter, Susan Gunn)

1. **RUBICON-343 was rewritten (2026-06-05) to be schema-only.** The old AEO acceptance
   criteria (entity definition, answer-style copy, FAQPage, single-H1/heading hierarchy)
   were removed from the body; the title still reads "Schema & AEO." We treat **343 as
   structured-data only**; all AEO content work lives in **344**.
2. **Gate placement = post-publish validation.** 343's rewrite now says *"All generated
   schema passes validation with no errors at publish time"* — matching the existing
   advisory `SeoValidator`. 344 still reads *"before the page work is marked complete"*;
   we interpret that completion gate as **satisfied by the extended post-publish audit**
   (consistent with current SEO behavior; no hard customer-facing block). This will be
   called out in the PR description and flagged to the reporter.
3. **No structured create-time business context exists.** The only reliable create-time
   inputs are the freeform `initial_prompt`, an optional `fqdn`, and `created_at`
   timestamps (verified: `apps` table in `agents/src/database/schema.ts`; create payload
   in `app/src/app/api/sites/quick-create/route.ts`). There is no captured business name,
   category, or location, and the v8 template has no site-level data-injection mechanism.
   A deterministic generator would require its own LLM extraction step and still could not
   resolve the canonical domain. We therefore keep generation **prompt-driven** — the
   building agent is the only component that knows the business specifics, because it is
   authoring the page content. We accept that the baseline could occasionally be missing
   until the publish audit catches it.

## Scope

### In scope — RUBICON-343 (homepage at create)
- Homepage emits a universal baseline JSON-LD `@graph`: **`WebSite`** (site identity),
  **`Organization`** (business entity), **`WebPage`** (page context), plus canonical URL,
  title, meta description, and `datePublished`/`dateModified`.
- A documented **mechanism for selecting the business-appropriate `@type`** (category →
  schema.org type), applying `LocalBusiness` (or the closest subtype) when the brief
  provides a location.
- Schema fields populated only from create-time context — **no invented/placeholder
  values**.
- All schema is SSR-rendered (present on first byte) and passes publish-time validation.

### In scope — RUBICON-344 (new page after create)
- New page emits page-level JSON-LD matching site patterns (Helmet + `JSON.stringify`,
  same `@context`, entity references back to the site `Organization`/`WebSite`).
- Page-purpose `@type` selection (`AboutPage`/`ContactPage`/`FAQPage`/`WebPage`/service
  types), required properties only, no fabricated data.
- AEO structure: exactly one `<h1>`, semantic heading hierarchy, and — when `FAQPage` is
  used — JSON-LD `mainEntity` `Question`/`Answer` entries that mirror the visible FAQ.

### Out of scope
- Full-site publish audit ([RUBICON-345](https://godaddy-corp.atlassian.net/browse/RUBICON-345)).
- Automatic creation of new pages from market/trend signals.
- Any new structured create-time business-context capture (no API/UI/schema changes to
  the create payload or `apps` table).
- Deterministic/code-generated JSON-LD; LLM extraction micro-agent.
- Hard, build-blocking completion gates.

## Components & changes

All changes are in the `agents/` service.

### 1. `agents/src/prompts/develop/seo.md` — light primer delta (keep lean)
- **343:** upgrade the single-type JSON-LD bullet (`:20`) into a compact instruction to
  emit a baseline `@graph` of `WebSite` + `Organization` + `WebPage`, including
  `datePublished`/`dateModified`, with a one-line type-selection nudge ("pick the
  schema.org type that fits the business; use `LocalBusiness` when the brief gives a
  location"). The existing no-fabrication rule and canonical/`url` convention are reused.
- **344:** add a single line for page-purpose `@type` selection on new pages
  (`AboutPage`/`ContactPage`/`FAQPage`/`WebPage`), referencing the site `Organization`.
  The single-`<h1>` and heading-hierarchy rules are already present (`:24`) — no change.
- **Constraint:** net growth of a few lines. Depth must not leak into the primer.

### 2. `agents/src/skills/seo/skill.md` — depth (post-publish/audit path only)
- Add a **category → schema.org `@type` mapping table** (the "mechanism" the AC asks for)
  spanning common AAB business categories.
- Add required-properties-per-type reference, entity-`@graph` linkage patterns, and
  `FAQPage` ↔ visible-content (`mainEntity`) alignment detail.
- Consumed by the MarketingAgent's `seoAnalysis`/audit pass; **not** loaded at create.

### 3. `agents/src/prompts/template-descriptions/v8.md` — worked example
- Replace the minimal `AboutPage` example (`:163`) with a correct baseline `@graph`
  worked example (WebSite + Organization + WebPage) showing literal-value filling and
  dates. This is a concrete copy pattern, not new prose — the most token-efficient lever
  for correct output.

### 4. `agents/src/services/SeoValidator.ts` — post-publish checks (advisory backstop)
- Extend `checkJsonLd` (`:93`): detect baseline-triad presence (WebSite/Organization/
  WebPage), type-appropriateness, light required-property presence, and `FAQPage`
  `mainEntity` presence when that type is used.
- Heading checks: confirm/tighten **exactly-one `<h1>`** and add heading-hierarchy
  (no skipped levels) — RUBICON-344.
- New issue codes, e.g. `missing-website-schema`, `missing-organization-schema`,
  `missing-webpage-schema`, `multiple-h1`, `heading-hierarchy-skip`,
  `faqpage-missing-mainentity`. Checks remain non-blocking (logged at publish).

### 5. `agents/src/evals/seo-generation.spec.ts` — eval coverage (light)
- Extend the existing static prompt-assertion pattern to pin the new primer phrases
  (baseline triad, page-purpose types). A `gosym-probe` runtime scenario is an optional
  stretch, not required for this PR.

## Data flow & edge cases

- **No FQDN at create** → `url`/canonical follows the convention RUBICON-98 established
  (preview URL or site-root); we do not invent a domain.
- **No location in the brief** → emit `Organization` only, **not** `LocalBusiness` (the
  type-selection nudge/mapping gates this).
- **Dates** → agent writes the build-time date into `datePublished`/`dateModified`;
  acceptable staleness for an advisory check.
- **FAQPage without matching visible content** → flagged by the validator
  (`faqpage-missing-mainentity`); the skill's audit-path guidance drives the fix.

## Testing

- **Unit (Vitest):** `pnpm --filter @airo/agents test:unit` — new `SeoValidator` checks
  (triad presence, type-appropriateness, multiple-H1, heading-hierarchy,
  FAQPage/mainEntity), with fixtures for present/missing/invalid cases.
- **Evals:** extended `seo-generation.spec.ts` static assertions pass.
- **Manual:** create a site locally, inspect SSR output for `/` and confirm the baseline
  `@graph` is present on first byte; add a new page and confirm page-purpose schema +
  single H1; run a publish audit and confirm the new issue codes fire appropriately.
- **PR checklist:** `pnpm typecheck`, `pnpm lint`, `pnpm build`; backward compatibility
  (existing single-type pages still validate); E2E `data-testid`/flows unaffected.

## Sequencing / delivery

- One branch off `tgottigundala/rubicon-98v2-cached-primer`, one combined PR (the primer,
  skill, validator, and eval edits overlap heavily across 343/344).
- PR description records the three AC-interpretation notes above and tags the reporter to
  confirm the gate interpretation for 344.

## Risks

- **Baseline occasionally missing at create** (accepted): prompt-only generation has no
  structural guarantee; the publish audit is the safety net. Mitigated by the concrete
  v8.md worked example.
- **Primer bloat creep:** depth must stay in the skill. Reviewers should reject primer
  growth beyond the narrow delta.
- **Validator false positives** on legitimate non-LocalBusiness sites: type-appropriateness
  checks must be lenient (presence + parse + type-in-allowed-set), not prescriptive.
