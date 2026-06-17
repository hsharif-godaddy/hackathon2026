# Editable Compliance Document Fields — Design

**Date:** 2026-06-15
**Status:** Draft (awaiting review) — revised against the downstream-editor spec
**Branch:** interactive-compliance-docs

## Problem

The compliance-docs skill generates legal pages (Privacy Policy, Terms of Use) by
calling an external compliance-agent API (`POST /api/document/generate`), which returns
legal **markdown** with the user's inputs (business name, email, domain, jurisdiction)
woven into the prose. That markdown is embedded as a string constant inside a generated
`src/pages/privacy.tsx` / `terms.tsx` page (`buildPageComponent`,
`agents/src/skills/compliance-docs/tools/index.ts:73`) and rendered in the customer
app's preview.

Once generated, the filled-in values are static, and the yes/no choices that gate whole
paragraphs (e.g. "does this site collect data from children?") are fixed. A user who
typo'd their business name, wants to change the contact email, or flipped the wrong
yes/no answer has no way to fix it short of regenerating the whole document.

## Goal

In the **preview**, the user should:

1. See each filled-in value **highlighted** with a symbol indicating it's editable,
   click it, and edit it **inline**; and
2. **Toggle** the boolean "children's data" section, swapping which paragraph is shown.

Both update the page **in place with no API call and no LLM**, and persist back into the
generated page file so the choice survives refresh and publish.

## How the annotated markdown works (from the generation API)

`POST /api/document/generate` returns `{ documentType, markdown }`, where `markdown` is
markdown **with inline HTML spans**. The editable annotations are present **only** on
this endpoint (it calls the generator with `markEditableFields: true`). There are two
markup constructs:

### Construct A — editable scalar field spans

```html
<span data-field="businessName" data-type="text" data-editable="true">Acme Corp</span>
<span data-field="email" data-type="email" data-editable="true">legal@acme.com</span>
<span data-field="domainName" data-type="url" data-editable="true">acme.com</span>
<span data-field="jurisdiction" data-type="us_states" data-editable="true">California</span>
```

- One span per interpolation of a field. **The same field appears multiple times** (e.g.
  `email` in several paragraphs) — editing it must update **every** span with that
  `data-field`.
- `data-field` is the canonical key, mapping to request-body keys (`businessName`,
  `email`, `domainName`, `jurisdiction`).
- `data-type` is the semantic type for validation/input rendering: `text`, `email`,
  `url`, `us_states`. `us_states` is the fixed 50-state `Jurisdictions` enum (full
  names, e.g. "California"). **The generator emits attributes in the order
  `data-field`, `data-type`, `data-editable` — they are NOT adjacent**, so any matching
  must be attribute-based, not positional.
- `last_updated_date` is **NOT** an editable field. It is server-generated and rendered
  as plain text ("Last updated: June 15, 2026") — there is no `data-field="last_updated_date"`
  span.
- A field appears in the markup only if it's on the generator's allowlist; non-allowlisted
  fields render as plain text.
- Inner text is **markdown-escaped** (`A*B` → `A\*B`, `<` → `&lt;`). Reading a value back
  yields escaped content; when re-submitting to the API you'd send the raw unescaped
  value — but this design does not re-submit on edit (see "Persistence").
- `data-editable` is always `"true"` on field spans today (no read-only fields yet) — do
  not hardcode that it can't become `"false"` later.

### Construct B — boolean section branches

```html
<span data-section="children" data-section-when="true" data-hidden="true" style="display:none"> …COPPA paragraph… </span>
<span data-section="children" data-section-when="false"> …does-not-collect paragraph… </span>
```

- **Both** branches are present in the markup. `data-section-when="true"` is the body
  shown when the boolean is true; `"false"` is the inverse.
- Exactly one branch per `(data-section, value)` is visible; the non-matching branch
  carries `data-hidden="true" style="display:none"`.
- **Toggling = flip which branch has `data-hidden`/`display:none`.** No re-fetch.
- **Editable field spans (construct A) live inside section bodies too** (e.g. `email`
  inside the COPPA paragraph), so a field edit must also update spans in **hidden**
  branches.
- Sections can be **block-level** (whole paragraphs — privacy-policy) or **inline**
  mid-sentence (terms-of-use). An inline `{{#children}}` with no `{{^}}` inverse produces
  **only** a single `data-section-when="true"` span — do not assume both branches exist.

### Field reference

| documentType | editable fields (data-type) | boolean sections | plain (non-editable) |
| --- | --- | --- | --- |
| privacy-policy | businessName (text), email (email) | children (block, both branches) | last_updated_date |
| terms-of-use | businessName (text), domainName (url), jurisdiction (us_states) | children (inline, positive branch only) | last_updated_date |

`jurisdiction` is a fixed US-state enum (`Jurisdictions` in the API's
`packages/api/src/api/mcp/types.ts`). If made editable, constrain to that enum.

## Decisions (locked during brainstorming)

| Decision | Choice |
| --- | --- |
| Field edit (A) | Inline `contentEditable`, commit on blur/Enter; **no API, no LLM** |
| Field propagation | Patch **every** span with the same `data-field`, **including hidden branches** |
| Section toggle (B) | Flip `data-hidden`/`display:none` between branches; **no API, no LLM**; handle inline single-branch case |
| Escaping | **Markdown-escape** the new value (not HTML-escape) to match the generator |
| Persistence | Patch the generated `.tsx` file in place (survives refresh + publish) |
| Publish | **Ship the annotated file as-is.** The hidden branch stays hidden via inline `display:none`. No publish-time regeneration. |
| Save routing | Direct, deterministic file patch via a new agents endpoint |

### Note on the spec's "do not publish as-is" caution

The downstream-editor spec warns that the annotated markdown is "editor-only" because
hidden branches contain legally contradictory text, and suggests re-generating a clean
single-branch doc (flag OFF) at publish. **This design deliberately does not do that.**
Per the product owner's direction, we leave the hidden branch in the published output and
rely on its inline `display:none` to keep it invisible. This is a recorded, deliberate
deviation, not an oversight. (A future change could add publish-time clean regeneration;
it is out of scope here.)

## Architecture & Data Flow

Four layers:

1. **Generation contract (external API → agents).** The API already returns annotated
   markdown with constructs A and B when called with `markEditableFields: true`
   (the existing generation path). Out of scope for this repo; we consume it.

2. **Page render (agents `buildPageComponent`).** Today `react-markdown` runs **without**
   `rehype-raw`, so embedded HTML spans (and `style="display:none"`) are stripped. We add
   `rehype-raw` so both constructs survive into the DOM. In the **published** build the
   spans are inert; the hidden branch stays hidden via inline style.

3. **Highlight + inline edit + toggle (dev-tools, preview-only).** dev-tools renders only
   when `import.meta.env.MODE === 'development'` (`DevToolsProvider.tsx:44`) and is
   stripped from published apps. It:
   - finds `[data-editable="true"][data-field]` spans → highlight + pencil + `contentEditable`;
   - finds section spans (keyed on `data-section` **AND** `data-section-when` to avoid
     collision with the existing `data-section` usage in `DevelopmentMode.tsx:1056`) →
     renders a toggle affordance for each distinct `data-section`.

4. **Direct persistence (preview → builder → new agents endpoint).** On commit/toggle,
   dev-tools fires a typed bus event → the builder forwards it to a new authenticated
   agents endpoint via `agent-fetch` → the endpoint performs a deterministic patch in
   `privacy.tsx`/`terms.tsx` → the disk write triggers Vite HMR → the preview re-renders.

```
[annotated markdown: data-field + data-section spans]
      | (generation, markEditableFields: true)
      v
privacy.tsx --renders (rehype-raw)--> Preview DOM
      |                                   |
      |          dev-tools: highlight [data-editable]; toggle for each data-section
      |                                   | commit / toggle (no API)
      v                                   v
   live DOM update              bus event --> builder --agent-fetch--> POST /apps/:id/compliance/field
                                                                       or /compliance/section
                                                                              | deterministic patch
                                                                              v
                                Vite HMR <---- privacy.tsx rewritten on disk
```

## Components

### A. `buildPageComponent` — render the spans
`agents/src/skills/compliance-docs/tools/index.ts:73`

- Add `rehype-raw` to the `react-markdown` pipeline; register a `span` passthrough that
  preserves `data-*` and `style`.
- New dependency: `rehype-raw@^7` in `app-templates/v8/package.json` (compatible with the
  template's `react-markdown@^9` — NOT the builder's catalog `react-markdown@^10`).
- Verify the renderer preserves inline `style` and `data-*`; if a sanitizer strips
  `style`, key the hidden state off `data-hidden` with dev-tools' own CSS instead.

### B. Span/section-patch utility + tests
`agents/src/skills/compliance-docs/field-patch.ts` (new)

- `patchFieldValue(source, fieldKey, newValue) → { content, replaced }`: replace inner
  text of **every** `<span data-field="KEY" data-editable="true">…</span>` (regardless of
  whether it sits in a hidden branch), **markdown-escaping** the new value.
- `setSectionValue(source, sectionKey, value) → { content, changed }`: for the given
  `data-section`, set `data-hidden`/`style="display:none"` on the branch whose
  `data-section-when` ≠ the chosen value, and remove them from the matching branch.
  Handle the single-branch (inline positive-only) case: if only `when="true"` exists,
  show it when value is true and hide it when false.
- `validateFieldValue(fieldKey, value)`: non-empty; length cap; email format for `email`;
  US-state enum for `jurisdiction`.
- Match spans **by attribute, not position**.

### C. New agents endpoints — deterministic patch
`agents/src/server/routes/compliance.ts` (new), mounted on the protected `/apps` router

- `POST /apps/:id/compliance/field` — body `{ documentType, fieldKey, newValue }`; reads
  the page file, applies `patchFieldValue`, writes back. 400 invalid; 404 app/page
  missing; 409 field absent; 500 unexpected.
- `POST /apps/:id/compliance/section` — body `{ documentType, sectionKey, value }`;
  applies `setSectionValue`, writes back. Same error contract.
- `documentType` → path: `privacy-policy` → `src/pages/privacy.tsx`, `terms-of-use` →
  `src/pages/terms.tsx`. Reads/writes via `createForWorkspace(id, 'preview')`.

### D. New bus events
`app/src/utils/eventBus.ts` **and** `app-templates/v8/dev-tools/src/utils/eventBus.ts`
(both copies, structurally identical per the file's sync rule)

```ts
COMPLIANCE_FIELD_UPDATED:   { data: { documentType: 'privacy-policy' | 'terms-of-use'; fieldKey: string; newValue: string } }
COMPLIANCE_SECTION_TOGGLED: { data: { documentType: 'privacy-policy' | 'terms-of-use'; sectionKey: string; value: boolean } }
```

### E. dev-tools editor
`app-templates/v8/dev-tools/src/` (new hook(s))

- Field editing: find `[data-editable="true"][data-field]`, highlight + pencil + inline
  edit; on commit, update **all** same-`data-field` spans in the live DOM and fire
  `COMPLIANCE_FIELD_UPDATED`.
- Section toggle: group section spans by `data-section`; render a toggle; on flip, swap
  `data-hidden`/`display:none` live and fire `COMPLIANCE_SECTION_TOGGLED`.
- Reuse `injectDevToolsStyles` for highlight/pencil/toggle styling, scoped to a dev-tools
  class so nothing leaks into the published page.

### F. Builder bindings
`app/src/app/[market]/develop/hooks/useDevToolsBusBindings.ts`

- `on('COMPLIANCE_FIELD_UPDATED', …)` → `POST /apps/:id/compliance/field`.
- `on('COMPLIANCE_SECTION_TOGGLED', …)` → `POST /apps/:id/compliance/section`.
- Both via `agentFetch` (Bearer token + appId), mirroring the `build-page-request`
  handler shape (`:380`) but calling the endpoint directly — no chat message.

## Edit Interaction & Visual Treatment

- **Field resting:** subtle tint + dotted underline + small pencil glyph.
- **Field editing:** click → `contentEditable`, focused, text selected. Enter/blur
  commits; Escape cancels and restores.
- **Field commit:** if changed and non-empty (and valid), update all matching spans live
  and fire `COMPLIANCE_FIELD_UPDATED`. Empty/no-op restores.
- **Section toggle:** a small dev-tools control near the section; flipping it swaps the
  visible branch immediately and fires `COMPLIANCE_SECTION_TOGGLED`.
- **In-flight + confirm:** the disk write triggers HMR; the re-render is the confirmation.
  On endpoint error, dev-tools restores prior state and shows a small inline error.

## Error Handling & Edge Cases

- **No-op / empty field edit:** don't fire; restore. Legal fields must not be blanked.
- **`email`:** validated in dev-tools and server-side. **`jurisdiction`:** US-state enum,
  validated server-side (and constrained in the UI if surfaced as editable).
- **Field span not found on server (409):** restore + "couldn't save — try refreshing."
- **Multiple spans same `data-field`:** patch **all**, including hidden branches.
- **Inline single-branch section:** only `when="true"` exists → show when true, hide when
  false; never assume a `false` inverse.
- **`data-section` collision:** key construct B off `data-section` **plus**
  `data-section-when` so it doesn't clash with the existing section-naming use in
  `DevelopmentMode.tsx:1056`.
- **Markdown escaping:** new field values are markdown-escaped before writing into the
  file (matching the generator), not HTML-escaped.
- **Renderer fidelity:** confirm `rehype-raw` keeps `style`/`data-*`; otherwise drive
  hidden state from `data-hidden` via dev-tools CSS.
- **Sentinels U+F0001..F0003:** internal generator detail; never expected in output. If
  seen, report as a bug — do not parse.
- **Auth:** endpoints behind the protected `/apps` router (JWT + site scoping).

## Testing

- **Unit (agents) — `patchFieldValue`:** single + multiple occurrences; occurrence inside
  a hidden branch; field absent (replaced=0); markdown-escaping (`*`, `_`, `<`, `` ` ``,
  `[`); length/email/jurisdiction validation.
- **Unit (agents) — `setSectionValue`:** flip true→false and false→true (both branches);
  single-branch inline (show/hide); section absent.
- **Unit (agents) — routes:** field 200/400/404/409; section 200/400/404/409.
- **Unit (dev-tools):** field commit fires event + updates all matching spans incl hidden;
  Escape cancels; no-op/empty doesn't fire; section toggle flips `data-hidden` and fires
  event; inline single-branch handled.
- **eventBus contract test:** both copies stay structurally identical.
- **E2E:** editable spans live in generated apps → at most a regression-suite touch; flag,
  don't assume.

## Out of Scope

- The external generation API (it already emits the annotated markup with the flag on).
- Publish-time clean regeneration (flag OFF). Deliberately omitted; hidden branches remain
  in published output, invisible via inline `display:none`.
- Re-calling the compliance API on any edit or toggle.
- Editing in the published build — the affordance is preview-only by construction.
