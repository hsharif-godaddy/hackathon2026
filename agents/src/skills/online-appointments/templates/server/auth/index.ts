// ---------------------------------------------------------------------------
// Auth layer public API
// ---------------------------------------------------------------------------

export { providerRegistry } from "./providers/registry";
export type { AuthProvider, AuthUser, Role, IdentityType } from "./providers/types";

export { sessionStore } from "./session/memory-store";
export type { Session, SessionStore } from "./session/types";

export {
  setSessionCookie,
  getSessionToken,
  clearSessionCookie,
  COOKIE_NAME,
} from "./session/cookie";
