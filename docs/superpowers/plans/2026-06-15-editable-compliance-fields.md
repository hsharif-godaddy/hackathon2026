# Editable Compliance Document Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let users edit filled-in field values inline AND toggle the boolean "children's data" section directly in the compliance-page preview, updating in place with no API call and no LLM, persisted to the generated page file.

**Architecture:** The generation API returns annotated markdown with two constructs — editable field spans (`data-field`/`data-editable`) and boolean section branches (`data-section`/`data-section-when`/`data-hidden`). The agents renderer keeps these via `rehype-raw`. In the preview only, dev-tools highlights fields (inline edit) and renders a toggle per section; on commit/toggle it fires a typed bus event, the builder forwards it to a new authenticated agents endpoint that deterministically patches `privacy.tsx`/`terms.tsx`, and Vite HMR re-renders.

**Tech Stack:** TypeScript, Express (agents, :4000), React 19 + react-markdown@9 (`app-templates/v8` + dev-tools), Next.js (builder `app/`), Vitest, cross-iframe `eventBus`, agents `WorkspaceClient`.

---

## Key facts
- Generated page lives in the customer app (`app-templates/v8`, `react-markdown@^9`) → use `rehype-raw@^7`, NOT the builder catalog's `react-markdown@^10`.
- dev-tools is preview-only (`DevToolsProvider.tsx:44`, `MODE==='development'`); spans are inert in published builds, hidden branch stays hidden via inline `display:none`.
- `eventBus.ts` is duplicated (`app/src/utils/eventBus.ts` + `app-templates/v8/dev-tools/src/utils/eventBus.ts`) — edit BOTH.
- Values are **markdown-escaped** in the file (match the generator), not HTML-escaped.
- Existing `data-section` use in `DevelopmentMode.tsx:1056` is unrelated → key construct B off `data-section` AND `data-section-when`.
- Field appears multiple times; patch ALL spans with the same `data-field`, including hidden branches.
- Inline section may have only the `when="true"` branch (terms-of-use) — don't assume a `false` inverse.

## File structure
- Create `agents/src/skills/compliance-docs/field-patch.ts` (+ `__tests__/field-patch.test.ts`)
- Create `agents/src/server/routes/compliance.ts` (+ `__tests__/compliance.test.ts`)
- Modify `agents/src/server/routes/index.ts`, `agents/src/server/app.ts`
- Modify `agents/src/skills/compliance-docs/tools/index.ts` (rehype-raw)
- Modify `app-templates/v8/package.json` (rehype-raw dep)
- Modify both `eventBus.ts` copies
- Create `app-templates/v8/dev-tools/src/hooks/useComplianceFieldEditor.ts` (+ test)
- Modify `app-templates/v8/dev-tools/src/utils/injectDevToolsStyles.ts`, `components/DevelopmentMode.tsx`
- Modify `app/src/app/[market]/develop/hooks/useDevToolsBusBindings.ts`

---

## Task 1: Patch utilities (field + section + validation)
**Files:** Create `agents/src/skills/compliance-docs/field-patch.ts`, `agents/src/skills/compliance-docs/__tests__/field-patch.test.ts`

- `patchFieldValue(source, fieldKey, newValue) → { content, replaced }` — replace inner text of every `<span data-field="KEY" data-editable="true">…</span>`, markdown-escaping the value.
- `setSectionValue(source, sectionKey, value) → { content, changed }` — for each `data-section="KEY"` branch, hide the branch whose `data-section-when` ≠ value (add `data-hidden="true"` + `display:none`), show the matching one (strip them). Single-branch inline case: only `when="true"` → show if true, hide if false.
- `validateFieldValue(fieldKey, value)` — non-empty, ≤200 chars, email format for `email`, US-state enum for `jurisdiction`.
- Markdown-escape: escape `\ ` ` * _ { } [ ] ( ) # + - . ! < >` per the generator's scheme (mirror minimal: backslash-escape markdown punctuation, `<`→`&lt;`, `>`→`&gt;`, `&`→`&amp;`).

Tests cover: single/multiple/hidden-branch field replace; absent field (replaced=0); markdown-escaping; section flip both directions; single-branch show/hide; absent section; validation cases.

Commit: `feat(compliance): deterministic field + section patch utilities`

## Task 2: Endpoints
**Files:** Create `agents/src/server/routes/compliance.ts`, `__tests__/compliance.test.ts`; modify `routes/index.ts`, `app.ts`

- `POST /apps/:id/compliance/field` body `{ documentType, fieldKey, newValue }`.
- `POST /apps/:id/compliance/section` body `{ documentType, sectionKey, value }`.
- documentType→path: privacy-policy→`src/pages/privacy.tsx`, terms-of-use→`src/pages/terms.tsx`.
- `createForWorkspace(id,'preview')` null→404; view→patch→409 if no change→write→200; 400 invalid; 500 unexpected.
- Mount under protected `/apps` router.

Commit: `feat(compliance): field + section patch endpoints`

## Task 3: rehype-raw render
**Files:** `app-templates/v8/package.json` (+`rehype-raw@^7`), `agents/src/skills/compliance-docs/tools/index.ts:73-101`

Add `rehype-raw` import + `rehypePlugins={[rehypeRaw]}` + `span` passthrough preserving `data-*`/`style`. Update generate-document test if it asserts component text. `pnpm install`.

Commit: `feat(compliance): render annotated spans via rehype-raw`

## Task 4: Bus events (both copies)
**Files:** `app/src/utils/eventBus.ts`, `app-templates/v8/dev-tools/src/utils/eventBus.ts`

Add `COMPLIANCE_FIELD_UPDATED: { data: { documentType; fieldKey; newValue } }` and `COMPLIANCE_SECTION_TOGGLED: { data: { documentType; sectionKey; value } }` to both.

Commit: `feat(compliance): add field + section bus events`

## Task 5: dev-tools editor hook
**Files:** Create `app-templates/v8/dev-tools/src/hooks/useComplianceFieldEditor.ts` (+ test)

Field: wire `[data-editable="true"][data-field]` → contentEditable; commit updates all same-key spans live + fires `COMPLIANCE_FIELD_UPDATED`; Escape cancels; empty/no-op restores. Section: group `[data-section][data-section-when]` by `data-section`; on toggle flip `data-hidden`/`display:none` + fire `COMPLIANCE_SECTION_TOGGLED`. MutationObserver re-scan for HMR. Infer documentType from path.

Commit: `feat(compliance): dev-tools inline field editor + section toggle`

## Task 6: Styles + mount
**Files:** `injectDevToolsStyles.ts`, `components/DevelopmentMode.tsx`

Highlight/pencil CSS on `.airo-editable-field`; toggle control style. Mount `useComplianceFieldEditor(true)` in DevelopmentMode.

Commit: `feat(compliance): highlight + toggle affordance styling`

## Task 7: Builder bindings
**Files:** `app/src/app/[market]/develop/hooks/useDevToolsBusBindings.ts`

`on('COMPLIANCE_FIELD_UPDATED')` → POST field endpoint; `on('COMPLIANCE_SECTION_TOGGLED')` → POST section endpoint, both via `agentFetch`.

Commit: `feat(compliance): forward edits + toggles to agents endpoints`

## Task 8: Verify
typecheck + lint + unit suites for touched packages; manual preview check with a hand-seeded annotated page; E2E grep.
