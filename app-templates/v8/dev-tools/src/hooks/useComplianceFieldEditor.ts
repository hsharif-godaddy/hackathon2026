import { useEffect } from 'react';
import { send, type ComplianceDocumentType } from '../utils/eventBus';

function inferDocumentType(pathname: string): ComplianceDocumentType | null {
  if (pathname.startsWith('/privacy')) return 'privacy-policy';
  if (pathname.startsWith('/terms')) return 'terms-of-use';
  return null;
}

const FIELD_SELECTOR = '[data-editable="true"][data-field]';
const SECTION_SELECTOR = '[data-section][data-section-when]';
const WIRED = 'data-airo-field-wired';
const ORIGINAL = 'data-airo-field-original';
const SECTION_WIRED = 'data-airo-section-wired';

// Friendly toggle labels per section key. Unmapped keys fall back to a generic
// "Toggle <key> clause" label.
const SECTION_LABELS: Record<string, string> = {
  children: 'Toggle under 18 clause',
};

// data-type values emitted by the generator (see API spec). Drives validation
// and input rendering. Unknown types fall back to plain text editing.
type FieldType = 'text' | 'email' | 'url' | 'us_states';

// Full US-state names — the `us_states` enum (Jurisdictions). Mirrors the
// server's list in agents field-patch.ts; dev-tools can't import across the
// package boundary, so it's duplicated here for the dropdown.
const US_STATES: readonly string[] = [
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
];
const US_STATE_SET = new Set(US_STATES);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Hostname labels + TLD, validated label-by-label rather than with one
// nested-quantifier regex — avoids the catastrophic-backtracking (ReDoS) shape
// of `(?:label\.)+tld` while accepting acme.com, sub.acme.co.uk, etc.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TLD_RE = /^[a-z]{2,}$/i;

function isValidDomain(value: string): boolean {
  const labels = value.split('.');
  if (labels.length < 2) return false;
  if (!TLD_RE.test(labels[labels.length - 1] ?? '')) return false;
  return labels.slice(0, -1).every((label) => LABEL_RE.test(label));
}

/** Strip scheme and any path so a "url" field persists a bare domain. */
function normalizeDomain(value: string): string {
  return value
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

/** Validate a trimmed value against its data-type. Empty is always invalid. */
function isValidForType(type: FieldType, value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return false;
  switch (type) {
    case 'email':
      return EMAIL_RE.test(v);
    case 'url':
      return isValidDomain(normalizeDomain(v));
    case 'us_states':
      return US_STATE_SET.has(v);
    default:
      return true;
  }
}

function invalidMessage(type: FieldType): string {
  switch (type) {
    case 'email':
      return 'Enter a valid email address';
    case 'url':
      return 'Enter a valid domain (e.g. example.com)';
    case 'us_states':
      return 'Choose a US state from the list';
    default:
      return 'Invalid value';
  }
}

/**
 * In dev mode (preview only), make compliance documents interactively editable:
 *
 *  - Field spans (`[data-editable="true"][data-field]`) become inline editable.
 *    On commit (blur/Enter) every span sharing the same `data-field` — including
 *    ones in hidden section branches — is updated in the live DOM and a
 *    COMPLIANCE_FIELD_UPDATED event is fired so the builder can persist the edit.
 *    Escape cancels and restores; empty/no-op edits restore without firing.
 *
 *  - Section branches (`[data-section][data-section-when]`) get a small toggle
 *    control rendered next to the first visible branch. Flipping it swaps which
 *    branch is hidden (data-hidden + display:none) in the live DOM and fires
 *    COMPLIANCE_SECTION_TOGGLED.
 *
 * Keyed on both `data-section` and `data-section-when` to avoid colliding with
 * the unrelated `data-section` usage in DevelopmentMode's section detection.
 * Re-scans on DOM mutations so spans rendered after HMR get wired.
 */
export function useComplianceFieldEditor(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    // Teardowns reverse every affordance the scan applies (contentEditable,
    // injected selects, toggle buttons, listeners, marker attrs) so leaving
    // edit mode returns the document to read-only presentation. They preserve
    // committed content — only the editing chrome is removed. Run on cleanup,
    // i.e. when `enabled` flips false.
    const teardowns: Array<() => void> = [];

    // Propagate a committed value to every span sharing this data-field
    // (including hidden branches) and notify the builder to persist it. The
    // value is kept raw/unescaped here — the server markdown-escapes on write.
    const applyFieldValue = (
      fieldKey: string,
      newValue: string,
      documentType: ComplianceDocumentType,
    ): void => {
      document
        .querySelectorAll<HTMLElement>(`[data-field="${cssEscape(fieldKey)}"]`)
        .forEach((el) => {
          // A us_states span holds a <select>; overwriting its textContent would
          // destroy the dropdown. Sync the select's value instead, and only set
          // textContent on plain (text/email/url) spans.
          const select = el.querySelector<HTMLSelectElement>('select.airo-state-select');
          if (select) {
            if (select.value !== newValue) select.value = newValue;
          } else {
            el.textContent = newValue;
          }
          if (el.hasAttribute(ORIGINAL)) el.setAttribute(ORIGINAL, newValue);
        });
      send({ type: 'COMPLIANCE_FIELD_UPDATED', data: { documentType, fieldKey, newValue } });
    };

    // Briefly flash an inline validation message next to a span, then restore.
    const flashInvalid = (span: HTMLElement, message: string): void => {
      span.classList.add('airo-editable-field-invalid');
      span.setAttribute('title', message);
      window.setTimeout(() => {
        span.classList.remove('airo-editable-field-invalid');
        span.removeAttribute('title');
      }, 1600);
    };

    // ── Field editing ──────────────────────────────────────────────────────
    const wireField = (span: HTMLElement, documentType: ComplianceDocumentType): void => {
      if (span.getAttribute(WIRED) === 'true') return;
      span.setAttribute(WIRED, 'true');
      span.setAttribute(ORIGINAL, span.textContent ?? '');

      const fieldKey = span.getAttribute('data-field') ?? '';
      if (!fieldKey) return;
      const type = (span.getAttribute('data-type') as FieldType | null) ?? 'text';

      // us_states: render a native <select> rather than free text so the value
      // is always a valid jurisdiction.
      if (type === 'us_states') {
        wireStateSelect(span, fieldKey, documentType);
        return;
      }

      // text / email / url: inline contentEditable with type-aware validation.
      span.setAttribute('contenteditable', 'true');
      span.setAttribute('spellcheck', 'false');
      span.classList.add('airo-editable-field');

      const commit = (): void => {
        const oldValue = span.getAttribute(ORIGINAL) ?? '';
        const raw = (span.textContent ?? '').trim();
        if (raw.length === 0 || raw === oldValue) {
          span.textContent = oldValue; // restore on empty / no-op
          return;
        }
        if (!isValidForType(type, raw)) {
          span.textContent = oldValue; // reject invalid; keep prior value
          flashInvalid(span, invalidMessage(type));
          return;
        }
        // Persist a normalized domain for url fields; otherwise the raw value.
        const newValue = type === 'url' ? normalizeDomain(raw) : raw;
        applyFieldValue(fieldKey, newValue, documentType);
      };

      const onKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Enter') {
          e.preventDefault();
          span.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          span.textContent = span.getAttribute(ORIGINAL) ?? '';
          span.blur();
        }
      };

      span.addEventListener('blur', commit);
      span.addEventListener('keydown', onKeydown);

      teardowns.push(() => {
        span.removeEventListener('blur', commit);
        span.removeEventListener('keydown', onKeydown);
        span.removeAttribute('contenteditable');
        span.removeAttribute('spellcheck');
        span.classList.remove('airo-editable-field', 'airo-editable-field-invalid');
        span.removeAttribute(WIRED);
        span.removeAttribute(ORIGINAL);
      });
    };

    // Replace a us_states field span's inline editing with a <select> dropdown.
    const wireStateSelect = (
      span: HTMLElement,
      fieldKey: string,
      documentType: ComplianceDocumentType,
    ): void => {
      span.classList.add('airo-editable-field', 'airo-editable-field-select');

      const current = (span.textContent ?? '').trim();
      const select = document.createElement('select');
      select.className = 'airo-state-select';
      select.setAttribute('aria-label', 'Select US state');

      for (const state of US_STATES) {
        const opt = document.createElement('option');
        opt.value = state;
        opt.textContent = state;
        if (state === current) opt.selected = true;
        select.appendChild(opt);
      }
      // If the current value isn't a known state, prepend it so we don't
      // silently change a value the user hasn't touched.
      if (current && !US_STATE_SET.has(current)) {
        const opt = document.createElement('option');
        opt.value = current;
        opt.textContent = current;
        opt.selected = true;
        select.insertBefore(opt, select.firstChild);
      }

      select.addEventListener('change', () => {
        const newValue = select.value;
        if (!newValue || newValue === span.getAttribute(ORIGINAL)) return;
        // Re-validate against the enum: the prepended unknown-current-value
        // option is selectable, but persisting it would be rejected by the
        // server (400). Revert the select and flash instead of sending.
        if (!US_STATE_SET.has(newValue)) {
          select.value = span.getAttribute(ORIGINAL) ?? '';
          flashInvalid(span, invalidMessage('us_states'));
          return;
        }
        applyFieldValue(fieldKey, newValue, documentType);
      });

      // Render the select in place of the text; keep the span as the anchor.
      span.textContent = '';
      span.appendChild(select);

      teardowns.push(() => {
        // Restore the chosen jurisdiction as read-only text; removing the
        // select also drops its change listener.
        const value = select.value || span.getAttribute(ORIGINAL) || '';
        select.remove();
        span.textContent = value;
        span.classList.remove(
          'airo-editable-field',
          'airo-editable-field-select',
          'airo-editable-field-invalid',
        );
        span.removeAttribute(WIRED);
        span.removeAttribute(ORIGINAL);
      });
    };

    // ── Section toggling ─────────────────────────────────────────────────────
    const isHidden = (el: HTMLElement): boolean =>
      el.getAttribute('data-hidden') === 'true' || el.style.display === 'none';

    const applySectionValue = (sectionKey: string, value: boolean): void => {
      document
        .querySelectorAll<HTMLElement>(`[data-section="${cssEscape(sectionKey)}"][data-section-when]`)
        .forEach((el) => {
          const branchWhen = el.getAttribute('data-section-when') === 'true';
          if (branchWhen === value) {
            el.removeAttribute('data-hidden');
            el.style.removeProperty('display');
          } else {
            el.setAttribute('data-hidden', 'true');
            el.style.display = 'none';
          }
        });
    };

    const labelFor = (sectionKey: string): string =>
      SECTION_LABELS[sectionKey] ?? `Toggle ${sectionKey} clause`;

    const wireSection = (span: HTMLElement, documentType: ComplianceDocumentType): void => {
      const sectionKey = span.getAttribute('data-section') ?? '';
      if (!sectionKey) return;
      // Only wire one toggle per section key — anchor it on the first branch seen.
      const anchorId = `airo-section-toggle-${sectionKey}`;
      if (document.getElementById(anchorId)) return;
      if (span.getAttribute(SECTION_WIRED) === 'true') return;
      span.setAttribute(SECTION_WIRED, 'true');

      // Current value = whichever branch is currently visible.
      const branchWhen = span.getAttribute('data-section-when') === 'true';
      const currentValue = isHidden(span) ? !branchWhen : branchWhen;
      const label = labelFor(sectionKey);

      const toggle = document.createElement('button');
      toggle.id = anchorId;
      toggle.type = 'button';
      toggle.className = 'airo-section-toggle';
      toggle.setAttribute('data-section-toggle', sectionKey);
      toggle.setAttribute('aria-pressed', String(currentValue));
      toggle.textContent = `${label}. Currently ${currentValue ? 'On' : 'Off'}`;

      toggle.addEventListener('click', () => {
        const next = toggle.getAttribute('aria-pressed') !== 'true';
        applySectionValue(sectionKey, next);
        toggle.setAttribute('aria-pressed', String(next));
        toggle.textContent = `${label}. Currently ${next ? 'On' : 'Off'}`;
        send({ type: 'COMPLIANCE_SECTION_TOGGLED', data: { documentType, sectionKey, value: next } });
      });

      span.parentNode?.insertBefore(toggle, span);

      teardowns.push(() => {
        // Remove only the toggle control. The branch visibility it set is a
        // committed edit (already sent to the builder), so leave it as-is.
        toggle.remove();
        span.removeAttribute(SECTION_WIRED);
      });
    };

    // Resolve the document type lazily on every scan (not once at mount) so a
    // client-side navigation INTO /privacy or /terms — after the preview first
    // loaded on a different route — still wires the fields. Returning early at
    // mount-time would permanently disable wiring for SPA navigations.
    const scan = (): void => {
      const documentType = inferDocumentType(window.location.pathname);
      if (!documentType) return;
      document.querySelectorAll<HTMLElement>(FIELD_SELECTOR).forEach((el) => wireField(el, documentType));
      document.querySelectorAll<HTMLElement>(SECTION_SELECTOR).forEach((el) => wireSection(el, documentType));
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      // Disconnect first so teardown DOM mutations don't re-trigger scan().
      observer.disconnect();
      teardowns.forEach((teardown) => teardown());
    };
  }, [enabled]);
}

/** Minimal CSS.escape fallback for attribute-selector interpolation. */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\\]]/g, '\\$&');
}
