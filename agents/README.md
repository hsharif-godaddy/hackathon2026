# @airo/agents

Express API service providing AI agent orchestration, app lifecycle management, WebSocket streaming, and SQLite persistence. Runs on port 4000.

## Quick Start

```bash
# From repo root
corepack enable
pnpm install
pnpm run dev          # TUI with all services (agents, app, control plane)
```

Or run agents alone:

```bash
pnpm run dev:agents
```

## Testing

Uses Vitest (not Jest).

```bash
pnpm --filter @airo/agents test:unit              # All unit tests
pnpm --filter @airo/agents test:unit "pattern"     # Filter by file path
pnpm --filter @airo/agents test:unit -t "test name" # Filter by test name
pnpm --filter @airo/agents test:integration        # Integration tests (need running services)
```

## Environment

Run `pnpm run dev` from the repo root — preflight checks will generate `agents/.env` automatically. See `agents/.env.example` for available variables.

## Reference

See [agents/CLAUDE.md](CLAUDE.md) for detailed documentation covering agent selection, prompt composition, tool system, database schema, observability, and security.
