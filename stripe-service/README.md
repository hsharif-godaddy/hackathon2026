# stripe-service

Katana-hosted Go service for the Airo Builder Stripe integration. Owns: platform Stripe secret
key access (Secrets Manager), Stripe webhook receive + signature verify + idempotency, claimable
sandbox + live-key provisioning on behalf of per-app agents, RSA managed-key decrypt via KMS.

One deployment per Airo env (dev / test / prod). Katana app: `airo-builder-stripe-service`.
Go module: `github.com/gdcorp-partners/airo-app-builder/stripe-service`.

## Status

Implemented:

- `/health` — public liveness.
- `/v1/_probe` — public diagnostic, exercises read-only IAM grants against the CDK-provisioned resources.
- `POST /v1/sandboxes` — stub today, returns 501. Wrapped in `gd-auth` S2S auth (AWS IAM SSO tokens) so the middleware chain is exercised end-to-end.
- `POST /webhooks/stripe` — receives Stripe webhooks. Public route (no `gd-auth`); Stripe authenticates via the `Stripe-Signature` header. The handler verifies the signature against the secret loaded at startup from Secrets Manager, parses `{id, type}`, and conditionally-`PutItem`s into the `stripe_events` DDB table for idempotency. Duplicate deliveries return 200; bad signatures return 401. **No per-event-type business logic yet** — that lands as the next handful of PRs.

Also landed: `internal/mhpairo` — outbound client for mhp-airo's three
alloc-management endpoints (POST secrets, PATCH app, POST reload). Library
only; not wired into any handler yet. See the section below.

Library packages (no caller wires them in yet):

- `internal/stripeapi` — outbound client for Stripe v2 preview APIs
  (`v2.core.claimableSandboxes.create`, `v2.iam.apiKeys.create`). Hand-rolled
  `net/http` wrapper, no `stripe-go` dependency. Bearer auth, configurable
  `Stripe-Version`, caller-supplied `Idempotency-Key`, optional `Stripe-Context`,
  typed `*StripeError` with `IsRetryable()` predicate. JWE responses surface as
  raw bytes — decryption belongs in a separate package. Wired into real
  `POST /v1/sandboxes` body and the live-key webhook handler in follow-up PRs.

Library packages (no caller wires them in yet):

- `internal/jwedecrypt` — RSA-OAEP[-256] + A256GCM JWE compact-serialization
  decrypter for Stripe Managed API Key responses. CEK unwrap delegated to AWS
  KMS via a narrow interface (asymmetric `RSA_2048` CMK); AES-256-GCM content
  decryption happens in-process via stdlib `crypto/aes` + `crypto/cipher`. AAD
  follows RFC 7516 §5.1.10 (raw base64url-encoded protected header bytes).
  Library only — slotted into the live-key webhook handler in a follow-up PR.

Library packages (no caller wires them in yet):

- `internal/kmspubkey` — fetch + validate + cache the RSA public PEM from a
  KMS asymmetric CMK. Validates `KeySpec=RSA_2048`, `KeyUsage=ENCRYPT_DECRYPT`,
  and that the CMK supports both `RSAES_OAEP_SHA_1` and `RSAES_OAEP_SHA_256`
  so JWE decryption (`internal/jwedecrypt`) can match either alg in the
  response header. Lazy fetch via `sync.Once`; errors cached. PEM-encoded via
  PKIX (`-----BEGIN PUBLIC KEY-----`). Library only — slotted into
  `apiKeys.create` calls in the live-key webhook handler PR.

Next PRs:

1. Real `POST /v1/sandboxes` body (Stripe `v2.core.claimableSandboxes.create` + DynamoDB write).
2. `GET /v1/status`, `GET /v1/sandbox/:id/mcp-key`.
3. Per-event-type webhook handlers: `claimable_sandbox.claimed` (DDB update), `sandbox_details_owner_account_updated` (live-key mint via Managed API Keys + push to mhp-airo), `api_key.rotated` / `api_key.expired` (revoke / re-push).
4. KMS decrypt + Managed API Keys flow.
5. Wire `internal/mhpairo` into `postSandboxes` and the go-live webhook handler.

### `internal/mhpairo` (outbound control-plane client)

`internal/mhpairo.Client` wraps `*http.Client` with an `AuthProvider` seam and
exposes three methods:

- `UpdateSecrets(ctx, subID, sysID, appID, ops)` — `POST /api/airo/v1/subscriptions/:subID/systems/:sysID/apps/:appID/secrets`
- `UpdateApp(ctx, subID, sysID, appID, update)` — `PATCH /api/airo/v1/subscriptions/:subID/systems/:sysID/apps/:appID`
- `ReloadApp(ctx, subID, sysID, appID)` — `POST /api/airo/v1/subscriptions/:subID/systems/:sysID/apps/:appID/reload`

All three take the full `(subscriptionId, systemId, appId)` triple — mhp-airo
has no appId-only endpoint and stripe-service has no customer context to
resolve one. The caller (future `postSandboxes` + webhook handler) is
expected to carry the triple alongside `appId`.

Auth is pluggable via `mhpairo.AuthProvider`. `mhpairo.NewAwsIamAuth(gd, sso)`
wraps `gd-auth-lib`'s AWS-IAM JWT minter for prod; `mhpairo.NoopAuth{}` sends
no Authorization header and is what you use against local-control-plane.

**Smoke-test locally:**

1. `cd local-control-plane && make run` (listens on `:4100`, SQLite auto-created, no auth required).
2. In a Go test or REPL: `mhpairo.New(mhpairo.Config{BaseURL: "http://localhost:4100/api/airo/v1", Auth: mhpairo.NoopAuth{}})` and call the three methods against a seeded app.
3. Inspect `local-control-plane/local-control-plane.db` (SQLite) to confirm the writes landed.

## Protected routes

- **Public:** `/health` (liveness, no auth).
- **Agent-facing (S2S):** `/v1/*` requires an AWS IAM SSO token in `Authorization: Bearer <token>`.
  Agents mint tokens via `getS2SToken()` from `@airo/ai-lib`; `stripe-service` validates via
  `packages/go-auth` using `AuthenticateWithKind("awsiam")`. Missing or invalid tokens → 401;
  valid tokens of the wrong kind → 403.

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

| Var                   | Default | Purpose                                                                                                                                                                |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SERVICE_ADDR` | `:8443` | Listen address.                                                                                                                                                        |
| `SERVER_CERT_PATH`    | _unset_ | TLS cert path. Both cert and key must be set or neither. Container image sets both; local dev serves plain HTTP.                                                       |
| `SERVER_KEY_PATH`     | _unset_ | TLS key path.                                                                                                                                                          |
| `ENVIRONMENT`         | `local` | `local` \| `dev` \| `test` \| `prod`. Surfaced in `/health`.                                                                                                           |
| `LOG_LEVEL`           | `info`  | `debug` \| `info` \| `warn` \| `error`.                                                                                                                                |
| `LOG_FORMAT`          | `json`  | `json` (structured) or `text` (human).                                                                                                                                 |
| `HTTP_READ_TIMEOUT`   | `30s`   | Go-duration format.                                                                                                                                                    |
| `HTTP_WRITE_TIMEOUT`  | `60s`   | Go-duration format.                                                                                                                                                    |
| `HTTP_IDLE_TIMEOUT`   | `120s`  | Go-duration format.                                                                                                                                                    |
| `SHUTDOWN_TIMEOUT`    | `15s`   | Max time to drain in-flight requests on SIGTERM.                                                                                                                       |
| `AUTH_TYPE`           | `jwt`   | `jwt` enforces AWS IAM SSO tokens on `/v1/*`; `none` bypasses auth (local dev only).                                                                                   |
| `SSO_HOST`            | _unset_ | GoDaddy SSO hostname; required when `AUTH_TYPE=jwt`. `sso.dev-godaddy.com` (dev) / `sso.godaddy.com` (prod).                                                           |
| `MHP_AIRO_BASE_URL`   | \*      | mhp-airo API root incl. `/api/airo/v1`. Required when `AUTH_TYPE=jwt`. Defaults to `http://localhost:4100/api/airo/v1` when `AUTH_TYPE=none`.                          |
| `MHP_AIRO_TIMEOUT`    | `30s`   | Per-request HTTP timeout to mhp-airo.                                                                                                                                  |
| `MHP_AIRO_AUTH`       | \*      | `awsiam` (mint AWS-IAM JWT via gd-auth-lib) or `none` (no Authorization header; for local-control-plane). Defaults mirror `AUTH_TYPE` (`jwt`→`awsiam`, `none`→`none`). |
