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
- `POST /v1/sandboxes` — agent-facing, creates a claimable sandbox and pushes the resulting Stripe keys to the mhp-core hosting service (`POST /hosting/v1/apps/:appId/secrets`) before persisting metadata to DynamoDB. Idempotent on `appId`. The five-op bulk push routes `STRIPE_MCP_KEY` to the agent task target via `protected:true` (delivered to `/local/config.json`), and splits `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` into preview and publish variant ops so go-live can later flip publish to `*_live_*` while preview stays `*_test_*`. Stripe-issued keys are never persisted in stripe-service — hosting is their durable home.
- `GET /v1/status?appId=X` — returns claim state for an app's sandbox.
- `POST /webhooks/stripe` — receives Stripe webhooks. Public route (no `gd-auth`); Stripe authenticates via the `Stripe-Signature` header. The handler verifies the signature against the secret loaded at startup from Secrets Manager, parses `{id, type}`, and conditionally-`PutItem`s into the `stripe_events` DDB table for idempotency. Duplicate deliveries return 200; bad signatures return 401. **No per-event-type business logic yet** — that lands as the next handful of PRs.

All `/v1/*` endpoints except `/v1/_probe` require an AWS IAM SSO token.

Also landed: `internal/hosting` — outbound client for the mhp-core hosting
service's bulk-secrets endpoint (POST `/hosting/v1/apps/:appId/secrets`).
Wired into `postSandboxes`. See the section below.

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

1. Per-event-type webhook handlers: `sandbox_details_owner_account_updated` (live-key mint via Managed API Keys + push to hosting using the same `internal/hosting` client), `api_key.rotated` / `api_key.expired` (revoke / re-push). The dispatcher is already merged (PR #3878); only the live-key write step is outstanding.
2. Managed API Keys flow on `sandbox_details_owner_account_updated`: three `apiKeys.create` calls (secret / publishable / mcp), JWE-decrypt via KMS for sk/mcp, push to hosting with the same five-op shape (publish-variant ops upgraded to `*_live_*`; preview ops stay `*_test_*`; MCP stays `protected:true`).

### `internal/hosting` (outbound control-plane client)

`internal/hosting.Client` wraps `*http.Client` with an `AuthProvider` seam and
exposes one method:

- `UpdateSecrets(ctx, appID, ops)` — `POST /hosting/v1/apps/:appID/secrets`
  with `{operations[], workflowName}`. The default `workflowName` is
  `airo-app-secrets`, which triggers hosting's reload pipeline server-side —
  no separate `/reload` call needed.

The endpoint is appId-only; hosting handles per-key delivery routing via the
`Protected` and `Variants` flags on each operation rather than path
segments. `Protected: true` routes to the agent task target (per the
composition's `protectedSecretsTargets`); `Variants: ["preview"]` /
`["publish"]` routes to those variant task targets.

Auth is pluggable via `hosting.AuthProvider`. `hosting.NewAwsIamAuth(gd, sso)`
wraps `gd-auth-lib`'s AWS-IAM JWT minter for prod; `hosting.NoopAuth{}` sends
no Authorization header and is what you use against local-control-plane
(which mocks the same endpoint at `/hosting/v1/apps/:id/secrets`).

**Smoke-test locally:**

1. `cd local-control-plane && make run` (listens on `:4100`, SQLite auto-created, no auth required).
2. In a Go test or REPL: `hosting.New(hosting.Config{BaseURL: "http://localhost:4100", Auth: hosting.NoopAuth{}})` and call `UpdateSecrets` against a seeded app.
3. Inspect `local-control-plane/local-control-plane.db` (SQLite) to confirm the writes landed; check `${APPS_BASE_DIR}/<appId>/local/preview/config.json` to confirm the protected MCP key was synced into the agent's per-app config.

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
| `MGMT_API_BASE_URL`   | \*      | mhp-core ingress root (no path prefix; the client appends `/hosting/v1/...`). Required when `AUTH_TYPE=jwt`. Defaults to `http://localhost:4100` when `AUTH_TYPE=none`. Legacy `MHP_AIRO_BASE_URL` accepted as a fallback for in-flight env migrations. |
| `MGMT_API_TIMEOUT`    | `30s`   | Per-request HTTP timeout. Legacy `MHP_AIRO_TIMEOUT` accepted as a fallback.                                                                                            |
| `MGMT_API_AUTH`       | \*      | `awsiam` (mint AWS-IAM JWT via gd-auth-lib) or `none` (no Authorization header; for local-control-plane). Defaults mirror `AUTH_TYPE` (`jwt`→`awsiam`, `none`→`none`). Legacy `MHP_AIRO_AUTH` accepted as a fallback. |
| `STRIPE_CLIENT`       | `fake`  | `fake` (deterministic synthetic IDs, no network) or `real` (real Stripe v2 via `internal/stripeapi`). Forced to `fake` when `ENVIRONMENT=local`.                       |
| `STRIPE_API_BASE_URL` | _unset_ | Override for `internal/stripeapi`'s default (`https://api.stripe.com`). Tests / staging environments only.                                                             |
| `STRIPE_API_VERSION`  | _unset_ | Override for `internal/stripeapi`'s pinned `Stripe-Version` header. Set when Stripe rotates us to a new preview version.                                               |
