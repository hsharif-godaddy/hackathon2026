---
status: implemented
---

# RUBICON-469: GBP Connection and Profile Sync

**Date:** 2026-06-16
**Status:** Draft
**Ticket:** [RUBICON-469](https://godaddy-corp.atlassian.net/browse/RUBICON-469)

> **Revised 2026-06-17:** Re-verified against current `main` (68 commits landed since drafting). Foundational anchors hold. Corrected the architecture to use the **two-pass client-action / context-attachment round-trip** (the agent cannot call `SocialV2Client` directly — it runs in `app/`, not `agents/`), mirroring the existing `google-reviews` skill. Also corrected `extractKeyContent` (returns a string blob, not structured fields) and the social-v2 method parameter shape (`userTokenId` + `accountId` + `locationId`). Phase count 6 → 7.
>
> **Revised 2026-06-17 (Phase 1):** Skill renamed `google-business-profile` → **`google-business-profile-sync`** (and `enablementId` → **`googleBusinessProfileSync`**) so it doesn't over-claim the GBP namespace shared with `google-reviews`; aligns with the `GbpSyncToolRenderer` name. The `checkConnection` lookup is extracted into a shared factory **`agents/src/services/social-connection-check.ts`** (`createCheckConnectionTool`) used by both `google-reviews` and `google-business-profile-sync` — only the logger labels and workflow-state `nextStep` strings differ per skill. No root `index.ts` per skill: tools are discovered by directory scan + `tools/index.ts` (per `packages/ai-skills/build-skill-tools.ts`).

## Problem

Customers maintain their Google Business Profile (GBP) listing separately from their Airo-built website, so business info (name, address, phone, hours, website URL) drifts out of sync between the two surfaces. There is currently no way to detect or reconcile that drift from inside the product.

## Goal

Add a new agent capability — exposed as a **conversational flow with no UI** — that lets a customer connect their GBP, surfaces mismatches between the live website and the GBP listing, and applies user-approved per-field syncs in either direction.

## Out of Scope

- Review management (handled by existing `google-reviews` skill — read-only, separate workflow)
- Listing performance reporting / analytics
- Yelp and Facebook profile sync
- Photo sync (read may be added later as a "suggest photos to add" flow)
- Category sync (GBP categories don't map cleanly to website concepts)
- Description sync (too subjective; high false-positive rate)
- Persistent mismatch state across sessions (re-fetch fresh each session)
- GBP-specific disconnect tool (use existing social-platform connection UI to disconnect)

## Fields in Scope (v1)

| Field         | Source on site                                                              | Source on GBP                                  | Notes                              |
| ------------- | --------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| Business name | Site title / `LocalBusiness.name` JSON-LD / footer                          | `location.title`                               | —                                  |
| Address       | JSON-LD `address` / `extractKeyContent` text blob                           | `location.storefrontAddress` (structured)      | LLM equivalence on free text       |
| Phone         | JSON-LD `telephone` / `extractKeyContent` text blob                         | `location.phoneNumbers.primaryPhone`           | E.164 normalization before compare |
| Hours         | JSON-LD `openingHoursSpecification` / `extractKeyContent` text blob         | `location.regularHours.periods`                | LLM equivalence if no JSON-LD      |
| Website URL   | Custom domain only (`hasCustomDomain` returns true) — else field is skipped | `location.websiteUri`                          | Only surfaced when on custom domain |

> **Note on `extractKeyContent`** (`agents/src/agents/page-prompt/extract-key-content.ts:23`): it returns a single human-readable **string** (sections like `"Phone: ..."`, `"Email: ..."`), **not** a structured object. The diff step must either parse this blob, call the underlying regexes directly, or hand the blob + GBP values to the LLM comparator. There are no `.addresses`/`.phones`/`.hours` fields.

## Key Decisions

| Decision                  | Choice                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Skill structure           | New sibling skill `agents/src/skills/google-business-profile-sync/`, **not** an extension of `google-reviews`  |
| OAuth                     | Reuse existing `social-v2` flow; `https://www.googleapis.com/auth/business.manage` scope already granted  |
| Persistence               | Re-fetch fresh on every session (no mismatch state stored beyond `SocialAssociation`)                     |
| Multi-location            | Pick first location silently, mirror `google-reviews` behavior; log + name the chosen location in chat    |
| Website-URL gating        | Skip the website-URL field entirely unless `hasCustomDomain(domains)` is true                             |
| App-not-published handling| Continue with non-website-URL fields against `previewUrl` if dev preview is up; otherwise scrape fails    |
| Site-side reading         | Reuse `websiteScraperAITool` + `extractKeyContent` + `parseJsonLdBlocks` — no new scraping infra          |
| Comparison strategy       | Prefer JSON-LD structured data; fall back to LLM equivalence judgment for free-text fields                |
| Site write                | Standard agent code-edit pass (no new mechanism)                                                          |
| Post-edit verification    | Poll preview URL up to 15 s, comparing scraped value to expected; fail if value doesn't propagate         |
| User confirmation         | Per-field user choice OR `fix all` shortcut; **no secondary confirmation** after `fix all`                |
| Feature flag              | Gated behind Switchboard `enablementId: googleBusinessProfileSync` (profile flag `skill.googleBusinessProfileSync.enabled`, off by default; registered in `profileGatedSkills`, matching `complianceDocs`/`ssrMigration`) |

## Architecture

### Client-action round-trip (critical constraint)

**The agent cannot call `SocialV2Client` directly.** `SocialV2Client` lives in `app/` (the browser/BFF) and authenticates with the customer's social token, which the agent process never holds. All GBP reads and writes go through the same **two-pass client-action / context-attachment** pattern that `google-reviews` already uses (see `docs/CLIENT-SIDE-TOOLS.md` and `agents/src/skills/google-reviews/tools/index.ts`):

```
Pass 1 (skill, agents/):  read SocialAssociation from local DB → return an `action` signal
                          e.g. { action: 'getGbpProfile', socialId }
        │
        ▼
Frontend tool renderer (app/):  catches the signal → calls SocialV2Client via hooks
                                (browser JWT) → posts result back as a context attachment
        │
        ▼
Pass 2 (skill, agents/):  read result from context.contextAttachments → return structured data
```

Each GBP operation that touches social-v2 (`getGbpProfile`, `updateGbp`) therefore requires **four** coordinated pieces, mirroring `google-reviews`:

1. **Skill tool** (`agents/`) — emits the `action` signal on pass 1, reads the attachment on pass 2.
2. **Shared attachment type** (`packages/shared/src/social/types.ts`) — e.g. `GBP_PROFILE_READY`, `GBP_UPDATE_DONE`, re-exported via `agents/src/types/social.ts`.
3. **Tool renderer** (`app/src/app/[market]/develop/components/tool-renderers/`) — a React component (sibling to `GoogleReviewsToolRenderer.tsx`) that detects the signal, calls the new `SocialV2Client` methods via the social hooks, and sends back the attachment.
4. **`SocialV2Client` methods** (`app/src/lib/social.ts`) — the actual social-v2 HTTP calls.

Operations that **don't** touch social-v2 — site scraping, JSON-LD/regex extraction, diffing, source-file edits, preview re-scrape verification — run entirely agent-side and need no round-trip.

### New skill: `agents/src/skills/google-business-profile-sync/`

```
agents/src/skills/google-business-profile-sync/
├── skill.md                          # frontmatter: name, description, whenToUse, intents, enablementId
└── tools/
    ├── index.ts                      # re-export registry (scanned by buildAllSkillTools)
    ├── check-connection.ts           # wraps shared createCheckConnectionTool factory (Phase 1, done)
    ├── get-gbp-profile.ts            # TWO-PASS: pass 1 emits `getGbpProfile` signal; pass 2 reads GBP_PROFILE_READY attachment
    ├── get-site-business-info.ts     # agent-side: scrape preview/published URL; JSON-LD + extractKeyContent
    ├── diff-business-info.ts         # agent-side: produces per-field { gbp, site, equivalent } records
    ├── sync-field.ts                 # gbp-to-site = agent-side code edit; site-to-gbp = TWO-PASS `updateGbp` signal
    ├── verify-site-sync.ts           # agent-side: poll preview URL up to 15 s for expected value
    └── __tests__/                    # one *.test.ts per tool
```

The shared `createCheckConnectionTool` factory lives in `agents/src/services/social-connection-check.ts` (outside both skill dirs) and is also consumed by `google-reviews/tools/index.ts`.

Plus, in **`app/`** (the frontend round-trip half):

```
app/src/app/[market]/develop/components/tool-renderers/
└── GbpSyncToolRenderer.tsx           # catches getGbpProfile / updateGbp signals, calls SocialV2Client, posts attachment
app/src/lib/social.ts                 # + getGoogleBusinessProfile, + updateGoogleBusinessProfile
packages/shared/src/social/types.ts   # + GBP_PROFILE_READY, + GBP_UPDATE_DONE attachment-type constants
```

`google-reviews` is unchanged. Both skills coexist and reference the same `SocialAssociation` row for a given app.

### New `SocialV2Client` methods (`app/src/lib/social.ts`)

Existing client has `getGoogleLocations(userTokenId)` and `getGoogleReviews(userTokenId, accountId, locationId)` — note the **`userTokenId` + `accountId`** parameter shape; `SocialAssociation` only stores `socialId`, and the socialId→token/account resolution happens browser-side via the social hooks. The two new methods follow the same shape:

> **Implemented (Phase 2) — `accountId` dropped from the read.** The GBP
> **Business Information v1** location resource (`mybusinessbusinessinformation/v1/locations/{locationId}`)
> is keyed by `locationId` alone — `accountId` only appears in the older v4
> reviews path and the account-management listing. So the shipped read signature
> is `getGoogleBusinessProfile(userTokenId, locationId)` (no `accountId`), and the
> renderer does **not** resolve `accountId` for the read. The return type is the
> shared `GoogleBusinessProfile` (`@airo/shared/social`). The Phase 5 update will
> likewise be keyed by `locationId`.

```typescript
// Read the editable profile (vs. existing getGoogleLocations which returns limited fields)
async getGoogleBusinessProfile(
  userTokenId: string,
  locationId: string,
): Promise<GoogleBusinessProfile>;   // { name, storefrontAddress?, primaryPhone?, regularHours?, websiteUri? }

// Write a subset of fields back via GBP Business Information API (Phase 5)
async updateGoogleBusinessProfile(
  userTokenId: string,
  locationId: string,
  updates: Partial<{
    name: string;
    storefrontAddress: GbpPostalAddress;
    primaryPhone: string;
    regularHours: GbpRegularHours;
    websiteUri: string;
  }>,
): Promise<{ updated: string[] }>;
```

Both route through the existing `social-v2.api` proxy with the `X-Token-Id` header. Update uses GBP's `updateMask` query parameter to PATCH only the changed fields. **These methods are invoked by the tool renderer, never by the skill directly.**

### Conversation flow (illustrative)

Tool calls below show which run agent-side vs. which trigger a frontend round-trip.

```
User: "Can you sync my Google Business listing with my site?"
  → Agent loads skill via `intents` match.

Agent → checkConnection                    [agent-side: reads SocialAssociation]
  ↳ not connected:
     Agent surfaces auth URL (existing social-v2 OAuth popup pattern).
     User completes OAuth in browser, returns to chat.
     Agent → checkConnection (now connected).

Agent → getGbpProfile                       [ROUND-TRIP: pass 1 signal → renderer calls
                                             getGoogleBusinessProfile → GBP_PROFILE_READY
                                             attachment → pass 2 reads it]
   (picks first location, names it: "...for your listing 'Acme Plumbing - Phoenix'")
Agent → getSiteBusinessInfo                 [agent-side: scrape previewUrl/publishedUrl + extract]
Agent → diffBusinessInfo                    [agent-side]

Agent presents mismatches in chat:
  "I found 3 differences:
   1. Phone — site says (555) 123-4567, GBP says (555) 123-9999
   2. Hours — site says 'Mon-Fri 9-5', GBP says 'Mon-Fri 8am-6pm, Sat 9am-2pm'
   3. Address — site says '123 Main St', GBP says '123 Main St, Suite 200'
   For each: update site, update GBP, or skip? Or say 'fix all using GBP' / 'fix all using site'."

User: "Phone — update site. Hours — update GBP. Address — skip."

Agent → syncField('phone', 'gbp-to-site')   [agent-side]
   → finds occurrences in source (footer, contact page, JSON-LD) and edits each.
   → verifySiteSync('phone', '(555) 123-9999') polls preview up to 15 s.
   → reports success or lists files where the value didn't propagate.

Agent → syncField('hours', 'site-to-gbp')   [ROUND-TRIP: pass 1 emits `updateGbp` signal →
                                             renderer calls updateGoogleBusinessProfile →
                                             GBP_UPDATE_DONE attachment → pass 2 reads result]
   → reports success or surfaces API error.

Agent: "Done. Phone now matches on both. Hours updated on GBP. Address skipped."
```

### Domain-validation rule

```typescript
const customDomain = hasCustomDomain(siteDomains); // existing utility
if (!customDomain) {
  // Skip the website-URL field entirely — do not surface as a mismatch in either direction.
  // All other fields are still compared and may be synced.
}
```

If the site is published only on a preview/prefix domain, the website-URL row is removed from the diff. This protects GBP from being pointed at a non-customer-facing URL, and avoids putting a preview URL into the customer's verified listing.

### Comparison strategies per field

| Field         | Strategy                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Name          | Trim + case-insensitive equality                                                                      |
| Phone         | Normalize to E.164 (strip formatting), then equality                                                  |
| Address       | If site has JSON-LD `PostalAddress`: structured field-by-field equality. Else: LLM equivalence judgment between GBP's structured form and site's free-text address. |
| Hours         | If site has JSON-LD `openingHoursSpecification`: structured comparison vs. GBP's `regularHours`. Else: LLM equivalence judgment between free-text hours and structured GBP hours. |
| Website URL   | Trim trailing slash + lowercase host; equality. Only run if custom-domain.                            |

LLM equivalence calls log a decision record (input A, input B, verdict, rationale) at `info` level for later auditing.

### Site-write & verification loop

```typescript
// Pseudocode for syncField('hours', 'gbp-to-site')
const expected = gbpProfile.regularHours;
await editSourceFiles(field, expected);   // standard code-edit pass via existing agent tools

const verified = await verifySiteSync(field, expected, {
  pollMs: 1000,
  timeoutMs: 15000,
});

if (!verified.ok) {
  // Re-scrape and report which surfaces still show the old value.
  // Agent surfaces the leftover occurrences to the user and offers a second pass.
}
```

`verifySiteSync` re-runs the same read pipeline (`websiteScraperAITool` + JSON-LD + `extractKeyContent`) against `app.previewUrl`. The dev container auto-rebuilds, so the new value should propagate within seconds. A 15 s timeout is a reasonable upper bound for local rebuild latency.

For `site-to-gbp` direction, "verification" is just the GBP API response. No polling required.

### Database

No new tables or columns. Reuses:

- `SocialAssociation` (already supports `SocialPlatform.GOOGLE_BUSINESS_PROFILE`)
- `apps.previewUrl`, `apps.publishedUrl` (existing)
- `memoryRepo.read('site.domains', appId)` (existing — used by `hasCustomDomain`)

### Skill activation (`skill.md` frontmatter)

```yaml
---
name: google-business-profile-sync
description: Connect a Google Business Profile and sync business info between the listing and the website.
whenToUse: |
  When the customer wants to connect their Google Business Profile, check whether their listing matches their site, or fix mismatches between the two. Do NOT use for review management — that is handled by google-reviews.
intents:
  - "Connect Google Business Profile"
  - "Sync Google Business listing"
  - "My GBP doesn't match my site"
  - "Update my Google listing"
enablementId: googleBusinessProfileSync
---
```

## Implementation Phases

Each phase that involves a social-v2 operation spans **three packages** (`agents/` skill tool, `packages/shared/` attachment type, `app/` renderer + client method) because of the client-action round-trip. Phases are ordered so the round-trip plumbing for a given operation lands together.

### Phase 1 — Skill skeleton & connection check (agent-side only) ✅ done

- Create skill folder `google-business-profile-sync/` + `skill.md` (no stub tool files — unimplemented tools are added in their phases so no broken tools register; the skill is gated off anyway)
- Extract shared `createCheckConnectionTool` factory (`agents/src/services/social-connection-check.ts`); `check-connection.ts` wraps it (agent-side only — no round-trip). Retrofit `google-reviews` to consume the same factory (behaviorally identical — exact log-event keys + `nextStep` strings preserved)
- Register `googleBusinessProfileSync` in `profileGatedSkills` (off by default → `skill.googleBusinessProfileSync.enabled`); gate the skill via `enablementId`
- Tests for `check-connection` (14); `google-reviews` suite (31) still green

### Phase 2 — GBP read round-trip (`getGbpProfile`) ✅ done

- `packages/shared/src/social/types.ts`: added `GBP_PROFILE_READY` + `GoogleBusinessProfile`/`GbpPostalAddress`/`GbpRegularHours`/`GbpTimePeriod`/`GbpTimeOfDay` types; exported via the social barrel and re-exported from `agents/src/types/social.ts` + `app/src/types/social.ts`
- `app/src/lib/social.ts`: added `SocialV2Client.getGoogleBusinessProfile(userTokenId, locationId)` (Business Information v1 location read, `readMask=title,storefrontAddress,phoneNumbers,regularHours,websiteUri`; **no `accountId`** — see method note above)
- `app/.../tool-renderers/GbpSyncToolRenderer.tsx`: handles the `getGbpProfile` signal — `getConnectionById` → `getGoogleBusinessProfile(userTokenId, locationId)` → posts `GBP_PROFILE_READY`. Registered as `google-business-profile-sync__getGbpProfile` in the tool-renderers `index.ts`
- `agents/`: implemented `get-gbp-profile.ts` two-pass (pass 1 emits signal; pass 2 reads attachment) — near-clone of `fetchReviews`; registered in the skill `tools/index.ts`
- Tests: skill tool both passes (12), renderer with mocked `SocialV2Client` (8). agents typecheck/lint + website lint clean

### Phase 3 — Site read (agent-side only) ✅ done

- Implemented `get-site-business-info.ts`: resolves the URL as `previewUrl ?? publishedUrl` (preview reflects latest edits) via `appRepository.findById`, scrapes with `WebsiteScraperDriver.scrapeAndScreenshot`, then runs two passes — structured (`parseJsonLdBlocks` + `flattenSchemaNodes` → the LocalBusiness/Organization node: name/address/telephone/openingHours/url; handles `@graph`) and fallback (`extractKeyContent` → labeled text blob). Returns both `{ sourceUrl, source, jsonLd, textBlob }`; the diff step picks which to use. Registered in the skill `tools/index.ts`
- Tests (13): JSON-LD present (LocalBusiness + `@graph` node selection), JSON-LD absent (text-blob fallback), preview/published URL resolution, no-URL graceful error, scrape failure/throw, computeState. Real `parseJsonLdBlocks`/`extractKeyContent` (not mocked)
- **Revised (post-Phase-7, customer-experience fix):** the site read is now **source-first**, not URL-scrape. `readSiteBusinessInfo` reads the app source via the **workspace `files` client** (`createForWorkspace(appId,'preview').files` — the same path the gbp→site write uses): `files.search` for business-info signals (`application/ld+json`, a US-phone regex, `hours/address/tel:/mailto:`) over source globs → `files.view` the matched files → concatenate → `parseJsonLdBlocks`/`flattenSchemaNodes` + `extractKeyContent`. This mirrors `seo-audit.ts` (source scan, no public URL needed) and, crucially, **works on the unpublished in-progress preview** — the old `WebsiteScraperDriver` route went through the public web-scraper, which can't reach a customer's auth-gated, co-located preview and so effectively required a published site. Output is now `{ source: 'source', jsonLd, textBlob, filesScanned }` (no `sourceUrl`/`previewUrl` lookup; no scraper, no screenshot).

### Phase 4 — Diff (agent-side only) ✅ done

- Implemented `diff-business-info.ts`. Takes the `gbp` (from getGbpProfile) and `site` (from getSiteBusinessInfo) objects as **parameters** — the agent threads the prior tool outputs, keeping the comparator pure/testable. Returns `{ fields: FieldDiff[], mismatches: FieldDiff[] }` with per-field `{ field, gbp, site, equivalent, strategy, rationale? }`. Fields with a value missing on either side are omitted (not a mismatch). Registered in the skill `tools/index.ts`
- Per-field strategy: name/phone/website = deterministic normalization (`normalizeName`, `normalizePhone` → last-10-digits dropping US country code, `normalizeUrl` → lowercase host, drop `www`/protocol/trailing slash). address/hours = JSON-LD-structured when the site has structured data (`formatGbp*`/`formatSchema*`, `canonicalize*Hours` → sorted "DAY HHMM-HHMM"), else LLM equivalence
- LLM equivalence (`getModel('haiku')` + `generateObject`, wrapped in `llmMetadataContext.run`): logs a decision record (`...diff.equivalence` with inputA/inputB/verdict/confidence/rationale) at info; **defaults to "different"** when model confidence `< 0.7` or on error (fail-safe forces the user to choose). Free-text site fields are pulled from the `extractKeyContent` blob (`fieldFromBlob`/`hoursFromBlob`)
- Tests (16): normalization helpers; structured all-match (no LLM); structured name/phone/website mismatch; free-text address/hours via mocked LLM; low-confidence → mismatch; LLM error → mismatch; one-side-missing omitted; computeState. Lint/typecheck clean

### Phase 5 — GBP write round-trip (`updateGbp`, site→GBP sync) ✅ done

> **Net-new territory:** no existing code did a *mutating* social-v2 round-trip. The mechanism mirrors the read path.

- `packages/shared/`: added `GBP_UPDATE_DONE` attachment-type constant; re-exported from `agents/` + `app/`
- `app/src/lib/social.ts`: added `SocialV2Client.updateGoogleBusinessProfile(userTokenId, locationId, updates)` (no `accountId`, same as the read) — maps GoogleBusinessProfile keys → GBP location field paths (`name`→`title`, `primaryPhone`→`phoneNumbers.primaryPhone`, …), PATCHes only changed fields via `updateMask`, returns `{ updated }`
- `app/.../GbpSyncToolRenderer.tsx`: now branches on `action` (`getGbpProfile` | `updateGbp`); the `updateGbp` path calls `updateGoogleBusinessProfile` and posts `GBP_UPDATE_DONE { field, updated, error? }` — error path posts an attachment too so pass-2 can prompt reconnect/retry. Registered `google-business-profile-sync__syncField` → `GbpSyncToolRenderer`
- `agents/`: implemented `sync-field.ts`. `site-to-gbp` is two-pass — pass 1 validates the value (string for name/phone/website; GBP-shaped object for address/hours), confirms connection, emits `updateGbp` with `{ socialId, field, updates }`; pass 2 reads the `GBP_UPDATE_DONE` attachment **matched on `field`** (disambiguates sequential field syncs). `gbp-to-site` is guarded (returns `notImplemented`) until Phase 6. Registered in the skill `tools/index.ts`
- Tests: skill tool 13 (both passes, field→key mapping, value-shape validation, not-connected, attachment match-on-field, gbp-to-site guard, computeState); renderer 12 = 8 read + 4 update (success, error-attachment, in-flight label). agents typecheck/lint + website lint clean

### Phase 6 — Site write + verification (agent-side only, gbp→site sync) ✅ done

- Implemented `sync-field.ts` `direction = 'gbp-to-site'`: replaces the current site text (`previousValue` param) with the GBP value (`value`, a string) across the app source using the **standard workspace primitives** — `files.search` (regex-escaped pattern, source globs) to locate, then `files.edit({ oldString, newString, replaceAll })` per unique file. Returns `{ editedFiles, occurrences }`; no-ops when `previousValue === value`; tolerates per-file edit throws. (address/hours site→gbp still take a GBP-shaped object on the write path; gbp→site takes the formatted display string.)
- Implemented `verify-site-sync.ts`: polls `app.previewUrl` via `WebsiteScraperDriver` up to `timeoutMs` (default 15s, `pollMs` default 1s), checking the scraped content for the expected value (phone by digits dropping the US country code; others case-insensitive substring). On success `{ ok: true, attempts }`; on timeout `{ ok: false, attempts, leftoverFiles }` where `leftoverFiles` comes from a source search for `previousValue` so the agent can name exactly which files still hold the old value. Tolerates transient scrape errors mid-poll. Registered in the skill `tools/index.ts`
- Tests (29): sync-field gbp-to-site (multi-file dedup edit, previousValue required, non-string rejected, no-op, workspace-unavailable, applied-0/throw tolerance, computeState site-edited); verify-site-sync (first-poll match incl. phone-by-digits, substring match, timeout→leftover search, no-previousValue timeout, polls through scrape errors, computeState). Full skill suite 84 tests; typecheck/lint clean

### Phase 7 — End-to-end & polish ✅ done

- Domain-gating: `diffBusinessInfo` now reads `site.domains` from memory (via context `appId`) and only emits the website field when an **active, non-prefix** custom domain exists — preview/prefix URLs are never surfaced. Default (no/empty/failed lookup) = not custom = website omitted. Tests cover custom / not-custom / prefix-only / lookup-failure
- `skill.md`: expanded with the full read→diff→sync flow (Steps 3–6) — `getGbpProfile`/`getSiteBusinessInfo` → `diffBusinessInfo` (pass prior outputs through) → present mismatches + fix-all shortcuts → per-field `syncField` both directions (+ `verifySiteSync` for gbp→site) → closing "publish to make it live" reminder. Multi-location naming and the website-gating note are inline. `intents`/`whenToUse` were set in Phase 1
- Skill-router corpus eval added at `evals/corpus-eval/corpora/skill-loader/google-business-profile-sync.yaml`: positives (sync/compare/field-fix intents) + negatives (reviews → `google-reviews`; UI/design/hours-section → no skill)
- Skill-level flow test (`tools/__tests__/skill-flow.test.ts`, mocked, 3 scenarios): connect → read both → diff (phone mismatch) → site→gbp two-pass → gbp→site edit → verify; plus all-match (no mismatches) and website-gated-off cases
- `agent-tool-inventory.md` intentionally **not** edited — it's an architecture doc with no per-skill tool listing (neither does `google-reviews` appear); skills are discovered dynamically from `skill.md` frontmatter per the Self-Containment Rule, so there is nothing to add there
- Full skill suite: **91 tests** across 7 files; agents typecheck/lint + website lint clean

**Disconnect:** intentionally not implemented in v1. Customers who want to disconnect can do so via the existing social-platform connection UI; no GBP-specific disconnect tool is shipped here.

## Risks & Mitigations

| Risk                                                                                | Mitigation                                                                                                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Multi-location: silently picking the first location may write to the wrong listing  | Always include the chosen location's name in the agent's chat output so the user can spot the wrong listing. Log a warning.       |
| LLM equivalence judgment yields false positives ("9-5" ≠ "9am-5pm" mistakenly)      | Log every equivalence decision for review. Default to "different" on low-confidence outputs (force the user to choose).           |
| Preview URL not available (dev container not running, app never opened)             | Fall back to `publishedUrl` if available; if neither exists, the agent reports "I need your site to be published or your preview running" and exits gracefully. |
| OAuth token expiry mid-session                                                      | The 401 surfaces in the **renderer** (browser-side, where the social-v2 call runs), not the skill. The renderer posts a failure attachment; the skill's pass-2 reads it and prompts for reconnect. Mirror how `GoogleReviewsToolRenderer` handles `needsReconnect`. |
| Write round-trip is net-new (no existing mutating social-v2 example)                | Build the read round-trip (Phase 2) first and validate it end-to-end before the write path; the write renderer reuses the read renderer's signal/attachment plumbing. Test the renderer's error path with a mocked failing `updateGoogleBusinessProfile`. |
| Site source has business info duplicated in N files; site-direction sync misses one | `verify-site-sync.ts` re-scrapes after edits and surfaces leftover occurrences to the user for a second pass.                     |
| Customer never re-publishes after a `gbp-to-site` sync                              | Agent flags this in its closing summary: "Your changes are live in your preview. Publish to make them live for visitors."         |

## PR Checklist (per repo CLAUDE.md)

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Skill-level tests pass under `pnpm --filter @airo/agents test:unit`
- [ ] Frontend renderer tests pass under `pnpm --filter website test` (new `GbpSyncToolRenderer`)
- [ ] `packages/shared` builds with the new attachment-type exports (consumed by both `agents/` and `app/`)
- [ ] New `GbpSyncToolRenderer` registered in the tool-renderers `index.ts`
- [ ] Switchboard flag `googleBusinessProfile` registered (off by default)
- [ ] No E2E `data-testid` / user-flow changes (the renderer reacts to an agent signal; it adds no new interactive UI). If a `data-testid` is added to the renderer for testing, sync `tests/e2e/`, `tests/e2e-v2/`, `tests/regression/` per repo policy.
- [ ] OAuth scope unchanged (`business.manage` already granted) — verified, no re-consent needed

## Open Questions

(All resolved with the user as of 2026-06-16. Listed for traceability.)

- Multi-location handling — pick first silently (deferred from "ask user" option)
- Domain validation — only surface website-URL mismatch when site is on custom domain
- App with no published site — proceed against preview URL for non-website-URL fields
- Free-text comparison — LLM equivalence fallback acceptable
- Feature flag — yes, Switchboard
- Post-edit verification cadence — poll up to 15 s
