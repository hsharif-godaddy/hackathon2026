/**
 * Returns a UUID v4 via `crypto.randomUUID`.
 * Falls back to a timestamp + base-36 random string in non-secure contexts
 * where `crypto.randomUUID` is unavailable.
 */
export function generateUniqueId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
