# Reference Tool Design

**Date:** 2026-06-22
**Status:** Approved (design)
**Supersedes:** the in-app reference-docs approach on branch `jeichorn/deep-build-reference-docs` (docs shipped in the v8 template + distributed via `SYNC_MANIFEST`).

## Problem

The v8 template reference docs (`summary.md`, `routing.md`, `api.md`, `layouts.md`, `components.md`, `media-slots.md`, `tech-stack.md`) are consumed exclusively by the agent: `resolveTemplateContext` (`agents/src/agents/template-context.ts`) reads them and injects them into sub-agent system prompts as "Reference Documentation (Ground Truth)".

They currently live in `app-templates/v8/docs/reference/` and are copied into each customer app via `SYNC_MANIFEST` in `container-scripts/preview/sync-template-files.js`. `resolveTemplateContext` reads them from the customer app workspace (`appPath`) because that is the only location the agents service can see at runtime.

This in-app placement has structural costs:

- **Drift:** the docs sit in the agent's editable workspace; an agent edit changes the ground-truth the next agent reads.
- **Stale existing apps:** manifest entries are `force: false` create-on-first-sync. Once an app has a file, it never receives a corrected version unless its MD5 matches a `known_hashes` entry — so corrections rarely reach existing apps.
- **`known_hashes` maintenance:** every edit to a manifest-tracked doc requires adding the prior hash (enforced by a pre-commit hook).
- **Repo/archive bloat:** the docs are copied into every customer repo though nothing in the app runtime reads them.

The docs are agent prompt-context. Their canonical home should be the agent, not the customer app.

## Goals

- Single, versioned, read-only source of truth for reference docs that the agent cannot mutate.
- Eliminate per-app copies, `known_hashes` maintenance, and create-on-first-sync staleness.
- Preserve the existing two-tier consumption: inject a lightweight index into the prompt, fetch detail on demand.
- Provide a **general** reference-retrieval capability (read/list/search across named corpora) so future curated corpora can register without changing the tool — while registering only the template-docs corpus now.

## Non-goals

- Semantic/embedding search (lexical only in v1).
- Building any corpus beyond `template-v8`.
- Backing a corpus by anything other than a filesystem directory in v1.
- Deleting orphaned reference-doc copies from already-synced customer apps (see Migration).

## Decisions

| Fork | Decision |
|---|---|
| Generalization scope | General multi-corpus tool with a registry; register only `template-v8` now. |
| Index ownership | `resolveTemplateContext` keeps injecting the index (summary/listing) into the prompt; the tool serves detail (list/read/search). |
| Corpus model | Filesystem-backed registered base directory: `{ id, baseDir, description }`. |
| Search semantics | Lexical (case-insensitive substring/keyword) over headings + body. |
| Corpus home | Move the corpus into the agents package; tool + injection both read from there. Stop syncing into customer apps. |
| Tool surface | A single `reference` tool with an `operation` enum (not three tools). |
| Current PR | Retarget this branch to the new design; drop the `SYNC_MANIFEST` additions (option (b)). |

## Architecture

### New module: `agents/src/reference/`

- **`corpus-registry.ts`** — maps `corpusId → { id, baseDir, description }`. One entry registered now:
  `template-v8 → <agents>/src/reference/corpora/template-v8/`.
  `baseDir` is resolved relative to the module source (the same approach `getModularPromptPaths` uses for `initial/templates`), so it works both in `src/` and the built runtime image.
- **`corpora/template-v8/`** — the relocated reference docs. This is the canonical home; the files leave `app-templates/v8/docs/reference/`.
- **Resolution rule:** both the tool and `resolveTemplateContext` resolve files through the registry's `baseDir`. Neither reads from `appPath`.

### Build / packaging

The corpus is `.md` resources. The build must include them in the agents runtime image (copy to `dist/` or read via a source-relative resolved path, consistent with how `initial/templates` markdown is already shipped). The implementation plan must verify the chosen mechanism actually resolves in the deployed image, not just in `src/` during tests.

## Tool API

Single tool `reference`, registered in `agents/src/tools/ai-lib-tools/index.ts`, built with `createTool` + Zod (matching existing tools).

```
reference({ operation, corpus?, path?, query? })
```

| operation | params | returns |
|---|---|---|
| `list` | `corpus?` (default `template-v8`) | `Array<{ path, title }>` for every `.md` in the corpus (`title` = first `#` heading) |
| `read` | `corpus?`, `path` (required) | full markdown content of the file |
| `search` | `corpus?`, `query` (required) | `Array<{ path, title, snippets: string[] }>` — case-insensitive substring match over headings + body; snippet = matched line/section |

### Ergonomics

- `corpus` defaults to `template-v8` so single-corpus callers can omit it; keeping it as a (defaulted) parameter is forward-compatible when more corpora register.
- `path` is corpus-relative (e.g. `routing.md`), resolved under `baseDir`.

### Safety (read-only)

- No write operation; no arbitrary-FS listing.
- `path` validation mirrors `show-doc.ts`: non-empty, not absolute, no `..` traversal, must end with `.md`, and the resolved real path must be contained within the corpus `baseDir`.
- Unknown `corpus` or missing `path` → structured error result (matching existing tool error style), not an unhandled throw.
- Return shape is plain JSON for model consumption (unlike `showDoc`, which is a UI-presentation tool).

## Integration

### Sub-agents

| Sub-agent | Injected index (unchanged) | Gets `reference` tool |
|---|---|---|
| planning | `summary` | yes |
| builder | `summary` | yes |
| discovery | `listing` | yes |
| media | `files` (full content of `media-slots.md`) | yes (can pull other docs) |
| design | `none` | no |

### `resolveTemplateContext` changes

- Drop the `appPath` argument; add `corpusId` (default `template-v8`). Read the index from the registry corpus.
- `summary` / `listing` / `files` modes all resolve under the corpus `baseDir`.
- Keep the `FileOps` injection seam for testability (it now points at the corpus dir).

### Index rewording

`summary.md`'s "Reference Files" section and the `listing` output change from
*"read the specific files in this directory"* to
*"call the `reference` tool: `read('routing.md')`, or `search('…')`"*.
This is the one behavioral nudge that makes the two-tier flow work without `appPath`.

## Migration

1. Move the 7 docs from `app-templates/v8/docs/reference/` to `agents/src/reference/corpora/template-v8/`.
2. Remove the 7 `docs/reference/*` entries from `SYNC_MANIFEST` (`container-scripts/preview/sync-template-files.js`). This also removes the `known_hashes` obligation for them.
3. Switch `resolveTemplateContext` and all sub-agent call sites to the registry; reword the index.
4. Add the `reference` tool and register it for planning/builder/discovery/media.
5. Orphaned copies in already-synced customer apps: **leave them.** After the resolver switch, nothing reads `appPath/docs/reference`, so they are inert. A deletion migration is out of scope (it would touch customer repos for no functional gain).
6. Keep the `seo-routes.ts` synchronizer header fix already on this branch — it concerns a real template **source** file (`seo-routes.ts`), not reference docs, and is independent of this change.

### Branch handling (option (b))

This branch (`jeichorn/deep-build-reference-docs`) is retargeted to the new design. The `SYNC_MANIFEST` additions and the `app-templates/v8/docs/reference/` files added by the prior commit are removed/relocated as part of this work, rather than landing the in-app approach and reworking it later.

## Testing

- **Registry:** resolves `template-v8` `baseDir`; unknown corpus errors cleanly.
- **Path safety:** rejects absolute paths, `..` traversal, non-`.md`, and paths resolving outside `baseDir`.
- **Operations:** `list` returns all fixture docs with titles; `read` returns content for a valid path and errors for a missing one; `search` finds a known substring across headings + body and returns snippets.
- **`resolveTemplateContext`:** reads index from the registry, not `appPath`; `summary`/`listing`/`files` modes each produce expected content from a fixture corpus.
- **Sub-agent wiring:** at least one sub-agent config asserts the `reference` tool is present; `design` asserts it is absent.

## Risks / open items for the plan

- **Packaging:** confirm `.md` corpus files ship in the deployed agents image and resolve at runtime (not only under `src/` in tests). This is the primary implementation risk.
- **Tool adoption:** the reworded index is the only nudge to call the tool; if sub-agents under-use it, consider strengthening the prompt wording (not adding mandatory tool round-trips).
