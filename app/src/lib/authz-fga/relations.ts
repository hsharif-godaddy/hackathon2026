/**
 * Maps Airo Builder permission concepts to the `airo_app_*` relations
 * in the shared GoDaddy venture FGA model.
 *
 * Pre-built role hierarchy and what each inherits:
 *   owner/admin → ALL airo_app_* + user_invite/user_update
 *   manager    → airo_app_build, _publish, _download, _view_db, _edit_db, _view
 *   employee   → airo_app_build, _download, _view_db, _edit_db, _view
 *
 * airo_app_manage_secrets and airo_app_manage_domains are admin-only.
 * user_invite (manage members) and owner are role-level relations.
 */
export const AUTHZ_FGA_RELATIONS = {
  canBuild: 'airo_app_build',
  canDelete: 'admin',
  canDownload: 'airo_app_download',
  canManageDomains: 'airo_app_manage_domains',
  canManageMembers: 'user_invite',
  canManageSecrets: 'airo_app_manage_secrets',
  canPublish: 'airo_app_publish',
  canTransfer: 'owner',
  canViewDb: 'airo_app_view_db',
  canEditDb: 'airo_app_edit_db',
  canView: 'airo_app_view',
} as const;

/**
 * Relations a member-manager (a caller who holds `user_invite`) may assign to a
 * member via `fga-write`: the per-app permission set plus `user_invite` itself.
 *
 * This DELIBERATELY EXCLUDES the privilege-escalation relations:
 *   - `owner`  (canTransfer) — never writable via fga-write; excluded by its
 *     ABSENCE from both writable sets (see isFgaWritableRelation).
 *   - `admin`  (canDelete) and `user_update` — see
 *     {@link AUTHZ_FGA_OWNER_ONLY_WRITABLE_RELATIONS}
 *
 * The route is reachable by any `user_invite` holder, which per the role model
 * includes both owner AND admin. If `admin`/`owner` were writable here, a
 * non-owner admin could POST `{ relation: 'owner' | 'admin' }` for themselves
 * (or an accomplice) and escalate past the dedicated level-3 transfer flow.
 */
export const AUTHZ_FGA_WRITABLE_RELATIONS: ReadonlySet<string> = new Set<string>([
  AUTHZ_FGA_RELATIONS.canBuild,
  AUTHZ_FGA_RELATIONS.canDownload,
  AUTHZ_FGA_RELATIONS.canManageDomains,
  AUTHZ_FGA_RELATIONS.canManageMembers, // user_invite
  AUTHZ_FGA_RELATIONS.canManageSecrets,
  AUTHZ_FGA_RELATIONS.canPublish,
  AUTHZ_FGA_RELATIONS.canViewDb,
  AUTHZ_FGA_RELATIONS.canEditDb,
  AUTHZ_FGA_RELATIONS.canView,
]);

/**
 * Privileged relations that `fga-write` will accept ONLY when the caller
 * themselves holds `owner` on the venture. Lets an owner promote a member to
 * admin / grant user-management, while blocking a non-owner admin from doing so.
 */
export const AUTHZ_FGA_OWNER_ONLY_WRITABLE_RELATIONS: ReadonlySet<string> = new Set<string>([
  AUTHZ_FGA_RELATIONS.canDelete, // 'admin'
  'user_update',
]);

/**
 * Whether a relation may be written via `fga-write` at all (by anyone) — the
 * union of the member-assignable and owner-only sets. `owner` (canTransfer) is
 * absent from both: ownership changes must go through the dedicated level-3
 * transfer flow, never a raw tuple write, so `owner` is never writable here.
 */
export function isFgaWritableRelation(relation: string): boolean {
  return (
    AUTHZ_FGA_WRITABLE_RELATIONS.has(relation) ||
    AUTHZ_FGA_OWNER_ONLY_WRITABLE_RELATIONS.has(relation)
  );
}
