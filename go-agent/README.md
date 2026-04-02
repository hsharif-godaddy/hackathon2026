# go-agent

**Research project — not used in production.**

Experimental Go rewrite of the TypeScript agents service, exploring solutions to memory spikes, observability gaps, and WebSocket/business logic coupling. See the [design doc](../docs/plans/2026-03-06-go-agent-design.md) for details.

## Running with TS Bridge

The Go agent automatically starts the TS bridge subprocess for legacy TypeScript tools.

### Prerequisites

- `pnpm install` from repo root
- `pnpm --filter @airo/agents run build:deps` (builds shared packages the bridge imports)

### Quick start

```bash
make dev    # Builds go-agent and starts with TS bridge
```

### Environment variables

| Variable                | Default                 | Description                         |
| ----------------------- | ----------------------- | ----------------------------------- |
| `TS_BRIDGE_DIR`         | `../ts-bridge`          | Path to ts-bridge package directory |
| `TS_BRIDGE_SOCKET_PATH` | `/tmp/ts-bridge.sock`   | Unix socket path                    |
| `DB_PATH`               | same as `DATABASE_PATH` | SQLite database for TS tools        |

## Commands

```bash
make build    # Build binary to dist/
make dev      # Build and run with TS bridge
make test     # Run tests with race detector
make lint     # golangci-lint
make check    # All checks (fmt, vet, lint, test)
```
