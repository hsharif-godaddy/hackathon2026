# Multi-User — Flows & Journeys

Request-level sequences, FGA HTTP shapes, tuple propagation, and per-role user journeys for AAB
multi-user. For the architecture and component reference see
[multi-user-architecture.md](./multi-user-architecture.md); for product/MVP decisions see
[multi-user-rbac-planning.md](./multi-user-rbac-planning.md).

> **Relation names:** this doc uses the shipped FGA relations (`airo_app_build`, `airo_app_publish`,
> `airo_app_manage_secrets`, `airo_app_manage_domains`, `airo_app_download`, `admin`, `owner`). Older
> drafts used `can_*` names — those were planning placeholders.

---

## Table of Contents

1. [The three credentials](#1-the-three-credentials)
2. [SSO vs FGA vs agent JWT](#2-sso-vs-fga-vs-agent-jwt)
3. [FGA HTTP shapes](#3-fga-http-shapes)
4. [Tuples & propagation lag](#4-tuples--propagation-lag)
5. [Request flows](#5-request-flows)
6. [Responsibility split (CDS vs AAB)](#6-responsibility-split-cds-vs-aab)
7. [User journeys (J1–J14)](#7-user-journeys-j1j14)
8. [Local mock mode](#8-local-mock-mode)

---

## 1. The three credentials

There is **no** "mini agent JWT" or "mint agent" — those are misnomers. Three distinct credentials are
involved:

| Credential | Issuer | Audience | Proves / used for |
| --- | --- | --- | --- |
| **SSO / session** | GoDaddy IdP | AAB BFF | **Who** the human is (`customerId`). Authentication only. |
| **FGA tuples** | OpenFGA store | BFF (via s2s OAuth) | **What** the customer may do on `venture:<ventureId>`. Authorization. |
| **AAB agent JWT** | AAB BFF | agents service | Short-lived builder credential (WS + tools). Issued **only after** BFF authorization passes; carries `siteId`, `isOwner`, `canPublish`, `canDownload`. Agents trusts the BFF — it does **not** call FGA. |

SSO is **not** a substitute for FGA. The agent-token route must run an FGA check after resolving the
user from SSO and before returning any agent JWT.

---

## 2. SSO vs FGA vs agent JWT

```text
+---------------------------+     +---------------------------+
| Browser (owner / member) |     | GoDaddy SSO               |
|  - AAB UI / develop       |     |  - Session cookie         |
|  - Settings → Team        |     |  - Resolves customerId    |
|  - CDS Multi-Users (ESM)  |     +-------------+-------------+
+------------+--------------+                   ^
             | HTTPS                            | validate session
             v                                  |
+------------+--------------+     +------------+-------------+
| AAB BFF (Next.js)         |     | AuthZ / OpenFGA          |
|  - API routes             |---->|  - listObjects(...)      |
|  - OpenFGA client (s2s)   |     |  - tuples venture:<id>   |
|  - Mint agent JWT         |     +------------+-------------+
|  - Proxy mgmt-airo        |                   ^
+------------+--------------+                   |
             |                                  |
             v                                  |
+------------+--------------+     +------------+-------------+
| mgmt-airo / control plane |     | CDS / Permissions Platform|
|  - apps, secrets, domains |     |  - invite, accept, roles  |
|  - collaborator table     |     +------------+-------------+
+------------+--------------+
             |
             v
+------------+--------------+
| agents service           |
|  - HTTP + WebSocket      |
|  - Trusts agent JWT only |
+---------------------------+
```

**Reading it:** SSO proves *who*. OpenFGA proves *what they may do* on the venture tied to the app
(`venture:<ventureId>`; the BFF resolves `ventureId` from `siteId`). The AAB agent JWT is a separate,
short-lived credential the BFF returns from `agent-token` only after policy passes.

---

## 3. FGA HTTP shapes

The BFF calls GoDaddy's OpenFGA API with the **store** in the path and the **tuple** in the body.
Auth is an OAuth `client_credentials` Bearer token (the BFF s2s client), **not** the browser SSO JWT.

### Primary: `listObjects` (what AAB uses)

AAB gates on **`listObjects`** + `includes(ventureId)`, not `/check`. The model uses computed
relations (role → permission via hierarchy); `listObjects` resolves them, `check` does not (see
[architecture §5](./multi-user-architecture.md#5-bff-enforcement)).

```http
POST /stores/{store_id}/list-objects
Authorization: Bearer <client_credentials access token>
Content-Type: application/json

{
  "type": "venture",
  "relation": "airo_app_build",
  "user": "customer:<customerId>"
}
→ { "objects": ["venture:<ventureId>", ...] }   // allow if it includes the app's venture
```

### `check` (illustrative — not used for gating)

```http
POST /stores/{store_id}/check
{ "tuple_key": { "user": "customer:<id>", "relation": "airo_app_build", "object": "venture:<ventureId>" } }
→ { "allowed": <may be false for computed relations — do not rely on this> }
```

### Flow → typical FGA relation

| Flow | Relation checked (object = `venture:<ventureId>`) |
| --- | --- |
| Agent token (build) | `airo_app_build` |
| Secrets API | `airo_app_manage_secrets` |
| Domains API | `airo_app_manage_domains` |
| Publish / download | `airo_app_publish` / `airo_app_download` (plus owner subscription) |
| Delete app | `admin` |
| Transfer / member management | `owner` |

`store_id` is the OpenFGA store UUID (per environment — see
[architecture §4](./multi-user-architecture.md#4-fga-permission-model)), **not** a Commerce store.
Writes need the `authz.fga:write` scope + the store-level write relation; checks need `authz.fga:check`.

---

## 4. Tuples & propagation lag

An OpenFGA **tuple** is a fact `(user, relation, object)`, e.g.
`(customer:alice, employee, venture:<uuid>)`. The store's **authorization model** defines valid
relations and how permissions like `airo_app_build` are **derived** from roles. A check/listObjects
asks: given the model and current tuples, does this user have this permission on this object?

**Propagation lag:** when an owner grants access (writes tuples), the write may complete slightly after
the UI considers the action done. There can be a brief window where SSO identifies the user but FGA has
not yet stored the tuple, so `listObjects(airo_app_build)` does not yet include the venture and the BFF
**correctly denies** the agent token (no JWT).

**Who hits it:** primarily the **invitee** right after gaining access — the **owner** is enforced via
`customer_id` ownership in the BFF and does not wait on a membership tuple. The
retry/spinner UX (retry `agent-token` ~2s × up to 5, ~10s window, app-specific spinner copy) exists to
ride out this window without treating a transient deny as permanent. The BFF **fails closed**: if FGA
denies, no agent JWT is issued — retry or wait, never "issue anyway".

---

## 5. Request flows

### 5.1 Owner invites / changes a member (grant)

Member management is **owner-only**. The owner uses the CDS Team panel; tuple writes and the
control-plane mirror are driven through the BFF `fga-write` route.

```text
Owner UI → BFF /fga-write          OpenFGA      BFF→mgmt-airo (owner jwt)    mgmt-airo DB
   │ invite/role B │                   │                  │                      │
   ├──────────────►│ checkFlag(aab-multi-user) (404 if off)│                      │
   │               │ getSite → subscription + venture ids  │                      │
   │               │ enforce caller is owner (FGA owner)   │                      │
   │               ├─ write tuples ───►│                   │                      │
   │               ├─ derive capability CSV from FGA (listObjects per capability) │
   │               ├─ POST …/collaborators {B, role=CSV} ─►│                      │
   │               │                                       ├─ EnsureExists(B) ───► airo_customers
   │               │                                       ├─ upsert ────────────► airo_app_collaborators
   │               │                                       │◄─ 200                 │
   │◄─ 200 (or 502 if the grant failed → client retries; both steps idempotent)   │
```

### 5.2 Invited user uses the app (credits / secrets / publish)

```text
B → BFF (action)                              mgmt-airo                       DB
  │ + B's sso-jwt    │                            │                           │
  ├─────────────────►│ FGA listObjects(relation)  │  (BFF gate, §3)           │
  │                  │ forward B's jwt ──────────►│ RequireRegisteredCustomer │ → row exists ✅
  │                  │                            │ EntityOwnerAuthorization  │
  │                  │                            │   owner? no               │
  │                  │                            │   HasAppCollaborator +    │
  │                  │                            │   capability allows route ►│ airo_app_collaborators
  │◄─ 200 ───────────┤◄───────────────────────────│ → allow ✅                │
```

### 5.3 List "shared with me"

```text
B → BFF /api/sites                       mgmt-airo                                DB
  │ + B's sso-jwt   │ /customers/me/apps  ───────► (owned — empty for invitee)    │
  │                 │ /customers/me/shared-apps ─►│ ListAppsByCollaborator(B) ────► airo_app_collaborators
  │                 │                             │ enrich (hosting + airo_apps)   │
  │                 │                             │ stamp ownerCustomerId + sharedWithMe
  │◄─ merged list ──┤◄────────────────────────────│ { apps }                       │
```

### 5.4 Remove (revoke)

```text
Owner UI → BFF /fga-write    OpenFGA      BFF (owner jwt)           mgmt-airo DB
   │ remove B   │ delete tuples ─►│            │                        │
   │            ├─ revoke candidate = deletes − writes                  │
   │            ├─ still has airo_app_view? ──► (yes → keep; role downgrade, refresh CSV)
   │            └─ no → DELETE …/collaborators/B ──────────────────────► airo_app_collaborators (delete)
```

### 5.5 Agent token — happy path vs deny

```text
HAPPY (member has airo_app_build)            DENY (no tuple / wrong app)
Browser → BFF: POST /agent-token             Browser → BFF: POST /agent-token
  BFF resolve customerId (SSO)                 BFF resolve customerId (SSO)
  BFF listObjects(airo_app_build) ✓            BFF listObjects(airo_app_build) ✗
  BFF mint agent JWT → 200                     BFF returns 403/404, NO agent JWT
  Browser → agents (Bearer agent JWT) OK       Browser cannot drive agents as builder
```

The route is **fail-closed**: on deny the handler never signs a JWT, so without that token the client
cannot open an authenticated agents WebSocket regardless of SSO.

### 5.6 Forbidden action (403) & owner-only

```text
Editor → BFF PATCH …/secrets                 Admin → BFF DELETE app
  BFF listObjects(airo_app_manage_secrets) ✗   BFF listObjects(admin) ✗  (admin/owner only)
  403, request never reaches mgmt-airo          403

Owner → BFF DELETE app / transfer
  owner check (customer_id) + FGA admin/owner ✓ → forward to control plane → 200
```

---

## 6. Responsibility split (CDS vs AAB)

| Action | System | Owned by |
| --- | --- | --- |
| Invite form, accept-flow UI, role management UI | CDS `multiusersEsm` | Permissions Platform team |
| Pending relationships, invite emails, accept orchestration | Permissions Platform | Permissions Platform team |
| OpenFGA model & store | OpenFGA | AuthZ team |
| Loading CDS, passing props (venture, customer, permissions) | `TeamPanel` | AAB |
| **FGA tuple writes for invite/role change** | BFF `fga-write` route | AAB |
| **Capability CSV mirror into `airo_app_collaborators`** | BFF collaborator-sync | AAB |
| FGA enforcement on every protected route | BFF `enforce*` | AAB |
| Owner bypass | BFF | AAB |
| Agent-token issuance with role claims | BFF `/api/auth/agent-token` | AAB |
| App/site metadata, transfer orchestration, collaborator table | mgmt-airo | AAB |

> **Note on `permissions-platform/client.ts`:** this BFF scaffolding is **not** on the critical path —
> AAB drives tuple writes through its own `fga-write` route and mirrors them to mgmt-airo. The CDS
> bundle handles invite-email/accept UX internally; AAB reads the resulting authorization state via FGA
> `listObjects`.

---

## 7. User journeys (J1–J14)

Legend: `[Owner]` app creator (C1) · `[Member]` invited Admin/Editor/custom · `[BFF]` AAB BFF ·
`[SSO]` GoDaddy SSO · `[FGA]` OpenFGA (via BFF s2s) · `[CDS]` Multi-Users UI · `[Agents]` agents
service · `[CP]` mgmt-airo control plane.

### J1 — Owner opens editor (existing app)

```text
[Owner] → [SSO] session OK → [BFF] agent-token (owner path, FGA bypass) → mint agent JWT → [Agents] OK
```

Owner access is `customer_id` ownership in the BFF; it does not depend on invite tuples.

### J2 — Owner opens Settings → Team

```text
[Owner] → [BFF] Settings→Team: flag(aab-multi-user) + ensure per-app venture in [CP] (if new)
        → render CDS props (resourceType=venture, resourceId=ventureId, customerId)
        → browser loads [CDS] multiusersEsm → invite/list UI
```

### J3 — Owner invites Admin/Editor/custom

```text
[Owner] → [CDS] enter email + role → invite created (Permissions Platform email)
        → owner action also drives [BFF] /fga-write: write tuples + mirror to [CP] collaborator row
```

Member management is owner-only; invite copy is AAB-only `aab:app:*` strings.

### J4 — Invitee receives email & accepts

```text
[Member] → click link → [SSO] login if needed → accept-invite UI → relationship ACCEPTED
         → redirect to /[market]/develop/[appId]  (deep link carries appId + market)
```

### J5 — Post-accept first load (propagation / retry)

```text
[Member] land on develop → [BFF] agent-token → [FGA] listObjects(airo_app_build) = (lag) ✗ → 403
         → UI spinner "Setting up your access to [App]…" + retry (~2s × up to 5)
         → [FGA] now includes venture ✓ → mint agent JWT → [Agents] editor usable
```

If still denied after the retry window → J10 fallback.

### J6 — Member builds with AI (happy path)

```text
[Member] agent-token OK → WS + tools with Bearer agent JWT → [Agents] validates JWT (build) → stream OK
```

### J7 — Editor attempts forbidden action

```text
[Editor] PATCH …/secrets → [BFF] listObjects(airo_app_manage_secrets) ✗ → 403 (no forward to [CP])
```

Same pattern: domains (`airo_app_manage_domains`), delete (`admin`, owner-only), transfer (`owner`).

### J8 — Admin/owner invites another member

```text
[Owner] Team → invite → same as J3. (Member management is owner-only in AAB.)
```

### J9 — Owner-only: delete or transfer

```text
[Owner] DELETE app / transfer → [BFF] owner check + FGA (admin/owner) ✓ → forward [CP] → 200
[Member] same action          → [BFF] FGA ✗ → 403
```

### J10 — No access (fallback)

```text
[Anyone] GET /develop/[id] with no relation → [BFF] FGA/ownership deny
         → redirect /[market]/apps + toast "You don't have access to this app."
```

### J11 — Expired/revoked invite

```text
[Member] open old link → [CDS/Permissions Platform] invalid/expired → error UI.
If they land on develop without a tuple → J10 fallback.
```

### J12 — Publish/download (role + owner subscription)

```text
[Member] publish → [BFF] listObjects(airo_app_publish) ✓ (role) → check owner subscription/paywall
         → 200 or 403. Member has no own subscription; owner plan gates publish limits (owner-pays).
```

### J13 — Non-owner: billing banners hidden

```text
[Member] agent-token → agent JWT isOwner=false → editor UI suppresses upgrade CTAs.
```

### J14 — Owner removes member / changes role

```text
[Owner] remove/change → [CDS]/[BFF] /fga-write: delete/write tuples + refresh [CP] collaborator CSV
        → [Member] later: agent-token re-checks FGA; revoked member gets 403.
```

### Journey index

| ID | Journey | ID | Journey |
| --- | --- | --- | --- |
| J1 | Owner opens editor | J8 | Owner invites another member |
| J2 | Owner opens Settings → Team | J9 | Owner delete/transfer vs member denied |
| J3 | Owner invites member | J10 | No access → apps list + toast |
| J4 | Invitee accept-invite | J11 | Expired invite |
| J5 | Post-accept load + retry | J12 | Publish/download with subscription |
| J6 | Member builds with AI | J13 | Billing UI hidden for non-owner |
| J7 | Forbidden route (403) | J14 | Remove / change role |

---

## 8. Local mock mode

With `AUTHZ_FGA_LOCAL_MOCK=true`, FGA operations are mocked at the BFF layer:

- The enforce gate short-circuits to **allow** via the `isAuthzFgaLocalMock()` check (in
  `enforce-venture-relation.ts`) BEFORE any FGA call. The mocked `listObjects()` / `listUsers()`
  themselves return `[]` — the allow comes from the short-circuit, not from listObjects resolving true.
- `writeTuples()` → no-op.
- `getAuthzFgaAccessToken()` → static mock token; `getAuthzFgaConfig()` → placeholder config (so the
  enforcement path still activates).

Because every relation resolves true, denial paths (J7, unauthorized transfer) appear to **pass**
locally — to test denial you must conditionally mock specific relations as denied. The CDS component
does **not** render locally (needs a real Permissions Platform connection + matching SSO domain); a
`MockTeamManagement` fallback renders and calls the BFF `fga-write` endpoint directly. Pair with
`NEXT_PUBLIC_DEV_FORCE_AAB_MULTI_USER=true` to force the flag on without Switchboard/VPN.
