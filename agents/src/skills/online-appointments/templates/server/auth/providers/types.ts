// ---------------------------------------------------------------------------
// Auth Provider interface
//
// An AuthProvider handles one authentication mechanism (local password,
// Google OAuth, magic-link, etc.). Providers are registered in the
// ProviderRegistry and selected at runtime. Endpoints that need auth call
// through the registry — they never import a concrete provider directly.
// ---------------------------------------------------------------------------

export type IdentityType = "Client" | "Resource" | "Admin";
export type Role = "customer" | "staff" | "admin";

/** The normalized user returned by every provider after successful auth. */
export interface AuthUser {
  /** Stable string key: "<identityType>:<identityId>" */
  id: string;
  identityId: string;
  identityType: IdentityType;
  roles: Role[];
  email: string | null;
  displayName: string | null;
}

/** Result shape from signup — includes the created user. */
export interface SignupResult {
  user: AuthUser;
}

export interface AuthProvider {
  /** Machine-readable name, used as AUTH_PROVIDER env value or registry key. */
  readonly name: string;
  readonly displayName: string;

  /** Whether this provider supports account creation via signup(). */
  readonly supportsSignup: boolean;

  /**
   * Attempt to authenticate with arbitrary credentials (e.g. { email, password }
   * for local; { code, redirectUri } for OAuth).
   * Returns AuthUser on success, null on failure. Never throws.
   */
  authenticate(credentials: Record<string, unknown>): Promise<AuthUser | null>;

  /**
   * Create a new user account. Throws a descriptive Error on validation or
   * duplicate-account failures so the caller can surface the message.
   * Undefined if supportsSignup is false.
   */
  signup?(input: Record<string, unknown>): Promise<SignupResult>;
}
