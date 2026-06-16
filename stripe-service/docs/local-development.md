# Local development

How to run `stripe-service` against real Stripe (test mode) on your laptop,
wired to a locally-running agent + app, with Stripe webhooks tunneled in.

This is the full-loop setup: agent → stripe-service → real Stripe sandbox API,
plus inbound webhooks via the Stripe CLI. For a no-network smoke test, use
`STRIPE_CLIENT=fake` (the default) instead — see [README](../README.md).

## Prerequisites

- AWS SSO access to the dev account: `aws sso login --profile airobuild-dev-private-sso`.
  The service reads the platform Stripe key, webhook signing secret, and KMS
  key from the dev account at runtime.
- [Stripe CLI](https://docs.stripe.com/stripe-cli) (`stripe`) for webhook
  forwarding.
- The repo bootstrapped for local dev (`pnpm install`), per the root README.

## 1. Point the agent at your local stripe-service

Edit `agents/.env` so the agent calls your local service instead of the
deployed one:

```
STRIPE_SERVICE_API_URL=http://localhost:8444
```

Port `8444` is arbitrary — it just has to match `STRIPE_SERVICE_ADDR` in step 3.
(The service defaults to `:8443`; we use `:8444` locally to avoid colliding with
anything already on `:8443`.)

## 2. Run the agent + app

In one terminal, from the repo root:

```bash
pnpm run dev
```

This starts agents (`:4000`), the app (`:3000`), and the local control plane
(`:4100`). The local control plane stands in for mhp-core hosting — when
stripe-service pushes secrets, they land in
`${APPS_BASE_DIR}/<appId>/local/preview/config.json`.

## 3. Run stripe-service against real Stripe (test mode)

In a second terminal:

```bash
cd stripe-service
AWS_PROFILE=airobuild-dev-private-sso \
  ENVIRONMENT=dev \
  STRIPE_CLIENT=real \
  AUTH_TYPE=none \
  STRIPE_SERVICE_ADDR=:8444 \
  LOG_LEVEL=debug \
  LOG_FORMAT=text \
  go run ./cmd/server
```

What each flag does:

| Flag | Why |
| --- | --- |
| `AWS_PROFILE=airobuild-dev-private-sso` | Resolves the dev account's platform key, webhook secret, KMS CMK, and DynamoDB tables. |
| `ENVIRONMENT=dev` | Selects the `dev-airo-stripe-*` resource names. **Must not be `local`** — `local` force-pins `STRIPE_CLIENT=fake` as a safety belt, so real Stripe calls never fire. `dev` keeps you in Stripe **test mode** (the dev platform key is `sk_test_*`). |
| `STRIPE_CLIENT=real` | Wires the real `stripeapi`-backed client. Issues actual `v2.core.claimableSandboxes.create` calls against Stripe test mode. |
| `AUTH_TYPE=none` | Skips AWS-IAM SSO validation on `/v1/*` so the local agent can call without minting an S2S token. Also defaults the hosting client to `MGMT_API_AUTH=none` + `MGMT_API_BASE_URL=http://localhost:4100` (the local control plane). |
| `STRIPE_SERVICE_ADDR=:8444` | Listen port — matches `STRIPE_SERVICE_API_URL` from step 1. |
| `LOG_LEVEL=debug` / `LOG_FORMAT=text` | Readable, verbose logs. |

Sanity check: `curl http://localhost:8444/health`.

With this running, "add Stripe" in the local app drives the real provisioning
path: stripe-service creates a claimable sandbox in Stripe test mode and pushes
`sk_test_*` / `pk_test_*` / `ek_test_*` into the app's
`local/preview/config.json` via the local control plane.

## 4. Tunnel Stripe webhooks to your laptop

The deployed dev/test stripe-service URLs are internal-only, so Stripe can't
reach them — webhooks only arrive in prod by default. Locally, use the Stripe
CLI to forward them to your running service:

```bash
stripe listen \
  --forward-thin-to http://localhost:8444/webhooks/stripe \
  --thin-events v2.core.claimable_sandbox.claimed,v2.core.claimable_sandbox.updated \
  --forward-to http://localhost:8444/webhooks/stripe \
  --events account.application.deauthorized \
  --api-key <sk_test_api_key_from_aws_secrets_manager>
```

Why two `--forward-*` flags:

- **`--forward-thin-to` + `--thin-events`** — the claimable-sandbox lifecycle
  events (`claimed`, `updated`) are Stripe **v2 "thin" events**. The handler
  re-fetches the full event via `GET /v2/core/events/{id}`, so the thin payload
  is all it needs. These drive claim-status updates and live-key minting at
  go-live.
- **`--forward-to` + `--events`** — `account.application.deauthorized` is a
  classic (v1) event, forwarded as a full payload. This is the uninstall/revoke
  signal.

`--api-key` is the dev platform **test** secret key, read from AWS Secrets
Manager:

```bash
AWS_PROFILE=airobuild-dev-private-sso \
  aws secretsmanager get-secret-value \
  --secret-id dev-airo-stripe-platform-key-test \
  --query SecretString --output text
```

`stripe listen` prints a `whsec_*` signing secret on startup. Local runs read
the **dev** webhook signing secret (`dev-airo-stripe-webhook-signing`) from
Secrets Manager at startup, so signature verification works without copying the
CLI's secret anywhere — as long as the dev secret matches the one registered
for the CLI's API key. If you see `401 INVALID_SIGNATURE`, that mismatch is the
usual cause.

## Triggering the flow end to end

1. In the local app, ask the agent to add Stripe / accept payments. This calls
   `POST /v1/sandboxes` → real sandbox created in test mode → keys land in
   `local/preview/config.json`.
2. Complete the claim flow from the `claim_url` the agent surfaces (Stripe's
   hosted page, test mode).
3. The `claimed` / `updated` webhooks arrive via `stripe listen`; at go-live the
   service mints `sk_live_*` / `pk_live_*`, deletes `STRIPE_MCP_KEY` (MCP is
   sandbox-only), and pushes the live keys to the control plane.
4. Inspect `${APPS_BASE_DIR}/<appId>/local/preview/config.json` to confirm what
   landed at each step.

## Notes

- **Test mode only, locally.** The dev platform key is `sk_test_*`, so even with
  `STRIPE_CLIENT=real` you operate entirely in Stripe test mode. Real-money
  `sk_live_*` minting only happens in the prod deployment.
- **DynamoDB writes go to the real dev tables** (`dev-airo-stripe-sandboxes`,
  `dev-airo-stripe-events`). Sandbox rows you create locally are real dev rows.
- **`./cmd/server`**, not `./cmd/serve` — there is one `cmd/` binary.
