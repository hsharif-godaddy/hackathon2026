# Divider Section Manual Editing — Design

**Status:** Draft
**Date:** 2026-06-17
**Scope:** Design a manual editing UI for divider sections so users can swap presets, adjust parameters, and remove dividers without going through "Edit with AI".

**Issue:** [AIROBUILD-2304](https://godaddy-corp.atlassian.net/browse/AIROBUILD-2304) — Spike: divider section manual editing UI.
**User feedback:** [AABSP-631](https://godaddy-corp.atlassian.net/browse/AABSP-631) (Loom video).

## Problem

When the user clicks a divider section in the Canvas, [`ElementHoverBar`](../../../app-templates/v8/dev-tools/src/components/ElementHoverBar.tsx) only renders the universal fallback actions: "Reference" and "Edit with AI". There is no surface for swapping the divider preset, tweaking its shape parameters, or removing it. Users have to send an LLM prompt for what should be a one-click style change, which is slow, costs tokens, and produces non-deterministic results.

The existing edit pipeline has four message types today:

- `TEXT_UPDATED` rewrites JSX text children through `ASTTextEditor`.
- `CONTENT_UPDATED` edits recognized `virtual:content` fields.
- `STYLE_UPDATED` rewrites element classes or inline styles through `ASTStyleEditor`.
- `FORMAT_OVERRIDE_UPDATED` writes guarded sidecar entries for whole-bound-expression formatting (see [2026-05-27 format-override spec](2026-05-27-format-override-sidecar-design.md)).

Divider editing needs a fifth semantic path. It is not a content edit, not class/style mutation, and not a sidecar — divider configuration is a small set of structured props on a JSX element we control. Reusing `STYLE_UPDATED` would force divider props through a className/inline-style channel that doesn't fit them.

## Goals

- Allow the user to swap a divider's preset from a popover grid of live previews.
- Allow the user to adjust per-preset numeric parameters (amplitude, depth, steepness, position) via contextual sliders.
- Allow the user to remove a divider from a section.
- Apply changes optimistically with rollback on failure, matching the `STYLE_UPDATED` and `FORMAT_OVERRIDE_UPDATED` correlation pattern.
- Keep divider configuration in JSX source so full-source export and dist-only publish keep working without a new persistence layer.
- Produce a design only for this spike. Implementation tickets follow.

## Non-goals

- Inserting a divider where one does not already exist. v1 only edits existing dividers. Muse's hover-revealed pill toolbar (Waves icon between sections, opacity-gated by hover with a 280 ms leave delay) is the documented future model and ships as a v1.5 ticket — see Open Questions.
- Per-divider color overrides. Muse confirms strict inheritance from the next section's background (no color picker, swatch, or input in `DividerPicker`). v1 follows.
- The fade/gradient parameter set (`softness`, `fadeOpacity`, `fadeDirection`, `fadeMidpoint`). Muse defines these in its schema and per-preset SVGs but has not wired them into its picker UI; AAB defers them too.
- Animating divider transitions on edit.
- Per-route divider variants for shared layouts/components. Dividers are page-level composition.
- Section data model. v1 keeps every divider as a JSX element; we do not introduce section-record metadata for one feature.
- Default-value omission. When the user sets a slider to its default (e.g. `amplitude: 50`), the prop is written explicitly. Muse does the same — it has no "if equals default, omit" guard. Keeping behavior identical avoids divergent serialization between the two products.
- Section background editing. Muse ships a separate per-section toolbar with a background-color picker (hex, palette presets, plus image/video dropdowns) that writes a `backgroundColor` field on the section record. AAB has no equivalent surface today; it is a separate feature, separate spike, and shipped from a different toolbar than divider editing in Muse. v1 of divider editing is forward-compatible: the runtime color resolver re-reads the next sibling's computed background on DOM mutation, so when a section-bg editing feature later lands (whether via `STYLE_UPDATED` rewriting Tailwind classes or a new mechanism), dividers will auto-update without changes here. Two Muse behaviors to consider when section-bg editing is designed: (a) Muse hides the divider when adjacent backgrounds are equal — worth porting as a runtime enhancement to avoid pointless dividers; (b) Muse's bg picker also adjusts text-color overrides for accessibility against the new background — orthogonal to dividers but a real interaction worth knowing about.

## V1 Boundaries

V1 ships:

- 15 presets (the full Muse set across the `waves`, `angles`, `curves`, `geometric`, and `minimal` categories).
- 4 wired numeric controls (`amplitude`, `depth`, `steepness`, `position`), each surfaced only for the presets that consume it.
- A "Remove" action in the popover header.
- A "Style" entry in the hover bar that is gated to elements classified as dividers.

V1 does not ship insertion, color editing, fade controls, or section-level metadata. Editing is scoped to dividers already present in the customer app's JSX.

## Recommendation

Add a `SectionDivider` React component to the v8 template, classify it in element-detection, surface a "Style" action on the hover bar, and edit it through a new `DIVIDER_UPDATED` message that lands at a new agents route backed by an AST prop-editor tool.

```tsx
<section className="bg-slate-50 py-12">
  …content…
</section>

<SectionDivider
  data-dev-id="abc123"
  preset="wave-smooth"
  amplitude={50}
  position={50}
/>

<section className="bg-white py-12">
  …content…
</section>
```

The `SectionDivider` component renders an inline SVG, resolves its fill color from the next sibling section's computed background at runtime, and reserves the right vertical height for the chosen preset and parameters. Editing is a structured prop rewrite: the picker collects new props, posts them to the agents service, and the AST tool replaces only the named JSX attributes on the located element.

This avoids inventing a sidecar layer (divider props live naturally on the JSX element) and avoids inventing a section data model (we already have JSX, the source mapper, and per-app commits).

## Alternatives Considered

### Sidecar (mirror the format-override design)

Store divider configuration in `dividers/<page>.json` per source page, render at runtime through a Vite virtual module, and write the sidecar on edit instead of touching JSX.

Rejected. The format-override sidecar exists because the underlying JSX expression (`{user.name}`) is not ours to mutate — formatting marks have to live elsewhere. Divider props are entirely on a component we ship; there is no expression to leave untouched. A sidecar adds a load path, a publish path, a virtual module, a guard system, and an orphan story without buying anything.

### Reuse `STYLE_UPDATED`

Map preset/amplitude/etc. onto `className` or inline `style` attributes and reuse `ASTStyleEditor`.

Rejected. Divider parameters are not CSS. `preset` is a string-literal union, the numeric params are 0–100 integers, and the rendered output is an SVG path family selected by preset. Forcing them through a className/style channel would either generate dynamic Tailwind classes (which v8 cannot extract at build time) or invent a synthetic prop-encoding scheme on top of `style=`. New message type and new AST tool is cleaner.

### Inline controls rendered on the divider

Render the preset grid and sliders directly on top of the selected divider element.

Rejected. The 15-tile preset grid plus contextual sliders does not fit on a divider that may be only ~80 px tall. Crowds the canvas, no precedent in AAB.

### Side panel / drawer

Open the picker in a permanent right-side drawer instead of a popover.

Rejected for v1. The drawer real estate is occupied by the agent chat panel, and a 4-control picker does not justify a new persistent surface. A popover trigger from the hover bar matches the `ColorPicker` and `FormatOverrideControls` precedent and is closer to the Muse model the user feedback explicitly references.

### Section data model

Introduce structured per-section metadata (a `SectionRecord` with a `divider: SectionDivider` field) and serialize the divider as data, not JSX.

Rejected for v1. AAB has no section metadata today. Introducing one for divider editing alone is disproportionate. The JSX-prop approach leaves the door open: a future migration can read the existing `<SectionDivider preset="…" …>` props and lift them into a section data model without breaking customer apps already in production.

## Source-Mapping

No new source-mapper logic is required, but **the classifier does not key off source-mapper output.** The Babel plugin in [`source-mapper/src/index.ts`](../../../app-templates/v8/source-mapper/src/index.ts:430) injects only `data-dev-file`, `data-dev-line`, and `data-dev-id` — *not* `data-dev-component`. The existing [`extractDevContext`](../../../app-templates/v8/dev-tools/src/utils/element-helpers.ts:48) helper documents this explicitly: "data-dev-component falls back to 'unknown' since the source-mapper Babel plugin does not inject it." Anything that depends on `componentName` matching a real component string is broken in production.

Instead, the runtime `SectionDivider` component renders its own stable marker on its DOM root: `data-component="SectionDivider"`. The classifier walks up via `closest()`:

```ts
export function isDividerElement(element: HTMLElement | null): boolean {
  return !!element?.closest('[data-component="SectionDivider"]');
}
```

This is independent of `isTextElement` / `isContentElement`, independent of source-mapper output, and reliable because the marker is set by the component itself on every render. The walk through `closest()` handles the inner `<svg>` click target case the same way `extractDevContext`'s ancestor walk does for file/line/devId reads.

`extractDevContext` is still used to read `data-dev-file`, `data-dev-line`, and `data-dev-id` from the wrapping div (those *are* injected by the source-mapper through the props the component forwards) — but only after `closest()` confirms the element is a divider.

## Runtime Component

Ship `app-templates/v8/src/components/SectionDivider.tsx`:

```ts
type DividerPreset =
  | "wave-smooth" | "wave-layered" | "wave-asymmetric"
  | "tilt" | "arrow"
  | "curve-concave" | "curve-convex" | "curve-double" | "sweep" | "spill"
  | "triangle" | "peaks" | "steps"
  | "fade" | "line";

interface SectionDividerProps {
  preset: DividerPreset;
  amplitude?: number;   // 10..100, default 50, used by wave-*
  depth?: number;       // 10..100, default 50, used by arrow/triangle/curve-*/sweep/spill/peaks/steps
  steepness?: number;   // 10..100, default 50, used by tilt/sweep
  position?: number;    // 0..100, default 50, used by tilt/sweep/arrow/triangle/curve-*/peaks/steps/spill
  color?: string;       // hex; resolves from next sibling's bg when undefined
  className?: string;
}
```

The component renders an inline `<svg>` whose path family is selected by `preset` and whose path data is parameterized by the four numeric props. SVG bodies are ported from Muse's `packages/sections/src/dividers/` preset implementations.

**Color resolution.** When `color` is `undefined`, the component reads the computed `background-color` of its next sibling element via a `useLayoutEffect` lookup, falls back to `transparent` when none is found, the sibling is hidden (`display: none`), or the resolved value is non-solid (e.g. `linear-gradient`). It re-resolves on relevant DOM mutations using a small `MutationObserver` scoped to the next sibling. This matches Muse's behavior — the divider visually carves into the section above by being filled in the section below's color — without requiring a section data model. An explicit `color` prop, when provided, skips the lookup. v1 never sets `color` from the picker; the agent may choose to set it during page generation. There is one sentinel (`undefined`); the spec does not introduce a string `"auto"` form to keep the prop's TypeScript type a clean `string | undefined`.

**Height reservation.** The component sets its own height based on `preset` and parameters via a small `getDividerHeight(divider: SectionDividerProps): string` helper, so layout doesn't reflow when params change. Helper ported from Muse.

**Loop safety.** `<SectionDivider>` should never be rendered inside a `.map()` in the customer app because dividers are page-level composition. The hover-bar duplicate-`data-dev-id` check (already used to gate style controls) handles this defensively in case the agent ever emits a divider inside a loop — those dividers don't open the picker.

## DividerPicker UI

A new dev-tools component `app-templates/v8/dev-tools/src/components/DividerPicker.tsx`. Trigger: a "Style" action button added to `ElementHoverBar` for divider elements. Surface: Radix `Popover` anchored to the trigger.

Layout:

- **Header:** title "Divider style" plus a "Remove" button (destructive variant, always visible when the divider is set).
- **Body:** a CSS-grid of preset tiles. Each tile renders a live mini SVG preview using the same `SectionDivider` component at a fixed small size, so the grid and the canvas use one source of truth for the rendering. Selected tile carries `data-selected="true"`.
- **Footer:** contextual sliders. Only sliders relevant to the active preset are rendered.

Per-preset slider matrix (matches Muse exactly):

| Slider        | Range, step | Presets                                                                                                |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| **amplitude** | 10–100, 5   | `wave-smooth`, `wave-layered`, `wave-asymmetric`                                                       |
| **depth**     | 10–100, 5   | `arrow`, `triangle`, `curve-concave`, `curve-convex`, `curve-double`, `sweep`, `spill`, `peaks`, `steps` |
| **steepness** | 10–100, 5   | `tilt`, `sweep`                                                                                        |
| **position**  | 0–100, 5    | `tilt`, `sweep`, `arrow`, `triangle`, `curve-concave`, `curve-convex`, `curve-double`, `peaks`, `steps`, `spill` |

`fade` and `line` show no sliders. `sweep` shows three. When the user changes preset, parameter values from the previous preset are kept in component state but only the relevant ones are sent to the AST tool — props for unused params are written as `null` (which the AST tool interprets as "remove this attribute from the JSX") so the on-disk JSX stays minimal across preset switches. Default-equivalent values from the *current* preset (e.g. `amplitude: 50`) are written explicitly; only preset-irrelevant params are omitted.

Slider step is 5 across the board, enforced at the Radix `Slider.Root` `step` prop (`amplitude`/`depth`/`steepness` in `[10, 100]`, `position` in `[0, 100]`). Muse confirms this is real quantization, not a UX hint — Radix emits multiples of 5 from `onValueChange`. The server validates the same constraint.

**Optimistic preview.** Slider drag fires `onChange` per tick; the component applies the new params to a transient runtime preview by posting a `DIVIDER_PREVIEWED` message that the runtime `SectionDivider` reads from a window-level preview store (keyed by `devId`). On `onChangeEnd` (drag complete), the picker fires `DIVIDER_UPDATED` to persist. On `EDIT_FAILED`, the runtime preview clears and the slider/grid state rolls back, matching `applyOptimisticFormatPreview`. Preset clicks debounce into a single `DIVIDER_UPDATED`.

The preview store is a small in-iframe singleton (`window.__airoDividerPreview__`); it does not touch component state outside `SectionDivider` and is cleared on iframe reload.

## Hover Bar Behavior

`ElementHoverBar` distinguishes element classes today (text, image, generic). Add a fourth: divider.

For divider-classified elements:

- The "Style" action button is rendered alongside "Reference" and "Edit with AI". Clicking it opens the `DividerPicker` popover.
- "Reference" remains available (multi-select).
- "Edit with AI" remains available as the fallback for vague intents ("make this more dramatic").
- All text/image actions are hidden, since they don't apply.

For non-divider elements: no change.

The action surface should be feature-flag-gated for the rollout; the existing dev-tools flag mechanism is sufficient.

## Endpoint

Add an agents endpoint:

```text
POST /apps/:id/dividers
```

Request:

```ts
interface DividerUpdateRequest {
  commitId?: string;
  devId: string;
  target: {
    file: string;   // e.g. "src/pages/index.tsx"
    line: number;
    component: "SectionDivider";
  };
  action: "update" | "remove";
  props?: {
    preset?: DividerPreset;
    amplitude?: number | null;  // null removes the prop
    depth?: number | null;
    steepness?: number | null;
    position?: number | null;
  };
}
```

Response:

```ts
interface DividerUpdateResponse {
  success: boolean;
  commitHash?: string;
  removed?: boolean;
  error?: string;
}
```

The builder page echoes the request's `commitId` in the iframe success/failure message, matching the `STYLE_UPDATED` and `FORMAT_OVERRIDE_UPDATED` conventions. The HTTP response does not need to echo it.

The route lives behind the protected router AND must apply [`validateAppOwnership`](../../../agents/src/server/middleware/app-ownership.ts) per [agents/CLAUDE.md](../../../agents/CLAUDE.md): every route accepting an `:id` (appId) is required to validate that the authenticated user owns that app before doing any work. JWT auth on the protected router only proves identity; it does not prove that this tenant is allowed to edit *this* app. Without `validateAppOwnership`, an authenticated tenant could edit and commit another tenant's app files via the route's `:id` param. Wire identical to the format-override route at [`agents/src/server/routes/format-overrides.ts:28`](../../../agents/src/server/routes/format-overrides.ts#L28). PaaS support is out of scope for v1; the route uses the AAB-only `apps` table to resolve the workspace, same as the format-override route.

## Validation

Server-side validation rejects:

- Missing `devId`, `target.file`, `target.line`, or `target.component`.
- `target.component !== "SectionDivider"`.
- `preset` not in the 15-element enum.
- Numeric params that are non-integer **or not multiples of 5**. Muse's slider quantizes to step 5 at the source; the server enforces the same on the wire so out-of-protocol clients can't introduce arbitrary precision.
- `position` outside `0..100`.
- `amplitude`/`depth`/`steepness` outside `10..100`.
- (The picker conditionally renders sliders per preset and so never emits mismatched params. The server does not enforce per-preset param relevance — it accepts and the AST tool writes whatever the picker sent. If picker bugs ever do leak mismatched params, they land harmlessly as extra JSX attributes that the runtime preset component ignores.)
- Invalid `action`.
- For `action: "update"` with no `preset` and no numeric params present: reject as no-op.
- For `action: "remove"`: any `props` field is ignored.

The route does not accept a client-provided file path other than `target.file` for the rewrite. The AST tool resolves the file from `target.file` against the per-app workspace; `target.file` must match `^src/pages/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.tsx$` (no `..`, no leading `/`, no symbol characters). Files outside `src/pages/` are not eligible for divider edits in v1 — Muse only renders dividers in page composition.

If validation fails, the route returns `{ success: false, error }` and writes nothing.

## AST Tool

New tool `agents/src/tools/ast-divider-editor.ts`, extending [`ASTEditorBase`](../../../agents/src/tools/ast-editor-base.ts). Responsibilities:

- Parse the source file at `target.file` via Babel using the shared parser plugin set in `ASTEditorBase`.
- Locate the `<SectionDivider>` JSX element using the same multi-tier locator already proven in [`ASTStyleEditor.isTargetElement`](../../../agents/src/tools/ast-style-editor.ts#L91): primary match on `data-dev-id` exact equality (the structural id from the source-mapper), fallback on tag name + line number with ±3-line tolerance + optional className overlap. The locator does not introduce a re-derive-devId verification step — `ast-style-editor` does not have one and has shipped fine without it; adding one for divider edits would diverge without obvious benefit.
- For `action: "update"`: replace the named JSX attributes. Attributes whose request value is `null` are removed from the JSX (used when a preset switch makes a param irrelevant).
- For `action: "remove"`: delete the `<SectionDivider>` JSX element from its parent. If the parent becomes empty as a result, the parent is left in place — divider removal does not cascade into section deletion.
- Format the file with the existing prettier config (inherited from `ASTEditorBase`).
- Stage and commit the file using [`commitChanges`](../../../agents/src/tools/ast-editor-base.ts#L294) on the base class, which calls `gitTool.executeGitOperation` for `add` → `commit` → `log`. The commit message uses the format `[divider] update <preset>` or `[divider] remove`. The `appId` must be present for the commit to actually land — base class silently skips commits when missing, matching the existing convention.

Error shapes match the existing `BaseEditResult` (`{ success, filePath, diff?, error?, commitHash? }`):

- `Element not found at line N in file` — locator failed (devId mismatch *and* line ±3 fallback failed).
- `DIVIDER_PROP_INVALID: <field>` — request validation failed at the AST layer (should be caught earlier at the route, but defense-in-depth).
- `DIVIDER_COMPONENT_NOT_FOUND` — the located JSX is not a `<SectionDivider>` (e.g., the line points to an unrelated element).

The tool does not introduce new prettier or Babel configuration. It reuses the same parser plugin set already used by `ASTStyleEditor`.

## Loop-Rendered Blocking

Dividers are unlikely to appear inside `.map()` — the agent renders sections sequentially as siblings of a page root, not via repetition. The hover-bar's existing duplicate-`data-dev-id` check (used to gate style controls today) is sufficient defense. The `DividerPicker` should not open for elements that fail this check; the user sees only "Reference" + "Edit with AI" in that case.

The runtime component itself does not need new loop-blocking logic because it does not consult any per-`devId` runtime state outside the optimistic preview store, and the preview store is cleared on rollback.

## Drift And Stale Edits

JSX prop edits are sensitive to source rewrites. If the agent rewrites the page between when the user opens the picker and when they commit a slider change, the located element may have moved. Drift behavior is fully inherited from `ASTStyleEditor`'s locator, with one subtlety worth calling out: `data-dev-id` is **structural, not positional**. The source-mapper computes it as a DJB2 hash of an ancestor-chain key (`tagName#siblingIndex>tagName#siblingIndex>…>SectionDivider#N`) rooted at the file path — the per-tag sibling indices are stable while the tree is fixed but shift when same-tag siblings are added/removed/reordered upstream of the target.

Drift cases:

- **Element moved to a new line, devId preserved (no upstream tree change):** locator's primary devId match still hits. Edit succeeds.
- **Element moved AND devId shifted (upstream `<SectionDivider>` added or removed):** primary devId match misses. Locator falls back to tag + line ± 3 + optional className overlap. If line ± 3 still finds the element, the edit succeeds — but it may target the wrong divider on a page with multiple divs of the same tag. Acceptable risk in v1; the picker round-trip is short (seconds), and the visual rollback on visible mismatch is fast.
- **Element deleted:** all locator tiers miss. AST tool returns `Element not found at line N in file`. Picker shows failure toast and clears optimistic state.
- **Different `<SectionDivider>` sits at the requested line (page restructure):** primary devId match misses; line ± 3 may match the wrong divider. The AST tool's `DIVIDER_COMPONENT_NOT_FOUND` check (verifies the located JSX has the `SectionDivider` component name) does not catch same-component substitution. This is the same gap `ASTStyleEditor` has; no new healing pass is introduced for v1.

Mitigation paths considered and rejected for v1: re-deriving devId after the located JSX would require running the source-mapper transform on the entire file in-process, which has setup cost and isn't done elsewhere; a content-hash guard on the located element's full JSX would catch upstream-tree changes but produces frequent false-mismatches when adjacent edits land between the open and the commit. The structural-shift case stays as a known v1 limitation.

## Optimistic Preview Store

The runtime store in `app-templates/v8/src/lib/divider-preview.ts`:

```ts
interface DividerPreviewState {
  set(devId: string, override: Partial<SectionDividerProps>): void;
  clear(devId: string): void;
  get(devId: string): Partial<SectionDividerProps> | undefined;
  subscribe(listener: () => void): () => void;
}
```

`SectionDivider` reads from this store via a small subscription hook and overlays the override on its incoming props. The store is window-scoped, not React-context-scoped, so dev-tools messages handlers can write to it without traversing the React tree.

The store is cleared on:

- `DIVIDER_UPDATED` succeeds (the file write produces the canonical state).
- `DIVIDER_UPDATED` fails (rollback).
- Iframe full reload.
- Manual `DIVIDER_PREVIEW_CLEARED` message (e.g., picker dismissed without a commit).

## Error Handling

Client:

- `onChange` slider drag posts `DIVIDER_PREVIEWED` only — no network.
- `onChangeEnd` posts `DIVIDER_UPDATED`. The picker shows a small in-flight indicator until the iframe replies with a correlated success/failure.
- On failure, runtime store is cleared for that `devId` and the picker UI rolls back to the last known persisted state.

Server:

- File parse, AST locate, prettier, and git commit failures all return `{ success: false, error }` with a stable error code so the picker can pick the right message.
- The route never partially writes: prettier and git commit are wrapped in a transaction shape so that a failure leaves no half-written file.

Runtime:

- `SectionDivider` renders unstyled fallback (a 0px gap) if `preset` is unknown. Logs once in development.
- Color lookup failure renders `transparent`.
- Unknown numeric params are clamped to range or dropped.

## Testing

`SectionDivider` runtime tests:

- Renders each of the 15 presets without throwing.
- Honors `amplitude`/`depth`/`steepness`/`position` within range.
- Clamps out-of-range numerics to the documented bounds.
- Resolves `color` to next-sibling computed background when `color` is unset.
- Falls back to `transparent` when no next sibling exists.
- Reads optimistic preview overrides from the store and reverts when cleared.
- `getDividerHeight` returns a stable height for fixed inputs.

Element-detection tests:

- `isDividerElement` returns true for an element whose nearest ancestor (or self) carries `data-component="SectionDivider"`.
- Returns false for elements outside any divider wrapper.
- Walks the DOM up via `closest()` to handle inner-SVG click targets.

`DividerPicker` tests:

- Renders all 15 preset tiles.
- Selecting a preset highlights its tile and shows only the relevant sliders.
- Slider drag posts `DIVIDER_PREVIEWED`; release posts `DIVIDER_UPDATED`.
- Remove button posts `DIVIDER_UPDATED` with `action: "remove"`.
- Rolls back UI state on `EDIT_FAILED`.
- Loop-rendered duplicate-`data-dev-id` element does not open the picker.

Hover-bar tests:

- "Style" action shows for divider-classified elements only.
- "Reference" and "Edit with AI" remain available.
- Text and image actions do not appear on dividers.

`ast-divider-editor` tests:

- Updates `preset` only, leaves other props untouched.
- Updates multiple numeric props in one call.
- Removes a prop when its value is `null`.
- Removes the entire JSX element on `action: "remove"`.
- Returns guard-mismatch when the located element's dev-id does not match the request.
- Produces a per-app commit with a stable, prettier-formatted file.
- Skips commit when the resulting file is byte-identical to the input.

Endpoint tests:

- Accepts a valid update.
- Accepts a valid remove.
- Rejects unknown presets, out-of-range numerics, missing target fields.
- Rejects `target.component !== "SectionDivider"`.
- Rejects path traversal in `target.file`.
- Returns guard-mismatch from the AST tool unchanged to the client.
- Echoes nothing in the HTTP body that should be echoed by the builder page instead.

E2E tests (in `tests/e2e-v2/` and `tests/regression/`):

- Open an app with a divider, click it, change preset, see the canvas update and the file commit land.
- Adjust a slider, see the optimistic preview track the drag, see the persisted value match release.
- Remove a divider, see the JSX element disappear.

Publish/export tests:

- Full-source export includes any divider JSX edits.
- Dist-only publish renders the latest divider configuration.

## Follow-up Implementation Tickets

Three v1 tickets plus one deferred v1.5 ticket. Each v1 ticket maps to a coherent code-owner boundary and produces a user-experienceable increment.

### Ticket 1 — Runtime divider component & agent integration

Ship `<SectionDivider>` in the v8 template and update the agent so new apps emit it between sections.

**Code areas.** `app-templates/v8/src/components/SectionDivider.tsx` (component), the 15 preset SVG bodies (one file per preset, ported from Muse's `packages/sections/src/dividers/presets/`), `getDividerHeight` helper (ported from `packages/sections/src/dividers/heights.ts`), the next-sibling computed-color resolver, and agent system-prompt / template-seed updates so generated pages include `<SectionDivider>` where appropriate.

**No dev-tools or agents-route dependency.** Lands first; Tickets 2 and 3 import the component name and prop types from this work.

**Deliverable.** New apps generated after this ticket lands include `<SectionDivider>` between sections. Existing apps don't change until the user asks the agent to add a divider via prompt.

### Ticket 2 — Agents AST tool & edit endpoint

Ship the structured-prop edit path on the agents service.

**Code areas.** `agents/src/tools/ast-divider-editor.ts` (extends `ASTEditorBase`, reuses the `isTargetElement` locator pattern from `ASTStyleEditor`), `POST /apps/:id/dividers` route under the protected router, request validation (preset enum, step-5 numeric quantization, path-traversal guard on `target.file`), and route tests.

**Depends on Ticket 1** for the `SectionDivider` component name (target validation rejects other components). Can be exercised with curl independently of Ticket 3.

**Deliverable.** Backend can update or remove a divider's props on a given page given `(devId, target.file, target.line)` and produces a per-app git commit.

### Ticket 3 — Builder bridge & dev-tools picker UI

Ship the visible-to-the-user editing surface.

**Code areas.** `element-detection.ts` `isDividerElement` classifier, `ElementHoverBar` "Style" action wiring, `DividerPicker` popover (preset grid + contextual sliders + Remove), optimistic preview store at `app-templates/v8/src/lib/divider-preview.ts`, `DIVIDER_PREVIEWED` / `DIVIDER_UPDATED` postMessage events, `appService.updateDivider` BFF method on the Next.js app, builder page handler that forwards to Ticket 2's endpoint and echoes `commitId` on success/failure.

**Depends on Tickets 1 and 2.** Can develop against a stubbed Ticket 2 response to unblock UI work in parallel.

**Deliverable.** Users can click a divider, swap presets, drag sliders with live preview, and remove dividers from the canvas without going through "Edit with AI".

### Ticket 4 — (v1.5) Insertion UX

Defer to a follow-up release. Ports Muse's `SectionGap` model: a wrapper component between page-level sections, a hover-revealed pill toolbar (Waves icon, 280 ms leave delay) anchored to gap elements, and the existing `DividerPicker` reused to insert when the gap has no divider. Adds gap detection in `element-detection.ts`, gap layout reservation, and an agent prompt update to wrap sections in `<SectionGap>`. Out of v1 scope to keep the first ship narrow.

### Cross-cutting

E2E coverage in `tests/e2e-v2/` and `tests/regression/`, i18n strings (15 preset names, 4 slider labels, "Style", "Remove"), feature-flag wiring, and visual regression are each absorbed into the ticket whose code they touch rather than tracked as separate tickets. Rollout strategy (feature flag + cohort) is decided at Ticket 3 implementation time.

### Ordering

```text
Ticket 1 (runtime) ──┬── Ticket 2 (agents)  ──┐
                     │                        │
                     └── Ticket 3 (UI) ───────┴── v1 complete

Ticket 4 (v1.5) — after v1 lands
```

Ticket 1 strictly first. Tickets 2 and 3 in parallel. Ticket 4 strictly after v1 ships.
