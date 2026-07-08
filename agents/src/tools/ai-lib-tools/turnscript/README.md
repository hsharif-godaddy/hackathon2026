# Turnscript

Turnscript replaces many discrete tool calls with **one batched orchestration call**. When it is
active, the model authors a single script against a typed `turnscript.*` API and the whole
discovery + edit sequence runs inside the customer preview container — the individual tool calls
never appear in the conversation stream.

**If you build anything that observes tool calls (UI renderers, side-effect hooks, analytics,
tests), read [What changes for observers](#what-changes-for-observers) — this is the section
people get burned by.**

## When is it active?

Off by default, everywhere. Resolved per-shopper by `resolveTurnscriptEnabled`
(`agents/src/agents/turnscript-context.ts`):

| Layer | Enable via | Default |
| --- | --- | --- |
| L1 enable | Switchboard flag `appbuilder-turnscript` OR env `TURNSCRIPT_ENABLED=true` | off |
| L2 restrict | Switchboard flag `appbuilder-turnscript-tla-only` OR env `TURNSCRIPT_TLA_ONLY=true` → TLA (internal) shoppers only | off |

Fail-safe: with no flags and no env, turnscript stays off (unconfigured/unreachable Switchboard
resolves to `false`). It is wired into **DevelopAgent only** (`agents/src/agents/develop-agent.ts`).

## What changes for observers

With turnscript **off**, a build turn emits visible calls like `readFile`, `grepSearch`,
`directoryListing`, and `str_replace_based_edit_tool` — one per operation.

With turnscript **on**, those same operations run inside a single opaque `turnscript` tool call.
The subset it batches (see `SUBSET_SCHEMAS` in `turnscript-tool.ts`): `readFile`, `grepSearch`,
`directoryListing`, `str_replace_based_edit_tool` (view / str_replace / create / insert).
Other tools (`content_scaffold`, `todoList`, `askQuestion`, media, …) still surface as normal
standalone calls.

**The rule: any logic keyed on tool-call names must handle the turnscript case.** Grep
`app/src` for `str_replace_based_edit_tool` / `FILE_EDIT_TOOLS` / `FILE_OPERATION_TOOLS` to see
the affected class — e.g. `useInitialization.ts` (first-build overlay dismissal),
`toolSideEffects.ts`, `mutatesFiles.ts`, tool renderers. Case study: the first-build overlay
hung for ~10 minutes on turnscript builds because the `src/pages/index` write it dismisses on
was hidden inside the batch.

To make edits observable, the tool result ends with a trailer listing the files the run wrote:

```
[turnscript:edited] src/pages/index.tsx, src/components/Hero.tsx
```

The client parses this with `parseTurnscriptEditedPaths`
(`app/src/app/[market]/develop/hooks/useInitialization.ts`), and `getEditPaths` routes
`turnscript` tool calls to it. Successful writes only (reads/views and failed writes are
excluded), deduped, present even when the script itself fails partway.

## How it works (one paragraph)

The model's script is TS-stripped, prepended with the in-container shim (which re-implements the
four subset tools with ported edit guards), staged under `.airo/` in the workspace, and run via
the production `/exec` path inside the preview container sandbox. The shim prints a base64 result
envelope across `__TURNSCRIPT_CHUNK` stdout lines, which is reassembled, validated, and rendered
into the model-facing summary text.

| File | Role |
| --- | --- |
| `turnscript-tool.ts` | Tool definition, result formatting, failure classification |
| `runner.ts` | TS-strip, stage, execute in-container, parse/validate envelope |
| `runtime/shim.mjs` | In-container `turnscript.*` API + edit guards + envelope emit |
| `executor.ts` | Shared result/telemetry types (`TurnscriptResult`, `DispatchRecord`) |
| `type-gen.ts` | Generates the typed `turnscript.*` surface the model codes against |
| `agents/src/agents/turnscript-context.ts` | Enablement gate (`resolveTurnscriptEnabled`) |

## Contracts — do not break these

- **The tool returns a plain string.** `develop-agent.ts` gates its failure fallback on
  `typeof result === 'string' && turnscriptReportedFailure(result)`. Returning an object
  silently disables the fallback.
- **`[turnscript:edited]` is a cross-boundary contract.** The marker in
  `formatTurnscriptResult` must stay in sync with `parseTurnscriptEditedPaths` in the app. It is
  appended *after* the 8000-char body slice so the body cap cannot swallow it (the path list
  itself is capped at 2000 chars), and it deliberately avoids the three failure prefixes that
  `turnscriptReportedFailure` matches: `[turnscript failed:`, `[turnscript runtime error]`,
  `[turnscript error`.
- **Failure fallback ("admit"):** when a run reports **any** failure — anything
  `turnscriptReportedFailure` matches, i.e. every kind except `result_unreadable` — the develop
  agent admits the direct tools (`readFile`, `grepSearch`, `str_replace_based_edit_tool`, …) for
  the rest of the conversation, so a turnscript failure degrades to the classic flow instead of
  looping. `RECOVERABLE_FAILURE_KINDS` does **not** gate the admit — it only selects the
  "don't rewrite, finish with direct tools" advisory text in the result.
- **`result_unreadable` is deliberately non-recoverable (and non-admitting).** It means the
  script ran (edits likely applied) but the result transport was truncated — re-running could
  double-apply edits; its wording intentionally dodges the failure prefixes above.
- **The envelope is model-controlled input.** `runner.ts` shape-validates `failureKind`,
  `dispatches`, and `editedPaths` rather than trusting them; keep that posture for new fields.

Tests live in `__tests__/` (shim smoke tests run the real shim under `node` against a temp
workspace). CI scans **every non-test `.ts` file** under `agents/src/tools` — code, comments,
and description strings alike — with `scripts/check-tools-security.js`; avoid the literal
`child_process` (and bare `.exec(`/`.spawn(` forms) anywhere in them. `runtime/shim.mjs` is
`.mjs` and outside the scan, which is why the shim itself may import `node:child_process`.
