/**
 * Deterministic, LLM-free patching of the annotated compliance markdown embedded
 * in a generated page file (`src/pages/privacy.tsx` / `terms.tsx`).
 *
 * Two markup constructs are produced by the generation API (with
 * `markEditableFields: true`):
 *
 *   A. Editable field spans (attributes emitted in the order data-field,
 *      data-type, data-editable):
 *        <span data-field="businessName" data-type="text" data-editable="true">Acme Corp</span>
 *      The same field may appear many times; an edit updates every occurrence,
 *      including spans nested inside hidden section branches.
 *
 *   B. Boolean section branches:
 *        <span data-section="children" data-section-when="true" data-hidden="true" style="display:none">…</span>
 *        <span data-section="children" data-section-when="false">…</span>
 *      Exactly one branch is visible; the inverse carries data-hidden + display:none.
 *      Toggling flips which branch is hidden. Inline sections may have only the
 *      `when="true"` branch (no inverse) — never assume both exist.
 *
 * Field values written back into the file are markdown-escaped to match the
 * generator's own escaping (e.g. `A*B` -> `A\*B`, `<` -> `&lt;`), so the value
 * renders verbatim through react-markdown rather than being interpreted.
 */

/**
 * Canonical US-state jurisdiction enum. Mirrors the external API's
 * `Jurisdictions` type; kept here so validation has a single source of truth.
 */
export const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California',
  'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
  'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
] as const;

const US_STATE_SET: ReadonlySet<string> = new Set(US_STATES);

// Field/section keys are short identifiers from a fixed allowlist
// (businessName, email, domainName, jurisdiction, children). We reject anything
// that isn't a small identifier as a defensive guard; the key is then compared
// in JS against a literal-regex capture rather than interpolated into a pattern.
const SAFE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A key safe to use as a field/section identifier: short and identifier-only. */
function isSafeKey(value: string): boolean {
  return SAFE_KEY_RE.test(value);
}

/**
 * Markdown- and HTML-escape a raw value so it renders literally inside an inline
 * HTML span within markdown. Backslash is escaped first so escapes we add are not
 * themselves doubled; `&` before `<`/`>` so entity ampersands are not re-escaped.
 *
 * Only characters that are markdown-significant *inline* are backslash-escaped
 * (`` ` ``, `*`, `_`, `[`, `]`, `~`). Positional characters (`.`, `#`, `-`, `!`,
 * `(`, `)`, `{`, `}`, `|`) only matter at line/block boundaries, never inside a
 * span value — escaping them here would corrupt ordinary values like emails
 * (`a@x.com`), domains (`acme.com`), and dates (`June 15, 2026`).
 */
export function markdownEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([`*_[\]~])/g, '\\$1');
}

export interface PatchFieldResult {
  content: string;
  replaced: number;
}

/**
 * Replace the inner text of every editable field span matching `fieldKey`.
 *
 * Matches any `<span …>` opening tag that carries `data-field="KEY"` AND
 * `data-editable="true"` in any attribute order — the generator emits
 * `data-field`, then `data-type`, then `data-editable`, so the two anchors are
 * NOT adjacent. Matching is by attribute, not position; occurrences inside
 * hidden section branches are patched too. `newValue` is markdown-escaped.
 *
 * `data-type` (text | email | url | us_states) is preserved verbatim — it lives
 * in the opening tag, which is reproduced unchanged. Field spans never nest, so
 * the non-greedy inner match to the first `</span>` is safe.
 */
// Literal (static) regex matching a span block whose OPENING TAG carries
// data-field — the specific key value is compared in JS, not interpolated into
// the pattern (no dynamic-regexp / ReDoS surface). Anchoring on `data-field` in
// the open tag is essential: a bare `<span` would otherwise match an enclosing
// section span and swallow a nested field span up to the first `</span>`.
// Field spans never nest inside each other, so the non-greedy inner match to
// the first `</span>` is correct.
const FIELD_SPAN_RE = /(<span\b[^>]*\bdata-field="[^"]*"[^>]*>)([\s\S]*?)(<\/span>)/g;
const DATA_FIELD_ATTR_RE = /\bdata-field="([^"]*)"/;

export function patchFieldValue(source: string, fieldKey: string, newValue: string): PatchFieldResult {
  if (!isSafeKey(fieldKey)) return { content: source, replaced: 0 };
  const escapedNew = markdownEscape(newValue);
  let replaced = 0;
  const content = source.replace(FIELD_SPAN_RE, (match, open: string, _inner: string, close: string) => {
    const field = DATA_FIELD_ATTR_RE.exec(open)?.[1];
    if (field !== fieldKey) return match;
    // Only rewrite genuinely-editable field spans; leave any non-editable
    // data-field span (data-editable could become "false" for read-only fields)
    // untouched.
    if (!/\bdata-editable="true"/.test(open)) return match;
    replaced += 1;
    return `${open}${escapedNew}${close}`;
  });
  return { content, replaced };
}

export interface SetSectionResult {
  content: string;
  /** Number of section-branch opening tags found for this key. 0 => key absent. */
  matched: number;
  /** Number of opening tags whose visibility attributes actually changed. */
  changed: number;
}

/**
 * Set the visible branch of a boolean section. For each branch tag of
 * `data-section="sectionKey"`, the branch whose `data-section-when` equals
 * `value` is made visible (strip `data-hidden` + `display:none`); the inverse is
 * hidden (inject them). Only opening tags are rewritten, so nested content
 * (including field spans) is untouched. Handles the inline single-branch case.
 */
// Literal regex matching ANY span opening tag; the data-section key is compared
// in JS rather than interpolated (no dynamic RegExp). `[^>]*` stops at the first
// `>` — these tags carry no `>` inside attribute values.
const SECTION_TAG_RE = /<span\b[^>]*>/g;
const DATA_SECTION_ATTR_RE = /\bdata-section="([^"]*)"/;

export function setSectionValue(source: string, sectionKey: string, value: boolean): SetSectionResult {
  if (!isSafeKey(sectionKey)) return { content: source, matched: 0, changed: 0 };
  let matched = 0;
  let changed = 0;

  const content = source.replace(SECTION_TAG_RE, (tag: string) => {
    if (DATA_SECTION_ATTR_RE.exec(tag)?.[1] !== sectionKey) return tag;
    const whenMatch = /\bdata-section-when="(true|false)"/.exec(tag);
    if (!whenMatch) return tag; // not a section branch tag (defensive)
    matched += 1;

    const branchWhen = whenMatch[1] === 'true';
    const shouldBeVisible = branchWhen === value;

    // Strip any existing hidden markers first.
    let newTag = tag
      .replace(/\s*data-hidden="[^"]*"/g, '')
      .replace(/\s*style="display:\s*none;?\s*"/g, '');

    if (!shouldBeVisible) {
      newTag = newTag.replace(/>$/, ' data-hidden="true" style="display:none">');
    }

    if (newTag !== tag) changed += 1;
    return newTag;
  });

  return { content, matched, changed };
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TLD_RE = /^[a-z]{2,}$/i;
const MAX_LEN = 200;

/**
 * Validate a bare hostname (no scheme/path) label-by-label. Implemented as a
 * split + per-label test rather than one nested-quantifier regex, which both
 * reads clearly and avoids the catastrophic-backtracking (ReDoS) shape static
 * analysis flags on `(?:label\.)+tld`.
 */
function isValidDomain(value: string): boolean {
  const labels = value.split('.');
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1] ?? '';
  if (!TLD_RE.test(tld)) return false;
  return labels.slice(0, -1).every((label) => LABEL_RE.test(label));
}

/**
 * Validate a raw (unescaped) field value. Non-empty, length-capped, and
 * type-specific by field key: email format for `email`, bare-domain format for
 * `domainName`, US-state enum for `jurisdiction`. Other fields accept any
 * non-empty value within the length cap. This is the authoritative check —
 * the dev-tools client validates too, but the client can be bypassed.
 */
export function validateFieldValue(fieldKey: string, value: string): ValidationResult {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  if (trimmed.length > MAX_LEN) return { ok: false, reason: 'too_long' };
  if (fieldKey === 'email' && !EMAIL_RE.test(trimmed)) return { ok: false, reason: 'invalid_email' };
  if (fieldKey === 'domainName' && !isValidDomain(trimmed)) return { ok: false, reason: 'invalid_domain' };
  if (fieldKey === 'jurisdiction' && !US_STATE_SET.has(trimmed)) return { ok: false, reason: 'invalid_jurisdiction' };
  return { ok: true };
}
