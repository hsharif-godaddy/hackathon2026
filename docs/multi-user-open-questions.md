# Multi-User — Open Items & Decision Log

Living tracker for multi-user decisions. Most of the original cross-team questions are now **resolved
and shipped** — they're recorded below as a decision log (with pointers to the authoritative doc) so
the history isn't lost. The short list of genuinely open / future items is at the bottom.

**Related:** [multi-user-architecture.md](./multi-user-architecture.md) (how it works today),
[multi-user-flows.md](./multi-user-flows.md) (request flows), [multi-user-rbac-planning.md](./multi-user-rbac-planning.md)
(product/MVP spec).

---

## Resolved decisions

### OpenFGA / AuthZ

| Topic | Decision | Where |
| --- | --- | --- |
| Tuple resource model | Venture-scoped: `customer:<id> → airo_app_* → venture:<id>`. No `app:<siteId>` tuples. | [arch §4](./multi-user-architecture.md#4-fga-permission-model) |
| Invite → tuple write | BFF `fga-write` route writes the tuples and mirrors a collaborator row into mgmt-airo. | [arch §8.1](./multi-user-architecture.md#8-key-code-flows) |
| User identifier in tuples | `customer:<customerId>`. | [flows §3](./multi-user-flows.md#3-fga-http-shapes) |
| Owner semantics | Owner is `customer_id` ownership enforced in the BFF (FGA bypass); an `owner` tuple is also written best-effort on venture creation. | [arch §5, §11](./multi-user-architecture.md#5-bff-enforcement) |
| Final authorization model | `airo_app_*` relations + `admin`/`owner`; **custom roles** = arbitrary capability sets. | [arch §4](./multi-user-architecture.md#4-fga-permission-model) |
| Check API contract | `listObjects` (not `check`) for gating, per-env store IDs, OAuth `client_credentials`. | [arch §5](./multi-user-architecture.md#5-bff-enforcement), [flows §3](./multi-user-flows.md#3-fga-http-shapes) |
| S2S OAuth / scopes | BFF client with `authz.fga:check` / `:write`; env vars in arch §15. | [arch §15](./multi-user-architecture.md#15-environment-configuration) |
| Invite/accept/email copy | AAB-only `aab:app:*` strings; no cross-product permissions. | [rbac-planning](./multi-user-rbac-planning.md) |
| Post-accept deep link | `/[market]/develop/[appId]`; fallback to apps list + toast. | [flows J4, J10](./multi-user-flows.md#7-user-journeys-j1j14) |

### CDS / Multi-Users

| Topic | Decision | Where |
| --- | --- | --- |
| `resourceType` | `venture`, with a **per-app** `resourceId` (the app's `aabTeamVentureId`). | [arch §10](./multi-user-architecture.md#10-cds-multiusersesm-integration) |
| `permissionsToInclude` | `AAB_TEAM_PERMISSION_KEYS` (10 × `aab:app:*`). | [arch §10](./multi-user-architecture.md#10-cds-multiusersesm-integration) |
| Next.js (non-Gasket) host | `ComponentLoader` from `@venture/cds-loader` (paywall pattern), nested router for `routePrefix`. | [arch §10](./multi-user-architecture.md#10-cds-multiusersesm-integration) |
| Venture creation API | `VentureService` (Product Graph, S2S cert), lazy + owner-only. | [arch §11](./multi-user-architecture.md#11-venture-provisioning) |

### Product / mgmt-airo

| Topic | Decision | Where |
| --- | --- | --- |
| Persist `appId ↔ ventureId` | App variable **`aabTeamVentureId`** in the control plane (source of truth). | [arch §11](./multi-user-architecture.md#11-venture-provisioning) |
| Legacy `VentureService` | Per-app team venture is **separate** from the per-customer `image_manager_venture_id` (Getty). | [arch §11](./multi-user-architecture.md#11-venture-provisioning) |
| Single signed flow | Captured end-to-end in [multi-user-flows.md](./multi-user-flows.md). | flows doc |
| Control-plane access for invitees | `airo_app_collaborators` row (registration + authorization + listing); capability-based enforcement. | [arch §6–7](./multi-user-architecture.md#6-airo_app_collaborators--mgmt-airo-table) |
| Member management scope | **Owner-only** (BFF `owner` gate + mgmt-airo `OwnerOnlyAuthorization`). | [arch §4, §6](./multi-user-architecture.md#4-fga-permission-model) |

---

## Open / future items

| # | Item | Notes |
| - | ---- | ----- |
| O1 | **Tuple propagation max delay** | Retry/spinner window is implemented (~10s); the empirical worst-case delay before `airo_app_build` resolves post-grant isn't formally measured. Confirm with AuthZ if the window needs tuning. |
| O2 | **Revoke reliability / reconciliation** | Revoke is best-effort; a periodic reconciliation pass would prevent a removed collaborator from retaining a stale `airo_app_collaborators` row. (A reconcile path exists and runs on Team-panel changes; a scheduled sweep is still future work.) |
| O3 | **`shopper_id` backfill** | `airo_customers.shopper_id` for invitees is populated on their next self-authenticated call; a backfill at grant time would avoid the gap. |
| O4 | **Shared-apps listing latency** | `GetMySharedApps` enriches per app; batch by system for users with many shared apps. |
| O5 | **WOS event listener** | Whether AAB needs a Workflow Orchestrator listener for AuthZ lifecycle events (e.g. revoke active agent tokens on member removal) vs relying on real-time FGA checks. Decision pending with AuthZ; likely unnecessary for MVP. |

### Closing an item

Replace the row with a **Decision** (date + link to PR/ticket) and move the durable detail into
[multi-user-architecture.md](./multi-user-architecture.md).
