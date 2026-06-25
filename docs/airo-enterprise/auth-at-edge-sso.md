# Auth-at-Edge SSO

How AAB protects **published apps** with the customer's own identity provider, so that end users of the published app must sign in via the customer's Okta / Azure AD / etc. before reaching the app.

| | |
|---|---|
| Status | Phase 1 (AAB-side scaffold shipped on the `feature/ISSE-3642-aab-phase1-sso` branch) |
| Scope | Per-app OAuth-based SSO for enterprise customers' *published* apps |
| First customer | GoDaddy internal employees |
| AAB ticket | [ISSE-3642](https://godaddy-corp.atlassian.net/browse/ISSE-3642) |
| Storage / security model (mhp-core) | [`AuthAtEdge-PerAppSecrets-AuthClassification.md`](https://github.com/gdcorp-partners/mhp-core/blob/main/backends/hosting/docs/AuthAtEdge-PerAppSecrets-AuthClassification.md) |

## Why this exists

Without this feature, every published AAB app is unauthenticated — anyone with the URL can use it. That's fine for marketing pages, but enterprises with internal tools need a gate: HR dashboards, partner portals, ops runbooks. The customer wants their own IdP in front, not a GoDaddy-managed one, so they can apply their own access policies, MFA, group rules, and offboarding.

This feature gives enterprise customers exactly that:

- They register an OAuth app at their IdP.
- They paste the resulting **Client ID** and **Client Secret** into AAB's Settings → SSO panel.
- Their published app, when visited, redirects users to the IdP, validates the returned ID token, and lets the user through.

AAB never sees the user's identity — that's between the customer and their IdP. AAB only carries the `clientId/clientSecret` so the in-container auth proxy can perform the OAuth exchange.

## Concrete example

A GoDaddy employee builds an internal HR tool in AAB.

1. **Admin enables SSO for the app.** A platform admin runs `mgmt apps:patch <appId> --sso-required=true`.
2. **Employee configures the IdP credentials.** They open Settings → SSO in the builder. The panel shows a locked alert ("SSO is required for all apps in your organization") and a 2-step intro:
   1. Register an OIDC web application in Okta.
   2. Copy the Client ID and Client Secret from Okta and paste them in the form below.
3. **Employee saves.** Click Save → AAB writes the credentials to a secure server-side store. The form shows "✓ SSO configured".
4. **Employee publishes the app.** The publish button, which was disabled until step 3, is now enabled.
5. **A teammate visits the published app.** Their browser is redirected to GoDaddy Okta. They sign in. Okta redirects them back. The app loads.

If the employee tries to publish before saving credentials, the button is disabled with an alert pointing them at Settings → SSO. If anyone tries to share a public link to the app, the share button is disabled too — share links bypass the IdP by design, which contradicts the SSO requirement.

## Who controls what

The feature spans four layers, each owned by a different concern. Keeping these separate by design avoids accidental coupling between admin policy, customer credentials, builder UX, and runtime enforcement.

| Layer | Responsibility |
|---|---|
| **Platform admin** (mhp-core via mgmt-client) | Sets `apps.sso_required = true` on the customer's app. Provisions the per-subscription SSO config (`airo_enterprise_sso_configs`: `idp_type`, `issuer`, `expected_audience`, `signing_cert` / `jwks_url`). |
| **Customer** (in the AAB builder) | Registers an OIDC application at their own IdP and pastes Client ID + Client Secret into Settings → SSO. They never type the issuer URL — that's already set by the platform admin. |
| **AAB BFF + UI** | Surfaces the SSO panel when `ssoRequired === true`, validates the form, writes the credentials through airo-go's customer-proxy as two `auth`-class pointer rows, gates the publish + share buttons until credentials are saved. |
| **dev-supervisor** (runtime, in-container) | Reads the credentials from `auth.json` at container startup. When an end user hits the published app, runs the OAuth handshake against the customer's IdP, sets a session cookie, lets them through. |

## End-to-end flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Admin time (one-time per app + one-time per subscription)                  │
└────────────────────────────────────────────────────────────────────────────┘

   Platform admin runs:                    ┌─────────────────────────────────┐
                                           │ airo_enterprise_sso_configs     │
   mgmt sso-config:create  ────────►       │  - issuer = godaddy.okta.com    │
                                           │  - jwks_url, expected_audience  │
                                           └─────────────────────────────────┘
   mgmt apps:patch <appId>                 ┌─────────────────────────────────┐
     --sso-required=true     ────────►     │ apps                            │
                                           │  - sso_required = true          │
                                           │  - sso_config_id = <cfg-id>     │
                                           └─────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│ Customer configuration (in the AAB builder)                                │
└────────────────────────────────────────────────────────────────────────────┘

   Customer opens Settings → SSO panel
   (visible when ssoRequired=true OR ssoOverrideAllowed=true)
                ▼
   (Phase 2) If admin tier is 'optional', flips the toggle ON
                ▼
   Pastes Client ID + Client Secret, clicks Save
                ▼
   AAB BFF → airo-go customer-proxy → mhp-core hosting   ┌──────────────────────┐
   POST /api/airo/v1/.../apps/{id}/secrets                │ hosting_app_secrets  │
   { operations: [                                        │  Two rows:           │
     { type: "upsert", secret: {                     ─►   │   GD_SSO_OAUTH_      │
       name: "GD_SSO_OAUTH_CLIENT_ID",                    │    CLIENT_ID         │
       auth: true, systemManaged: false,                  │   (auth=true,        │
       value: "<the-client-id>" } },                      │    systemManaged=    │
     { type: "upsert", secret: {                          │    false)            │
       name: "GD_SSO_OAUTH_CLIENT_SECRET",                │   GD_SSO_OAUTH_      │
       auth: true, systemManaged: false,                  │    CLIENT_SECRET     │
       value: "<the-client-secret>" } }                   │   (same)             │
   ] }                                                    └──────────────────────┘
                                                              ▼
                                          On next deploy, both rows extract
                                          to the publish container as
                                          /alloc/secrets/hosting/auth.json
                                          (Landlock-isolated from the
                                          customer's app process)

┌────────────────────────────────────────────────────────────────────────────┐
│ End-user runtime (every request to the published app)                      │
└────────────────────────────────────────────────────────────────────────────┘

   End user visits  https://<appId>.<cell>.airoapp.ai/some/page
                ▼
   dev-supervisor (PID 1 in the publish container) intercepts
                ▼  (no session cookie?)
   Reads clientId / clientSecret from auth.json (customer's app cannot)
                ▼
   Redirects browser to godaddy.okta.com/oauth2/v1/authorize?...
                ▼
   User signs into Okta
                ▼
   Okta redirects to /airo/idp/callback?code=...
                ▼
   dev-supervisor exchanges code for ID token, validates the signature
   against jwks_url, sets session cookie, lets the user through.
```

## The four AAB-side gates

The customer's UI flow is one path to publishing, but the same publish action can be triggered three other ways. Each is gated independently so no surface can bypass the requirement:

| Trigger | Gate | Behavior |
|---|---|---|
| Customer clicks Publish in the UI | `useAppSsoStatus` → `AppPublish.tsx` | Button disabled, alert shown until SSO is configured |
| AI agent in chat says "let's publish" | `client_action` → browser → BFF → mhp-core hosting | mhp-core's `publish_prerequisites.go` (queries the `SSO_OAUTH_CONFIG` row's presence) — the canonical authority |
| Direct BFF call (`POST /api/apps/[id]/deployments`) | Same as above | Same |
| Direct agents call (`POST /apps/:id/publish` over UDS) | `requireSsoConfigured` middleware | 403 from JWT claims (`ssoRequired` + `ssoConfigured`) baked at agent-token mint time |

The same pattern applies to share-link mints, with one carve-out: hosting's `archive_snapshot` system path (cert2s tokens used for screenshot capture) bypasses the gate because it isn't user-shareable and blocking would break archive captures.

The hosting-side gate is the canonical authority. The agents/ middleware is parallel enforcement that closes the bypass surface for any caller holding a valid agent JWT — per-request cost in agents/ is zero (claim read, no extra HTTP).

## The two-row data model

mhp-core's `auth` classification splits the per-app SSO state into TWO concerns:

1. **The cache row** (`SSO_OAUTH_CONFIG`, `auth:true, systemManaged:true`) — a single secret whose JSON value carries the SSO metadata: `idpType`, `issuer`, `jwksUrl`, `expectedAudience`, `ssoRequired` (resolved bool), `clientIdKey`, `clientSecretKey`. **Auto-seeded by airo-go's `UpsertSSOConfigCacheTask` on app create. AAB never writes this.**

2. **The credential pointer rows** — names from the cache row's `clientIdKey` / `clientSecretKey` fields (defaults `GD_SSO_OAUTH_CLIENT_ID` / `GD_SSO_OAUTH_CLIENT_SECRET`). Each is `auth:true, systemManaged:false` holding the bare credential string. **This is what AAB writes** when the customer clicks Save.

At runtime, dev-supervisor reads the cache row, looks up the pointer keys, and resolves the credentials from the pointer rows — all from a single `auth.json` file inside the publish container.

## Why a dedicated `auth` secret class

Two properties matter:

1. **The customer's own app cannot read its own SSO credentials.** Auth-class secrets route to `${NOMAD_SECRETS_DIR}/hosting/auth.json`, which is outside the customer process's Landlock allowlist. Same kernel-enforced isolation the JWS/DKIM signing keys have used in production for ages.

2. **The customer cannot tamper with the cache row.** `SSO_OAUTH_CONFIG` is `systemManaged: true`; mhp-core's `ValidateAuthClassWrite` blocks any customer-proxy or non-pointer write. Only airo-go's SFN tasks can seed it.

## Why customer-proxy (no mTLS)

mhp-core's validator runs two checks on every auth-class write:

- **`ValidateAuthClassWrite`** (caller-agnostic) — for `auth:true` writes whose name ≠ `SSO_OAUTH_CONFIG`: must EITHER carry `systemManaged:true` (service-context seed) OR target a name matching the cache row's pointer keys. Our writes hit the pointer-key branch.

- **`ValidateCustomerAuthRestrictions`** (customer-proxy via airo-go) — for `auth:true` on pointer names: must NOT carry `systemManaged:true` (would self-wedge subsequent customer writes). Pointer-name gating: the name must match the bound SSO config's `client_id_secret_name` / `client_secret_secret_name` columns.

AAB uses **airo-go's customer-proxy** with the customer's gd-auth JWT (no mTLS, no stripe-service cert). mhp-core PR #738 extended airo-go's `SecretDetailSchema` to forward the `auth` flag through to hosting, so the credential rows land as `auth:true, systemManaged:false`, hitting the pointer-key branch of both validators. The same auth model covers every AAB→mhp-core write (sites, deployments, secrets) — single audit story.

## Phase-2 customer toggle

When the admin tier on the subscription's SSO config is `'optional'` (vs `'true'` / `'false'`), the customer can flip per-app SSO on or off via a toggle in the panel:

```
   Customer flips Settings → SSO toggle
                ▼
   AAB BFF PUT /api/apps/[id]/sso-required  { ssoRequired: true | false | null }
                ▼
   AAB → airo-go customer-proxy
   PUT /api/airo/v1/subscriptions/:subId/apps/:appId/sso-required
                ▼
   airo-go: ShopperJwt + EntityOwner authz; if admin lock != 'optional' → 409 OVERRIDE_LOCKED
                ▼
   airo-go writes airo_apps.sso_required = <new value>
                ▼
   Next app GET response reflects the new resolved ssoRequired
```

The capability flag `ssoOverrideAllowed` on the app GET response tells AAB which UI to render: when `true`, the panel shows a toggle; when `false`, a locked indicator (the admin has hard-locked SSO on or off).

## Phase 1 limitations

| Limitation | Why | When it lifts |
|---|---|---|
| **Cell-default URL only** | `IDP_REDIRECT_URI` is a single static env var on the publish container; custom domains are decoupled from job rendering. SSO works for `<appId>.<cell>.airoapp.ai` but not for an attached `myapp.customer.com`. | When dev-supervisor implements per-host redirect URI derivation. Tracked as a dev-supervisor companion-doc concern (different team). |
| **Pointer-key names default to GD bootstrap** | AAB reads the per-config pointer-key names dynamically from `SiteInfo.clientIdSecretName` / `clientSecretSecretName` (mhp-core PR #738), with `GD_SSO_OAUTH_CLIENT_ID` / `GD_SSO_OAUTH_CLIENT_SECRET` as backstop defaults. Only the GD bootstrap config is in scope today, so the defaults match. Per-IdP overrides require no AAB change. | Already lifted — dynamic-name read is in place. |
| **No customer-facing disable of credentials** | Customer can toggle SSO off (clears the per-app override) but the pointer-row secrets stay in hosting until rotated by an admin. | Phase 2 — customer-facing rotate / clear endpoint. |
| **Multi-IdP per subscription** | Phase 1 expects one SSO config per sub. mhp-core's storage supports many; the UI doesn't pick yet. | Phase 2. |
| **Pre-existing share-link revocation** | When `apps.sso_required` flips mid-flight, share tokens minted earlier still work for their TTL (≤ 7 days). | Accepted MVP gap. |

## Where the code lives

### AAB (this repo)

| File | What |
|---|---|
| `app/src/app/[market]/develop/components/settings/SsoPanel.tsx` | Settings → SSO panel UI |
| `app/src/hooks/useAppSsoStatus.ts` | Reads `ssoRequired`/`ssoConfigId` from site store + `ssoConfigured` from status route |
| `app/src/lib/sso/pointer-names.ts` | Dynamic pointer-name resolver (reads `SiteInfo.clientIdSecretName` / `clientSecretSecretName`, falls back to GD defaults) |
| `app/src/app/api/apps/[id]/sso-required/route.ts` | Phase-2 customer-toggle BFF route — forwards to airo-go |
| `app/src/app/api/apps/[id]/sso-config/route.ts` | BFF POST — saves credentials |
| `app/src/app/api/apps/[id]/sso-config/status/route.ts` | BFF GET — reports presence for the UI hook |
| `app/src/app/api/auth/agent-token/route.ts` | Bakes `ssoRequired` + `ssoConfigured` into agent JWT claims |
| `app/src/components/layout/AppPublish.tsx` | Publish-button gate |
| `app/src/app/[market]/develop/components/layout/ShareLink.tsx` | Share-link button gate |
| `agents/src/server/middleware/require-sso-configured.ts` | Defense-in-depth at the agents/ surface |
| `local-control-plane/internal/api/secrets.go` | LCP `auth`-class secret handling (mirrors hosting's behavior for local dev) |
| `local-control-plane/internal/api/apps.go` | LCP shim for `apps.sso_required` (driven by `AAB_DEV_SUBSCRIPTION_POLICY=required`) |
| `local-control-plane/internal/docker/compose.go` | LCP `IDP_*` env rendering for the publish container |

### Adjacent repos

| Repo | What |
|---|---|
| **mhp-core** | The `auth`-class secret design + reserved-name validator + publish-prerequisite gate + libsonnet `IDP_*` env. See [`AuthAtEdge-PerAppSecrets-AuthClassification.md`](https://github.com/gdcorp-partners/mhp-core/blob/main/backends/hosting/docs/AuthAtEdge-PerAppSecrets-AuthClassification.md). |
| **dev-supervisor** | The runtime OAuth handshake. Companion design doc TBD. |

### Tests

- BFF: `useAppSsoStatus.test.tsx`, `sso-config/route.test.ts`, `sso-config/status/route.test.ts`, `agent-token/route.test.ts` (4 SSO-claim cases), `share/route.test.ts` (SSO gate cases)
- Agents: `require-sso-configured.test.ts`, `build-agent-context.test.ts`, share integration suites
- LCP: `internal/api/handlers_test.go` (auth-class cases), `internal/docker/compose_test.go` (IDP_* env cases)

End-to-end test plan (out-of-tree): `research/AIRO-AUTH-AT-EDGE-PHASE1-TEST-PLAN.md` — two personas (GD-ent + non-ent) covering the full UI + BFF + agents + LCP integration.

## Onboarding cheat sheet

If you're picking up an SSO ticket cold:

1. Read this doc and the parent [README](./README.md) for the broader enterprise vision.
2. Read the [mhp-core companion](https://github.com/gdcorp-partners/mhp-core/blob/main/backends/hosting/docs/AuthAtEdge-PerAppSecrets-AuthClassification.md) for the storage and security model — the reserved-name + Landlock + service-context-cert reasoning.
3. **Run the local-dev personas** from the test plan — easiest way to see the UX:
   ```bash
   AAB_DEV_SUBSCRIPTION_POLICY=required pnpm run dev   # GD-ent persona
   pnpm run dev                                         # non-ent persona
   ```
4. **Trace one publish path** end-to-end. The most-instructive is "AI chat says publish":
   `agent` → emits `client_action` → SSE → `app/src/hooks/chat/actions/publishAction.ts` → BFF `/api/apps/[id]/deployments` → mhp-core hosting publish prerequisite gate.
5. **For changes to the panel UX**, the file is `SsoPanel.tsx` — small, no shared mutable state, easy to iterate.
6. **For changes to the gate semantics**, you almost certainly need to update three places at once: UI hook (`useAppSsoStatus`), BFF (`agent-token` mint + the relevant route gate), and agents/ middleware. The test plan has the full coverage matrix.
