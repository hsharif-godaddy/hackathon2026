# Airo Enterprise

How Airo App Builder serves **enterprise customers** — organizations where many people build apps under a shared subscription, with their own identity provider, per-organization controls on cost and access, and dedicated infrastructure.

## The vision

Airo today is a per-shopper product: one shopper, one subscription, one set of apps. The enterprise extension layers a **member model** on top of that so a single subscription can admit many users and pay once for the lot, while preserving isolation between members and giving the org its own auth, infra, and admin controls.

The shape an enterprise customer experiences:

| Capability | What it means |
|---|---|
| **Single subscription, many users** | One paying subscription owns the relationship; individual employees ("members") create apps under it without their own paid plans. |
| **Identity federation** | Members sign into the AAB builder via their company's IdP. AAB never asks for passwords; the IdP says "this is `jdoe@company.com`" and AAB binds that to a member record. |
| **Isolated workspaces** | Each member sees only their own apps. No cross-member visibility unless explicitly shared. |
| **Per-app SSO for published apps** | Members can require their own org's IdP in front of the *published* app — end users authenticate via the customer's Okta / Azure AD / etc. before reaching the app. |
| **Per-member spend caps** | Optional monthly credit cap per member, falling back to a subscription default. Stops one member from burning the whole org's budget. |
| **Dedicated infrastructure** | Enterprise apps land on customer-dedicated cells for compliance and tenant isolation. |
| **Admin tooling** | Org admins manage members, identities, SSO configs, and quotas. |

The first enterprise customer is **GoDaddy itself** — internal employees create AAB apps under a shared admin/ENT subscription via Enterprise SSO. The design is deliberately generic: any enterprise bringing its own OIDC IdP follows the same path.

## How the model is structured

```
┌──────────────────────────────────────────────────────┐
│  Enterprise Subscription                              │
│   - billing relationship                              │
│   - default per-member quota                          │
│   - SSO config(s) — one per IdP the org federates with│
└────────────────────────┬─────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼─────┐    ┌─────▼─────┐    ┌─────▼─────┐
   │ Member A │    │ Member B  │    │ Member N  │
   │ jdoe@…   │    │ asmith@…  │    │ …         │
   │ role:    │    │ role: user│    │ role:user │
   │  admin   │    │ quota: 50k│    │           │
   └────┬─────┘    └─────┬─────┘    └─────┬─────┘
        │                │                │
   ┌────▼─────┐    ┌─────▼─────┐    ┌─────▼─────┐
   │ A's apps │    │ B's apps  │    │ N's apps  │
   │ (private │    │ (private  │    │ (private  │
   │  to A)   │    │  to B)    │    │  to N)    │
   └──────────┘    └───────────┘    └───────────┘
```

Two layers above the per-shopper Airo model:

- **Member**: a subscription-scoped account record. Carries a role (`user` | `admin`) and a status (`active` | `disabled`). Owns the member's apps. Does NOT have its own JWT — the JWT comes from the org's IdP and gets translated to a member at runtime.
- **Identity**: the IdP binding(s) under a member (1..N). One row per IdP subject the member can authenticate as. This is the runtime link between "the customer's IdP says this person is signing in" and "this is which member they are."

A subscription holds N members; a member holds 1..N identities. A subscription can also federate against multiple IdPs by holding multiple SSO configs — handy for orgs with both an internal directory and a partner IdP.

## End-to-end journey

The lifecycle of an enterprise app spans four distinct phases: admin onboarding, member sign-in, building an app, and end-user access. Each touches different repos and infrastructure layers.

### Phase 1 — Admin onboarding (one-time per enterprise)

```
   Org admin                     mhp-core control plane           Cells
      │                                  │                          │
      │ Create enterprise subscription   │                          │
      ├─────────────────────────────────►│                          │
      │ (aab-ent-v1, billing, defaults)  │                          │
      │                                  │                          │
      │ Allocate dedicated cell(s)       │                          │
      ├─────────────────────────────────►│ Mark cells in            │
      │                                  │ hosting_cell_owners ────►│
      │                                  │ as owned by this sub     │
      │                                  │                          │
      │ Create SSO config (per IdP)      │                          │
      ├─────────────────────────────────►│ airo_enterprise_sso_     │
      │ (issuer, jwks_url, expected_aud) │ configs                  │
      │                                  │                          │
      │ Invite members                   │                          │
      ├─────────────────────────────────►│ airo_subscription_       │
      │ (per employee: shopper subject + │ members + airo_sub_      │
      │  role)                           │ member_identities        │
      │                                  │                          │
```

All admin operations today flow through `mgmt-client`. A browser-based admin UI is on the roadmap.

### Phase 2 — Member sign-in (every login)

```
   Browser              IdP (e.g. GoDaddy SSO)        AAB BFF              mhp-core
      │                          │                       │                     │
      │ Open builder.airo.ai     │                       │                     │
      ├──────────────────────────┴──────────────────────►│                     │
      │ 302 redirect to IdP      │                       │                     │
      │◄─────────────────────────┤                       │                     │
      │ Sign in (creds + MFA)    │                       │                     │
      ├─────────────────────────►│                       │                     │
      │ Redirect with JWT        │                       │                     │
      │ (sub = employee subject) │                       │                     │
      │◄─────────────────────────┤                       │                     │
      │ Reload builder w/ JWT    │                       │                     │
      ├──────────────────────────┴──────────────────────►│                     │
      │                          │                       │ Identity lookup     │
      │                          │                       ├────────────────────►│
      │                          │                       │ Match in airo_      │
      │                          │                       │ subscription_       │
      │                          │                       │ member_identities?  │
      │                          │                       │                     │
      │                          │                       │ → member row        │
      │                          │                       │   role + ent sub    │
      │                          │                       │◄────────────────────┤
      │ Apps view loaded under   │                       │                     │
      │ enterprise sub (only     │                       │                     │
      │ this member's apps)      │                       │                     │
      │◄─────────────────────────┴───────────────────────┤                     │
```

There's no separate "enterprise login" UX from the user's perspective — they sign in as their normal shopper account, and mhp-core's identity lookup decides whether they're a regular shopper or an enterprise member. If their subject is in `airo_subscription_member_identities`, they get the enterprise experience; otherwise the regular Airo flow.

### Phase 3 — Member builds and publishes an app

```
   Member               AAB BFF             mhp-core           Dedicated cell
     │                      │                   │                     │
     │ Click "Create app"   │                   │                     │
     ├─────────────────────►│ Create app        │                     │
     │                      ├──────────────────►│                     │
     │                      │                   │ Honor cell affinity:│
     │                      │                   │ pick from cells     │
     │                      │                   │ owned by this sub   │
     │                      │                   ├────────────────────►│
     │                      │                   │                     │ Allocate
     │                      │                   │                     │ preview
     │                      │                   │                     │ container
     │                      │ App ready         │                     │
     │                      │◄──────────────────┤                     │
     │ Builder opens        │                   │                     │
     │◄─────────────────────┤                   │                     │
     │                      │                   │                     │
     │ Iterate w/ AI agent  │                   │                     │
     │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─►│                   │                     │
     │                      │                   │                     │
     │ (Admin marked app    │                   │                     │
     │  apps.sso_required)  │                   │                     │
     │                      │                   │                     │
     │ Settings → SSO       │                   │                     │
     │ Paste Okta clientId+ │                   │                     │
     │ secret, click Save   │                   │                     │
     ├─────────────────────►│ Write SSO_OAUTH_  │                     │
     │                      │ CONFIG via mTLS   │                     │
     │                      ├──────────────────►│ Stored as           │
     │                      │                   │ auth-class secret   │
     │                      │                   │ (Landlock-isolated  │
     │                      │                   │  from customer app) │
     │                      │                   │                     │
     │ Click Publish        │                   │                     │
     ├─────────────────────►│                   │                     │
     │                      │ Trigger deploy    │                     │
     │                      ├──────────────────►│ Publish gate:       │
     │                      │                   │ check SSO_OAUTH_    │
     │                      │                   │ CONFIG present (yes)│
     │                      │                   ├────────────────────►│
     │                      │                   │                     │ Allocate
     │                      │                   │                     │ publish
     │                      │                   │                     │ container
     │                      │                   │                     │ + IDP_*
     │                      │                   │                     │ env vars
     │ App live at          │                   │                     │
     │ <appId>.<cell>.      │                   │                     │
     │  airoapp.ai          │                   │                     │
     │◄─────────────────────┤                   │                     │
```

The app lives entirely on the enterprise's dedicated cell — preview, publish, secrets, persistent storage. It never touches the cells used by regular Airo customers.

### Phase 4 — End-user access (every visit to the published app)

```
   End user                 dev-supervisor              Customer's IdP
   (e.g. teammate)          (in publish container)      (e.g. Okta)
      │                            │                          │
      │ Visit app URL              │                          │
      ├───────────────────────────►│                          │
      │                            │                          │
      │                            │ Reads clientId/secret    │
      │                            │ from auth.json           │
      │                            │ (Landlock-isolated from  │
      │                            │  the customer's app)     │
      │                            │                          │
      │                            │ No session cookie?       │
      │                            │ → start OAuth flow       │
      │                            │                          │
      │ 302 redirect to IdP        │                          │
      │◄───────────────────────────┤                          │
      │ /authorize?client_id=...   │                          │
      ├───────────────────────────────────────────────────────►│
      │ Sign in                    │                          │
      ├───────────────────────────────────────────────────────►│
      │ Redirect with auth code    │                          │
      │◄───────────────────────────────────────────────────────┤
      │ /airo/idp/callback?code=…  │                          │
      ├───────────────────────────►│ Exchange code for token  │
      │                            ├─────────────────────────►│
      │                            │ ID token returned        │
      │                            │◄─────────────────────────┤
      │                            │ Validate JWT signature   │
      │                            │ vs jwks_url, set session │
      │                            │ cookie scoped to host    │
      │ App loaded                 │                          │
      │◄───────────────────────────┤                          │
```

The customer's IdP is the trust anchor for who can use the app. AAB never sees user passwords or MFA — the customer keeps full control over access policies, group rules, and offboarding. When an employee leaves the customer's company, removing them from the IdP is sufficient; AAB doesn't need to be notified.

## Tenant isolation via dedicated cells

A **cell** is a unit of compute + storage in mhp-core's hosting plane — roughly, a small cluster of machines that run customer apps. The platform has dozens of cells today (~22 prod p3 in Oregon, ~6 prod sxb1 in Frankfurt, plus dev). Regular Airo customers' apps land on **shared cells** that host many customers' workloads side-by-side.

Enterprise customers don't share cells with anyone:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Production hosting fleet (mhp-core managed)                          │
│                                                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │  Cell c1        │  │  Cell c4        │  │  Cell c40       │      │
│  │  ┌────┬────┬───┐│  │  ┌────┬────┬───┐│  │  ┌────┬────┬───┐│      │
│  │  │app │app │ … ││  │  │app │app │ … ││  │  │app │app │ … ││      │
│  │  └────┴────┴───┘│  │  └────┴────┴───┘│  │  └────┴────┴───┘│      │
│  │                 │  │                 │  │                 │      │
│  │ Owner: shared   │  │ Owner: ent A    │  │ Owner: ent B    │      │
│  │ (regular        │  │ (employees of   │  │ (employees of   │      │
│  │  shoppers)      │  │  enterprise A)  │  │  enterprise B)  │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
        ▲                       ▲                       ▲
        │                       │                       │
   Many regular            All apps owned by       All apps owned by
   customers'              members of               members of
   apps share              enterprise A             enterprise B
   this cell               (no other tenants)       (no other tenants)
```

The mechanism (already shipped in mhp-core):
- `hosting_cell_owners` table records which subscription owns each cell. `owner_type='subscription'` for enterprise.
- `airo_subscriptions.requires_cell_affinity = true` on enterprise subs forces the cell allocator to pick from owned cells only.
- `system_cell_attachments` records which cells a subscription has been provisioned with — multi-cell subs (e.g., regional split) work naturally.

What this gives an enterprise:
- **Compute isolation** — no noisy-neighbor effects from other customers' workloads.
- **Storage isolation** — each cell has its own Ceph filesystem; an enterprise's persistent app data physically lives on machines no other customer's process runs on.
- **Network blast-radius** — a cell-level outage affects only the apps on that cell. An enterprise can be on multi-cell to ride out single-cell incidents.
- **Compliance posture** — for regulated workloads, the customer can point at the dedicated-cell guarantee in their security review.

For multi-region requirements, an enterprise can be allocated cells in different regions (Oregon + Frankfurt today) and routing is handled by the cell router via the `DOMAINS` shared secret.

## Workspace isolation (within an enterprise)

Cell isolation handles "enterprise A vs enterprise B." A second layer of isolation handles "member A vs member B within the same enterprise":

- **Apps are member-scoped.** Member A creating an app doesn't expose it to Member B. The visibility rules are enforced at the data layer (mhp-core), so the AAB UI doesn't need to know about member boundaries — it asks "what are this caller's apps?" and the answer respects the member scope.
- **Per-app hosting infra is member-scoped.** An app's preview container, publish container, secrets, and persistent storage are scoped to the owning member's apps only — no shared state across members within the same enterprise.
- **Sharing across members is explicit** and currently limited to "transfer ownership" — no cross-member collaboration UI in Phase 1.

## Per-app SSO

Members can require their org's IdP in front of their *published* app — separate from the IdP they use to sign into AAB. So a GoDaddy employee builds an internal HR tool that other GoDaddy employees access via Okta sign-in, even though everyone involved is already authenticated to AAB itself.

Detailed design + flow + code pointers: [`auth-at-edge-sso.md`](./auth-at-edge-sso.md).

## Quotas + admin tools

Enterprises can optionally cap per-member monthly credit spend. Members without an explicit cap fall back to the subscription's default, so the admin sets a sensible default and only overrides for outliers (e.g., a member running an unusual training pipeline gets a higher cap; a new member gets the default).

Today admin operations — creating members, binding identities, setting roles, adjusting quotas, toggling SSO requirements — flow through the `mgmt-client` CLI. A browser-based admin surface is on the roadmap.

## Where the implementation lives

The enterprise model spans multiple repos and teams. AAB owns the customer-facing surfaces; mhp-core owns the data model, identity translation, and admin tooling; dev-supervisor owns the runtime auth proxy inside the published container.

| Concern | Where it lives | Status |
|---|---|---|
| **Member identity** — linking IdP subjects to subscription members | mhp-core (`airo_subscription_members` + `airo_subscription_member_identities`) | Shipped. mhp-core: [`gd-internal-member-management-quickstart.md`](https://github.com/gdcorp-partners/mhp-core/blob/main/docs/processes/gd-internal-member-management-quickstart.md) |
| **AAB builder login as an enterprise member** | mhp-core's `MultiTenantJWTValidator` + `DetectGodaddyEntMember` middleware in airo-go; AAB BFF treats ent JWTs identically to regular shopper JWTs | Shipped |
| **Cell affinity** — landing enterprise apps on dedicated cells | mhp-core (`hosting_cell_owners`, `requires_cell_affinity`) | Shipped |
| **Per-app SSO** — the customer's IdP gates end users of the *published* app | This folder ([`auth-at-edge-sso.md`](./auth-at-edge-sso.md)) | Phase 1 in flight |
| **Member quotas** — per-member monthly credit caps | mhp-core | Shipped (admin via `mgmt-client`) |
| **Admin UI for member management** | TBD | Phase 2 |

## Index

- [auth-at-edge-sso.md](./auth-at-edge-sso.md) — Per-app SSO ("Auth-at-Edge"). Detailed design and code pointers.

## Roadmap

**Phase 1 (shipped) — foundation, GoDaddy-internal**
The data model, identity translation, cell affinity, per-member quotas, and the per-app SSO scaffold all exist. Limited to the GoDaddy-shopper IdP. Admin operations via `mgmt-client` CLI. Enough for GoDaddy employees to self-serve apps under a shared subscription and put GoDaddy-Okta in front of their published apps.

**Phase 2 (in this PR for the customer-toggle slice) — three-tier admin lock + customer override**
The first piece is shipping here: the admin selects one of three modes per subscription (`required` / `optional` / `disabled`), and when admin chose `optional`, the customer can flip per-app SSO on/off via a toggle in **Settings → SSO**. Backed by mhp-core's `airo_enterprise_sso_configs.sso_required` enum + `airo_apps.sso_required` per-app override + the customer-facing `PUT /v1/subscriptions/:subId/apps/:appId/sso-required` endpoint.

**Remaining Phase 2 work — generalize to non-GoDaddy enterprises**
- **Multi-IdP per subscription** — one org federating against several IdPs (e.g., internal SSO + a partner IdP). Storage already supports this; Phase 2 is the admin-CRUD UI and the customer-facing SSO config picker.
- **Custom-domain SSO** — dev-supervisor derives the published-app redirect URI per-host so SSO works on attached custom domains, not just the cell-default URL.
- **Admin UI** — replace the `mgmt-client` CLI with a browser-based surface for org admins.
- **Member quota dashboards** — visibility into per-member spend (caps already enforced in Phase 1).
- **Additional IdP types** — broaden beyond `godaddy_shopper` to generic OIDC (Azure AD, Ping, Auth0, etc.).

**Phase 1.5 cleanups (small, deferred)**
Cosmetic improvements that would make AAB's code cleaner without changing customer behavior:

- **airo-go `auth` field in customer-context schema** — `SecretDetailSchema` doesn't list `auth` today, so the customer-proxy POST path strips it. Until mhp-core ships this, AAB uses direct mTLS for SSO writes (works, just inconsistent with our other AAB→mhp-core calls).
- **Per-config pointer-key names on customer-context GET** — admin-only today; AAB hardcodes the defaults (fine while Phase 1 is GoDaddy-only).
- **Website-specific mTLS cert** — AAB reuses the `stripe-service.airo-builder.…` cert (already on mhp-core's allowlist). A dedicated `website.airo-builder.…` cert would be cleaner identity-wise.

**Beyond Phase 2** is not yet scoped. Plausible directions follow customer demand: SAML alongside OIDC, SCIM-based member provisioning, group-based intra-app authorization, audit logging on credential and policy changes, regulated-industry compliance attestations.
