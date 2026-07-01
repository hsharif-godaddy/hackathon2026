// ---------------------------------------------------------------------------
// Admin Auth Strategy — core interfaces
//
// Add new strategies by implementing AdminAuthStrategy and registering them
// via the AdminAuthRegistry. The active strategy is selected at boot via the
// ADMIN_AUTH_STRATEGY env var (defaults to "first-user").
// ---------------------------------------------------------------------------

/** Opaque bag of credentials supplied by the caller (login or setup). */
export type AdminCredentials = Record<string, unknown>;

/** Returned on successful authentication. */
export interface AdminIdentity {
  /** Stable identifier for the authenticated admin (strategy-scoped). */
  id: string;
  /** Human-readable label shown in the UI. */
  label: string;
}

export interface AdminAuthStrategy {
  /** Machine-readable unique name, used as the ADMIN_AUTH_STRATEGY value. */
  readonly name: string;
  /** Human-readable name shown in the UI. */
  readonly displayName: string;
  /** Short description of how this strategy works. */
  readonly description: string;

  /**
   * Returns true when the strategy has been fully configured and can
   * authenticate. A fresh deployment returns false until setup() succeeds.
   */
  isReady(): Promise<boolean>;

  /**
   * First-time configuration. Called once via POST /api/admin/auth/setup.
   * Returns null on success or an object with an error message on failure.
   * Implementations MUST be idempotent-safe: if already configured, return
   * an error rather than overwriting the existing admin.
   */
  setup(input: AdminCredentials): Promise<{ error: string } | null>;

  /**
   * Authenticate a login attempt. Returns the AdminIdentity on success or
   * null on failure. Never throws — surface errors as null.
   */
  authenticate(credentials: AdminCredentials): Promise<AdminIdentity | null>;
}
