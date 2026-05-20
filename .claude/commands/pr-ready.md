Run the full PR readiness check sequence. For each step, report pass/fail:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm build`

If any step fails, stop and report the errors with enough context to fix them. For Go services (dev-supervisor, local-control-plane, go-agent), also run `make check` if files in those directories were modified.
