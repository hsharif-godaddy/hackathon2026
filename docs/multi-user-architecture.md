# Multi-User (Team Collaboration) — Architecture & Reference

> **Products affected:** AiroAppBuilder (AAB) only — PaaS is headless and unaffected.
> **Flag:** `aab-multi-user` (Switchboard) — off ⇒ feature fully inert.
> **Scope:** `airo-app-builder` (BFF/UI) + `mhp-core/backends/airo-go` (mgmt-airo control plane).

This is the single authoritative reference for how multi-user works **today**. For the
request-level sequences see [multi-user-flows.md](./multi-user-flows.md).

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [App ↔ Venture Relationship](#3-app--venture-relationship)
4. [FGA Permission Model](#4-fga-permission-model)
5. [BFF Enforcement](#5-bff-enforcement)
6. [`airo_app_collaborators` — mgmt-airo Table](#6-airo_app_collaborators--mgmt-airo-table)
7. [Capability Enforcement in mgmt-airo](#7-capability-enforcement-in-mgmt-airo)
8. [Key Code Flows](#8-key-code-flows)
9. [Paywall Bypass for Invited Users](#9-paywall-bypass-for-invited-users)
10. [CDS `multiusersEsm` Integration](#10-cds-multiusersesm-integration)
11. [Venture Provisioning](#11-venture-provisioning)
12. [Security & Data Integrity](#12-security--data-integrity)
13. [Failure Modes](#13-failure-modes)
14. [Component Map](#14-component-map)
15. [Environment Configuration](#15-environment-configuration)
16. [Deployment Checklist](#16-deployment-checklist)
17. [Contacts & Channels](#17-contacts--channels)
18. [Common Gotchas](#18-common-gotchas)

---

## 1. Feature Overview

Multi-user lets an app owner invite collaborators to their AAB app. Invited users can open the app,
use the chat (build), publish, manage secrets/domains, and download — depending on the permissions
assigned in the Team settings panel.

**The invited user needs:**

- Their own GoDaddy account (created via the invite URL).
- FGA permission tuples on the app's venture (in-app permissions).
- A collaborator row in mgmt-airo (control-plane access + registration) — written automatically when
  the owner invites them.
- **No AAB subscription** — they use the owner's subscription (**owner-pays**).

**The owner needs:**

- `aab-multi-user` Switchboard flag enabled.
- The app must have a `team_venture_id` (created lazily on first Team panel open).

### Why two stores (FGA + mgmt-airo table)

In-app permissions live in **OpenFGA** (`customer:<id> → airo_app_* → venture:<id>`). But the control
plane (**mgmt-airo**) — which authorizes credits, secrets, publish, and serves the app listing — is
single-owner: it keys off `subscription.customerId == caller` and requires the caller to be a
registered Airo customer. An invited user isn't in `airo_customers` (every call 403s on
`RequireRegisteredCustomer`), isn't the subscription owner, and isn't visible to the
`/customers/me`-scoped listing. The `airo_app_collaborators` table bridges that gap (registration,
authorization, and "shared with me" listing). See §6.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          Browser (BFF Client)                    │
│  Owner & Invitee: airo-builder.godaddy.com/apps → develop/{appId}│
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│               BFF — Katana (Next.js app/)                        │
│  /api/sites             → V2ControlPlaneAdapter                  │
│  /api/auth/agent-token  → JWT mint + FGA permission check        │
│  /api/sites/:id/authz/fga-write → FGA write + collaborator sync  │
└────┬───────────────────────┬────────────────────────┬───────────┘
     │ customer sso-jwt        │ FGA                    │ customer sso-jwt
     ▼                         ▼                        ▼
 mgmt-airo                  OpenFGA            mgmt-airo (collaborator API)
 (mgmt.nstk)              (authz-fga.*)        airo_app_collaborators (MySQL)
   │                                                    ▲
   └── /customers/me/shared-apps  ─── reads ────────────┘
```

| System | What it is | Role in this feature |
|---|---|---|
| **BFF / UI** (`airo-app-builder`, `app/`) | Next.js app + BFF API routes | Owner-facing invite UI; writes OpenFGA tuples; mirrors grants/revokes to mgmt-airo; aggregates owned + shared app lists; enforces FGA on sensitive routes |
| **mgmt-airo** (`mhp-core/backends/airo-go`) | Go control plane | Source of truth for collaboration: registration, authorization, shared-app listing |
| **OpenFGA** | GoDaddy venture authz store | Fine-grained in-app permissions |
| **CDS `multiusersEsm`** | Federated UI (Permissions Platform team) | Invite form, accept flow, role management |

**Key constraint (solved):** mgmt-airo's owned-app listing (`/customers/me/apps`) is `/me`-scoped, so
an invited user never sees an app under the owner's subscription. mgmt-airo bridges this with a
**control-plane reverse lookup** — `GET /customers/me/shared-apps`, backed by `airo_app_collaborators`
— so the BFF maintains **no AAB-owned database**.

---

## 3. App ↔ Venture Relationship

A **venture** is a GoDaddy Product Graph entity — a generic "team workspace" used across GoDaddy
products. The `multiusersEsm` CDS bundle operates entirely at the venture level and is
product-agnostic.

```
App (mgmt-airo resource)
  └── variables.aabTeamVentureId  ──→  Venture (Product Graph)
                                            └── FGA tuples:
                                                customer:ownerCid    owner          venture:V
                                                customer:inviteeCid  employee       venture:V
                                                customer:inviteeCid  airo_app_view  venture:V
```

- **1 app → 0 or 1 venture** (0 before multi-user is enabled for that app).
- Created lazily by `ensureAppTeamVenture` when the owner first opens the Team panel (see §11).
- FGA permissions live on the **venture**, not directly on the app.

### The discovery problem — and how it's solved

```
FGA tells us:  customer:B  airo_app_view  venture:V
FGA does NOT:  venture:V  →  app:X            (no reverse lookup)
```

Rather than maintain a BFF-side venture→app index, the **collaborator row already carries the app's
coordinates** (`subscription_id`, `app_id`), keyed by the invitee. So "which apps are shared with B?"
is a direct `ListAppsByCollaborator(B)` on the control plane — exposed as
`GET /customers/me/shared-apps` (§6).

---

## 4. FGA Permission Model

The FGA model is owned and deployed by the AuthZ/CDS team. AAB reads it but does not own the schema.
FGA is the authority for **fine-grained in-app permissions**; the collaborator table governs coarse
**control-plane access** (§6–7).

AAB permissions live under the **`airo_app_*`** prefix in the shared GoDaddy venture model, decoupled
from `website_*` / `email_marketing_*` — a `website_publish` grant does **not** imply
`airo_app_publish`.

### Role → Permission Mapping

| Permission (FGA relation) | owner | admin | manager | employee | What it gates in AAB |
| --- | :---: | :---: | :---: | :---: | --- |
| `airo_app_view` | ✅ | ✅ | ✅ | ✅ | See the app in listing, open develop page |
| `airo_app_build` | ✅ | ✅ | ✅ | ✅ | Use chat (agent token issued) |
| `airo_app_download` | ✅ | ✅ | ✅ | ✅ | Download code archive |
| `airo_app_view_db` | ✅ | ✅ | ✅ | ✅ | View database |
| `airo_app_edit_db` | ✅ | ✅ | ✅ | ✅ | Edit database |
| `airo_app_publish` | ✅ | ✅ | ✅ | ❌ | Publish the app |
| `airo_app_manage_secrets` | ✅ | ✅ | ❌ | ❌ | Read/write secrets |
| `airo_app_manage_domains` | ✅ | ✅ | ❌ | ❌ | Manage custom domains |
| `user_invite` | ✅ | ✅ | ❌ | ❌ | Invite/manage team members |
| `admin` | ✅ | ✅ | ❌ | ❌ | Delete the app |
| `owner` | ✅ | ❌ | ❌ | ❌ | Transfer ownership |

> **Owner-only on member management:** writing FGA tuples / managing collaborators is gated on the
> `owner` relation in the BFF `fga-write` and reconcile routes, and mirrored owner-only in mgmt-airo
> (`OwnerOnlyAuthorization`). The `user_invite` relation above is the model's general "can manage
> members" capability; AAB currently restricts member management to the owner.

**Custom roles:** roles are **not** limited to the four pre-built tiers. The owner can grant arbitrary
combinations of individual permissions (and can edit a role's permissions). A collaborator with only
`airo_app_build` gets `airo_app_view` implicitly but nothing else. Because roles are arbitrary
capability sets, mgmt-airo enforcement is **capability-based**, not tier-based (see §7).

### FGA relation format

```
user:   customer:{customerId}     object: venture:{ventureId}
```

### FGA Stores (per environment)

| Environment | Base URL | Store ID |
| --- | --- | --- |
| Dev | `https://fga.api.int.dev-godaddy.com` | `01GR57FDR2KS0VNKZD4H5D804V` |
| Test | `https://fga.api.int.test-godaddy.com` | `01GRPT3CAT3WKHS4BH447D1ABA` |
| OTE | `https://fga.api.int.ote-godaddy.com` | `01GRPTJ9NJ1SCR2G4V53HS250J` |
| Prod | `https://fga.api.int.godaddy.com` | `01GRPTNJ05HNQWB2G7TTDM2BRG` |

Swagger: `{base_url}/docs/`. Model repo: `gdcorp-identity/authz-fga-models`.

---

## 5. BFF Enforcement

Every protected BFF route enforces an FGA relation before forwarding downstream.
`enforceAabMultiUserVentureRelation()`:

1. Checks `aab-multi-user` flag → skip if off.
2. Loads FGA config → skip if not configured.
3. Owner bypass — `customerId === owner_customer_id` → skip FGA.
4. If `team_venture_id` is missing (or `owner_customer_id` is absent) for a non-owner → **deny (403)**. We fail **CLOSED**: the relation cannot be verified, so access is refused. (Do NOT skip FGA here — that would be a fail-open authorization hole.)
5. Gets an OAuth token for the FGA API (`client_credentials`).
6. Calls FGA **`listObjects`** for the relation and checks the app's venture is in the result set.
7. Returns 403 if not present.

### Route → required relation

| Route | Operation | Required relation |
| --- | --- | --- |
| `POST /api/auth/agent-token` | Open builder session | `airo_app_build` |
| `POST /api/sites/[id]/deploy` | Deploy/publish | `airo_app_publish` |
| `POST /api/apps/[id]/publish-snapshots` | Deploy snapshot | `airo_app_publish` |
| `POST /api/apps/[id]/unpublish` | Unpublish | `airo_app_publish` |
| `GET/PUT /api/secrets/[appId]` | Read/write secrets | `airo_app_manage_secrets` |
| `GET /api/secrets/[appId]/diff` | Secrets diff | `airo_app_manage_secrets` |
| `POST /api/secrets/[appId]/sync` | Secrets sync | `airo_app_manage_secrets` |
| `POST /api/sites/[id]/domains` | Manage domains | `airo_app_manage_domains` |
| `POST /api/apps/[id]/project-domain` | Project domain | `airo_app_manage_domains` |
| `POST /api/apps/[id]/download` | Download source | `airo_app_download` |
| `DELETE /api/sites/[id]` | Delete app | `admin` |
| `POST /api/apps/[id]/transfer` | Transfer ownership | `owner` |
| `POST /api/sites/[id]/authz/fga-write` | Write FGA tuples (invite/role) | `owner` |

### Known FGA quirk — Check vs ListObjects

**Symptom:** `checkPermission` (FGA `/check`) returns `false` for invited users even when
`listObjects` correctly returns the venture for the same user + relation.

**Root cause:** the model uses **computed relations** (role → `airo_app_view` via hierarchy).
`ListObjects` traverses the full model including computed relations; `Check` on this store/model does
not.

**Fix:** all FGA permission gates use `listObjects` + `includes(ventureId)`, never `checkPermission`
— in `enforce-venture-relation.ts`, `tryGetSharedSite`, and the agent-token `canPublish`/`canDownload`
derivation. `list-objects.ts` has a 4s read timeout; `oauth-token.ts` an 8s timeout (and caches the token).

---

## 6. `airo_app_collaborators` — mgmt-airo Table

The single control-plane source of truth for collaboration. One row per `(app, invitee)`. It serves
**three** jobs: registration, authorization, and the "shared with me" listing.

**Location:** mgmt-airo's MySQL (InnoDB 8.0) control-plane DB — same instance as `airo_apps` /
`airo_subscriptions` / `airo_customers`. Written **only** via the owner-authorized mgmt-airo API; the
app's own containers can't reach it (no self-escalation).

### Schema

```sql
CREATE TABLE airo_app_collaborators (
  id              VARCHAR(36)  NOT NULL,        -- uuid
  subscription_id VARCHAR(21)  NOT NULL,        -- owner's subscription (billing principal)
  app_id          VARCHAR(21)  NOT NULL,
  customer_id     VARCHAR(255) NOT NULL,        -- the invitee
  role            VARCHAR(50)  NOT NULL DEFAULT 'editor',  -- capability CSV (see §7)
  granted_by      VARCHAR(255) NULL,            -- actor, for audit
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_customer (app_id, customer_id),    -- natural key + serves HasAppCollaborator
  KEY idx_customer     (customer_id),                  -- "apps shared with me"
  KEY idx_subscription (subscription_id, customer_id)  -- subscription-scoped checks
);
```

No `system_id` (not part of any authz predicate; the listing derives the system from hosting at read
time). No FK (matches the `airo_apps` convention). The `UpsertAppCollaborator` query uses
`ON DUPLICATE KEY UPDATE` so a re-grant overwrites `role`/`subscription_id`/`granted_by` in place —
this is what makes capability **downgrades** take effect.

### Three jobs

1. **Registration** — `Grant` calls `customerService.EnsureExists(invitee)` before upserting the row,
   so the invitee gets an `airo_customers` row and clears `RequireRegisteredCustomer` on every later
   mgmt-airo call. (Fixes the invited-user `403 "Customer not registered with Airo"`.)
2. **Authorization** — additive checks in `entity_owner.go`:
   - `EntityOwnerAuthorization` (app-scoped routes — secrets, publish, deploy): owner OR
     `HasAppCollaborator(sub, app, caller)` whose stored capabilities permit the route (§7).
   - `SubscriptionReadAuthorization` (subscription-scoped reads — `GET /subscriptions/:id`,
     `…/credits/grants`): owner OR `HasSubscriptionCollaborator(sub, caller)`.
   - Owner path unchanged; both inert until a row exists.
3. **Listing** — `GET /customers/me/shared-apps` = `ListAppsByCollaborator(caller)`, enriched, each
   tagged `sharedWithMe` + the real `ownerCustomerId`.

### Write / read APIs (mgmt-airo, `/api/airo/v1`)

| Method · Path | Auth | Purpose |
|---|---|---|
| `POST /subscriptions/:sub/apps/:app/collaborators` | owner (sso-jwt) | Grant (`EnsureExists` + upsert). Idempotent. |
| `DELETE /subscriptions/:sub/apps/:app/collaborators/:collaboratorCustomerId` | owner (sso-jwt) | Revoke. |
| `GET /subscriptions/:sub/apps/:app/collaborators` | owner (sso-jwt) | List collaborators on an app. |
| `GET /customers/me/shared-apps` | customer | The caller's shared apps. |

**Auth scheme:** every mgmt-airo call uses the **caller's `sso-jwt`** — the invitee's for their own
reads/actions, the inviting **owner's** for the grant/revoke. There is **no service principal**:
mgmt-airo authorizes the write owner-only, and the BFF's upstream FGA `owner` check is the "who may
invite" gate. Because the row drives both authz and listing, a failed grant surfaces as **502** so the
client retries (both the FGA write and the grant are idempotent). Revoke is best-effort.

---

## 7. Capability Enforcement in mgmt-airo

Because roles are **arbitrary capability sets** (§4 "Custom roles"), mgmt-airo does not store or
enforce a coarse tier. The BFF derives the exact capabilities a collaborator holds from FGA and stores
them as a comma-separated **capability CSV** in the `role` column; mgmt-airo parses that CSV and gates
each route on the specific capability it requires.

### Capability tokens

`view`, `publish`, `secrets`, `domains`, `download`. (`view` is the floor — any collaborator can open
the app.) App **delete** is owner-only and never granted via a capability token.

### BFF → capability CSV (write side)

On invite/role change, `deriveCapabilityResolver` (`app/src/lib/mgmt-airo/collaborator-sync.ts`)
queries FGA `listObjects` per sensitive capability (`airo_app_publish`, `airo_app_manage_secrets`,
`airo_app_manage_domains`, `airo_app_download`) and writes the exact set, e.g.
`"publish,secrets,domains,download"` or `"view"` for a collaborator with no elevated capabilities. The
CSV is sent as the `role` field on the mgmt-airo grant.

### mgmt-airo (enforcement side)

`internal/presentation/http/middleware/collaborator_capability.go`:

- `parseCollaboratorCapabilities(stored)` parses the CSV into a capability set. **Legacy** values
  written before capability-aware grants (`editor`, `admin`, `manager`, `employee`) are mapped to
  equivalent capability sets for backward compatibility.
- `requiredCollaboratorCapability(method, fullPath)` classifies a route to one required token
  (e.g. `/secrets` → `secrets`, `/publish` → `publish`, app delete → owner-only).
- `collaboratorAllowed(stored, required)` allows the request only if the parsed set contains the
  required token.

This avoids the lossy tier model (which both **false-denied** custom roles — e.g. a domains-only role
classified as `employee` — and **false-granted** — e.g. a secrets role classified as `admin` picking
up delete/domains). The BFF's live FGA checks remain the immediate authoritative gate; the collaborator
CSV is the control-plane mirror, refreshed on every grant and on reconcile.

---

## 8. Key Code Flows

### 8.1 Owner invites a collaborator (`POST /api/sites/:id/authz/fga-write`)

```
fga-write route
  ├── checkFlag(aab-multi-user)        → 404 if off (complete no-op)
  ├── getSite                          → subscription_id, venture_id
  ├── enforce caller is owner (FGA owner relation)
  ├── writeFgaTuples(writes, deletes)  → OpenFGA
  └── syncCollaboratorsToMgmtAiro()   (uses the caller's sso-jwt)
       ├── derive capability CSV per invitee from FGA (§7)
       ├── grant per invitee → POST …/collaborators → EnsureExists + upsert
       └── revoke per removed invitee (best-effort; skips role-downgrades via FGA airo_app_view check)
     (grantFailures > 0 → route returns 502 → client retries)
```

### 8.2 Invited user — app listing (`GET /api/sites`)

```
listSites(jwt)
  ├── getAllAppsForCustomer()          → 403/404 for invited user → caught → []
  └── listSharedSites(jwt)
       └── GET /customers/me/shared-apps → AiroApp[] → mapAppToSiteInfo + sharedWithMe:true
```

### 8.3 Invited user — open app (`GET /api/sites/{id}`)

```
getSite(siteId, jwt)
  ├── owner/owned lookups            → 403/null for invited user
  └── tryGetSharedSite(siteId, jwt)
       └── listSharedSites(jwt).find(id === siteId)   → SiteInfo{sharedWithMe:true}
```

### 8.4 Invited user — agent token (`POST /api/auth/agent-token`)

```
agent-token route
  ├── appExists → appExistsViaSharedApps → tryGetSharedSite ✓
  ├── getSite → tryGetSharedSite → SiteInfo{sharedWithMe:true}
  ├── enforceAabMultiUserCanBuild → listObjects(airo_app_build) ✓
  ├── [sharedWithMe] canPublish/canDownload from FGA listObjects (paywall bypass, §9)
  └── JWT issued: canPublish, canDownload, subscriptionId (owner's), isOwner:false
```

### 8.5 Venture creation (`ensureAppTeamVenture`)

```
ensureAppTeamVenture(...)
  ├── team_venture_id already set / flag off / siteInfo null / non-owner / no cert → early return
  ├── VentureService.createProfileForShopper(shopperId) → ventureId  (FRESH venture per app — 1:1)
  │     NOTE: do NOT use getOrCreateVentureForCustomer() — it returns the shopper's single
  │     image_manager_venture_id (one venture per CUSTOMER), which leaks members across all the
  │     owner's apps. See ensure-app-venture.ts.
  ├── writeOwnerTupleBestEffort(ventureId, ownerCid)        → OpenFGA
  └── updateSiteVariables(siteId, {aabTeamVentureId})       → mgmt-airo
```

(No BFF-side index write — the invitee's listing comes from `airo_app_collaborators`, populated by the
invite flow in 8.1.)

---

## 9. Paywall Bypass for Invited Users

Invited users have no AAB subscription. **The owner pays**; the FGA role controls *what* the invited
user can do, while billing is the owner's responsibility.

- **Server-side (agent-token):** when `siteInfo.sharedWithMe`, derive `canPublish`/`canDownload` from
  FGA `listObjects` (`airo_app_publish` / `airo_app_download`) instead of the subscription paywall.
- **Client-side:** `UpgradeBanner` is suppressed when `getSite(appId)?.sharedWithMe` is true (the
  `isOwner` agent-JWT claim is `false` for collaborators).

---

## 10. CDS `multiusersEsm` Integration

The Team management UI is a CDS (Component Delivery Service) federated component. AAB loads it via
`ComponentLoader`, passing the venture context. **CDS for UX, FGA for truth** — CDS delivers the
invite/accept/role UI; AAB still enforces `airo_app_*` on every sensitive route (§5).

```tsx
<ComponentLoader
  cds={gasketData?.cds}
  customerId={customerId}      // Owner's GoDaddy customer ID
  design="ANTARES"
  locale={locale}
  permissionsToInclude={AAB_TEAM_PERMISSION_KEYS}
  resourceId={ventureId}       // Real Product Graph venture ID (per app)
  resourceType="venture"
  routePrefix={routePrefix}    // CDS-internal React Router path matching (not API routing)
  source="aab-team-multiusers"
  type="multiusersEsm"
/>
```

`AAB_TEAM_PERMISSION_KEYS` (CDS permission strings, distinct from FGA relations):

```typescript
const AAB_TEAM_PERMISSION_KEYS = [
  "aab:app:build", "aab:app:publish", "aab:app:download",
  "aab:app:manage_secrets", "aab:app:manage_domains", "aab:app:manage_members",
  "aab:app:delete", "aab:app:transfer", "aab:app:view_db", "aab:app:edit_db",
];
```

**Where in AAB:** Settings panel → Team (`TeamPanel`), gated by `aab-multi-user` (or the legacy
`appbuilder-settings-team` flag). The host nests a router so `routePrefix/*` matches the CDS pattern.

**Permission text / translations** (owned by AuthZ, repo `gdcorp-identity/authz-multiuser-crm`): a
human-readable label/description per permission shows on the CDS Users page (e.g.
`AIRO_APP_PUBLISH_PERMISSION_NAME` → "Publish and unpublish live projects"). Translations go through a
separate pipeline and lag the code.

**Local dev:** the CDS component does not render locally (needs a real Permissions Platform connection
+ matching SSO domain). A `MockTeamManagement` fallback renders instead and calls the BFF `fga-write`
endpoint directly. See [multi-user-flows.md](./multi-user-flows.md) §"Local Mock Mode".

---

## 11. Venture Provisioning (Per-App)

Each app needs a real Product Graph venture ID for FGA and CDS.

```
User opens app (owner) → team_venture_id missing?
  → ensureAppTeamVenture()
    → VentureService.createProfileForShopper(shopperId)  [Product Graph — FRESH venture per app]
      (NOT getOrCreateVentureForCustomer — that shares one venture per customer; leaks members)
    → writeOwnerTupleBestEffort(ventureId, ownerCid)   [OpenFGA]
    → updateSiteVariables(siteId, { aabTeamVentureId }) [mgmt-airo control plane]
  → subsequent requests use the stored ID
```

Design decisions:

- **One venture per app** (not per customer) — isolates permissions per project. (Contrast the image
  manager's per-customer `image_manager_venture_id` — different concept, must not collide.)
- **Lazy creation** — created on first Team panel open when the flag is on.
- **Owner-only creation** — prevents collaborator race conditions.
- **Non-fatal failure** — the app works without team features if Product Graph is down.
- **S2S auth** — cert-based (`GRAPHQL_CLIENT_CERT` / `GRAPHQL_CLIENT_KEY`).

The venture ID is persisted as the app variable **`aabTeamVentureId`** in the control plane — this is
the source of truth the BFF reads to pass `resourceId` into CDS and to resolve `siteId → ventureId`
for FGA checks.

---

## 12. Security & Data Integrity

- **Owner-pays** — the collaborator row records *access*, never ownership or billing. Credits/spend
  resolve through the subscription, whose `customerId` is unchanged.
- **Control-plane trust boundary** — the record lives in mgmt-airo, written via the owner-authorized
  API after the BFF authorizes the owner's intent (FGA `owner`). The app's own (AI-generated)
  containers can't reach or assert it, so a compromised/prompt-injected app can't self-grant.
- **No privilege confusion** — shared-app records carry the real `ownerCustomerId`; the BFF treats
  `owner_customer_id === caller` as "owner" (FGA bypass), so a shared app must name its true owner.
- **Subscription reads are access-controlled** — `GET /subscriptions/:id` and credit-grant reads are
  owner-or-collaborator gated; an unrelated customer gets 404.
- **FGA is the in-app authority** — no app action proceeds without an FGA permission check (via
  `listObjects`, which resolves computed relations).
- **No BFF-owned database** — there's no application-layer Postgres table to leak; authorization is
  enforced at the control plane.

### Data integrity rules

- **One row per `(app, invitee)`** — enforced by `UNIQUE (app_id, customer_id)`; a repeat invite is an
  idempotent upsert (capabilities refreshed in place), never a duplicate.
- **The subscription is the billing anchor** — `subscription_id` always points at the owner's
  subscription; refreshed on re-grant so an ownership move stays consistent.
- **Revoke only on full removal** — the BFF sync revokes a collaborator only when they no longer hold
  `airo_app_view` on the venture, so a role downgrade (removing one relation) never drops the backend
  binding.

```sql
-- Who collaborates on an app
SELECT customer_id, role, granted_by, created_at FROM airo_app_collaborators WHERE app_id = ?;

-- What apps a customer collaborates on ("shared with me")
SELECT app_id, subscription_id, role FROM airo_app_collaborators WHERE customer_id = ?;
```

---

## 13. Failure Modes

| Scenario | Behavior |
|---|---|
| `aab-multi-user` off | No FGA, no sync, no DB, no new calls. |
| Grant to mgmt-airo fails | `fga-write` returns 502; client retries; idempotent ⇒ converges. |
| Revoke fails | Logged, best-effort; FGA tuple already removed (in-app perms gone). |
| Collaborator table empty | Authorization fallbacks return false ⇒ single-owner behavior. |
| Role downgrade (remove one relation) | Not revoked — member still has `airo_app_view`; binding kept, capabilities refreshed. |
| `team_venture_id` missing | Non-owner → deny (403, fail closed); owner bypasses FGA (C1 ownership). Logged. |

---

## 14. Component Map

**mgmt-airo** (`mhp-core/backends/airo-go`)

| Concern | Path |
|---|---|
| Table / queries | `sql/migrations/…_add_airo_app_collaborators.up.sql`, `sql/schema.sql`, `sql/queries/airo_app_collaborators.sql` |
| Entity / repo / service | `internal/domain/entities/app_collaborator.go`, `internal/domain/repositories/app_collaborator_repository.go`, `internal/infrastructure/database/app_collaborator_repo.go`, `internal/application/services/app_collaborator_service.go` |
| Authorization | `internal/presentation/http/middleware/entity_owner.go`, `internal/presentation/http/middleware/collaborator_capability.go` |
| Write API | `internal/presentation/http/handlers/collaborator_handler.go` |
| Listing | `internal/presentation/http/handlers/customer_handler.go` (`GetMySharedApps`) |
| Routes / wiring | `…/handlers/router.go`, `internal/bootstrap/container.go`, `cmd/server/main.go` |

**BFF** (`app`)

| Concern | Path |
|---|---|
| mgmt client | `src/lib/mgmt-airo/client.ts` (`grant/revoke/listCollaborator`, `getSharedAppsForCustomer`) |
| Sync | `src/lib/mgmt-airo/collaborator-sync.ts` |
| FGA enforcement | `src/lib/authz-fga/enforce-venture-relation.ts`, `list-objects.ts`, `oauth-token.ts` |
| Listing | `src/lib/control-plane/v2-control-plane-adapter.ts` (`listSharedSites`) |
| Write trigger | `src/app/api/sites/[id]/authz/fga-write/route.ts` |
| Team UI | `src/app/[market]/develop/components/settings/TeamPanel.tsx` |

---

## 15. Environment Configuration

### Katana secrets (test/prod) — BFF

| Variable | Purpose |
| --- | --- |
| `AUTHZ_FGA_BASE_URL` | FGA API base (per env — see §4 stores table) |
| `AUTHZ_FGA_STORE_ID` | FGA store ID (per env) |
| `AUTHZ_FGA_OAUTH_TOKEN_URL` | OAuth endpoint (`https://api.{env}-godaddy.com/v2/oauth2/token`) |
| `AUTHZ_FGA_CLIENT_ID` / `AUTHZ_FGA_CLIENT_SECRET` | OAuth client for FGA |
| `AUTHZ_FGA_MODEL_ID` | Optional: pin to a specific model version |
| `GRAPHQL_CLIENT_CERT` / `GRAPHQL_CLIENT_KEY` | S2S cert for Product Graph (venture creation) |
| `GRAPHQL_SSO_ENDPOINT` | SSO token endpoint (default `sso.{env}-godaddy.com`) |
| `MGMT_AIRO_BASE_URL` | mgmt-airo endpoint (collaborator sync + shared-apps) |

> No `AAB_POSTGRES_*` (the BFF owns no database) and no S2S/IAM token for mgmt-airo — the collaborator
> sync uses the caller's `sso-jwt`, like every other mgmt-airo call.

### Switchboard flags

| Flag | Purpose | Default |
| --- | --- | --- |
| `aab-multi-user` | Master gate for all multi-user features | `false` |
| `appbuilder-settings-team` | Legacy Team nav gate (pre-FGA) | — |
| `appbuilder-airoplus-upgrade-banner` | Controls upgrade banner display | — |

### Local development

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_DEV_FORCE_AAB_MULTI_USER=true` | Force the flag on without Switchboard (IAM needs VPN) |
| `AUTHZ_FGA_LOCAL_MOCK=true` | Mock all FGA calls (returns `allowed: true`) — see flows doc |

---

## 16. Deployment Checklist

### mgmt-airo

- Run the `airo_app_collaborators` migration.
- Deploy the collaborator endpoints **before or with** the BFF (the grant path fails-loud, so a
  missing endpoint would 502 invites).

### Post-deploy verification (invitee browser)

```js
(async () => {
  const h = { credentials: "include" }, siteId = "<appId>";
  const list = await fetch("/api/sites", h).then((r) => r.json());
  console.log("shared in listing:", (list.sites ?? []).find((s) => s.id === siteId)?.sharedWithMe);
  const site = await fetch(`/api/sites/${siteId}`, h).then((r) => r.json());
  console.log("getSite sharedWithMe:", site.sharedWithMe, "| agent_url:", site.agent_url);
  const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 15000);
  const tok = await fetch("/api/auth/agent-token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "include", signal: ctrl.signal, body: JSON.stringify({ siteId }),
  });
  const body = await tok.json().catch(() => ({}));
  if (body.token) {
    const c = JSON.parse(atob(body.token.split(".")[1]));
    console.log("agent-token:", tok.status, "| canPublish:", c.canPublish, "| canDownload:", c.canDownload);
  } else console.log("agent-token failed:", tok.status, body);
})();
```

**Expected:** `shared in listing: true` · `getSite sharedWithMe: true` · `agent-token: 200` with
`canPublish` per role.

---

## 17. Contacts & Channels

| Team | Contact | Slack |
| --- | --- | --- |
| AuthZ (permissions) | Nick Verbos | `#authz-support` |
| AuthZ UI (CDS) | Trond Bergquist, Oleksandr Stukalo | `#multi-users-venture` |
| AuthZ PM | Viswanath Veerappan | — |
| FGA API access | — | `#sso-authz-support` |
| eComm | Josh Rogers | `#ecomm-platform-support` |
| My Products | Ambika Yavatkar | `#agi-ii-products` |
| Help pages | Hayley Komen | DC Content Dev intake form |

---

## 18. Common Gotchas

1. **OAuth token URL in prod:** use `api.godaddy.com/v2/oauth2/token`, NOT `oauth.api.godaddy.com`
   (the `oauth.` prefix is the internal origin and fails in prod).
2. **FGA store RBAC for writes:** even with the `authz.fga:write` scope, the client needs an internal
   `write` relation on the store+type object (`fga_store_and_object_type:{storeId}_venture`) — a store
   admin action.
3. **Cert tokens vs OAuth tokens:** `sso.{env}-godaddy.com/v1/secure/api/token` returns cert tokens
   (typ `cert`) without FGA scopes. FGA requires `Bearer` tokens from the OAuth2 endpoint.
4. **Use `listObjects`, not `check`** — see §5; `check` silently denies computed relations on this
   model.
5. **One venture per app, not per customer** — see §11.
6. **Owner bypass is before FGA** — owners never hit the FGA API.
7. **Missing venture = fail CLOSED (deny 403)** for a non-owner — the relation can't be verified, so access is refused (NOT skipped).
8. **Local dev without VPN:** use `NEXT_PUBLIC_DEV_FORCE_AAB_MULTI_USER=true` +
   `AUTHZ_FGA_LOCAL_MOCK=true`.
9. **CDS version override for testing:** `?cdsVersion=multiusersEsm--{9-char-hash}`.
