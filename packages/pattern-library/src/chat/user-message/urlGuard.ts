/**
 * Consumer-provided `src` / `href` URLs on a chat message are untrusted —
 * the component has to render them into DOM sinks (`<img src>`, `<a href>`)
 * without letting a surviving `javascript:`, `data:`, `vbscript:`, or
 * `file:` URL reach the sink. The review playbook's `SECURITY.md §3.1`
 * mandates a scheme allow-list on any `href` / `src` built from consumer
 * input; these are the library-default predicates that satisfy it.
 *
 * Consumers with a stricter CSP or a legitimate need to broaden the set
 * (e.g. allowing `data:image/svg+xml` they constructed themselves) override
 * via the `validateSrc` / `validateHref` props on `UserMessage` or its
 * compound `Image` / `File` slots. The default is meant as a safe baseline,
 * not the final word on policy — see the README's "URL handling" section.
 */

/**
 * Default safe schemes for an `<img src>` bound from a consumer-provided
 * prop. Only the always-web-safe schemes are allowed here; `data:` /
 * `blob:` are intentionally blocked because the prop source is opaque to
 * the library (per SECURITY.md §3.1, a forwarded `data:` URL can smuggle
 * `data:text/html` through a non-strict CSP).
 */
const SAFE_IMG_SCHEMES: readonly string[] = ['http:', 'https:'];

/**
 * Default safe schemes for an `<a href>` bound from a consumer-provided
 * prop. Adds the link-only schemes (`mailto:`, `tel:`, `sms:`) on top of
 * the img set.
 */
const SAFE_HREF_SCHEMES: readonly string[] = ['http:', 'https:', 'mailto:', 'tel:', 'sms:'];

/**
 * Syntactic parse root used to normalize relative and fragment URLs. We
 * never navigate to this origin; it exists solely so `new URL(...)` can
 * parse fragment / relative inputs in environments (tests, SSR) where
 * `window.location` doesn't resolve.
 */
const URL_PARSE_BASE = 'https://airo-components.invalid/';

function parseUrl(value: string): URL | null {
  // Reject empty / whitespace-only input up front. `new URL('', base)`
  // happily returns the base URL itself (scheme `https:`), which would
  // pass the allow-list check for no good reason — a component that
  // rendered `<img src="">` would trigger a real request to the current
  // page. Treating empty-string as unsafe matches what the compound
  // tiles already do at the prop-shape layer.
  if (!value || value.trim() === '') {
    return null;
  }
  try {
    return new URL(value, URL_PARSE_BASE);
  } catch {
    return null;
  }
}

/**
 * Library-default predicate for an `<img src>` URL on a `UserMessage`
 * tile. Returns `true` if the URL resolves to one of `http:` or `https:`,
 * including relative / fragment URLs that inherit `https:` from the parse
 * root. Rejects `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, and
 * any other scheme per SECURITY.md §3.1.
 *
 * Re-exported from `@airo-ux/pattern-library/chat/user-message` so consumers can
 * compose it with their own policy:
 *
 * @example
 * import { UserMessage, isSafeImgSrc } from '@airo-ux/pattern-library/chat/user-message';
 *
 * // Allow the library default plus `data:image/svg+xml` from a known-safe
 * // in-house renderer.
 * const validateSrc = (src: string) =>
 *   isSafeImgSrc(src) || src.startsWith('data:image/svg+xml;base64,');
 *
 * <UserMessage validateSrc={validateSrc}>...</UserMessage>
 */
export function isSafeImgSrc(value: string): boolean {
  const parsed = parseUrl(value);
  if (parsed === null) return false;
  return SAFE_IMG_SCHEMES.includes(parsed.protocol.toLowerCase());
}

/**
 * Library-default predicate for an `<a href>` URL on a `UserMessage.File`
 * tile. Returns `true` for `http:`, `https:`, `mailto:`, `tel:`, `sms:`,
 * and relative / fragment URLs; rejects everything else (notably
 * `javascript:`, `data:`, `vbscript:`, `file:`) per SECURITY.md §3.1.
 *
 * Re-exported from `@airo-ux/pattern-library/chat/user-message` for composition
 * in the same way as {@link isSafeImgSrc}.
 */
export function isSafeHref(value: string): boolean {
  const parsed = parseUrl(value);
  if (parsed === null) return false;
  return SAFE_HREF_SCHEMES.includes(parsed.protocol.toLowerCase());
}

/**
 * Predicate type used by `UserMessage`'s URL-guard props. The predicate
 * runs against the raw prop value; returning `false` causes the component
 * to elide the DOM sink (skip the `<img src>` binding, drop the `<a
 * href>`) while keeping the surrounding accessible name / caption intact.
 */
export type UrlValidator = (value: string) => boolean;
