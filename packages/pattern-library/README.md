# @airo-ux/pattern-library

Airo's component library for AI-powered conversational and generative UI,
built on GoDaddy UXCore2 (Antares).

- One npm package, many components, addressed by **subpath exports**:
  `import { Thinker } from '@airo-ux/pattern-library/chat/thinker';`
- Theming via `@ux/tailwind-intents` — no hardcoded colors.
- React 18, ESM + CJS + CSS via [`tsup`](https://tsup.egoist.dev/);
  `.d.ts` declarations via `tsc -p tsconfig.build.json`.

## Quick start

```bash
npm install @airo-ux/pattern-library \
  @ux/box @ux/button @ux/intents @ux/text-lockup \
  react react-dom
```

```tsx
import { Thinker } from '@airo-ux/pattern-library/chat/thinker';
import '@airo-ux/pattern-library/chat/thinker/styles';

export function Loading() {
  return <Thinker label="Generating your logo ideas..." />;
}
```

With the optional reasoning panel:

```tsx
<Thinker defaultOpen label="Thinking through your request">
  <Thinker.Reasoning>
    {reasoningStream}
  </Thinker.Reasoning>
</Thinker>
```

## Required setup for consumers

- A tailwind pipeline that includes `@ux/tailwind-intents/plugin`.
- Theme CSS generated via the GoDaddy Theme API
  (`https://theme-api.uxp.godaddy.com/v1/generate?alias=<theme>`) imported
  once at the app root. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
  canonical setup.

## Developing locally

```bash
nvm use                # Node 22 (see .nvmrc)
npm install            # needs GD Artifactory access (see .npmrc)
npm run storybook      # localhost:6006
npm run test:watch
npm run build          # produces dist/
```

All commands verified in `package.json#scripts`. See
[`AGENTS.md`](AGENTS.md) for the full command table.

## Storybook

The `main` Storybook is published to GitHub Pages by
[`storybook-publish.yml`](.github/workflows/storybook-publish.yml) —
it runs on pushes to `main` that touch Storybook inputs (`src/**`,
`.storybook/**`, `public/**`, the Tailwind/PostCSS/TS config, the
lockfile, `.nvmrc`, `.npmrc.gha`, or the workflow itself). The URL is:

```
https://gdcorp-ux.github.io/airo-components/
```

Every open PR also gets its own live preview at
`https://gdcorp-ux.github.io/airo-components/pr-<N>/` — the
[`storybook-preview.yml`](.github/workflows/storybook-preview.yml)
workflow builds the preview on every push and leaves a comment on the
PR with the URL. Previews are removed when the PR closes.

## AI editor setup (MCP)

This repo publishes a **codex** — a machine-readable description of every
component, its props, examples, and gotchas — to:

```
https://gdcorp-ux.github.io/airo-components/codex.json
```

It's regenerated and redeployed on every push to `main`. Point any
MCP-capable editor (Cursor, Claude Desktop, Windsurf, Zed, Cline, …) at that
URL and AI agents can query `@airo-ux/pattern-library` APIs directly instead of
guessing.

### Copy-paste config

Drop this into your editor's MCP config file:

```json
{
  "mcpServers": {
    "airo-components": {
      "command": "npx",
      "args": [
        "@ux/aichemy",
        "mcp",
        "https://gdcorp-ux.github.io/airo-components/codex.json",
        "--refresh-interval",
        "30"
      ]
    }
  }
}
```


| Editor                   | Config path                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| Cursor (project)         | `./.cursor/mcp.json`                                              |
| Cursor (user)            | `~/.cursor/mcp.json`                                              |
| Claude Desktop (macOS)   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json`                     |
| Windsurf                 | `~/.codeium/windsurf/mcp_config.json`                             |
| Zed                      | `~/.config/zed/settings.json` (under `context_servers`)           |
| Cline (VS Code)          | `~/.vscode/cline_mcp_settings.json`                               |


Claude Desktop and Windsurf need an app restart after editing. Cursor picks up
changes via **Settings → MCP → Refresh**.

Once connected, your editor exposes `list_codexes`, `list_components`,
`search_components`, and `get_component` — the standard MCP tool surface. The
server polls the URL every `--refresh-interval` minutes (ETag-conditional), so
new components land in your editor automatically after a merge to `main`.

**Troubleshooting.** If you ever see `Could not load codex from package …`,
wipe the Aichemy package store:

```bash
npx @ux/aichemy clean
```

Then restart the editor.

See [`codex/README.md`](codex/README.md) for how the codex is generated and
the contributor-mode variant (local file instead of URL).

## Package layout

```
src/
└── chat/
    └── thinker/          # @airo-ux/pattern-library/chat/thinker
        ├── index.ts
        ├── Thinker.tsx
        ├── ThinkerReasoning.tsx
        ├── styles.css
        ├── Thinker.stories.tsx
        └── __tests__/Thinker.test.tsx
```

Every component folder is a subpath. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the recipe to add a new one.

## Further reading

- [`AGENTS.md`](AGENTS.md) — how agents (and humans) work in this repo.
- [`.agents/skills/review/SKILL.md`](.agents/skills/review/SKILL.md) —
  what PRs are reviewed for, applied by local agents (Cursor, Claude,
  Codex) and by GitHub Copilot Code Review.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — add-a-component recipe and
  auto-review / auto-merge docs.
- `.cursor/rules/` — inline rules for AI assistants.

