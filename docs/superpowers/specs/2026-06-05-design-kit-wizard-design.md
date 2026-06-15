# Design Kit Wizard — Interactive Brand Builder (Slice 1)

- **Date:** 2026-06-05
- **Status:** Draft (awaiting review)
- **Author:** Alice Miller (with Claude)
- **Branch:** new branch off `main` (not `feat/logo-api-v2`)
- **Slice:** 1 of N — see [Deferred follow-up slices](#deferred-follow-up-slices)

## Summary

Introduce a new **agent profile** that turns the builder's "Logo & Brand" tab into a
full-canvas, 5-step **Design Kit Wizard**: Understanding → Planning features →
Designing visuals → Building app → Finalizing. The wizard lets a user interactively
refine the brand the agent assembles (logo, colours, fonts, image/video direction,
elements, brand voice, brand summary), watch it come together with live preview, and
then hand off to the develop agent to build the real site.

When the new profile is **not** active, the tab renders `main`'s existing React
brandbook component unchanged. Nothing routes to the new profile unless Switchboard /
Hivemind explicitly points at it, so **production is untouched**.

This slice ships an interactive end-to-end experience built on backends that already
exist (colours, fonts, logo generation, Getty media, memory). Heavier net-new
capabilities (per-colour editing, LLM keyword alternatives, icons/graphics, voice /
summary regeneration, multi-lockup logo upload, "import from Airo") are explicitly
deferred to later slices.

## Goals

1. A new agent profile + cloned prompt variant that drives the 5-step flow and never
   touches the production design-system prompts.
2. A full-canvas wizard UI (stepper + brand panels) gated to that profile, replacing
   the "Logo & Brand" tab content; the old React brandbook remains the default.
3. Live, "auto-saving as we go" editing in Step 3 for capabilities that exist today.
4. **Memory as the single source of truth** for brand content, so the showcase
   generator and the develop agent can read it via `memoryRead` / `memorySearch`.
5. A standalone HTML brand showcase (Step 4) that consumes the same CSS variables as
   the real site but does not depend on the v8 template's React/Tailwind/build.
6. A handoff to the develop agent (Step 5) that builds the real website from the same
   memory + tokens + media slots.

## Non-goals (this slice)

These are real product requirements from the designer, but they are **deferred** so
Slice 1 stays shippable. Each becomes its own spec:

- Per-swatch colour editing (hex / RGB picker), add / delete colour, LLM "colour vibe"
  descriptions.
- LLM-generated image/video keyword **alternatives** picker (~3 suggested phrases).
  Slice 1 has a single, agent-generated, user-editable keyword phrase.
- Icons set, graphics, and the "regenerate elements" affordance. Slice 1 shows the
  kit's buttons/components read-only.
- Brand voice / brand summary **regeneration** (the magic-wand). Slice 1 allows
  editing the text; regeneration is later.
- Multi-lockup customer logo **upload** (primary-with-type / type-only / symbol-only),
  the "+" add-your-own, and "import from Airo". Slice 1 generates one square logo and
  lets the user regenerate it.
- Migrating existing apps, changing the publish path, or touching the design kits
  themselves.

## Background — current state

Understanding what exists keeps this slice small. Findings (verified in the codebase):

**Agent profiles.** Profiles are JSON files in `agents/src/profiles/*.json`, registered
in `agents/src/profiles/index.ts`, each with `{ name, description, properties }`. The
`initial.promptVersion` property selects an initial-agent variant (e.g.
`design-system`), whose prompt is assembled from a manifest in
`agents/src/prompts/initial/<variant>/`. The active profile is resolved from a JWT
claim (`agentProfile`, sourced from Switchboard `appbuilder-agent-profile` or a Hivemind
cohort in `app/src/config/experiments.ts`) or a per-message `metadata.agentProfile`
override. `resolveProfile()` picks per-project → JWT → none.

**The design-system flow already walks ~70% of the 5 steps.** The
`initial-agent-design-system` variant: asks Phase-1 questions → `installDesignSystem`
(kit auto-select) → `colorScheme` → `fontTheme` → writes identity → generates a logo →
builds a showcase → `handoff` to develop. The wizard is largely a new **UI skin + step
orchestration** over a cloned version of this flow, not a new agent from scratch.

**Brand data writes that exist today.**
- `colorScheme` (`agents/src/tools/ai-lib-tools/color-scheme.ts`) writes
  `src/styles/globals.css` (via `updateCssColorPalette` / `generatePalette` in
  `css-color-tool.ts`) + memory key `brand.colors.palette`.
- `fontTheme` (`agents/src/tools/ai-lib-tools/font-theme.ts`) writes `globals.css` (via
  `updateCssFontVariables`, including the Google Fonts `@import`) + memory key
  `brand.typography`. Font catalog = Google Fonts + curated `FONT_THEMES` + the system
  list in `app-templates/v8/dev-tools/src/utils/getFontList.ts`.
- `brandIdentity` (`agents/src/tools/ai-lib-tools/brand-identity.ts`) writes memory key
  `brand.identity` (voice, personality, audience, mission, tagline, …).
- Logo: `LogoService` (`agents/src/services/LogoService.ts`) calls `POST /api/logo/create`
  (**already on `main`**) and stores layout variants in media slots
  (`/airo-assets/images/logo/{primary,horizontal,vertical}`) via `MediaManifestService`.
- Media: `media-search-tool.ts` (Getty images + video) + `media-slot-tool.ts` +
  `MediaManifestService.ts`; slot swap / import routes in
  `agents/src/server/routes/media.ts`.
- `GET /apps/:id/brand-data` (`agents/src/server/routes/brand-data.ts`) already
  assembles a `BrandData` object from these memory keys.

**Live preview already exists.** `previewThemeInIframe` / `previewFontInIframe`
(`app/src/app/[market]/develop/components/utils/`) post `PREVIEW_THEME` / `PREVIEW_FONT`
/ `RELOAD_MEDIA_SLOT` messages into the preview iframe, which applies CSS variables /
font links / media reloads **live, with no file write** (today the listener lives in the
template's `DevelopmentMode.tsx`).

**Event contract.** Agent→client streaming events (`packages/ai-transport`) include
`tool_call`, `tool_result`, `complete`, etc. `app/src/hooks/shared/toolSideEffects.ts`
dispatches a `BRAND_SHOWCASE_UPDATED_EVENT` and a `logo-generated` custom event when
brand tools complete. There is **no** "build phase" event today.

**What is NOT on `main` (branch-only, in `feat/logo-api-v2`).** The `/__brand` React
route + seed file (`app-templates/v8/src/pages/__brand.tsx`), the
`brand-showcase/state` BFF route, the `brand.md` content model, and the
`brand-showcase-guidance`. We branch off `main`, so we inherit none of these; we port
only the guidance (adapted) and reuse the logo API that already merged to `main`.

## Architecture at a glance

```
┌──────────────────────────── Builder UI (app/, Next.js) ─────────────────────────────┐
│  Chat (left)                "Logo & Brand" tab (canvas)                              │
│                             ├─ profile = design-kit  →  <DesignKitWizard>            │
│                             │     Stepper (1..5)  +  Step-3 panels  +  Step-4 iframe │
│                             └─ otherwise           →  <BrandBookView> (main, today)  │
│                                                                                       │
│   reads:  GET /apps/:id/brand-data, GET wizard step      live preview: postMessage   │
│   writes: direct-edit BFF routes (proxy → agents)        (PREVIEW_THEME/FONT/MEDIA)   │
└───────────────┬───────────────────────────────────────────────────────┬─────────────┘
                │ Bearer (agent-fetch)                                    │ socket.io (WS/SSE)
┌───────────────▼───────────────── agents/ (@airo/agents) ───────────────▼─────────────┐
│  Cloned profile  initial-agent-design-kit  (prompts/initial/design-kit/)             │
│    auto-advance 1→2→3, pause; setWizardStep → build_phase event + memory             │
│  Tools (existing): colorScheme, fontTheme, brandIdentity, media-logo, mediaSearch    │
│  Direct-edit routes (new, thin): reuse updateCssColorPalette / updateCssFontVariables │
│                                   / memoryStore.set / media-slot PUT  (no agent turn) │
│  Showcase generator (Step 4): writes public/brand-showcase.html (+ brand-tokens.css) │
│  Memory (source of truth): brand.colors.palette · brand.typography · brand.identity  │
│                            · brand.summary · brand.imagery · brand.wizard.step        │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                          │ handoff (Step 5)
                                   develop agent → real site (v8 template, globals.css)
```

Three responsibilities, cleanly separated:

- **Agent** owns the conversational flow, step advancement, and all *generative* work
  (kit install, palette/font/keyword/logo generation, showcase HTML, handoff).
- **Direct-edit routes** own *parameter* edits (pick a font, apply a palette, edit voice
  / summary text, pick a media result, set the primary logo) — no agent turn, instant
  persistence, reusing the existing write functions.
- **Memory** is the single source of truth for brand content; `globals.css` /
  `brand-tokens.css` and media slots are the rendered projection of it.

## Agent profile + cloned prompt variant

- **New profile** `agents/src/profiles/initial-agent-design-kit.json`:
  ```json
  {
    "name": "initial-agent-design-kit",
    "description": "Interactive Design Kit Wizard: questioning → kit/colour/font/keyword planning → interactive brand editing → showcase → handoff.",
    "properties": { "initial.promptVersion": "design-kit" }
  }
  ```
  Register it with one import + array entry in `agents/src/profiles/index.ts`. No
  changes to factory, router, or handoff wiring (auto-discovered).

- **New prompt variant** `agents/src/prompts/initial/design-kit/` — cloned from
  `initial/design-system/` (manifest + markdown), then adapted to:
  1. **Auto-advance 1→2→3** (questioning → planning) and then **stop at Step 3** — do
     not build the showcase or hand off until the user triggers it.
  2. Call **`setWizardStep`** (new tool, see [Step-state machine](#step-state-machine))
     at each transition so the UI's stepper stays in lockstep.
  3. Read and write all brand **content via memory** (`memoryRead`/`memorySet`/
     `memorySearch`), **not `brand.md`**.
  4. Generate **one square logo** initially (`media-logo` with `layout: 'square'`,
     synchronous via `main`'s `/api/logo/create`).
  5. Derive an **image/video keyword phrase** during Planning and store it in memory.
  6. On the user's "Build" gate: generate the **standalone HTML showcase** (Step 4).
  7. On the user's "Create website" gate: `handoff` to `develop` (Step 5).

- **Routing.** Add a Hivemind cohort / Switchboard value that maps to
  `initial-agent-design-kit` (same machinery as the existing design-system profiles in
  `app/src/config/experiments.ts`). Until that is set, nothing routes here.

## Gating — old brandbook vs wizard

- Add an explicit helper `isDesignKitWizardProfile(profile): boolean` (a dedicated check,
  e.g. `profile === 'initial-agent-design-kit'`). **Do not overload**
  `isDesignSystemProfile` — the two flows stay independent so design-system behaviour is
  unaffected.
- The "Logo & Brand" tab content branches on it:
  - `isDesignKitWizardProfile(activeProfile)` → render `<DesignKitWizard>` (full canvas).
  - otherwise → render `main`'s existing `<BrandBookView>` React component.
- Tab **visibility** reuses today's gating; for the wizard profile the tab is always
  available (the wizard is the brand experience for that profile).
- The active profile reaches the UI via the existing JWT claim / per-message metadata
  plumbing already used for profile selection; the wizard reads it the same way the BFF
  brand routes read `agentProfile` today.

## Data model — memory is the source of truth

This reverts the branch's `brand.md`-as-content approach. Because we branch off `main`
(where `brand.md` never existed), this is mostly "keep using memory + add a few keys",
not a migration.

| Concept | Storage | Written by | Notes |
|---|---|---|---|
| Colours | `globals.css` + `brand-tokens.css` + memory `brand.colors.palette` | `colorScheme` tool / direct route | unchanged shape |
| Fonts | `globals.css` + `brand-tokens.css` + memory `brand.typography` | `fontTheme` tool / direct route | includes Google Fonts `@import` |
| Identity (name, tagline, personality, audience, mission, **voice**) | memory `brand.identity` | agent / direct route | existing key |
| **Brand summary** (LLM elevator pitch) | memory `brand.summary` *(new)* | agent (generate) / direct route (edit) | plain string |
| **Image/video keyword phrase** | memory `brand.imagery` *(new)* | agent / direct route | e.g. `"Minimal neutral fashion lifestyle, airy whites, soft textures, quiet luxury"` |
| Logos / images / videos | media slots + `airo-media.json` | media-logo skill / media routes | slot URLs unchanged |
| **Wizard step (1–5)** | memory `brand.wizard.step` *(new)* | agent (advance) / direct route (user jumps to 3) | step 1–5 |

- `brand.imagery` value shape (Slice 1): `{ keyword: string }` (a single descriptor
  phrase). Later slices add `{ alternatives: string[] }`.
- `brand.summary` value shape: `{ text: string }`.
- `brand.wizard.step` value shape: `{ step: 1|2|3|4|5 }`.
- All keys are scoped via `workspaceScopeFromAppId(appId, customerId)` like the existing
  brand keys.
- `GET /apps/:id/brand-data` is **extended** to surface `brand.summary`, `brand.imagery`,
  and `brand.wizard.step` (it already returns palette / typography / identity). The wizard
  panels and stepper hydrate from this single endpoint.
- We **do not** write `brand.md`. The Step-4 showcase generator and the develop agent
  read brand content from memory.

### `brand-tokens.css` — single token source for site + standalone showcase

The colours/fonts must be identical between the real site and the standalone showcase,
so there is **one** file holding the CSS custom properties:

- `colorScheme` / `fontTheme` (and the colour/font direct-edit routes) write the `:root`
  variable block + the Google Fonts `@import` into **`public/brand-tokens.css`** (a plain,
  static, build-independent file).
- `src/styles/globals.css` `@import`s `brand-tokens.css` so the real site and Tailwind
  resolve the same variables (the template change is a single `@import` line).
- The standalone showcase HTML `<link>`s `/brand-tokens.css` directly.

This means a colour/font edit updates exactly one token file, and both the site and the
showcase reflect it.

## Step-state machine

The stepper must stay in lockstep as the agent advances *and* when the user jumps back to
Step 3. Source of truth = persisted `brand.wizard.step`; updates are pushed live.

- **`setWizardStep` tool** (new, agents): the cloned prompt calls it at each transition.
  It (a) persists `brand.wizard.step` to memory and (b) emits a `build_phase` streaming
  event.
- **`build_phase` event** (new): added to `STREAMING_EVENT_TYPES` in
  `packages/ai-transport/src/interfaces.ts`, payload `{ step: 1|2|3|4|5 }`. A client
  handler in `app/src/hooks/websocket/handlers/` updates the wizard store on receipt.
- **Read on load / reconnect:** the UI reads the persisted step from the extended
  `GET /apps/:id/brand-data` (which also returns `summary` + `imagery`), so a single fetch
  hydrates the whole wizard. Because the step is persisted, a reload or disconnect restores
  the exact step and the populated panels.
- **User jumps back to Step 3:** the UI calls a direct route that sets
  `brand.wizard.step = 3`. The agent reads the persisted step on its next turn and
  respects it (it will not re-run Planning or re-build unless asked).
- **`useWizardStep` hook** (new, app): returns the current step, subscribes to
  `build_phase` for instant updates, and exposes a setter that calls the direct route.

There is no separate showcase "state" probe — "showcase ready" is implied by the step
(≥ 4 with the generator having completed). See
[Step 4](#step-4--building-app-standalone-html-showcase).

## The five steps

Flow: the agent **auto-advances 1 → 2 → 3**, then **pauses** at Step 3. Step 4 and Step 5
are **user-gated** (explicit buttons). The user may return to Step 3 at any time.

### Step 1 — Understanding

- **Agent:** runs Phase-1 questioning in chat (the existing design-system questioning).
  Calls `setWizardStep(1)` at the start.
- **UI:** stepper highlights step 1; the left "Thinking" block shows sub-items
  ("Understanding your idea", …). Brand panels are not yet shown (or shown empty).
- **Transition:** once it has the answers it needs, the agent proceeds and calls
  `setWizardStep(2)`.

### Step 2 — Planning features ("assembling the kit")

- **Agent:** auto-selects + installs the kit (`installDesignSystem`), applies the palette
  (`colorScheme`), applies fonts (`fontTheme`), derives the image/video keyword phrase
  (→ memory `brand.imagery`), writes identity + voice + a brand summary (→ memory
  `brand.identity`, `brand.summary`), and generates **one square logo** (`media-logo`,
  `layout: 'square'`).
- **UI — the headline delight moment.** As each Planning event arrives, the wizard
  animates that asset *dropping into the kit*, "building the kit up" piece by piece:
  - palette applied → swatches fly in,
  - fonts applied → type locks in,
  - logo completes → logo lands,
  - keyword phrase set → image/video direction slots in,
  - voice / summary written → those cards fill.
- **Event sources (already exist):** `BRAND_SHOWCASE_UPDATED_EVENT` (colour/font/identity
  tool completion), the `logo-generated` custom event, and `tool_result` events — plus
  the `build_phase` event. No async-logo event is needed (logo is synchronous).
- **Transition:** when Planning completes the agent calls `setWizardStep(3)`, which
  triggers the **reveal** — Step 3's full editable panels animate in.

### Step 3 — Designing visuals (interactive editing; agent paused)

- **Agent:** paused. It does not act unless the user sends a chat message or triggers a
  generative action (logo regenerate, media search).
- **UI:** the full panel grid (see [Step-3 panels](#step-3-editing-panels)). Edits are
  **auto-saved and live-previewed** (direct-edit routes + postMessage). The user can stay
  here as long as they like.
- **Gate → Step 4:** a **"Build my brand showcase"** button sends the agent
  the instruction to generate the showcase. The agent calls `setWizardStep(4)` and runs
  the generator.

### Step 4 — Building app (standalone HTML showcase)

- **Agent:** generates a self-contained **`public/brand-showcase.html`** from memory +
  the brand-showcase guidance (7 sections, "swap test", tokens-only styling). It writes
  plain HTML + inline `<style>` using `var(--…)`, `<link>`s `/brand-tokens.css`, embeds a
  small postMessage listener, and references logo/image slots by URL
  (`/airo-assets/images/logo/primary`, …).
- **UI:** the wizard iframes `${previewUrl}/brand-showcase.html` in-canvas for review.
  Because it is a real static file, it 404s cleanly until written; the UI only mounts the
  iframe once step ≥ 4.
- **Return to Step 3:** allowed at any time. Cosmetic edits (colour, font, logo, picked
  media) reflect **live** via `brand-tokens.css` + postMessage + slot reloads — no
  re-generation. Structural changes (e.g. a different brand summary that changes copy)
  are re-applied on the next "Build".
- **Gate → Step 5:** a **"Create website"** button hands off to develop.

### Step 5 — Finalizing (handoff to develop)

- **Agent:** calls `setWizardStep(5)` and `handoff` → `develop`. The develop agent builds
  the real site in the v8 template, reading the same memory + `globals.css` tokens +
  media slots. (The standalone showcase remains a builder-only preview artifact and is
  never published.)
- **UI:** stepper shows step 5; the experience transitions to the normal build/preview of
  the real site.

## Step-3 editing panels

Seven panels matching the Figma. For each, Slice 1 ships the **editable now** column; the
**deferred** column lands in later slices (panels still render those areas, read-only or
with the affordance disabled, so the layout is complete).

| Panel | Editable now (Slice 1) | Deferred |
|---|---|---|
| **Logo** | View the generated square logo; **regenerate** it (agent, synchronous) | Multiple orientations/lockups, upload, "+" add-your-own, "import from Airo" |
| **Color** | View the palette; **apply an agent-suggested alternative palette** (live preview) | Per-swatch hex/RGB edit, add/delete colour, LLM "colour vibe" text |
| **Fonts** | **Heading & body dropdowns** from the existing font catalog (Google + curated + system); live preview | — |
| **Image & Video** | The agent-generated **keyword phrase**, shown and **fully editable**; editing it runs a Getty search; **pick results** into media slots | LLM-suggested alternative phrases (~3) dropdown |
| **Elements** | **Read-only** preview of the kit's buttons / components | Icons set, graphics, "regenerate" |
| **Brand voice** | **Edit** the tone-of-voice descriptors (text); auto-saved to memory | Regenerate (magic-wand) |
| **Brand summary** | **Edit** the summary text; auto-saved to memory | Regenerate (magic-wand) |

Notes:
- **Color (Slice 1):** whole-palette only — the user can apply an alternative palette the
  agent suggests, not edit individual swatches. The screenshots' per-swatch edit / `+` is
  deferred.
- **Image & Video keyword is a phrase, not tags** — a single descriptor string the user
  can rewrite wholesale (e.g. the two example phrases in the Background). Editing it
  triggers a search; the results grid lets the user choose which images/video fill the
  media slots.
- **Logo regenerate** uses the existing synchronous `media-logo` path against `main`'s
  `/api/logo/create`; it is the one Step-3 action that is a true generative agent call.

## Direct-edit services + live preview

Parameter edits must feel like direct manipulation (auto-saving), so they do **not** go
through a full agent turn. They reuse the existing write functions.

- **New thin routes** in `agents/` (app/ BFF proxies them via `agent-fetch`, matching the
  `brand-data` pattern). Each validates input, is idempotent, persists, and returns the
  new persisted value:
  - **Colour (apply palette):** reuse `updateCssColorPalette` / `generatePalette` →
    writes `globals.css` + `brand-tokens.css` + memory `brand.colors.palette`.
  - **Fonts (apply pair):** reuse `updateCssFontVariables` → writes `globals.css` +
    `brand-tokens.css` (incl. Google Fonts `@import`) + memory `brand.typography`.
  - **Voice / summary (edit text):** `memoryStore.set` on `brand.identity` (voice) /
    `brand.summary`.
  - **Image/video keyword (edit phrase):** `memoryStore.set` on `brand.imagery`.
  - **Set primary logo / pick media result:** media-slot PUT (existing route or a thin
    wrapper) updating `airo-media.json`.
  - **Wizard step (jump to 3):** `memoryStore.set` on `brand.wizard.step`.
- **Live preview** reuses the existing channel:
  - colour → `PREVIEW_THEME`, font → `PREVIEW_FONT`, media → `RELOAD_MEDIA_SLOT`.
  - The wizard applies the edit **optimistically** (postMessage for instant feedback),
    fires the direct route, and **rolls back** the preview if the route fails.
- **Generative** actions still go through the agent/services: logo regenerate
  (`media-logo`), image/video search (`media-search-tool` — invoked via the agent or a
  thin search route reusing the service so a keyword change can search without a full
  conversational turn).

## Standalone HTML showcase (Step 4 detail)

The showcase is a **builder-only preview artifact**, decoupled from the v8 template's
React/Tailwind/build.

- **Location & serving:** `public/brand-showcase.html` in the app workspace, served
  statically by the preview server at `${previewUrl}/brand-showcase.html`. Same origin as
  `/airo-assets/...` and `/brand-tokens.css`, so all relative URLs resolve; a missing file
  is a clean 404.
- **No React route, no seed file, no seed marker.** We do **not** add the `/__brand`
  route or `app-templates/v8/src/pages/__brand.tsx`.
- **CSS variables:** `<link rel="stylesheet" href="/brand-tokens.css">` (reload-safe;
  rewritten by colour/font edits) **plus** a ~15-line inline `<script>` that listens for
  `PREVIEW_THEME` / `PREVIEW_FONT` and applies them to `:root` for instant edits. No
  dependency on the template's `DevelopmentMode.tsx` listener.
- **Styling:** the agent writes self-contained HTML + inline `<style>` using `var(--…)`
  tokens only (no Tailwind utilities, no template components). This matches the
  brand-showcase guidance ("style with tokens, not hardcoded values") and the branch's
  original HTML iteration (prior art: `install.ts` once seeded
  `docs/ui-kit/brand-showcase.html`).
- **Guidance:** port `agents/src/services/design-system/brand-showcase-guidance.ts`
  (7 required sections, "swap test", accessibility rules), adapted to: write a standalone
  HTML file in `public/`, read brand **content from memory** (not `brand.md`), and embed
  the postMessage listener.
- **Assets:** logo via `/airo-assets/images/logo/primary`; images/video via their media
  slots. Live media swaps reflect via `RELOAD_MEDIA_SLOT` cache-busting (existing).

## Components & files

### agents/
- **New:** `src/profiles/initial-agent-design-kit.json` (+ registration in
  `src/profiles/index.ts`).
- **New:** `src/prompts/initial/design-kit/` (cloned + adapted from `design-system/`).
- **New:** `setWizardStep` tool (persists `brand.wizard.step` + emits `build_phase`).
- **New:** direct-edit routes (colour, fonts, voice/summary, keyword, wizard-step) reusing
  `updateCssColorPalette` / `updateCssFontVariables` / `memoryStore.set`; a thin media-pick
  wrapper if the existing media route isn't a clean fit.
- **New:** standalone HTML showcase generator path (guidance ported + adapted; writes
  `public/brand-showcase.html`).
- **Changed:** `colorScheme` / `fontTheme` also write `public/brand-tokens.css` (the
  `:root` vars + Google Fonts `@import`).
- **Changed:** `GET /apps/:id/brand-data` returns `brand.summary`, `brand.imagery`, and
  `wizard.step`.
- **Changed:** memory key constants for the new keys.

### packages/ai-transport/
- **Changed:** add `build_phase` to `STREAMING_EVENT_TYPES` (`src/interfaces.ts`) and emit
  it from the server when `setWizardStep` runs.

### app/ (website)
- **New:** `isDesignKitWizardProfile()` helper.
- **New:** `<DesignKitWizard>` — stepper + 7 panels + Step-4 iframe, rendered in the
  "Logo & Brand" tab when the profile is active.
- **New:** `useWizardStep` hook (reads persisted step + subscribes to `build_phase` + setter
  via direct route).
- **New:** a `build_phase` client handler in `src/hooks/websocket/handlers/` (+ registry
  entry).
- **New:** BFF proxy routes for the direct-edit endpoints.
- **Changed:** "Logo & Brand" tab content branch (wizard vs `<BrandBookView>`); reuse the
  existing `previewThemeInIframe` / `previewFontInIframe` / media-reload utilities from the
  panels.

### app-templates/v8/
- **Changed:** `src/styles/globals.css` `@import`s `brand-tokens.css` (single token source).
- **No** `/__brand` route, **no** seed page.

## Error handling

- **Direct-edit routes:** validate input (reject malformed hex, unknown font, empty
  required fields); idempotent; return the new persisted value. The UI applies edits
  optimistically and **rolls back the preview** on a non-2xx response, surfacing an inline
  error on the panel.
- **Logo / media generation:** synchronous failures (including budget-exceeded / 402 from
  `LogoService`) surface inline on the Logo / Image&Video panel with a retry; no silent
  fallback to a placeholder.
- **Reload / disconnect:** `brand.wizard.step` and all brand content are persisted in
  memory, so reconnecting restores the exact step and repopulates the panels from
  `brand-data`. The Step-4 iframe re-mounts only when step ≥ 4 and the file exists.
- **Showcase generation failure:** the agent reports it in chat and leaves the step at 3/4
  (does not advance to 5); the user can retry "Build".
- **Profile mis-route:** if `isDesignKitWizardProfile` is false, the tab falls back to the
  existing `<BrandBookView>` — never a blank tab.

## Testing

- **agents (Vitest):** unit tests for each direct-edit route (correct reuse of write
  functions; memory + `brand-tokens.css` + `globals.css` all updated; idempotency;
  validation rejects); `setWizardStep` (persist + event); profile registration loads;
  `brand-data` returns the new keys; the showcase generator emits tokens-only HTML
  referencing slot URLs.
- **app (Vitest + jsdom):** `<DesignKitWizard>` stepper renders/advances on `build_phase`;
  each panel's edit fires the right direct route + postMessage and rolls back on failure;
  gating test (`isDesignKitWizardProfile` → wizard vs `<BrandBookView>`); `useWizardStep`
  read/subscribe/set.
- **E2E (Playwright):** profile-gated happy path 1 → 2 (assemble animation) → 3 (edit a
  font + apply alt palette + edit keyword + pick image + edit voice/summary) → Build → 4
  (iframe renders, edit reflects live) → Create website → 5 (handoff). Add `data-testid`s
  for the stepper, each panel, Build, and Create-website; register required i18n keys.

## Rollout / flagging

- New profile is dormant until a Switchboard value / Hivemind cohort maps to
  `initial-agent-design-kit`. Enable per-shopper override in dev first
  (`appbuilder-agent-profile`), then test, then a small Hivemind cohort.
- The token-source `@import` and `brand-tokens.css` emission are backward-compatible:
  apps without the file fall back to the existing `globals.css` variables.
- Backward compatibility: with the profile off, the brand tab is byte-for-byte today's
  `<BrandBookView>`; no agents default behaviour changes.

## Deferred follow-up slices

Each gets its own spec → plan → implementation:

1. **Colour deep-edit:** per-swatch hex/RGB picker, add/delete, LLM "colour vibe" text.
2. **Image/video keyword alternatives:** LLM generates ~3 alternative descriptor phrases +
   a picker; store `brand.imagery.alternatives`.
3. **Elements:** icon set + graphics generation + "regenerate".
4. **Voice / summary regeneration:** suggest/apply tool (magic-wand).
5. **Logo library:** multiple lockups (primary-with-type / type-only / symbol-only),
   customer upload (jpeg/jpg/png/svg), "+" add-your-own, "import from Airo".

## Open questions / risks

- **`globals.css` `@import` of a `public/` file:** confirm the preview build serves
  `/brand-tokens.css` and that the `@import` resolves at runtime (vs. Vite trying to inline
  it at build). Fallback: emit identical values into both files rather than `@import`.
- **Keyword-search without a full agent turn:** decide whether the Image&Video search is a
  thin agents route wrapping `media-search-tool`'s service, or a lightweight agent
  invocation. (Leaning: thin route, to keep Step 3 snappy.)
- **`build_phase` vs `complete` ordering:** ensure the client applies `setWizardStep`
  before/independently of stream completion so the stepper doesn't lag a turn.
- **Step-2 animation source:** the existing events fire per-tool; confirm they carry enough
  to drive distinct animations (which asset landed) or add minimal metadata.
- **Profile string in the UI:** confirm the cleanest read of the *active* profile on the
  client for the tab branch (per-message metadata vs a config read), since the tab renders
  before any message is sent.
