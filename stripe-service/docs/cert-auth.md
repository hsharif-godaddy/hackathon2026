# stripe-service client cert auth

stripe-service can authenticate to mhp-core hosting (`POST /api/hosting/v1/apps/:appId/secrets`) using a service-specific client certificate instead of an AWS-IAM JWT. This document covers what the cert is, where it lives, and how to switch the service over.

## When to use cert auth

Default is AWS-IAM JWT (`MGMT_API_AUTH=awsiam`) which mints a Bearer token via gd-auth-lib. Cert auth is the fallback for environments where:

- The frontdoor pioneermgmt route doesn't allow `awsiam` for `POST /api/hosting/v1/apps/...` — at the time of writing, the catch-all `/api/` rule only accepts `idp,jomax,cert`, and the `awsiam` allowlist is being added in [frontdoor-config #3653](https://github.com/gdcorp-engineering/frontdoor-config/pull/3653) (test only; prod follows). Once that ships and the IAM ARN is allowlisted on mhp-core, the awsiam path becomes viable too.
- You want a service identity tied to a CN rather than an IAM role.
- You need to revoke just stripe-service's access without affecting other airo-builder services.

When PR #3653 is merged the route allows both `cert,awsiam` and either path works at Edge — the choice between them is then a matter of the hosting-side allowlist (`AllowedIamRoles` for awsiam, `CertPolicies` for cert).

## Cert identity

Follows the `<service>.airo-builder[.<env-modifier>].authclient.int.godaddy.com` convention used by `getty.airo-builder.authclient.int.godaddy.com` (see `docs/knowb-knowledge-base.md`) and `notification-service`'s MGMT_CERT/MGMT_KEY pair.

| Environment | CN minted in PCP | SSO endpoint |
| ----------- | ---------------- | ------------ |
| TEST        | `stripe-service.airo-builder.test.authclient.int.godaddy.com` | `https://sso.test-godaddy.com/secure/api/token` |
| PROD        | `stripe-service.airo-builder.authclient.int.godaddy.com`      | `https://sso.godaddy.com/secure/api/token`      |

The CN is the caller identity mhp-core hosting matches against for allowlist purposes.

## Provisioning flow

PCP → Katana → ECS env var. There is no PCP-to-ASM auto-delivery; both halves are manual operator steps.

### 1. Mint the cert in PCP

Already done. The two CNs above were minted at https://pcp.int.gdcorp.tools.

### 2. Download cert + key from PCP

In PCP, open each cert → **Download**:
- `.bundle` (the full chain PEM — NOT just `Cert`)
- `.key` (the private key PEM)

For both env certs (test and prod). See [Confluence: Client cert download in PCP](https://godaddy-corp.atlassian.net/wiki/spaces/PRODEM/pages/4400154376/Client+cert+download+in+PCP).

### 3. Add as Katana secrets on the airo-builder-stripe app

In the Katana UI: **Namespaces → Airo App Builder → airo-builder-stripe → `<env>` → Create Secret**. Two secrets per env:

| Field | `CLIENT_CERTIFICATE_CRT` | `CLIENT_CERTIFICATE_KEY` |
| ----- | ------------------------ | ------------------------ |
| Region | us-west-2 | us-west-2 |
| Type   | Use a Katana-managed secret | Use a Katana-managed secret |
| Name   | `CLIENT_CERTIFICATE_CRT` | `CLIENT_CERTIFICATE_KEY` |
| Value  | contents of the PCP `.bundle` file | contents of the PCP `.key` file |

Test envs paste the `.test.authclient.…` cert; prod env pastes the `.authclient.…` cert. The CN-vs-env separation is enforced by *which Katana env you paste into*, not by the cert filename.

Katana writes the value into AWS Secrets Manager at `/Katana/Secrets/airobuilde/airo-builder-stripe/<env>/CLIENT_CERTIFICATE_CRT` (and `…_KEY`) and auto-grants the Katana ECS task role read access on that namespace. **No CDK IAM grant required** — it's automatic. The UI handles the full ASM write; no AWS CLI step is needed.

The first creation rolls the running container; subsequent value updates do NOT — rotations require a redeploy.

### 4. Set runtime env vars

In the same Katana variables panel, add four non-secret variables:

| Name | Value (test) | Value (prod) |
| ---- | ------------ | ------------ |
| `MGMT_API_AUTH` | `cert` | `cert` |
| `SSO_HOST` | `sso.test-godaddy.com` | `sso.godaddy.com` |

`MGMT_API_BASE_URL` is presumably already set per env. `AUTH_TYPE=jwt` is required and presumably already set.

### 5. Redeploy stripe-service

The new container will:

1. Read `CLIENT_CERTIFICATE_CRT` and `CLIENT_CERTIFICATE_KEY` env vars (PEM contents).
2. Parse them with `tls.X509KeyPair` at boot — fail-fast if either is missing or malformed.
3. On the first outbound call to mhp-core, POST `realm=cert` to `https://<SSO_HOST>/secure/api/token` presenting the cert in the TLS handshake.
4. Cache the resulting JWT until 60s before its `exp` claim.
5. Attach `Authorization: sso-jwt <token>` to outbound `/hosting/v1/apps/:appId/secrets` calls.

## Reverting to awsiam

Set `MGMT_API_AUTH=awsiam` (or unset it — `awsiam` is the default when `AUTH_TYPE=jwt`). The cert env vars become inert. No code change required.

## Verifying the cert path on test

After `MGMT_API_AUTH=cert` is flipped in Katana and the service is redeployed, hit `GET /v1/_probe` from anywhere with network reach to the test stripe-service. The probe runs zero-side-effect checks against AWS dependencies AND mhp-core auth + reachability:

```json
{
  "status": "ok",
  "checks": [
    {"name": "dynamodb.sandboxes",   "ok": true,  "latencyMs": 47},
    {"name": "dynamodb.events",      "ok": true,  "latencyMs": 42},
    {"name": "secretsmanager.platform", "ok": true, "latencyMs": 91},
    {"name": "secretsmanager.webhook",  "ok": true, "latencyMs": 88},
    {"name": "kms.managed",          "ok": true,  "latencyMs": 65},
    {"name": "hosting.auth",         "ok": true,  "latencyMs": 312, "details": "scheme=sso-jwt"},
    {"name": "hosting.reach",        "ok": true,  "latencyMs": 48,  "details": "status=404 body=\"app not found\""}
  ]
}
```

`hosting.auth` exercises just the SSO mint (no mhp-core call). `hosting.reach` does a no-op `POST /hosting/v1/apps/_probe/secrets` against mhp-core — a single delete op for a sentinel name on a non-existent app, so no real state is ever modified. POST (not GET) is deliberate: the frontdoor pioneermgmt route only allows `awsiam` on POST; a GET probe would false-negative for the awsiam path. Expected outcomes:

| `hosting.reach` result | What it means |
|---|---|
| `status=404` (app not found) | ✅ Auth passed end-to-end. Cert flow is fully working. |
| `status=401` body mentions "Certificate CN not authorized" | mhp-core middleware rejected the cert — the new policy isn't deployed yet, OR the CN doesn't match `vars-mhp-*.json` |
| `status=401` body mentions "Authentication required" | mhp-core route is still `JWTOnly()` — the route-flip PR hasn't deployed yet |
| `status=401` from Edge (no body) | Frontdoor rejected the JWT — cert mint succeeded but the issued JWT shape isn't accepted at Edge |
| 5xx | mhp-core internal issue — page mhp-core/hosting on-call |
| Probe step's `error` field set, status=0 | SSO mint failed — cert env vars wrong, expired, or sso host unreachable |

`hosting.reach` 4xx outcomes are intentionally treated as "call succeeded" in the overall probe status (returns 200) because the call itself completed cleanly — only 5xx or transport-level errors flip overall status to 503.

## Code references

- `stripe-service/internal/hosting/cert_auth.go` — `CertSSOAuth` provider
- `stripe-service/internal/hosting/auth.go` — sibling `AwsIamAuth` provider for comparison
- `stripe-service/internal/config/config.go` — `HostingConfig.ClientCert/ClientKey` + `loadHostingConfig`
- `stripe-service/cmd/server/main.go` — `buildHostingClient` switch
- `stripe-service/internal/hosting/client.go` — `ProbeAuth` + `ProbeReach`
- `stripe-service/internal/api/probe.go` — `/v1/_probe` handler
- `image-search-service/internal/getty/auth.go` — the original `SSOJWTAuth` pattern this implementation mirrors

## External docs

- [Confluence: Client cert download in PCP](https://godaddy-corp.atlassian.net/wiki/spaces/PRODEM/pages/4400154376/Client+cert+download+in+PCP)
- [TDL: Katana Variables & Secrets](https://tdl.int.gdcorp.tools/docs/products/compute/managed/katana/apps/environments/variables-and-secrets/)
- [TDL: How to Create Secrets in Katana UI](https://tdl.int.gdcorp.tools/docs/products/compute/managed/katana/apps/environments/variables-and-secrets/how-to-create-secrets)
