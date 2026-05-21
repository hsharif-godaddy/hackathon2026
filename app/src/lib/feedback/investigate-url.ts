/**
 * Builds the customer-scoped investigate URL the support agent follows from
 * a CRM case note back to the in-flight investigation.
 *
 * **Why a single base64url-encoded `?ctx=` param instead of three separate
 * query params:** CMAPI HTML-escapes note bodies on storage (defensive
 * encoding for any rendering path that treats notes as HTML). A multi-param
 * URL like `?customerId=X&appId=Y&tab=investigate` round-trips through
 * CMAPI as `?customerId=X&amp;appId=Y&amp;tab=investigate`. When the
 * support agent copy-pastes the link from the CRM UI into a browser, they
 * get the literal `&amp;` text — Chrome doesn't auto-decode HTML entities
 * from the address bar — and the URL parses as one giant `customerId`
 * value. Click-through routes to the wrong page.
 *
 * Wrapping all three values in a single base64url blob removes every `&`
 * from the URL, so CMAPI has nothing to encode and copy-paste survives
 * intact. base64url (RFC 4648 §5) is the URL-safe variant: `+` → `-`,
 * `/` → `_`, no `=` padding. Zero characters that need URL or HTML
 * escaping.
 *
 * `DEBUG_CONSOLE_BASE_URL` is read here to match the Lambda's existing
 * convention. Single source of truth — the CDK config decides the URL
 * once, every consumer of the var sees the same value. Returns null when
 * the var is missing so the BFF skips the link silently rather than emit
 * a broken URL — the deduplicated case is still filed; only the cross-
 * link is missing.
 */

export function encodeInvestigateCtx(customerId: string, appId: string): string {
  // Short keys (`c`, `a`, `t`) keep the URL compact. The console decoder
  // hardcodes the same shape; if you add a fourth field, update both
  // sites in lockstep.
  const payload = JSON.stringify({ c: customerId, a: appId, t: 'investigate' });
  return Buffer.from(payload, 'utf-8').toString('base64url');
}

/**
 * Returns null when DEBUG_CONSOLE_BASE_URL is unset (caller skips the
 * link silently — common on local dev / Katana envs that didn't get the
 * value plumbed through).
 *
 * Set on website Katana per env to match `cdk/lib/config.ts:debugConsoleBaseUrl`:
 *   pre-test / test → https://console.airo-builder.test-godaddy.com
 *   prod-ecs        → https://console.airo-builder.godaddy.com
 */
export function buildInvestigateUrl(appId: string, customerId: string): string | null {
  const base = process.env.DEBUG_CONSOLE_BASE_URL;
  if (!base) return null;
  const ctx = encodeInvestigateCtx(customerId, appId);
  return `${base.replace(/\/$/, '')}/?ctx=${ctx}`;
}
