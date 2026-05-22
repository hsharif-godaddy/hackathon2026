# Initial Brand-Kit Agent

**Status:** Design
**Date:** 2026-05-18
**Author:** Joshua Eichorn

## Summary

A new initial-agent variant — `initial-brand-kit` — based on the existing 3.0 modular initial agent, that asks kit-aware discovery questions, selects a brand kit from a remote catalog (with the user picking from a shortlist), downloads and installs the kit into the app's `docs/ui-kit/` directory, and asks any per-kit customization questions defined in the catalog before handing off to develop.

The variant exists alongside the current initial agents so it can be A/B tested against them in the endgame harness.

## Goals

- Produce a discoverable named manifest variant of the initial agent that runs the new flow end-to-end.
- Drive kit selection from a catalog hosted on `blobby.{env}.wsimg.com`, with environment-aware URL resolution.
- Make the catalog visible to the model on turn 1 with no extra round-trip (preflight tool call).
- Cleanly install a kit into the existing UI-kit pipeline (`docs/ui-kit/`) so all downstream tooling (`loadUiKit`, `UiKitUploadContextRenderer`) keeps working unchanged.
- Support the catalog's per-kit customization `questions[]` — the agent asks them after install.

## Non-Goals

- Replacing or deprecating the 1.0/2.0/3.0 initial agents.
- Authoring new brand kits or building catalog-management tooling — the catalog is owned elsewhere; this design only consumes it.
- A pre-generation script that commits a snapshot of the catalog to the repo. We chose runtime fetch with disk-cache fallback instead.
- Personalising the kit-discovery questions to a richer multi-kit catalog. Today there is one example kit; the question stubs are designed against that example and will be revised as the catalog grows.

## Flow

```
Phase 1 — project details (same as 3.0): name, audience, location, scope
   ↓
Phase 2 (NEW) — kit-discovery questions: aesthetic family, craft texture, energy
   ↓
Shortlist 2–3 kits from catalog + "None — start from scratch" → askQuestion
   ↓
   ├── Picked a kit → installBrandKit(slug) → ask catalog's per-kit questions[]
   │
   └── "None"       → run standard 3.0 Phase 2 (vivid-style + tone)
   ↓
Design + handoff (kit, if installed, is in context via UiKitUploadContextRenderer)
```

## Components

### 1. Named manifest variant

Directory: `agents/src/prompts/initial/brand-kit/`

`manifest.json` declares the load order plus a new field:

```json
{
  "promptVersion": "brand-kit",
  "modules": [
    "identity.md",
    "project-name.md",
    "questioning-phase1.md",
    "kit-discovery-questions.md",
    "kit-selection.md",
    "kit-customization.md",
    "no-kit-fallback.md",
    "design-direction.md",
    "design-reference.md",
    "feature-list.md",
    "examples.md",
    "handoff-template.md"
  ],
  "preflightTools": ["listBrandKits"]
}
```

`discoverNamedInitialVariants()` already picks up any `agents/src/prompts/initial/<name>/manifest.json`, so registration is automatic. The new `preflightTools` field is read by the agent factory (see §4).

Most modules are copied (not symlinked) from `initial/3.0/` so the variant is free to diverge. The new modules are:

- **`questioning-phase1.md`** — Phase 1 only, split from 3.0's `questioning.md`.
- **`kit-discovery-questions.md`** — Phase 2, kit-aware. Three multiple-choice questions whose answers map onto catalog `tags` / `whenToUse` vocabulary. Stubbed against the single current example kit (botanical-calligraphy):
  - **Aesthetic family** — organic & natural / minimal & geometric / bold & expressive / classic & traditional / playful & illustrated
  - **Craft texture** — hand-lettered & illustrated / refined-typographic / clean-digital / photographic & cinematic
  - **Energy** — warm & intimate / luxurious & elevated / energetic & bold / calm & precise / casual & friendly
- **`kit-selection.md`** — instructs the model to read the pre-run `listBrandKits` result, score candidates against Phase 1 + kit-discovery answers, present 2–3 best matches plus "None — start from scratch" via `askQuestion`, then call `installBrandKit(slug)` on a pick.
- **`kit-customization.md`** — after install, read the kit's `questions[]` from the install tool's response and ask them via a single `askQuestion` call. Answers feed the design/handoff prompts.
- **`no-kit-fallback.md`** — when the user picks "None", run the standard 3.0 Phase 2 (vivid-style + tone). The module duplicates the relevant chunk of 3.0's `questioning.md` rather than importing it, so the variant can diverge.

### 2. Catalog service

`agents/src/services/brand-kit/catalog.ts`:

- `resolveBrandKitBaseUrl(): string` — returns `process.env.BRAND_KIT_BASE_URL` if set; otherwise composes from `resolveEnv()` (`agents/src/utils/gd-env.ts`):
  - `dev` → `https://blobby.dev-wsimg.com/brand-kits`
  - `test` → `https://blobby.test-wsimg.com/brand-kits`
  - `prod` → `https://blobby.wsimg.com/brand-kits`
- `fetchBrandKitCatalog(): Promise<BrandKitCatalog>` — `GET ${baseUrl}/catalog.json`, validate with a zod schema, cache in memory with a TTL (default 10 minutes), and write the validated payload to disk at `agents/data/brand-kit-catalog.json`. On network failure, fall back to the on-disk cache; if neither is available, throw a descriptive error.
- `BrandKitCatalogEntry` zod schema mirrors the catalog: `slug`, `whenToUse`, `tags: string[]`, `questions: string[]`, `tarball`, `tarballHash`.

### 3. Install service

`agents/src/services/brand-kit/install.ts`:

- `installBrandKit({ slug, appPath })`:
  1. Look up the entry in the cached catalog.
  2. Resolve the tarball URL: `${resolveBrandKitBaseUrl()}/${entry.tarball}`.
  3. Download the tarball into a temp file under `IMPORT_TEMP_DIR` (same env var the existing UI-kit upload route uses).
  4. Verify sha256 of the downloaded bytes against `entry.tarballHash` (which is `sha256-<hex-prefix>`); reject with a typed error on mismatch.
  5. Extract the tarball into `${appPath}/docs/ui-kit/` using the `tar` npm package (new dependency — existing code uses JSZip for zips).
  6. Apply the same path-safety posture as `routes/ui-kit.ts` — reject entries containing `..`, absolute paths, NUL bytes, or anything that resolves outside the target directory after `path.resolve()`.
  7. Return `{ slug, written: number, questions: string[] }`.

### 4. Tools

`listBrandKits` — `agents/src/tools/ai-lib-tools/list-brand-kits.ts`:

- Optional `tags?: string[]` filter.
- Returns formatted markdown listing each kit's `slug`, `whenToUse`, `tags`. Tarball + hash are not exposed to the LLM (install detail).
- Registered as a preflight tool by the `initial-brand-kit` variant (see §5).

`installBrandKit` — `agents/src/tools/ai-lib-tools/install-brand-kit.ts`:

- Required `slug: string`.
- Calls the install service, then enqueues a `ui_kit_upload` context attachment so the existing `UiKitUploadContextRenderer` injects the kit's primitives/components on the next turn.
- Returns a markdown response that contains both the install summary (`slug`, `written`) and a "Customization questions for this kit:" block listing `entry.questions[]` verbatim. `kit-customization.md` tells the model to ask exactly those questions via `askQuestion` next.

Both tools are added to `allAILibTools` in `agents/src/tools/ai-lib-tools/index.ts`.

### 5. Preflight tool support in the initial agent factory

The 3.0 agent has no notion of a tool that runs before the first user turn. Add a small mechanism on the named-variant manifest:

- `manifest.json` may declare `preflightTools: string[]`.
- In the agent factory (`agents/src/agents/ai-lib-agents/index.ts` or a thin wrapper around the initial-agent config used for named variants), when a conversation is empty and the active variant declares preflight tools, synthesize one assistant `tool_call` + `tool` result message pair per declared tool and prepend them to the message history sent to the model.
- The tool itself runs server-side via the same handler the LLM would invoke; the synthesized `tool_call_id` is generated locally so the message pair round-trips correctly.

This means the catalog is "free" context at turn 1 — no extra round-trip, no extra latency, no per-turn token re-spend beyond the catalog itself.

### 6. Environment configuration

- Default base URL via `resolveEnv()` (above).
- `BRAND_KIT_BASE_URL` env var overrides when set (local testing, mirrors).
- `agents/.env.example` documents the override (commented-out by default).

## Data Flow

```
listBrandKits (preflight, no args)
  → catalog.fetchBrandKitCatalog()
  → returns formatted markdown of kit metadata

[user answers Phase 1 + kit-discovery]

[model shortlists 2–3 kits, calls askQuestion]

[user picks slug | "None"]

  picked:                          | "None":
    installBrandKit(slug)          |   continue with no-kit-fallback Phase 2
      → install.installBrandKit()  |
        → download tarball         |
        → verify sha256            |
        → extract into docs/ui-kit |
        → emit ui_kit_upload attachment
      → return install summary + entry.questions[]
    [model asks customization questions via askQuestion]
    [user answers]

[design / handoff using accumulated answers + (if installed) kit content]
```

## Testing

Unit:

- Catalog: URL resolution per env + override; fetch with mock; disk-fallback when network fails; zod validation rejects bad payloads; cache TTL behavior.
- Install: hash verification (mismatch → rejected), path-traversal blocked (entries with `..`, absolute paths, etc.), extraction confined to `docs/ui-kit/`, attachment emitted, `questions[]` returned.
- Variant discovery: `initial-brand-kit` registers; `preflightTools` field round-trips.
- Preflight rendering: with an empty conversation and a manifest declaring preflight tools, the synthesized message pair appears as the leading assistant tool_call + tool result.

Integration / smoke:

- End-to-end with the single current catalog kit (botanical-calligraphy): kit-discovery answers steering toward "organic & natural" → shortlist contains the kit → pick → install → customization questions asked → handoff message references the kit.
- "None" path: same flow with the user picking "None" → standard 3.0 Phase 2 runs → handoff completes without a kit.

## File Inventory

New:

- `agents/src/prompts/initial/brand-kit/manifest.json`
- `agents/src/prompts/initial/brand-kit/identity.md` (copied from 3.0)
- `agents/src/prompts/initial/brand-kit/project-name.md` (copied from 3.0)
- `agents/src/prompts/initial/brand-kit/questioning-phase1.md` (split from 3.0)
- `agents/src/prompts/initial/brand-kit/kit-discovery-questions.md`
- `agents/src/prompts/initial/brand-kit/kit-selection.md`
- `agents/src/prompts/initial/brand-kit/kit-customization.md`
- `agents/src/prompts/initial/brand-kit/no-kit-fallback.md`
- `agents/src/prompts/initial/brand-kit/design-direction.md` (copied from 3.0)
- `agents/src/prompts/initial/brand-kit/design-reference.md` (copied from 3.0)
- `agents/src/prompts/initial/brand-kit/feature-list.md` (copied from 3.0)
- `agents/src/prompts/initial/brand-kit/examples.md` (copied from 3.0)
- `agents/src/prompts/initial/brand-kit/handoff-template.md` (copied from 3.0)
- `agents/src/services/brand-kit/catalog.ts`
- `agents/src/services/brand-kit/install.ts`
- `agents/src/services/brand-kit/__tests__/catalog.test.ts`
- `agents/src/services/brand-kit/__tests__/install.test.ts`
- `agents/src/tools/ai-lib-tools/list-brand-kits.ts`
- `agents/src/tools/ai-lib-tools/install-brand-kit.ts`
- `agents/src/tools/ai-lib-tools/__tests__/list-brand-kits.test.ts`
- `agents/src/tools/ai-lib-tools/__tests__/install-brand-kit.test.ts`

Modified:

- `agents/src/tools/ai-lib-tools/index.ts` — register the two new tools in `allAILibTools`.
- `agents/src/agents/ai-lib-agents/index.ts` (or initial-agent factory wrapper) — preflight-tool synthesis when the conversation is empty.
- `agents/src/agents/initial-agent.ts` — extend the manifest schema typing if it lives here; otherwise no change beyond import surface.
- `agents/.env.example` — document `BRAND_KIT_BASE_URL`.
- `package.json` (agents/) — add `tar` dependency.

## Open Questions / Risks

- **Preflight tool plumbing surface area** — depending on how `ai-lib`'s `AgentFactory` constructs the initial message list, the synthesis hook may need to live in `ai-transport` rather than `agents`. Confirm during implementation; if so, surface a callback like `onComposeInitialHistory` and keep brand-kit-specific logic in `agents`.
- **Single-kit catalog today** — kit-discovery questions and the kit-selection scoring logic are stubs designed off one example. Plan is to revisit the prompt files when the catalog grows; testing today confirms only the "match → botanical-calligraphy" and "no-match → fallback" paths.
- **Tarball format** — assumes `.tar.gz` from the catalog filename and the new `tar` dep. If the upstream catalog ever ships zips, add a sniff-by-extension dispatch.
- **Cache invalidation** — TTL of 10 minutes means a freshly published kit may take up to 10 minutes to appear on a hot agent process. Acceptable; documented in the catalog service.
