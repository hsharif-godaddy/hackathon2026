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
- `POST /v1/sandboxes` — agent-facing, creates a claimable sandbox (via fake Stripe client) and persists metadata (no credentials) to DynamoDB. Idempotent on `appId`. All three Stripe-issued keys (`sk_test_*`, `pk_test_*`, `ek_test_*`) are **not** persisted — by design they flow only into mhp-airo's alloc env, where the agent reads `STRIPE_MCP_KEY` and preview/publish read `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY`. Current build drops them on the floor since the mhp-airo push ships in a later PR; see TODO in `internal/api/sandboxes.go`.
- `GET /v1/status?appId=X` — returns claim state for an app's sandbox.
- `POST /webhooks/stripe` — receives Stripe webhooks. Public route (no `gd-auth`); Stripe authenticates via the `Stripe-Signature` header. The handler verifies the signature against the secret loaded at startup from Secrets Manager, parses `{id, type}`, and conditionally-`PutItem`s into the `stripe_events` DDB table for idempotency. Duplicate deliveries return 200; bad signatures return 401. **No per-event-type business logic yet** — that lands as the next handful of PRs.

All `/v1/*` endpoints except `/v1/_probe` require an AWS IAM SSO token.

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
- `internal/jwedecrypt` — RSA-OAEP[-256] + A256GCM JWE compact-serialization
  decrypter for Stripe Managed API Key responses. CEK unwrap delegated to AWS
  KMS via a narrow interface (asymmetric `RSA_2048` CMK); AES-256-GCM content
  decryption happens in-process via stdlib `crypto/aes` + `crypto/cipher`. AAD
  follows RFC 7516 §5.1.10 (raw base64url-encoded protected header bytes).
  Library only — slotted into the live-key webhook handler in a follow-up PR.

- `internal/kmspubkey` — fetch + validate + cache the RSA public PEM from a
  KMS asymmetric CMK. Validates `KeySpec=RSA_2048`, `KeyUsage=ENCRYPT_DECRYPT`,
  and that the CMK supports both `RSAES_OAEP_SHA_1` and `RSAES_OAEP_SHA_256`
  so JWE decryption (`internal/jwedecrypt`) can match either alg in the
  response header. Lazy fetch via `sync.Once`; errors cached. PEM-encoded via
  PKIX (`-----BEGIN PUBLIC KEY-----`). Library only — slotted into
  `apiKeys.create` calls in the live-key webhook handler PR.

### Stripe client selection

`STRIPE_CLIENT` selects which `internal/stripe.Client` implementation the server wires in:

- **`fake` (default)** — `internal/stripe.FakeClient`. Returns obvious-fake values (every ID prefixed `*_fake_*`, claim URLs under `/fake-claim/`, keys prefixed `sk_test_fake_` / `pk_test_fake_` / `ek_test_fake_`). No real Stripe network call. Lets the full agent→service→DynamoDB loop be exercised end-to-end before real Stripe credentials are provisioned.
- **`real`** — `internal/stripe.RealClient`, an adapter over `internal/stripeapi.Client`. Loads the platform secret key (`sk_test_*` / `sk_live_*`) from Secrets Manager (`{env}-airo-stripe-platform-key`) at startup; fails fast on a missing/placeholder secret. Issues real Stripe v2 `claimableSandboxes.create` calls. Until the preview API is enabled for the GoDaddy account, Stripe rejects with `invalid_request_error`, which the handler maps to `502 STRIPE_CREATE_FAILED` — the agent skill (separate PR) pattern-matches that for graceful degradation.

`Environment=local` forces `fake` regardless of the env var — local dev never hits real Stripe by accident.

Next PRs:

1. `mhp-airo` callout to inject all three Stripe keys (`sk_test_*`, `pk_test_*`, `ek_test_*` as `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_MCP_KEY`) into the customer-app alloc env. Must run between `claimableSandboxes.create` and the DDB `PutItem` so `claim_status: "provisioned"` implies the alloc env is actually ready; on push failure, abandon the Stripe sandbox and return an error without writing DDB.
2. Per-event-type webhook handlers: `claimable_sandbox.claimed` (DDB update), `sandbox_details_owner_account_updated` (live-key mint via Managed API Keys + push to mhp-airo), `api_key.rotated` / `api_key.expired` (revoke / re-push).
3. Managed API Keys flow on `sandbox_details_owner_account_updated`: three `apiKeys.create` calls (secret / publishable / mcp), JWE-decrypt via KMS for sk/mcp, push all three to mhp-airo as `sk_live_*` / `pk_live_*` / `ek_live_*`. No new stripe-service data store — live credentials follow the same mhp-airo path as the sandbox keys.
4. Wire `internal/mhpairo` into `postSandboxes` and the go-live webhook handler.

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
| `STRIPE_CLIENT`       | `fake`  | `fake` (deterministic synthetic IDs, no network) or `real` (real Stripe v2 via `internal/stripeapi`). Forced to `fake` when `ENVIRONMENT=local`.                       |
| `STRIPE_API_BASE_URL` | _unset_ | Override for `internal/stripeapi`'s default (`https://api.stripe.com`). Tests / staging environments only.                                                             |
| `STRIPE_API_VERSION`  | _unset_ | Override for `internal/stripeapi`'s pinned `Stripe-Version` header. Set when Stripe rotates us to a new preview version.                                               |
