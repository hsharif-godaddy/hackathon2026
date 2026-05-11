# stripe-service

Katana-hosted Go service for the Airo Builder Stripe integration. Owns: platform Stripe secret
key access (Secrets Manager), Stripe webhook receive + signature verify + idempotency, claimable
sandbox + live-key provisioning on behalf of per-app agents, RSA managed-key decrypt via KMS.

One deployment per Airo env (dev / test / prod). Katana app: `airo-builder-stripe-service`.
Go module: `github.com/gdcorp-partners/airo-app-builder/stripe-service`.

## Status

Implemented: `/health` (public liveness) and `/v1/_probe` (public diagnostic —
exercises read-only IAM grants against the CDK-provisioned resources). AWS SDK
v2 clients for DynamoDB / Secrets Manager / KMS are wired. No Stripe SDK, no
auth middleware, no real handler bodies yet.

Next PRs:

1. Auth middleware (mirroring `knowledge-service` / `budget-service`: `gd-auth`).
2. Stripe webhook endpoint + signature verification.
3. Agent-facing REST endpoints (`POST /v1/sandboxes`, `GET /v1/status`, `GET /v1/sandbox/:id/mcp-key`).
4. KMS decrypt + Managed API Keys flow.
5. mhp-airo callout (awsiam JWT) for alloc env rotation.

## Local dev

```bash
make dev                           # go run ./cmd/server, debug logs, text format
make test                          # go test -race ./...
make lint                          # go vet + gofmt check
make build                         # builds bin/stripe-service
curl http://localhost:8443/health  # sanity check
```

### Diagnostic probe

`GET /v1/_probe` runs a zero-side-effect `Describe*` call against each backing
AWS resource provisioned by `AiroStripeServiceStack` (2 DynamoDB tables, 2
Secrets Manager secrets, 1 KMS CMK alias) and returns either
`200 {"status":"ok", checks:[...]}` if all pass or
`503 {"status":"error", checks:[...]}` if any fail. In non-prod envs each
failed check's `error` field contains the raw AWS error for quick triage; in
prod this is masked to `"describe failed"` so ARNs and backend error text
don't leak. Used as a post-deploy smoke check for IAM grants. Unauthenticated
today — follow-up PR wraps it with `gd-auth`.

- Without AWS creds: expect 503, all five `ok:false` (credential-resolution
  errors are logged).
- With dev SSO active (`aws sso login --profile airobuild-dev-private-sso &&
AWS_PROFILE=airobuild-dev-private-sso make dev`): expect 200, all five
  `ok:true`, latency ~50-200ms.

`Environment=local` resolves resource names to the dev account's `dev-airo-stripe-*`
so local probes exercise real dev resources without a separate local stack.

## Env vars

| Var                   | Default | Purpose                                                                                                          |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SERVICE_ADDR` | `:8443` | Listen address.                                                                                                  |
| `SERVER_CERT_PATH`    | _unset_ | TLS cert path. Both cert and key must be set or neither. Container image sets both; local dev serves plain HTTP. |
| `SERVER_KEY_PATH`     | _unset_ | TLS key path.                                                                                                    |
| `ENVIRONMENT`         | `local` | `local` \| `dev` \| `test` \| `prod`. Surfaced in `/health`.                                                     |
| `LOG_LEVEL`           | `info`  | `debug` \| `info` \| `warn` \| `error`.                                                                          |
| `LOG_FORMAT`          | `json`  | `json` (structured) or `text` (human).                                                                           |
| `HTTP_READ_TIMEOUT`   | `30s`   | Go-duration format.                                                                                              |
| `HTTP_WRITE_TIMEOUT`  | `60s`   | Go-duration format.                                                                                              |
| `HTTP_IDLE_TIMEOUT`   | `120s`  | Go-duration format.                                                                                              |
| `SHUTDOWN_TIMEOUT`    | `15s`   | Max time to drain in-flight requests on SIGTERM.                                                                 |
