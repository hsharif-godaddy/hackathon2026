# JWS Email Signing — Architecture, Implementation, Operations

**Status:** Implemented across `airo-app-builder` (dev-supervisor + BFF + agent), `mhp-core` (control plane + libsonnet), and `pioneer-infra` (per-cell Terraform + bootstrap scripts). Test rollout in progress on c4-dev; production gated behind switchboard.

**Last updated:** 2026-05-22.

**See also**: [`dkim-provisioning-flow.md`](./dkim-provisioning-flow.md) — the companion doc covering DKIM onboarding (Vox), DCC classification, mail-flow status polling, and the `/api/apps/[id]/dkim/*` BFF endpoints. The provisioning flow runs once per (app, domain) at attach time and publishes the DNS records this signing flow assumes are already in place.

This doc supersedes the earlier design + rollout series (`smtp-jws-sidecar-implementation.md`, `jws-signing-implementation-summary.md`, `jws-signing-rollout-*`, `email-promotional-dkim-architecture.md`, `email-http-gateway-and-dkim.md`, etc.). Those docs reflect intermediate design decisions that no longer match shipped reality. They've been deleted; their reasoning is recoverable via `git log -- docs/`.

---

## 1. Why This Exists

The platform's hosting relay (Sable) requires DKIM signatures on outbound mail to keep receiver-side spam reputation healthy. Customer apps in `airo-builder` cells call into the relay via SMTP/HTTP through `dev-supervisor`, but the relay has no way to know which messages on its inbound port are authorised platform mail vs. arbitrary traffic — so it can't apply DKIM speculatively.

JWS signing closes that gap. `dev-supervisor` signs every outbound message with a per-cell RSA key whose leaf cert chains to an Airo-controlled intermediate CA. The relay verifies the JWS, treats verification success as authorisation to apply the customer-domain DKIM signature (provisioned via Vox at domain-attach time), strips the trust headers, and forwards. Net effect: customer mail leaves the relay with a real `DKIM-Signature: d=<customer-domain>` and the corresponding DNS records, satisfying the receiver's authentication checks.

The same machinery covers the platform default domain (`airoapp.ai`) for customers who haven't attached a custom domain.

---

## 2. Architecture

### 2.1 Inline signing in `dev-supervisor` (chosen over per-cell gateway)

Customer code in an alloc never has the signing key in its accessible filesystem. Process layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  Nomad alloc (AlmaLinux 9.x kernel)                             │
│                                                                 │
│  PID 1: dev-supervisor (uid 0, NOT sandboxed)                   │
│   │   - Reads /alloc/jws-signing-key.pem at startup             │
│   │   - Holds *rsa.PrivateKey in process memory                 │
│   │   - Listens on:                                             │
│   │       :25    SMTP proxy (nodemailer entry)                  │
│   │       :2525  HTTP email gateway (fetch entry)               │
│   │       :20000 HTTP proxy → customer app at :20010            │
│   │                                                             │
│   └── exec: airo-sandbox  ← applies Landlock, then exec's       │
│        │                                                        │
│        │   Landlock allowlist (irrevocable, inherited):         │
│        │     rwc on  /app, /tmp, /home/agent, /private          │
│        │     rx  on  /node_modules                              │
│        │     connect TCP {80,443,53,3306,25}                    │
│        │     ALL OTHER PATHS DENIED → including /alloc          │
│        │                                                        │
│        └── exec: customer process (uid != 0)                    │
│             ↓ open("/alloc/jws-signing-key.pem")                │
│             ✗ EACCES — kernel-enforced                          │
└─────────────────────────────────────────────────────────────────┘
```

`dev-supervisor` itself never passes through `airo-sandbox`, so it retains full filesystem access. The trust boundary is the `airo-sandbox` invocation: code before it is trusted, code after it is the customer.

This was Dan Everton's recommendation, replacing an earlier per-cell gateway design. Key points:

- **No new long-running service.** The signing happens on the same SMTP/HTTP path that already handles platform mail.
- **No network hop.** RSA sign in-process, microseconds.
- **No new authentication surface.** "Which alloc is signing this?" is moot — `dev-supervisor` IS the alloc.
- **Kernel-enforced isolation.** Landlock's allowlist, not Unix permissions, is the load-bearing protection against customer key exfiltration.

### 2.2 Send paths

Two entry points, one signing core:

```
Path A:  customer app  →  nodemailer  →  :25 SMTP proxy  →┐
                                                          │
                                                          ├→ signFn(body, appID, from)
                                                          │      │
                                                          │      ├─ build JWS over body+from
                                                          │      ├─ inject X-GD-DKIM-SIGN header
                                                          │      ├─ inject X-GD-DKIM-PUB-KEY header
                                                          │      └─ return modified body
                                                          │
Path B:  customer app  →  fetch       →  :2525 HTTP gw  →┘
                                                          │
                                                          ↓
                                          ForwardSMTP(SMTP_DESTINATION, …)
                                                          │
                                                          ↓
                                                  Sable relay
                                                          │
                                                          ├─ verify JWS against trusted intermediate CA
                                                          ├─ strip X-GD-DKIM-* headers
                                                          ├─ apply DKIM-Signature for d=<from-domain>
                                                          └─ forward to receiver MTA
```

Both paths call the same `signFn`, which is `(*signing.Signer).SignMessage`. A nil signer (no key loaded) is a no-op — the message forwards unsigned, the relay rejects it per its policy. The platform's bias is **availability over signing**: a transient sign failure must not break the customer's send path.

### 2.3 Per-cell key model

| Layer | What | Where |
|---|---|---|
| Intermediate CA | Single per AWS account, RSA 2048, self-signed | `airo/smtp-signing/ca-{key,cert}` in ASM. Created once by `bin/jws-signing/bootstrap-ca.sh`. |
| Per-cell leaf | RSA 2048, signed by the intermediate CA, 1-year validity | `airo/smtp-signing/cells/<cell>/{private-key,cert,key-id}` in ASM. Created/rotated by `pioneer-infra/terraform/modules/hosting-cell/jws-signing.tf` on `terragrunt apply`. |
| Trust on relay side | Intermediate CA cert installed once in Sable's trust store | Out-of-band hand-off from infra to relay team during account bootstrap. New cells and rotations require zero relay-side work. |

The CA private key never leaves ASM after bootstrap. Terraform reads it at apply time to sign each cell's leaf, then drops it.

---

## 3. Wire Format

The relay's verifier matches a cPanel reference implementation byte-for-byte. Deviations cause silent verification failure — the message is then forwarded unsigned and the relay rejects it.

### 3.1 Compact JWS

```
<base64url(header)>.<base64url(payload)>.<base64url(signature)>
```

- `base64url` is RFC 7515 §2 — URL-safe alphabet, no padding.
- Signature: RS256 (RSA-SHA256, PKCS#1 v1.5) over `<header>.<payload>` (the bytes before the second dot, NOT decoded back to JSON).

### 3.2 JOSE header

```json
{"typ":"JWT","alg":"RS256"}
```

- No `kid`. The relay does not look at `kid`; we keep the key id on the `Signer` struct for diagnostics only.
- Field order is irrelevant — JSON decode reads as a map.

### 3.3 Payload

```json
{
  "domain":     "<lowercased domain part of from>",
  "timestamp":  <unix seconds, e.g. 1779452280>,
  "from":       "<envelope-from address>",
  "body_hash":  "<UPPERCASE HEX SHA-256 of canonical body>"
}
```

- `from` is omitted from the payload when empty (no envelope-from claim).
- `body_hash` is omitted when the body is empty.
- No `iss`/`sub`/`aud`/`iat`/`exp`/`jti` claims — the cPanel verifier doesn't read them.

### 3.4 Canonical body hash

The relay strips X-GD-DKIM-* headers before recomputing the hash, so what dev-supervisor signs must equal what the relay reconstructs from the wire.

Algorithm (from `dev-supervisor/internal/email/signing/signer.go canonicalBodyHash`):

1. Take the bytes after the first blank line in the RFC 5322 message (the body).
2. Truncate to the first **5000 bytes**.
3. Decode UTF-8 with errors='ignore' (drop invalid sequences).
4. Collapse runs of `\s+` (any Unicode whitespace) to a single space.
5. Trim leading and trailing whitespace.
6. Truncate to **1000 bytes**.
7. SHA-256 → **uppercase hex** (NOT base64).

Empty body → empty string `""`, which is omitted from the payload.

### 3.5 Headers injected into RFC 5322

Inserted at the bottom of the header block, before the header/body separator. Byte-preserving — the existing tracking headers (`X-SITE-UID`, `X-PRODUCT`, `X-ENVIRONMENT`, `X-DATACENTER`) stay where they were.

```
X-GD-DKIM-SIGN: <compact JWS>
X-GD-DKIM-PUB-KEY: <inner base64 of leaf cert PEM>
```

`X-GD-DKIM-PUB-KEY` is the leaf cert with `-----BEGIN/END CERTIFICATE-----` markers and ALL whitespace stripped — just the base64 body, single line. The relay reconstructs the cert and verifies it chains to the trusted intermediate CA.

The relay strips both headers before delivery; receivers never see them.

---

## 4. Per-Repo Implementation Map

### 4.1 `airo-app-builder` (dev-supervisor + BFF + agent)

#### dev-supervisor (Go)

| Path | Purpose |
|---|---|
| `dev-supervisor/internal/email/signing/signer.go` | `Signer` struct, `Load()`, `SignMessage(body, siteID, from)`. Reads keys from `JWS_PRIVATE_KEY_PATH`, `JWS_CERT_PATH`, `JWS_KEY_ID_PATH`. Nil receiver = no-op pass-through. |
| `dev-supervisor/internal/email/signing/testkeys/testkeys.go` | Generates ephemeral RSA keypair + self-signed leaf at test time. Replaces committed fixtures (avoids GitHub Push Protection trips). |
| `dev-supervisor/internal/email/inject.go` | `InjectHeaders(message, headers)` — byte-preserving header insertion shared by SMTP and HTTP paths. |
| `dev-supervisor/internal/proxy/smtp/smtp.go` | SMTP proxy on `:25`. Calls `signFn` after policy enforcement, before `ForwardSMTP`. |
| `dev-supervisor/internal/proxy/emailhttp/gateway.go` | HTTP email gateway on `:2525`. POST /api/email/send. Calls `signFn` between policy + forward. Same `signFn` instance as SMTP path. |
| `dev-supervisor/internal/proxy/http/server.go` | HTTP proxy on `:20000` (the public preview port). Hosts `/airo/health`, `/airo/auth-check`, and `/airo/email/test-send` (debug). |
| `dev-supervisor/internal/proxy/http/email_test_send.go` | `/airo/email/test-send` debug handler. Forwards request to `localhost:2525/api/email/send` (the existing email gateway) and wraps response with `signing_enabled`, `key_id`, `cell_id`, `would_forward_to`. Gated on env var. |
| `dev-supervisor/cmd/airo-sandbox/sandbox_linux.go` | Landlock enforcement. Requires kernel ABI v6. Refuses to start on older kernels (no graceful degradation). |
| `dev-supervisor/internal/sandbox/profile.go` | Allowlist profiles for preview/publish/exec processes. Critically, **`/alloc` is not in any profile** — that's how the signing key is implicitly hidden from customer code. |
| `dev-supervisor/cmd/dev-supervisor/main.go` | Calls `signing.Load()` at startup; wires the signer into `smtpProxy.SetSigner`, `emailGateway.SetSigner`, and `httpProxy.SetSigner` (the last for the debug endpoint). |

#### BFF (Next.js / TypeScript)

| Path | Purpose |
|---|---|
| `app/src/lib/dkim/dkim-client.ts` | Vox API client (`POST /onboard`, `POST /offboard`). mTLS-cert→SSO-JWT auth chain. |
| `app/src/lib/dkim/mail-flow-client.ts` | Mail-flow status polling (`GET /domains/{domain}/dkim`). |
| `app/src/lib/dkim/dkim-service.ts` | Orchestrates activate/deactivate. Switchboard-gated on `appbuilder-dkim-onboarding`. |
| `app/src/app/api/apps/[id]/dkim/onboard/route.ts` | Triggered after a domain is attached. Looks up DCC ownership; if INTERNAL, calls `dkim-service.activate`. |
| `app/src/app/api/apps/[id]/dkim/offboard/route.ts` | Mirror for domain detach. |
| `app/src/app/api/apps/[id]/dkim/status/route.ts` | Polls mail-flow for DKIM verification state. |
| `app/src/app/api/apps/[id]/email-signing/debug/route.ts` | Switchboard-gated wrapper around dev-supervisor's `/airo/email/test-send`. Mints a 5-min agents-service JWT, forwards to the alloc preview URL, returns the wrapped response. |

#### Agent skill

| Path | Purpose |
|---|---|
| `agents/src/skills/email/skill.md` | Documents the three sender-identity patterns the relay accepts: omit-from (default), custom local-part on connected domain, `<exact-app-id>@airoapp.ai` (rare). Explicit guidance against recommending Resend/SendGrid (they bypass the platform's trust path). |

### 4.2 `mhp-core` (control plane + libsonnet)

| Path | Purpose |
|---|---|
| `backends/hosting/internal/config/config.go` | Defines `EnableJwsSigning` and `EnableJwsSignDebug` Go config fields. Loaded from env vars `ENABLE_JWS_SIGNING` / `ENABLE_JWS_SIGN_DEBUG` OR mgmt.php keys `enableJwsSigning` / `enableJwsSignDebug`. |
| `backends/hosting/internal/templates/service.go` | Passes both flags into `Variables.config` for jsonnet rendering. |
| `templates/.../v4/job-templates/main/global-templates/fetch-signing-key.libsonnet` | The `fetch-signing-key` prestart task. Uses `amazon/aws-cli:2.13.0` to fetch from `airo/smtp-signing/cells/<cell>/{private-key,cert,key-id}` into `${NOMAD_ALLOC_DIR}/jws-signing-{key.pem,cert.pem,key-id}`. `set +e` + `exit 0` so transient ASM failures don't bounce the alloc. |
| `templates/.../v4/job-templates/main/job.jsonnet` | Conditionally includes the prestart task when `Variables.config.enableJwsSigning` is true. When false, the task is omitted entirely from the rendered Nomad job. |
| `templates/.../v4/job-templates/main/app-templates/preview.libsonnet` | Sets `JWS_PRIVATE_KEY_PATH`, `JWS_CERT_PATH`, `JWS_KEY_ID_PATH`, `CELL_ID`, and `DEV_SUPERVISOR_SIGN_DEBUG_ENABLED` env vars on the preview task. |
| `templates/.../v4/job-templates/main/app-templates/publish.libsonnet` | Same env vars on the publish task. |
| `secrets-templates/mgmt-api-hosting.json` | mgmt.php template — references `enableJwsSigning` and `enableJwsSignDebug` from environment vars files. |
| `secrets-templates/vars-mhp-development.json` | Test/dev environment values: both flags `true`. |
| `secrets-templates/vars-mhp-production.json` | Production values: both flags `false` (signing turned on per-cell once vetted; debug NEVER on in prod). |

### 4.3 `pioneer-infra` (Terraform + bootstrap)

| Path | Purpose |
|---|---|
| `terraform/modules/hosting-cell/jws-signing.tf` | Per-cell Terraform module. When `var.enable_jws_signing = true`: reads CA from ASM, generates leaf RSA 2048, signs (1y validity), writes leaf+key+key-id to `airo/smtp-signing/cells/<cell>/`, attaches scoped `secretsmanager:GetSecretValue` IAM policy to the onegroup instance role. |
| `terraform/environments/dev/sxb1/c4/terragrunt.hcl` | c4-dev cell config: `enable_jws_signing = true`. |
| `bin/jws-signing/bootstrap-ca.sh` | One-time, per AWS account. Creates the offline intermediate CA secrets at `airo/smtp-signing/ca-{key,cert}`. Prints the public CA cert for the relay team's trust store. |
| `bin/jws-signing/provision-cell-keys.sh` | Per-cell manual seed (alternative to Terraform — prefer Terraform for prod). |
| `bin/jws-signing/verify.sh` | Validates the secrets exist, the CA→leaf chain is valid, the JWS pipeline produces a verifiable assertion. |
| `bin/jws-signing/_lib.sh` | Shared shell helpers (`make_tempdir`, `cleanup_tempdir`, `verify_aws_auth`). |
| `bin/jws-signing/README.md` | Operator guide. |

---

## 5. Configuration Knobs

The full ladder, in order from "infrastructure provisioning" to "runtime per-request":

| Knob | Where set | Default | Effect |
|---|---|---|---|
| `enable_jws_signing` (Terraform var) | pioneer-infra cell terragrunt.hcl | `false` | Provisions per-cell ASM secrets + IAM grant. Without this, no key material exists for the cell. |
| `EnableJwsSigning` (Go config) | mhp-core: `ENABLE_JWS_SIGNING` env var on the mhp-core service deployment, OR `enableJwsSigning` key in mgmt.php (which is rendered from `secrets-templates/vars-mhp-{env}.json`) | `false` | When true, mhp-core's libsonnet renderer includes the `fetch-signing-key` prestart task in the alloc spec. Without this, key material exists in ASM but never reaches the alloc filesystem. |
| `EnableJwsSignDebug` (Go config) | mhp-core: `ENABLE_JWS_SIGN_DEBUG` env var, OR `enableJwsSignDebug` mgmt.php key | `false` | When true, `DEV_SUPERVISOR_SIGN_DEBUG_ENABLED='true'` is set on preview/publish tasks. Without this, the debug `/airo/email/test-send` endpoint returns 404. **Test cells only — never set in production.** |
| `JWS_PRIVATE_KEY_PATH`, `JWS_CERT_PATH`, `JWS_KEY_ID_PATH` (alloc env vars) | Set unconditionally by preview/publish libsonnet to `${NOMAD_ALLOC_DIR}/jws-signing-{key,cert}.pem` and `${NOMAD_ALLOC_DIR}/jws-key-id` | (always set) | Tells dev-supervisor's `signing.Load()` where to find the keys. Files only exist if the prestart task ran (gated by `EnableJwsSigning` above). |
| `DEV_SUPERVISOR_SIGN_DEBUG_ENABLED` (alloc env var) | Set by libsonnet from `Variables.config.enableJwsSignDebug` | `''` | When `'true'`, dev-supervisor's `/airo/email/test-send` route accepts requests. Otherwise returns 404. |
| `DEV_SUPERVISOR_SANDBOX_ENABLED` (alloc env var) | dev-supervisor config | `false` | When true, `airo-sandbox` applies Landlock to customer processes. **Independent of signing** — signing works either way; sandbox is what makes "customer can't read the key" kernel-enforced rather than Unix-permissions-only. Requires Landlock ABI v6 on the host kernel. |
| `appbuilder-dkim-onboarding` (switchboard) | switchboard-config repo for the environment | varies | Master kill switch for Vox onboarding calls. When off, `dkim-service.activate` returns `{result: 'skipped'}`. Existing DKIM CNAMEs in DNS stay published. Outbound mail still flows; just no new domain onboardings. |
| `appbuilder-jws-signing-debug` (switchboard) | switchboard-config repo for the environment | off in all environments by default | Gates the BFF debug wrapper at `/api/apps/[id]/email-signing/debug`. **Test environments only.** Production must keep this off. |

### 5.1 Two-source resolution for the Go flags

`EnableJwsSigning` and `EnableJwsSignDebug` resolve from either source — env var on the mhp-core service deployment OR mgmt.php key. The mgmt.php source (via `secrets-templates/`) is the durable, code-reviewed path. The env var path is a fast hack for one-off testing on a specific deployment without committing changes.

Code path for both:

```
Go startup → getEnvOrDefault("ENABLE_JWS_SIGNING", "false")
           → cfg.EnableJwsSigning = (value == "true")
mgmt.php load → applyPhpDataToConfig overrides with mgmt.php key if present
              → final cfg.EnableJwsSigning value
```

The mgmt.php override **wins** if both are set, because it runs after the env-var read. So setting `enableJwsSigning: false` in mgmt.php for prod overrides any `ENABLE_JWS_SIGNING=true` env var that might have been left around.

---

## 6. Threat Model

The signing key file lives at `${NOMAD_ALLOC_DIR}/jws-signing-key.pem` (typically `/alloc/jws-signing-key.pem`) inside the customer alloc — same filesystem namespace as the customer process. Two layers of protection:

### 6.1 Landlock (primary, kernel-enforced when sandbox is on)

`airo-sandbox` applies a Landlock ruleset before exec'ing the customer process. The ruleset is **allowlist-only**: paths not listed return `EACCES` to all syscalls.

The allowlist (preview profile, from `internal/sandbox/profile.go`):

```
rwc on  /app, /tmp, /home/agent, /private
rx  on  /node_modules
connect TCP {80, 443, 53, 3306, 25}
```

`/alloc` is **not** in any profile. The customer's `open("/alloc/jws-signing-key.pem")` returns EACCES — the kernel refuses before the file system code runs.

Landlock rules are:

- **Inherited** by all child processes
- **Irrevocable** — there's no syscall to widen them after they're applied
- **Kernel-enforced** — no userspace bypass

`dev-supervisor` itself doesn't pass through `airo-sandbox`, so it retains full filesystem access. The trust boundary is the `airo-sandbox` invocation.

### 6.2 SELinux (defense-in-depth, designed but not yet shipped)

Phase 2: label the key file `system_u:object_r:smtp_signing_key_t:s0`, allow only `dev_supervisor.process` to read that type, set `airo_customer_app.process` as the exec label in airo-sandbox via `goselinux.SetExecLabel`. A kernel bug bypassing Landlock would still hit SELinux as an independent LSM check.

Not gating the rollout on this. Landlock alone is sufficient; SELinux is convenience.

### 6.3 Concrete attack table

| Attack | Stopped by | Notes |
|---|---|---|
| Customer code calls `open("/alloc/jws-signing-key.pem")` | Landlock | Path not in allowlist → EACCES |
| Customer code reads `/proc/1/environ` to grab the key from env | N/A | Key is **never** in env vars; only file paths are |
| Customer code mounts /proc or /sys to read PID1 memory | Landlock + container caps drop CAP_SYS_ADMIN | Multiple barriers |
| Customer code uses `ptrace` on `dev-supervisor` (PID 1) | Container caps drop CAP_SYS_PTRACE; Landlock seccomp | Multiple barriers |
| Customer code reads `/proc/1/mem` directly | Container security: customer is uid != 0, can't read another uid's memory | OS isolation |
| Customer code spoofs JWS shape to fool the relay | Cryptographic — relay verifies signature against trusted intermediate CA | The customer doesn't have the leaf private key |
| Sandbox is OFF (`DEV_SUPERVISOR_SANDBOX_ENABLED=false`) | **Unix file permissions only** — `chmod 400`, owned by root | Acceptable for v1; weaker than kernel-enforced |
| Kernel bug bypasses Landlock | SELinux (when v2 ships) | Two-LSM defense-in-depth |
| Kernel bug bypasses both Landlock AND SELinux | Nothing — game over | Residual risk; security team accepted |
| Operator misconfigures sandbox profile and adds `/alloc` | `internal/sandbox/profile_test.go` invariants | Test enforces no profile contains `/alloc`; CI catches at PR time |

### 6.4 Kernel prerequisite

Landlock ABI v6 is required (filesystem rules + network rules + IPC scoping). `airo-sandbox` checks at startup and refuses to start on older kernels — fail-closed, no graceful degradation.

```bash
# On any cell node, before flipping DEV_SUPERVISOR_SANDBOX_ENABLED=true:
cat /sys/kernel/security/landlock/abi_version
# Expect: 6 or higher

cat /sys/kernel/security/lsm
# Expect: comma-separated list including "landlock" and "selinux"
```

If the kernel doesn't meet this bar, signing still works (the env-var-gated `airo-sandbox` is independent of `signing.Load()`) — the customer just isn't kernel-isolated from the key. The security regression is the difference between "Unix permissions" and "Landlock-enforced." Both are defensible for v1; kernel-enforced is the long-term goal.

---

## 7. Rollout Sequence

In order of dependency. Each step assumes the previous succeeded.

### Step 1 — Bootstrap CA (one-time per AWS account)

```bash
aws sso login --profile <account-profile>
./pioneer-infra/bin/jws-signing/bootstrap-ca.sh \
    --profile <account-profile> --region <region>
```

Capture the printed CA cert PEM and hand it to the relay team. **This must happen before any customer mail flows signed** — otherwise the relay can't verify any leaf cert.

### Step 2 — Provision per-cell signing material

For each cell that should support signing, set in its terragrunt.hcl:

```hcl
enable_jws_signing = true
```

Then:

```bash
cd pioneer-infra/terraform/environments/<env>/<region>/<cell>
terragrunt plan
terragrunt apply
./pioneer-infra/bin/jws-signing/verify.sh \
    --profile <account-profile> --region <region> \
    --cell <cell-short-name>
```

Verify output should show CA→leaf chain valid, all three secrets present, signing pipeline produces a verifiable assertion.

### Step 3 — Enable in mhp-core control plane

Two paths (use one):

**Path A (durable):** commit `secrets-templates/vars-mhp-{env}.json` with `EnableJwsSigning: true` (and `EnableJwsSignDebug: true` for test environments only). Deploy mhp-core. New mgmt.php contains the keys; Go config picks them up.

**Path B (fast hack):** set `ENABLE_JWS_SIGNING=true` (and `ENABLE_JWS_SIGN_DEBUG=true` for test) as env vars on the mhp-core hosting service deployment. Restart mhp-core.

After either, **redeploy any customer alloc you want signing on** — the alloc's job spec is rendered from libsonnet at deploy time, not at mhp-core deploy time. Bumping the app version, making any commit to the customer app, or clicking deploy in the builder UI does it.

### Step 4 — Deploy `airo-app-builder`

Standard Katana deploy of:

- BFF (`app/`)
- dev-supervisor (the customer alloc image)
- agents (skill changes)

No special env vars needed.

### Step 5 — Flip switchboard flags

For test cells that need DKIM onboarding to fire on domain attach:

```
appbuilder-dkim-onboarding: true
```

For test cells that need the debug API:

```
appbuilder-jws-signing-debug: true
```

Production: `appbuilder-dkim-onboarding` only when ready for live customer traffic. **Never** flip `appbuilder-jws-signing-debug` in production.

---

## 8. Debug API — `/api/apps/[id]/email-signing/debug`

Purpose: confirm signing works end-to-end on a cell where the normal customer flow can't be exercised (e.g. DCC outage blocking domain attach).

### 8.1 What it does

Sends a real email through the existing `/api/email/send` HTTP gateway pipeline (same code path customer apps hit via nodemailer). Returns the upstream send result wrapped with the alloc's signing state at the moment of the call.

**Important:** this causes a real outbound email. Use a recipient inbox you own; the sentinel-domain default doesn't apply to the BFF wrapper.

### 8.2 Two-layer gating

Both must pass:

1. **Switchboard flag** `appbuilder-jws-signing-debug` enabled in the request's environment.
2. **Alloc env var** `DEV_SUPERVISOR_SIGN_DEBUG_ENABLED='true'` (controlled by mhp-core's `enableJwsSignDebug`).

Either off → 404 with a hint pointing at which gate failed.

### 8.3 Request

```bash
curl -X POST 'https://<bff-host>/api/apps/<appId>/email-signing/debug' \
    -H 'Content-Type: application/json' \
    -H "Cookie: auth_idp=$TOKEN" \
    -d '{
      "to": ["your-test-inbox@gmail.com"],
      "subject": "JWS signing test",
      "text": "Looking for DKIM-Signature in the delivered headers."
    }'
```

The body shape mirrors `dev-supervisor`'s `emailhttp.SendRequest`. All fields optional; gateway applies its policy to `from` if set, default-fills with `<appId>@<connected-domain>` if not.

### 8.4 Response — happy path

```json
{
  "debug_url": "https://<appId>.preview.<cell>.test-airoapp.ai/airo/email/test-send",
  "cell_id": "c4-dev-sxb1-eu-central-1",
  "upstream_status": 200,
  "result": {
    "signing_enabled": true,
    "key_id": "c4-20260520",
    "cell_id": "c4",
    "would_forward_to": "p3nlsmtpcp01-v01.prod.phx3.secureserver.net:25",
    "upstream_status": 200,
    "upstream": {
      "success": true,
      "messageId": "<gateway-assigned-id>"
    }
  }
}
```

Fields to read:

| Field | Meaning |
|---|---|
| `result.signing_enabled` | **The answer.** True iff `signing.Load()` succeeded at dev-supervisor startup. |
| `result.key_id` | Matches `airo/smtp-signing/cells/<cell>/key-id` ASM secret value. Tracks which leaf cert is in use. |
| `result.cell_id` | Confirms which cell signed it. |
| `result.would_forward_to` | The relay address dev-supervisor would have shipped to. |
| `result.upstream_status` | The HTTP gateway's response status. 200 = sent; 400 = policy reject (see §8.6). |
| `result.upstream.messageId` | The message-id baked into the email's headers. Useful for cross-referencing with relay logs. |

### 8.5 Gate ladder — what the failure response tells you

| Response | Which gate failed |
|---|---|
| `401 Token is expired` | Your `auth_idp` cookie is past its `vat`. Re-login in the builder UI, grab fresh value. |
| `404 {"error": "Not found"}` (no other fields) | Switchboard flag `appbuilder-jws-signing-debug` is off for this environment. |
| `404 {"error": "JWS debug endpoint disabled on the alloc", "hint": "Set DEV_SUPERVISOR_SIGN_DEBUG_ENABLED=true..."}` | Switchboard on, but alloc's env var is off. mhp-core `enableJwsSignDebug` not true, or alloc not yet redeployed since the flag flipped. |
| `502 dev-supervisor /airo/email/test-send unreachable` | BFF can't reach the preview hostname. Alloc not running, DNS issue, or wrong cell. |
| `200` with `result.signing_enabled: false` | Endpoint reachable but no signer wired. `signing.Load()` returned nil at dev-supervisor startup. See §9.2. |
| `200` with `result.upstream_status: 400 "from address not permitted"` | Gateway's sender-identity policy rejected the from-address. Use `<appId>@airoapp.ai` or omit `from`. Independent of signing state. |

### 8.6 Sender-identity policy

The gateway accepts (loud-rejects anything else with 400):

| Pattern | Example | Notes |
|---|---|---|
| Omit `from` | (no field) | Gateway picks `<appId>@<connected-domain>` if a domain is attached, else `<appId>@airoapp.ai`. Always passes. |
| Exact app-id local-part on platform default | `xybxond463@airoapp.ai` | Always passes; useful when you want a deterministic from in tests. |
| Custom local-part on connected domain | `noreply@<connected-domain>` | Passes only if `<connected-domain>` is verified-attached for this app. |

`noreply@airoapp.ai` does NOT pass — local-part doesn't match the app id. This is a common confusion; the `from` field is policy-checked separately from signing.

---

## 9. Verification

### 9.1 Confirm dev-supervisor loaded the keys

After mhp-core deploy + alloc redeploy:

```bash
ALLOC=$(nomad job allocs -t '{{(index . 0).ID}}' airo-<appId>)

# 1. Job spec includes the prestart task
nomad job inspect airo-<appId> | jq '.Job.TaskGroups[0].Tasks[].Name'
# Expect: ["fetch-signing-key", "preview", "publish"]

# 2. Prestart task ran successfully
nomad alloc logs $ALLOC fetch-signing-key 2>&1 | tail -20

# 3. Files landed in /alloc
nomad alloc exec $ALLOC preview ls -la /alloc/jws-signing-key.pem /alloc/jws-signing-cert.pem /alloc/jws-key-id

# 4. signing.Load() succeeded
nomad alloc logs $ALLOC preview 2>&1 | grep "jws.signing\." | tail -5
# Expect: jws.signing.enabled key_id=<cell>-YYYYMMDD cell=<cell>
```

### 9.2 Confirm signing fires on a real send

Two independent signals:

```bash
# Per-send log marker
nomad alloc logs $ALLOC preview 2>&1 | grep -E "email_gateway.send.ok|email.sign" | tail -3
```

And at the **recipient inbox**, "Show original" should display:

```
DKIM-Signature: v=1; a=rsa-sha256; d=<from-domain>;
                s=secureserver1; bh=<base64>; b=<base64>;
Authentication-Results: <receiver>; dkim=pass header.d=<from-domain>;
```

`dkim=pass` confirms the **relay** verified the JWS and applied real DKIM. That's the load-bearing end-to-end check.

### 9.3 Quick sanity grep set

After any rollout step, this captures most failure modes in one go:

```bash
nomad alloc logs $ALLOC preview 2>&1 | grep -E \
    "jws.signing.(enabled|disabled|load_failed|sign_failed)|smtp.sender_rewritten|email_gateway.send.(ok|failed)" \
    | tail -10
```

| Marker | Meaning |
|---|---|
| `jws.signing.enabled key_id=...` | Keys loaded; signing active for every send |
| `jws.signing.disabled reason="no JWS_PRIVATE_KEY_PATH..."` | env var unset on alloc; alloc is on stale spec |
| `jws.signing.load_failed error=...` | env vars set, files missing/unreadable; prestart task didn't run or ASM call failed |
| `jws.signing.sign_failed` | Per-message sign error (rare); message forwarded unsigned |
| `smtp.sender_rewritten` | SMTP path rewrote a from-address that didn't pass policy |
| `email_gateway.send.ok` | HTTP path delivered successfully |

---

## 10. Operational Runbook

### 10.1 Add a new cell to the JWS feature

1. Set `enable_jws_signing = true` in the cell's `terragrunt.hcl`.
2. `terragrunt apply` the cell module.
3. Run `bin/jws-signing/verify.sh --cell <short-name>` — confirm CA→leaf chain valid.
4. Cell's mhp-core sees `EnableJwsSigning: true` from the env's mgmt.php.
5. Trigger one customer alloc redeploy in the cell — confirm `signing_enabled: true` via debug API.

### 10.2 Rotate a leaf key

```bash
cd pioneer-infra/terraform/environments/<env>/<region>/<cell>
terragrunt taint module.hosting_cell.tls_private_key.smtp_signing
terragrunt apply
```

This regenerates the keypair, re-signs the leaf with the same CA. Allocs pick up the new key on next `fetch-signing-key` run, which happens at alloc start. Existing allocs continue using the old key until they cycle. To force pickup immediately, redeploy customer apps in the cell.

The intermediate CA stays the same → relay's trust store unchanged.

### 10.3 Rotate the intermediate CA

This breaks every existing leaf cert (signed by the old CA, verifiable only against the old CA cert in the relay's trust store). Coordinate with relay team:

1. Run `bootstrap-ca.sh` (creates new ca-key/ca-cert, overwriting placeholder check first).
2. Hand the new CA cert to relay; they install **alongside** the old one (dual-trust window).
3. `terragrunt apply` every cell to re-sign leaf certs against the new CA.
4. Once every cell is re-signed and allocs have cycled, relay removes the old CA cert.

Not scripted today — manual coordination required.

### 10.4 Decommission a cell

```bash
aws --profile <account> --region <region> secretsmanager delete-secret \
    --secret-id airo/smtp-signing/cells/<cell>/private-key \
    --force-delete-without-recovery

# Repeat for /cert and /key-id
```

Or `terragrunt destroy` the cell module (does the same plus removes the IAM grant).

### 10.5 Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `signing_enabled: false` after deploy | Customer alloc not redeployed since mhp-core flag flipped | Bump app version / trigger redeploy from builder UI |
| `signing_enabled: false`, `jws.signing.load_failed` in logs | Prestart task didn't write key file. ASM IAM denial, or cell secrets don't exist | Check `nomad alloc logs <id> fetch-signing-key`; run `bin/jws-signing/verify.sh` |
| `dkim=fail` at recipient | Relay rejected JWS. Wire-format drift, expired cert, untrusted CA | Compare a debug-API response's `body_hash` against what the relay computed; verify CA cert is in relay's trust store |
| `signing_enabled: true` but no `DKIM-Signature` at recipient | Relay verified JWS but didn't apply DKIM. Domain not Vox-onboarded | Check `dkim.activate.success` log line for the domain; check Vox status via `GET /api/apps/<id>/dkim/status` |
| 400 "from address not permitted" on debug send | Gateway sender-identity policy rejected `from` | Use `<appId>@airoapp.ai` or omit |
| 404 from debug endpoint | One of the two gates is off (switchboard or alloc env var) | See gate ladder in §8.5 |
| Email arrives, `From: <appId>@airoapp.ai` instead of `noreply@<custom-domain>` | Custom domain wasn't verified-attached at send time | Check domain status in builder UI; wait for verification to propagate (~minutes) |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Sable** | The hosting relay that receives outbound mail from the alloc and applies DKIM. Verifies the JWS we inject. |
| **Vox** | The DKIM provisioning service. Called once per domain at attach time to publish the `secureserver1/2._domainkey` CNAME records and key material. |
| **DCC** | Domain Control Console — the GoDaddy service that determines whether a customer-typed domain is GoDaddy-managed (INTERNAL) or external. The auto-onboard hook only fires for INTERNAL. |
| **Mail-flow** | The DKIM/DMARC status-polling API. `GET /domains/<d>/dkim` returns whether the published records pass validation. |
| **Intermediate CA** | The Airo-controlled signing authority for per-cell leaf certs. One per AWS account; bootstrapped once. |
| **Leaf cert** | The per-cell cert that goes into `X-GD-DKIM-PUB-KEY` on the wire. Signed by the intermediate CA, valid 1 year by default. |
| **`kid`** | Key identifier carried in dev-supervisor's `Signer` for diagnostics. **NOT placed in the JWS header** — the relay's verifier doesn't look at it. |
| **`appbuilder-dkim-onboarding`** | Switchboard flag that gates Vox onboarding calls. Master kill switch for the whole flow. |
| **`appbuilder-jws-signing-debug`** | Switchboard flag that gates the BFF debug wrapper. Test environments only. |
| **`signFn`** | The `*signing.Signer.SignMessage` method value installed on the SMTP proxy and HTTP gateway. Both paths share one `Signer` per dev-supervisor process. |

---

## 12. References

- **Source files** — see §4 for the per-repo file map.
- **Bootstrap scripts** — `pioneer-infra/bin/jws-signing/README.md` for operator-facing detail.
- **cPanel reference verifier** — `/etc/gd_domain_validation.pl` on shared hosting (defines the relay's expectations; our wire format is matched against this byte-for-byte).
- **Python parity test** — `scripts/test_dkim_send_mail.py` (in the dev-supervisor repo); produces the same JWS our Go code does for the same inputs. Used as a relay-parity oracle in unit tests.

---

*This is the canonical operations reference. If something here disagrees with the source, treat the source as truth and submit a PR fixing this doc.*
