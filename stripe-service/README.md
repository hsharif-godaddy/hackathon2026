# stripe-service

Katana-hosted Go service for the Airo Builder Stripe integration. Owns: platform Stripe secret
key access (Secrets Manager), Stripe webhook receive + signature verify + idempotency, claimable
sandbox + live-key provisioning on behalf of per-app agents, RSA managed-key decrypt via KMS.

One deployment per Airo env (dev / test / prod). Katana app: `airo-builder-stripe-service`.
Go module: `github.com/gdcorp-partners/airo-app-builder/stripe-service`.

## Status

**Walking skeleton.** Only `/health` is implemented. No Stripe SDK, no AWS SDK, no auth middleware,
no DynamoDB yet. This PR's purpose is to prove the Go CI/CD chain — container builds, artifact
publishes to Katana, service runs on ECS Fargate, ALB healthcheck passes.

Next PRs:

1. CDK stack: DynamoDB (`stripe_sandboxes`, `stripe_events`), KMS RSA CMK, Secrets Manager entry.
2. Auth middleware + TLS (mirroring `budget-service`: `gd-auth` + self-signed backend cert).
3. Stripe webhook endpoint + signature verification.
4. Agent-facing REST endpoints (`POST /v1/sandboxes`, `GET /v1/status`, `GET /v1/sandbox/:id/mcp-key`).
5. KMS decrypt + Managed API Keys flow.
6. mhp-airo callout (awsiam JWT) for alloc env rotation.

## Local dev

```bash
make dev                           # go run ./cmd/server, debug logs, text format
make test                          # go test -race ./...
make lint                          # go vet + gofmt check
make build                         # builds bin/stripe-service
curl http://localhost:8443/health  # sanity check
```

## Env vars

| Var                    | Default | Purpose                                              |
| ---------------------- | ------- | ---------------------------------------------------- |
| `STRIPE_SERVICE_ADDR`  | `:8443` | Listen address.                                      |
| `SERVER_CERT_PATH`     | *unset* | TLS cert path. Both cert and key must be set or neither. Container image sets both; local dev serves plain HTTP. |
| `SERVER_KEY_PATH`      | *unset* | TLS key path.                                        |
| `ENVIRONMENT`          | `local` | `local` \| `dev` \| `test` \| `prod`. Surfaced in `/health`. |
| `LOG_LEVEL`            | `info`  | `debug` \| `info` \| `warn` \| `error`.              |
| `LOG_FORMAT`           | `json`  | `json` (structured) or `text` (human).               |
| `HTTP_READ_TIMEOUT`    | `30s`   | Go-duration format.                                  |
| `HTTP_WRITE_TIMEOUT`   | `60s`   | Go-duration format.                                  |
| `HTTP_IDLE_TIMEOUT`    | `120s`  | Go-duration format.                                  |
| `SHUTDOWN_TIMEOUT`     | `15s`   | Max time to drain in-flight requests on SIGTERM.     |
