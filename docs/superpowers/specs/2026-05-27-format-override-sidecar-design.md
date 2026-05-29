# Format Override Sidecar

**Status:** Draft
**Date:** 2026-05-27
**Scope:** Design a narrow sidecar-based way to apply Hover Bar formatting to data-bound text without rewriting JSX expressions.

**Issue:** [AIROBUILD-1696](https://godaddy-corp.atlassian.net/browse/AIROBUILD-1696) - Spike: enable RTE formatting on data-bound text via format-override sidecar.

## Problem

The preview Hover Bar currently exposes formatting controls for ordinary text elements, but bound text is blocked from the text-edit path. That is correct for content edits: replacing a JSX expression such as `{user.name}` with a literal string would break the binding. It is too strict for whole-expression formatting, where the user wants to change presentation but keep the expression intact.

The existing code has three relevant paths:

- `TEXT_UPDATED` rewrites JSX text children through `ASTTextEditor`.
- `CONTENT_UPDATED` edits recognized `virtual:content` fields.
- `STYLE_UPDATED` rewrites element classes or inline styles through `ASTStyleEditor`.

Bound text needs a fourth semantic path. It should not rewrite content, and it should not mutate JSX class/style when the formatting is meant to sit beside an expression.

## Goals

- Allow whole-bound-expression formatting for eligible single-expression text elements such as `<h1>{user.name}</h1>`.
- Keep the JSX expression unchanged.
- Store formatting in per-app, source-scoped sidecar files keyed by `data-dev-id`, guarded by source metadata to prevent stale formatting from applying to the wrong element.
- Preserve current behavior for normal literal text, content edits, and style edits.
- Block loop-rendered bound text in v1.
- Produce a design only for this spike. Implementation tickets follow.

## Non-goals

- Partial range formatting, character offsets, or word-level marks.
- Per-item formatting inside `.map()` output.
- Template-level formatting for all repeated items.
- Automatic orphan cleanup or healing after JSX reorders.
- CMS schema work, `virtual:content` migration, multi-locale support, or agent-authored content modeling.
- Reusing `CONTENT_UPDATED`; formatting is presentation, not content mutation.
- PaaS/direct-agents API support. V1 is scoped to the Airo App Builder preview flow where the agents service can resolve the app workspace from the AAB-only `apps` table.

## V1 Boundaries

V1 deliberately supports only whole-expression formatting for non-loop bound text. It does not support `.map()` output, per-item marks, template-level marks, partial range marks, or formatting that survives an agent rewriting the bound expression itself. If the expression changes, the guard should fail open and the user can reapply formatting to the new expression.

## Recommendation

Add a guarded `format-overrides/` sidecar directory and a small runtime wrapper named `FormattedBoundText`.

Each scoped sidecar is keyed by `data-dev-id` because every source-mapped JSX element already receives one. Since `data-dev-id` is structural, each entry also carries guard metadata. At runtime, the wrapper applies an override only when the current element still matches the guard.

V1 should store page-owned overrides in one JSON file per source page and non-page overrides in `shared.json`:

```text
format-overrides/
  pages/
    index.json     # src/pages/index.tsx
    about.json     # src/pages/about.tsx
  shared.json      # layouts, components, and other non-page sources
```

The `shared.json` fallback preserves the current source-mapper eligibility for layout/component bound text. Formatting a shared source applies wherever that same source renders; route-instance-specific formatting for shared components remains out of scope.

V1 only supports whole-expression marks: bold, italic, and color. Loop-rendered elements are not eligible in v1, so users cannot accidentally format all items or one item with an unstable index-based key.

## Alternatives Considered

### Reuse `STYLE_UPDATED`

This would keep implementation small by mutating `className` or `style` on the JSX element.

Rejected for this spike because it does not follow the requested sidecar model, remains whole-element class/style editing, and does not leave a clean path for future rich-text semantics.

### Key by `data-dev-content-key`

This would use the strongest semantic key available for `virtual:content` bindings.

Rejected as the primary v1 key because it only covers recognized content-layer fields. It would not solve generic bound expressions like `{user.name}`. The design still uses `contentKey` and `contentKeyTemplate` as strong guards when they are available.

### Key by `data-dev-id` with guards

This is the recommended approach. It covers generic bound expressions, aligns with the Jira proposal, and keeps formatting outside JSX. Guard metadata addresses the main structural-ID risk.

### Single app-root sidecar file

This would keep runtime loading and agents writes slightly simpler by storing every override in one `format-overrides.json`.

Rejected for v1 because per-page files localize future cleanup. If `src/pages/about.tsx` is deleted or rescanned, the implementation can delete or prune `format-overrides/pages/about.json` without proving every other route or shared component has been visited.

## Source-Mapping

Extend `app-templates/v8/source-mapper/src/index.ts` to identify bound-text formatting candidates.

An element is eligible only when all of these are true:

- The parent tag is a supported text tag: `h1` through `h6`, `p`, `span`, `a`, `label`, `li`, or `blockquote`.
- The element has exactly one meaningful child.
- That child is a non-empty JSX expression.
- The expression resolves to either a `virtual:content` key/template or can be represented by a stable expression fingerprint.
- The source mapper can prove the expression is not inside a known `.map()` render frame, and the rendered DOM later passes the duplicate-`data-dev-id` loop check.
- The expression is not direct JSX or a fragment, because `FormattedBoundText` renders a `<span>` wrapper and v1 is intended for text-valued bound expressions.

The source mapper should keep existing `data-dev-dynamic="true"` behavior for content-edit gating. Formatting eligibility is a separate concern, represented by additional metadata such as:

```tsx
<h1
  data-dev-id="abc123"
  data-dev-bound-text="true"
  data-dev-bound-source-kind="bound-expression"
  data-dev-bound-expression-hash="sha256:..."
>
  <FormattedBoundText
    devId="abc123"
    guard={{
      file: "src/pages/index.tsx",
      tagName: "h1",
      sourceKind: "bound-expression",
      expressionHash: "sha256:..."
    }}
  >
    {user.name}
  </FormattedBoundText>
</h1>
```

For recognized content fields, include the content key in the guard:

```tsx
<FormattedBoundText
  devId="abc123"
  guard={{
    file: "src/pages/index.tsx",
    tagName: "h1",
    contentKey: "home.hero.title",
    sourceKind: "content-key"
  }}
>
  {home.hero.title}
</FormattedBoundText>
```

For template keys, v1 should still block loop-rendered instances unless the implementation can prove a non-loop single instance. Template-level and per-item formatting are future work. The runtime and Hover Bar must also block elements when the rendered DOM contains multiple nodes with the same source identity, because not every loop shape is statically obvious to the source mapper.

When loop support is needed, the path forward is a per-app item-identity schema, not a stronger expression hash. Per-item formatting needs a durable answer to "which item in which collection is this?", for example a content id derived from a declared identity field. The sidecar shape remains compatible with that direction because future targets can re-key from structural `data-dev-id` to content identity while preserving guarded mark entries.

## Runtime Loading

Store sidecar data under an app-root directory:

```text
format-overrides/
  pages/
    index.json
    about.json
  shared.json
```

Scope derivation is based on normalized source file path:

- `src/pages/index.tsx` maps to `format-overrides/pages/index.json`.
- `src/pages/about.tsx` maps to `format-overrides/pages/about.json`.
- `src/pages/home.tsx` maps to `format-overrides/pages/home.json`; it must not share a scope with `src/pages/index.tsx`.
- Nested page files preserve their directory and keep `index` as the leaf, for example `src/pages/blog/index.tsx` maps to `format-overrides/pages/blog/index.json`.
- Any source file outside `src/pages/` maps to `format-overrides/shared.json`.
- Unsafe or unrecognized page path segments do not become filesystem paths; they fall back to `shared.json`.

The source mapper/runtime and agents service must derive the same scope key from the same `target.file`. A single pure utility is preferred, but generated v8 apps cannot assume unpublished workspace packages: `app-templates/v8` is excluded from the root pnpm workspace and does not currently depend on `@airo/shared`. If implementation moves this helper into a shared package, it must also make that package resolvable for generated app runtimes. Without that packaging change, duplicated helpers must carry paired comments and representative tests on both sides.

Expose it to the v8 runtime through a Vite virtual module, for example `virtual:format-overrides`. The virtual module should:

- Read every JSON sidecar under `format-overrides/`.
- Return an empty v1 bundle when the directory or an individual scoped file is missing.
- Watch the directory in dev so Vite HMR re-renders formatted text after an edit, add, or delete.
- Embed the current sidecar bundle during production builds.

This avoids a runtime network fetch and gives a clear publish/export story:

- Full-source downloads include `format-overrides/` as committed source files.
- Dist-only publish includes the sidecar data because the virtual module is bundled into the client and SSR build.
- Archive tests should verify that a built app with overrides renders the formatting after dist-only packaging.

For v1, a full page reload after sidecar changes is acceptable if module-level HMR is awkward. The important contract is that a sidecar write causes the preview to re-render from the latest `format-overrides/` contents; softer HMR can be optimized later.

## Sidecar Schema

Each scoped sidecar JSON file should use the same explicit and versioned shape:

```json
{
  "version": 1,
  "overrides": {
    "abc123": {
      "target": {
        "file": "src/pages/index.tsx",
        "tagName": "h1",
        "sourceKind": "bound-expression",
        "contentKey": null,
        "contentKeyTemplate": null,
        "expressionHash": "sha256:..."
      },
      "marks": {
        "bold": true,
        "italic": false,
        "color": "#1f2937"
      },
      "updatedAt": "2026-05-27T12:00:00.000Z"
    }
  }
}
```

The virtual module should aggregate those files into a runtime bundle keyed by source scope:

```json
{
  "version": 1,
  "scopes": {
    "pages/index": {
      "version": 1,
      "overrides": {}
    },
    "shared": {
      "version": 1,
      "overrides": {}
    }
  }
}
```

Rules:

- `version` is required.
- `overrides` is keyed by `data-dev-id`.
- The sidecar file path is derived from `target.file`; clients do not send arbitrary sidecar paths.
- `target.file`, `target.tagName`, and `target.sourceKind` are required.
- `target.contentKey` or `target.contentKeyTemplate` is preferred when present.
- `target.expressionHash` is required for generic bound expressions.
- `target.expressionHash` must use the canonical `sha256:<64 lowercase hex>` shape produced by the source mapper.
- `marks` is sanitized to the v1 mark set: `bold`, `italic`, and `color`.
- Empty or default marks remove the override entry.

The Jira ticket described sanitizing to Lexical's mark set. V1 intentionally supports only the formatting controls currently exposed for this path: bold, italic, and text color. Underline, strikethrough, subscript, superscript, range marks, text size, alignment, and list formatting remain out of scope until the UI and persistence contracts exist for bound text.

The literal-text path may continue mutating Tailwind classes or inline styles through `STYLE_UPDATED`. Bound-text formatting renders inline styles on the runtime wrapper instead. That keeps the original JSX source untouched and avoids relying on Tailwind classes that would be generated dynamically from sidecar JSON after build-time class extraction.

`FormattedBoundText` renders a `<span>` when marks apply. The v1 supported parent tags all accept phrasing content, so this is valid for text-valued expressions. Expressions that directly return JSX fragments/elements should be skipped by the source mapper; expressions that only prove their text-ness at runtime are a known v1 limitation.

## Guard Validation

The runtime applies an override only if all relevant guard fields still match the current element.

Required checks:

- `data-dev-id` matches the sidecar key.
- Current source file matches `target.file`.
- Current tag name matches `target.tagName`.
- Current source kind matches `target.sourceKind`.
- If `contentKey` is present, current `data-dev-content-key` matches.
- If `contentKeyTemplate` is present, current `data-dev-content-key-template` matches.
- If `expressionHash` is present, current expression hash matches.

This prevents stale formatting from applying when a different element moves into the same structural location.

If an override is missing, invalid, or guard-mismatched, `FormattedBoundText` renders children unchanged. In development, it should emit a warning for guard mismatches so we can diagnose sidecar drift. It should not warn for a normal missing override.

## Hover Bar Behavior

`ElementHoverBar` should distinguish three text states:

1. Literal/editable text: existing `TEXT_UPDATED` and `STYLE_UPDATED` behavior remains.
2. Content-key editable text: existing content edit behavior remains.
3. Bound-text format eligible: content editing stays blocked, but whole-expression formatting buttons are available.

For bound-text format eligible elements:

- Bold, italic, and color buttons post a new message, conceptually `FORMAT_OVERRIDE_UPDATED`.
- The message includes `devId`, guard metadata, and sanitized marks.
- The builder page forwards the request to a new agents route.
- The agents route derives the scoped sidecar file from `target.file`, updates that file, and creates the normal per-app git commit.
- The iframe receives success/failure, correlated with a commit/action id like the style edit path.
- The color button should reuse the same small swatch presentation as the existing text-color control; only the persistence behavior differs.

Do not reuse `CONTENT_UPDATED`. Do not send `STYLE_UPDATED` for this path.

## Endpoint

Add an agents endpoint conceptually shaped as:

```text
POST /apps/:id/format-overrides
```

Request:

```ts
interface FormatOverrideUpdateRequest {
  commitId?: string;
  devId: string;
  target: {
    file: string;
    tagName: string;
    sourceKind: "bound-expression" | "content-key" | "content-key-template";
    contentKey?: string | null;
    contentKeyTemplate?: string | null;
    expressionHash?: string | null;
  };
  marks: {
    bold?: boolean;
    italic?: boolean;
    color?: string | null;
  };
}
```

Response:

```ts
interface FormatOverrideUpdateResponse {
  success: boolean;
  commitHash?: string;
  removed?: boolean;
  error?: string;
}
```

The agents route does not need to echo `commitId` in this HTTP response. The builder page already has the request's `commitId` and should echo it in the iframe success/failure message, matching the current `STYLE_UPDATED` convention.

Validation:

- Reject missing `devId`.
- Reject missing required target fields.
- Reject unknown source kinds.
- Reject unsupported marks.
- Reject unsafe colors. V1 should accept normalized hex values only.
- Derive the sidecar file from `target.file`; never accept a client-provided file path for sidecar storage.
- Treat empty/default marks as a removal for that `devId`.

The route should preserve unrelated overrides in the same scoped file and write stable formatted JSON. If removing an entry leaves a scoped sidecar empty, the service should delete that sidecar file instead of committing an empty file.

## Loop-Rendered Blocking

Loop-rendered elements are blocked in v1.

The current Hover Bar already detects duplicate `data-dev-id` plus `data-dev-line` pairs for style controls. The implementation should reuse or extract that idea for bound-text formatting eligibility.

When an eligible-looking bound-text element is loop-rendered:

- The Hover Bar should not show the format-override path.
- The runtime should not apply per-item sidecar formatting.
- No "format all repeated items" fallback should happen silently.

Future options:

- Per-item formatting with stable item IDs from the content/data model.
- Template-level formatting that intentionally applies to every repeated instance.

Both are out of scope for v1.

## Orphans And Drift

`data-dev-id` can drift because it is derived from JSX structure. If source order changes, the same bound expression may receive a new ID. A different element may also move into the old structural location and receive the old ID.

V1 handles this by guarded application, not cleanup:

- Missing sidecar key: render normally.
- Missing DOM element for an override: ignore the sidecar entry.
- Matching `data-dev-id` but guard mismatch: render normally and warn in development.
- User clears formatting on a currently matched element: remove that entry.
- No automatic pruning of unseen entries.
- No remapping or healing pass.

This avoids deleting valid overrides for routes or components that are not currently rendered.

Per-page files make later cleanup narrower. A future cleanup pass can rescan one page source file and prune only that page's sidecar, or delete `format-overrides/pages/<page>.json` when the corresponding `src/pages/<page>.tsx` file is removed. Shared cleanup still requires more care because `shared.json` can contain layout and component overrides rendered across multiple routes.

## Error Handling

Client-side optimistic formatting should roll back when the agent route fails.

Failure cases:

- Sidecar write fails.
- JSON parse or schema validation fails.
- Guard metadata is invalid.
- Unsupported mark is requested.
- Color sanitization fails.

Runtime rendering should be fail-open: if the sidecar cannot be loaded or parsed, render unformatted children and warn in development.

Invalid or future-version scoped sidecar files should be treated as empty v1 sidecars, with a development warning for that scope. The runtime should not attempt to heal, migrate, or prune the file in v1.

## Testing

Source mapper tests:

- Marks a single generic bound expression as bound-text format eligible.
- Adds expression hash metadata for generic bound expressions.
- Adds content-key guard metadata for `virtual:content` expressions.
- Does not mark literal text as bound-text format eligible.
- Does not mark mixed children in v1.
- Does not mark unsupported tags.
- Does not mark direct JSX or fragment expression children.
- Keeps bound-text wrapping available in production builds while omitting dev-only `data-dev-*` attributes.

Runtime wrapper tests:

- Applies bold, italic, and color when `devId` and guard metadata match.
- Renders unchanged when no override exists.
- Renders unchanged and warns in dev when guard metadata mismatches.
- Renders unchanged when the sidecar is missing or malformed.
- Removes unsupported mark keys during sanitization.

Hover Bar tests:

- Shows whole-expression formatting controls for eligible non-loop bound text.
- Keeps content editing blocked for bound text.
- Sends `FORMAT_OVERRIDE_UPDATED`, not `STYLE_UPDATED` or `CONTENT_UPDATED`.
- Rolls back optimistic formatting on failure.
- Blocks loop-rendered bound text and includes an explicit regression test for duplicate `data-dev-id` / `data-dev-line` rendered nodes.
- Documents that duplicate-node loop detection cannot catch empty loops or loops with only one rendered item.

Endpoint tests:

- Creates the correct scoped sidecar file when missing.
- Writes `src/pages/index.tsx` overrides to `format-overrides/pages/index.json`.
- Keeps `src/pages/index.tsx` and `src/pages/home.tsx` in distinct scoped sidecar files.
- Writes non-page overrides to `format-overrides/shared.json`.
- Adds an override.
- Updates an existing override.
- Removes an override when marks are empty/default.
- Deletes an empty scoped sidecar after removing its last override.
- Preserves unrelated override entries.
- Rejects invalid colors and unsupported marks.
- Rejects invalid expression hashes.
- Treats missing, malformed, or non-v1 sidecars as empty.
- Skips writes and commits when the normalized payload is unchanged.
- Writes stable JSON.
- Produces a per-app commit.

Publish/export tests:

- Full-source export includes `format-overrides/`.
- Dist-only publish renders formatted bound text from the bundled virtual module.
- A build with no sidecar directory still succeeds and renders unformatted text.

## Follow-up Implementation Tickets

1. Source-mapper eligibility and `FormattedBoundText` wrapper insertion.
2. `virtual:format-overrides` loader plus runtime wrapper.
3. Builder and agents message/route plumbing for `FORMAT_OVERRIDE_UPDATED`.
4. Hover Bar gating and loop-rendered blocking.
5. Publish/export regression coverage.
