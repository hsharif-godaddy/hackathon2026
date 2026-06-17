import { describe, it, expect } from 'vitest';
import {
  patchFieldValue,
  setSectionValue,
  validateFieldValue,
  markdownEscape,
} from '../compliance-field-patch.js';

// Mirrors the generator's real shape: data-field, data-type, then data-editable.
const TYPE_FOR: Record<string, string> = {
  businessName: 'text',
  email: 'email',
  domainName: 'url',
  jurisdiction: 'us_states',
};
const field = (k: string, v: string): string =>
  `<span data-field="${k}" data-type="${TYPE_FOR[k] ?? 'text'}" data-editable="true">${v}</span>`;

describe('patchFieldValue', () => {
  it('replaces the inner value of a single matching span', () => {
    const src = `const markdown = \`# Privacy\n\nOwner: ${field('businessName', 'Acme Corp')}.\`;`;
    const result = patchFieldValue(src, 'businessName', 'Beta LLC');
    expect(result.replaced).toBe(1);
    expect(result.content).toContain(field('businessName', 'Beta LLC'));
    expect(result.content).not.toContain('Acme Corp');
  });

  it('matches when data-type sits between data-field and data-editable', () => {
    // Exact attribute order the generator emits.
    const src = `<span data-field="email" data-type="email" data-editable="true">a@x.com</span>`;
    const result = patchFieldValue(src, 'email', 'b@x.com');
    expect(result.replaced).toBe(1);
    expect(result.content).toContain('data-type="email"'); // preserved verbatim
    expect(result.content).toContain('>b@x.com<');
  });

  it('does NOT rewrite a non-editable data-field span', () => {
    const src = `<span data-field="businessName" data-type="text" data-editable="false">Acme</span>`;
    const result = patchFieldValue(src, 'businessName', 'Beta');
    expect(result.replaced).toBe(0);
    expect(result.content).toBe(src);
  });

  it('replaces ALL occurrences of the same field key', () => {
    const src = `${field('email', 'a@x.com')} ... ${field('email', 'a@x.com')}`;
    const result = patchFieldValue(src, 'email', 'b@x.com');
    expect(result.replaced).toBe(2);
    expect(result.content).not.toContain('a@x.com');
  });

  it('patches occurrences nested inside a hidden section branch', () => {
    const src =
      `<span data-section="children" data-section-when="true" data-hidden="true" style="display:none">` +
      `Contact ${field('email', 'a@x.com')} for COPPA.` +
      `</span>`;
    const result = patchFieldValue(src, 'email', 'b@x.com');
    expect(result.replaced).toBe(1);
    expect(result.content).toContain('b@x.com');
    // The surrounding hidden-branch markup is preserved.
    expect(result.content).toContain('data-hidden="true"');
  });

  it('returns replaced=0 when the field key is absent', () => {
    const src = field('businessName', 'Acme Corp');
    const result = patchFieldValue(src, 'email', 'z@y.com');
    expect(result.replaced).toBe(0);
    expect(result.content).toBe(src);
  });

  it('markdown-escapes inline-significant characters in the new value', () => {
    const src = field('businessName', 'Acme');
    const result = patchFieldValue(src, 'businessName', 'A*B_C [x] ~z~');
    expect(result.content).toContain('A\\*B\\_C \\[x\\] \\~z\\~');
    expect(result.content).not.toContain('A*B_C');
  });

  it('does NOT escape dots so emails and domains stay intact', () => {
    const src = field('email', 'old@x.com');
    const result = patchFieldValue(src, 'email', 'legal@acme.com');
    expect(result.content).toContain('legal@acme.com');
    expect(result.content).not.toContain('acme\\.com');
  });

  it('HTML-escapes angle brackets and ampersands in the new value', () => {
    const src = field('businessName', 'Acme');
    const result = patchFieldValue(src, 'businessName', 'A&B <Co>');
    expect(result.content).toContain('A&amp;B &lt;Co&gt;');
    expect(result.content).not.toContain('<Co>');
  });
});

describe('setSectionValue', () => {
  const both =
    `<span data-section="children" data-section-when="true" data-hidden="true" style="display:none">COPPA yes</span>` +
    `<span data-section="children" data-section-when="false">COPPA no</span>`;

  it('flips visibility to the true branch when value=true', () => {
    const result = setSectionValue(both, 'children', true);
    expect(result.matched).toBe(2);
    expect(result.changed).toBe(2);
    // true branch is now visible (no hidden markers)
    expect(result.content).toContain('<span data-section="children" data-section-when="true">COPPA yes</span>');
    // false branch is now hidden
    expect(result.content).toMatch(
      /<span data-section="children" data-section-when="false" data-hidden="true" style="display:none">COPPA no<\/span>/,
    );
  });

  it('flips visibility to the false branch when value=false', () => {
    const result = setSectionValue(both, 'children', false);
    expect(result.content).toContain('<span data-section="children" data-section-when="false">COPPA no</span>');
    expect(result.content).toMatch(
      /<span data-section="children" data-section-when="true" data-hidden="true" style="display:none">COPPA yes<\/span>/,
    );
  });

  it('handles a single-branch (inline positive-only) section: show when true', () => {
    const single = `<span data-section="children" data-section-when="true" data-hidden="true" style="display:none">guardian</span>`;
    const result = setSectionValue(single, 'children', true);
    expect(result.matched).toBe(1);
    expect(result.content).toContain('<span data-section="children" data-section-when="true">guardian</span>');
    expect(result.content).not.toContain('display:none');
  });

  it('handles a single-branch (inline positive-only) section: hide when false', () => {
    const single = `<span data-section="children" data-section-when="true">guardian</span>`;
    const result = setSectionValue(single, 'children', false);
    expect(result.matched).toBe(1);
    expect(result.content).toContain('data-hidden="true"');
    expect(result.content).toContain('display:none');
  });

  it('returns matched=0 when the section key is absent', () => {
    const result = setSectionValue('<p>no sections</p>', 'children', true);
    expect(result.matched).toBe(0);
    expect(result.changed).toBe(0);
  });

  it('does not modify field spans nested inside the branch', () => {
    const src =
      `<span data-section="children" data-section-when="true" data-hidden="true" style="display:none">` +
      `Contact <span data-field="email" data-editable="true">a@x.com</span>` +
      `</span>`;
    const result = setSectionValue(src, 'children', true);
    expect(result.content).toContain('<span data-field="email" data-editable="true">a@x.com</span>');
  });
});

describe('validateFieldValue', () => {
  it('rejects empty / whitespace-only values', () => {
    expect(validateFieldValue('businessName', '   ').ok).toBe(false);
    expect(validateFieldValue('businessName', '').ok).toBe(false);
  });

  it('rejects values over 200 chars', () => {
    expect(validateFieldValue('businessName', 'a'.repeat(201)).ok).toBe(false);
    expect(validateFieldValue('businessName', 'a'.repeat(200)).ok).toBe(true);
  });

  it('validates email format only for the email field', () => {
    expect(validateFieldValue('email', 'not-an-email').ok).toBe(false);
    expect(validateFieldValue('email', 'ok@example.com').ok).toBe(true);
    expect(validateFieldValue('businessName', 'not-an-email').ok).toBe(true);
  });

  it('validates jurisdiction against the US-state enum', () => {
    expect(validateFieldValue('jurisdiction', 'California').ok).toBe(true);
    expect(validateFieldValue('jurisdiction', 'Atlantis').ok).toBe(false);
  });

  it('validates domainName as a bare hostname', () => {
    expect(validateFieldValue('domainName', 'acme.com').ok).toBe(true);
    expect(validateFieldValue('domainName', 'sub.acme.co.uk').ok).toBe(true);
    expect(validateFieldValue('domainName', 'not a domain').ok).toBe(false);
    expect(validateFieldValue('domainName', 'https://acme.com').ok).toBe(false);
    expect(validateFieldValue('domainName', 'acme').ok).toBe(false);
  });
});

describe('markdownEscape', () => {
  it('escapes backslash first to avoid double-escaping', () => {
    expect(markdownEscape('a\\b')).toBe('a\\\\b');
  });
});
