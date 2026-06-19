# Canvas status pill (PR spec)

**Branch:** `feature/canvas-status-pill-messages`  
**Surface:** Preview `Canvas.Status` pill — desktop portal chip + mobile bottom pill (`PreviewPane`), gated by `appbuilder-preview-enhanced-overlays`.

## Summary

Replaces granular Thinker tool labels on the preview overlay with **summarized, content-design-approved copy** (`builder_canvas_status_*`). The chat Thinker is unchanged; only the preview status pill uses the new mapping via `useCanvasStatusLabel` + `getCanvasStatusKey()`.

## Canvas pill vs chat Thinker

| | **Chat Thinker** | **Preview `Canvas.Status` pill** |
|---|------------------|----------------------------------|
| Hook | `useThinkerLabel()` | `useCanvasStatusLabel(isMutatingFiles, isProcessing)` |
| Copy source | `getToolActiveDisplayName` (granular) | `getCanvasStatusKey` (summarized buckets) |
| Agent idle / between tools | `builder_agent_thinking` | **`Working`** (not “Thinking”) |
| Edit turn behavior | Per-tool labels only | Mutation override + exempt buckets (below) |

## Content design mapping (approved)

| Agent activity / bucket | Description | Previous pill label | Updated pill label |
|-------------------------|-------------|---------------------|-------------------|
| No active tool, agent processing | Streaming with no running tool | Thinking | **Working** |
| Read / search / scrape | Exploring the project | Reviewing your site / Checking your site | **Checking your project** |
| Validation / QA | Checking quality | Reviewing your site / Checking your site | **Checking your project** |
| File mutation | Editing project files | Updating your site | **Updating your project** |
| Planning | Plan / todo work | Planning | **Planning** |
| Design / media / CSS | Visual and styling changes | Styling your site | **Adding styles** |
| Terminal / server / git / mysql | Environment setup | Setting things up | **Setting things up** |
| Sub-agents | `runAgent`, `awaitAgents` | Building | **Building** |
| Handoff | `returnToParent` | Wrapping up a task | **Wrapping up a task** |
| `restore` tool (streamed) | Git rollback tool name | Working | **Restoring** |
| Unmapped tools | Default bucket | Working | **Working** |

## Content design rules

1. **Checking, not Reviewing** — read/search and validation share **Checking your project**.
2. **Project, not site** — user-facing copy uses “project”.
3. **Adding styles** — design/media bucket; not “Styling your site”.
4. **Working, not Thinking** — the pill never shows “Thinking”; use **Working** for processing gaps and idle fallback (chat Thinker still uses `builder_agent_thinking`).
5. **Unmapped tools** → **Working**.

## i18n keys

### Publish in [@airo-app-builder/aab](https://i18n.int.gdcorp.tools/org/airo-app-builder/app/aab)

| i18n key | English label | When shown |
|----------|---------------|------------|
| `builder_canvas_status_checking_project` | Checking your project | Read/search/scrape + validation/QA tools |
| `builder_canvas_status_updating_project` | Updating your project | File edits; mutation override |
| `builder_canvas_status_planning` | Planning | `appPlan`, `todoList` |
| `builder_canvas_status_adding_styles` | Adding styles | Design/media/CSS tools |
| `builder_canvas_status_setting_up` | Setting things up | Terminal, server, git, mysql |
| `builder_canvas_status_building` | Building | `runAgent`, `awaitAgents` |
| `builder_canvas_status_wrapping_up` | Wrapping up a task | `returnToParent` |
| `builder_canvas_status_restoring` | Restoring | Streamed tool named `restore` |
| `builder_canvas_status_working` | Working | Processing with no tool; unmapped tools; idle |

Dev fallbacks: `app/src/lib/translations/canvas-status-defaults.ts` (validated by `scripts/validate-i18n.mjs`).

### Do not publish (removed / renamed)

| Old key | Replacement |
|---------|-------------|
| `builder_canvas_status_thinking` | `builder_canvas_status_working` |
| `builder_canvas_status_reviewing_site` | `builder_canvas_status_checking_project` |
| `builder_canvas_status_checking_site` | `builder_canvas_status_checking_project` |
| `builder_canvas_status_updating_site` | `builder_canvas_status_updating_project` |
| `builder_canvas_status_styling_site` | `builder_canvas_status_adding_styles` |

## Label resolution (`useCanvasStatusLabel`)

Priority order:

1. **Active running tool** → bucket label from `getCanvasStatusKey()`, unless mutation override applies.
2. **Mutation override** → **Updating your project** when `isMutatingFiles` is true, the running tool is not a file mutation, and the bucket is not exempt (below).
3. **Edit turn, no running tool, still processing** → **Working**.
4. **Edit turn, no running tool, not processing** → **Updating your project** (preview settling after edits).
5. **Processing, no edit activity** → **Working**.
6. **Otherwise** → **Working**.

`isMutatingFiles` is true when the active stream contains **any** file-mutation tool call (including completed ones) — see `mutatesFiles()` in `app/src/app/[market]/develop/utils/mutatesFiles.ts`.

## Mutation override exemptions

After a file edit in the current stream, most non-edit tools collapse to **Updating your project** so the preview signals ongoing change. These buckets **stay visible** when their tool is running:

| Bucket | Label | Example tools |
|--------|-------|---------------|
| Checking | Checking your project | `grepSearch`, `validateCode`, `qaAnalyze`, `readFile` |
| Adding styles | Adding styles | `colorScheme`, `fontTheme`, `media`, `imageEditor` |
| Building | Building | `runAgent`, `awaitAgents` |
| Wrapping up | Wrapping up a task | `returnToParent` |

Still collapsed to **Updating your project** during an edit turn: **Planning**, **Setting things up**, **Working** (unmapped), **Restoring**.

Implementation: `MUTATION_OVERRIDE_EXEMPT_KEYS` in `useCanvasStatusLabel.ts`.

## Tool → bucket reference

Authoritative mapping: `getCanvasStatusKey()` in `app/src/utils/toolNameMapping.ts`.

| Bucket | Example tool names |
|--------|-------------------|
| Checking your project | `readFile`, `grepSearch`, `directoryListing`, `ragSearch`, `websiteScraper`, `validateCode`, `qaAnalyze`, `httpCheck`, … |
| Updating your project | `fileEdit`, `textEditor`, `str_replace_based_edit_tool`, `writeFile` |
| Planning | `appPlan`, `todoList` |
| Adding styles | `colorScheme`, `fontTheme`, `cssColor`, `media`, `brand`, `loadUiKit`, `websiteRebuild`, … |
| Setting things up | `terminalCommand`, `serverRestart`, `gitOperation`, `mysqlOperation`, … |
| Building | `runAgent`, `awaitAgents` |
| Wrapping up | `returnToParent` |
| Restoring | `restore` |
| Working | `askQuestion`, `skill`, unmapped / commerce tools, default |

## Special cases

### `restore` bucket

Maps to streamed tool name **`restore`**. User **Undo** / **Version History Restore** uses `POST /apps/:id/git/restore` and a synthetic transcript notice — **not** a running streamed tool — so those flows do **not** drive the **Restoring** pill label today.

### User restore / undo

Not wired to the canvas pill unless a separate pending-state hook is added (e.g. `restoreMutation.isPending`).

## Pattern library (`Canvas.Status`)

- Summarized label + spinner in `packages/pattern-library/src/surfaces/canvas/CanvasStatus.tsx`.
- **Width:** content + padding only (no JS measurement). Rebuild `@airo-ux/pattern-library` after changes (`pnpm --filter @airo-ux/pattern-library build`).

## Implementation files

| Area | Files |
|------|-------|
| Label logic | `app/src/app/[market]/develop/components/preview/useCanvasStatusLabel.ts` |
| Tool buckets | `app/src/utils/toolNameMapping.ts` |
| i18n fallbacks | `app/src/lib/translations/canvas-status-defaults.ts` |
| Preview wiring | `app/src/app/[market]/develop/components/preview/PreviewPane.tsx` |
| Mutation detection | `app/src/app/[market]/develop/utils/mutatesFiles.ts`, `[id]/page.tsx` |
| UI component | `packages/pattern-library/src/surfaces/canvas/CanvasStatus.tsx`, `styles.css` |

## Test plan

```bash
pnpm --filter website test src/app/[market]/develop/components/preview/useCanvasStatusLabel.test.ts
pnpm --filter website test src/app/[market]/develop/components/preview/PreviewPane.test.tsx -t "status chip|status pill"
pnpm --filter website test src/utils/toolNameMapping.test.ts
pnpm --filter @airo-ux/pattern-library test:run src/surfaces/canvas/__tests__/Canvas.test.tsx
node scripts/validate-i18n.mjs
```

## PR checklist

- [ ] `appbuilder-preview-enhanced-overlays` enabled in test environment
- [ ] Pill labels match table above during edit / check / style / wrap-up phases
- [ ] Pill shows **Working** (not Thinking) between tool calls
- [ ] Chat Thinker still shows granular labels + `builder_agent_thinking`
- [ ] New i18n keys published to AAB (or dev fallbacks acceptable until publish)
- [ ] Pattern-library `dist/` rebuilt if UI changed
