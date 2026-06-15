# RUBICON-343 + 344 — AC Coverage Map

**Companion to:** `2026-06-05-rubicon-343-344-schema-aeo-design.md`
**Date:** 2026-06-05 (revised 2026-06-09)
**Purpose:** For each acceptance criterion in both tickets, state who satisfies it —
existing work, **this PR (generation-only)**, or **RUBICON-345 (validation/audit)**.

## Boundary

Per RUBICON-345's text — *"Create and new-page tickets own first-time correctness"* and
345 is the post-publish *"safety net"* — responsibilities split cleanly:

- **343 / 344 = first-time correctness via generation** (develop primer + `v8.md` worked
  example; no validator, no new tools). The SEO skill stays **unloaded at create**, but
  its JSON-LD section was synced to the same triad/`@id` baseline (review found it taught a
  conflicting single-`@type` pattern, and it loads on-demand during SEO/audit sessions).
- **345 = validation, full-site audit, regression detection, customer-facing surfacing,
  and the fix loop.**

## Legend

| Status | Meaning |
| --- | --- |
| ✅ **Done** | Already satisfied by existing SEO work on `main`. |
| 🟢 **This PR** | Net-new generation guidance in 343/344 (primer reword + worked example + eval). |
| 🔵 **RUBICON-345** | Satisfied by the post-publish validation/audit work, out of scope here. |
| 🟡 **Shared** | Generation side is this PR; enforcement/validation side is 345. |

## What already exists on `main` (RUBICON-98 baseline)

The `develop/seo.md` primer already requires, per page: Helmet with title/description/
canonical/OG/Twitter, **one** JSON-LD block (min fields, strong anti-fabrication), image
hygiene, **exactly one `<h1>`**, heading hierarchy, sitemap sync. SSR renders it on first
byte. An advisory post-publish audit already checks JSON-LD **validity** and **H1
presence**.

---

## RUBICON-343 — Schema & AEO on site create (homepage)

> Rewritten 2026-06-05 to be schema-only.

### Table stakes — every homepage must include

| AC | Status | Notes |
| --- | --- | --- |
| `WebSite` schema | 🟢 This PR | Primer reword → baseline `@graph`; concrete shape in `v8.md` worked example. |
| `Organization` schema | 🟢 This PR | Same; declared on the homepage. |
| `WebPage` schema | 🟢 This PR | Added to the baseline `@graph`. |
| Canonical URL | ✅ Done | Primer requires absolute canonical; existing validity check covers it. |
| Page title + meta description | ✅ Done | Primer + eval (AC1). |
| `datePublished` + `dateModified` | 🟢 This PR | Added to the triad guidance (build-time date). |

### Business-appropriate schema

| AC | Status | Notes |
| --- | --- | --- |
| Mechanism for selecting the `@type` | 🟢 This PR | At create = model judgment + one-line primer nudge + worked example. (Any heavy category→type table is 345 fix-flow fuel, not create-time.) |
| `LocalBusiness` when location available | 🟢 This PR | Conditional nudge in primer + shown in worked example. |
| No invented / placeholder values | ✅ Done | Existing anti-fabrication clause; eval-pinned. |

### Technical requirements

| AC | Status | Notes |
| --- | --- | --- |
| SSR-rendered, present on first byte | ✅ Done | Helmet JSON-LD already SSR'd. |
| Passes validation, no errors at publish | 🟡 Shared | **This PR** makes generation correct; the **validity** check already exists; the **triad/type checks** that fully enforce this are 🔵 **345**. |

---

## RUBICON-344 — Schema & AEO on add new page

### AC1 — Page-level JSON-LD matching site patterns

| Sub-requirement | Status | Notes |
| --- | --- | --- |
| JSON-LD via Helmet + `JSON.stringify`, same `@context` | ✅ Done | Primer already requires it on every page. |
| Consistent entity references to site/`Organization` | 🟢 This PR | Primer line + worked-example sub-page pattern (reference by `@id`). |

### AC2 — Page-appropriate `@type` + required properties, no fabrication

| Sub-requirement | Status | Notes |
| --- | --- | --- |
| Select `@type` by **page purpose** | 🟢 This PR | Page-purpose nudge in primer + worked example. |
| Required properties, no fabricated data | ✅ Done | Anti-fabrication clause already covers this. |

### AC3 — Validate new page has schema + AEO elements

| Sub-requirement | Status | Notes |
| --- | --- | --- |
| Valid JSON-LD | ✅ Done | Existing `checkJsonLd` validity check. |
| One `<h1>` | 🟡 Shared | Primer already mandates it (generation ✅); **count enforcement** (`multiple-h1`) is 🔵 **345**. |
| Semantic structure / heading hierarchy | 🟡 Shared | Primer already mandates it (generation ✅); **hierarchy check** is 🔵 **345**. |
| `@type` appropriate to page | 🟡 Shared | Generation 🟢 this PR; **type-appropriateness check** 🔵 345. |
| FAQ aligned to schema if `FAQPage` | 🟡 Shared | Light generation guidance 🟢 this PR; **`mainEntity` sync check** 🔵 345. |
| Gating "before page work marked complete" | 🔵 345 | Satisfied by the post-publish safety net; no hard pre-completion block. |

---

## Rollup

| Ticket | ✅ Done | 🟢 This PR (generation) | 🔵/🟡 RUBICON-345 (validation) |
| --- | --- | --- | --- |
| **343** | canonical, title/description, no-fabrication, SSR | WebSite, Organization, WebPage, dates, type-selection nudge, LocalBusiness rule | triad/type **checks** that enforce "passes validation" |
| **344** | JSON-LD-via-Helmet, no-fabrication, valid JSON-LD | entity refs, page-purpose `@type`, FAQ generation guidance | multi-H1, heading-hierarchy, type-appropriateness, FAQ-sync **checks**; completion gate |

**Takeaway:** 343/344 is a focused **generation** change — reword the develop primer and
upgrade the `v8.md` worked example so the agent emits the baseline triad (343) and
page-appropriate, entity-linked schema (344) the first time, from always-loaded context
with no skill. Everything that *checks* the output — the new validator checks, full-site
sweep, UI surfacing, and fix loop — is **RUBICON-345**. The existing advisory audit
(JSON-LD validity, H1 presence) remains the interim backstop until 345 lands.
