# go-agent

**Research project — not used in production.**

Experimental Go rewrite of the TypeScript agents service, exploring solutions to memory spikes, observability gaps, and WebSocket/business logic coupling. See the [design doc](../docs/plans/2026-03-06-go-agent-design.md) for details.

## Commands

```bash
make build    # Build binary to dist/
make test     # Run tests with race detector
make lint     # golangci-lint
make check    # All checks (fmt, vet, lint, test)
```
