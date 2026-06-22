/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

const send = vi.fn();
vi.mock('../../utils/eventBus', () => ({ send }));

import { useComplianceFieldEditor } from '../useComplianceFieldEditor';

function addField(key: string, value: string, type = 'text'): HTMLSpanElement {
  const span = document.createElement('span');
  span.setAttribute('data-field', key);
  span.setAttribute('data-type', type);
  span.setAttribute('data-editable', 'true');
  span.textContent = value;
  document.body.appendChild(span);
  return span;
}

function addSectionBranch(key: string, when: 'true' | 'false', hidden: boolean, text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.setAttribute('data-section', key);
  span.setAttribute('data-section-when', when);
  if (hidden) {
    span.setAttribute('data-hidden', 'true');
    span.style.display = 'none';
  }
  span.textContent = text;
  document.body.appendChild(span);
  return span;
}

beforeEach(() => {
  send.mockReset();
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/privacy');
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('useComplianceFieldEditor — fields', () => {
  it('marks editable spans contentEditable', () => {
    const span = addField('businessName', 'Acme Inc.');
    renderHook(() => useComplianceFieldEditor(true));
    expect(span.isContentEditable).toBe(true);
    expect(span.classList.contains('airo-editable-field')).toBe(true);
  });

  it('fires COMPLIANCE_FIELD_UPDATED on blur when the value changed', () => {
    const span = addField('businessName', 'Acme Inc.');
    renderHook(() => useComplianceFieldEditor(true));
    span.textContent = 'Beta LLC';
    span.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(send).toHaveBeenCalledWith({
      type: 'COMPLIANCE_FIELD_UPDATED',
      data: { documentType: 'privacy-policy', fieldKey: 'businessName', newValue: 'Beta LLC' },
    });
  });

  it('updates every span sharing the same data-field, including hidden ones', () => {
    const visible = addField('email', 'a@x.com');
    const hidden = addField('email', 'a@x.com');
    hidden.setAttribute('data-hidden', 'true');
    hidden.style.display = 'none';
    renderHook(() => useComplianceFieldEditor(true));
    visible.textContent = 'b@x.com';
    visible.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(visible.textContent).toBe('b@x.com');
    expect(hidden.textContent).toBe('b@x.com');
  });

  it('does NOT fire when the value is unchanged', () => {
    const span = addField('businessName', 'Acme Inc.');
    renderHook(() => useComplianceFieldEditor(true));
    span.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT fire and restores when the new value is empty', () => {
    const span = addField('businessName', 'Acme Inc.');
    renderHook(() => useComplianceFieldEditor(true));
    span.textContent = '   ';
    span.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(send).not.toHaveBeenCalled();
    expect(span.textContent).toBe('Acme Inc.');
  });

  it('cancels and restores on Escape', () => {
    const span = addField('businessName', 'Acme Inc.');
    renderHook(() => useComplianceFieldEditor(true));
    span.textContent = 'Typing...';
    span.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(span.textContent).toBe('Acme Inc.');
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const span = addField('businessName', 'Acme Inc.');
    renderHook(() => useComplianceFieldEditor(false));
    expect(span.hasAttribute('contenteditable')).toBe(false);
  });

  it('does nothing on a non-compliance path', () => {
    window.history.pushState({}, '', '/about');
    const span = addField('businessName', 'Acme Inc.');
    renderHook(() => useComplianceFieldEditor(true));
    expect(span.hasAttribute('contenteditable')).toBe(false);
  });

  it('wires fields after a client-side navigation INTO a policy page', async () => {
    // Mount on a non-compliance route (no fields yet), like the preview booting on "/".
    window.history.pushState({}, '', '/about');
    renderHook(() => useComplianceFieldEditor(true));

    // Navigate to the policy page and inject the span, as an SPA route change would.
    window.history.pushState({}, '', '/privacy');
    const span = addField('businessName', 'Acme Inc.');

    // The MutationObserver scan must pick it up even though mount happened off-route.
    await vi.waitFor(() => {
      expect(span.isContentEditable).toBe(true);
    });
  });
});

describe('useComplianceFieldEditor — sections', () => {
  it('renders one toggle for a section and flips visibility on click', () => {
    const truthy = addSectionBranch('children', 'true', true, 'COPPA yes');
    const falsy = addSectionBranch('children', 'false', false, 'COPPA no');
    renderHook(() => useComplianceFieldEditor(true));

    const toggle = document.getElementById('airo-section-toggle-children') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    // Friendly label for the children section.
    expect(toggle.textContent).toContain('Toggle under 18 clause. Currently Off');
    // Currently false branch is visible → pressed=false
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    // true branch now visible, false branch hidden
    expect(truthy.getAttribute('data-hidden')).toBeNull();
    expect(falsy.getAttribute('data-hidden')).toBe('true');
    expect(send).toHaveBeenCalledWith({
      type: 'COMPLIANCE_SECTION_TOGGLED',
      data: { documentType: 'privacy-policy', sectionKey: 'children', value: true },
    });
  });

  it('handles an inline single-branch section', () => {
    addSectionBranch('children', 'true', false, 'guardian');
    renderHook(() => useComplianceFieldEditor(true));
    const toggle = document.getElementById('airo-section-toggle-children') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    const branch = document.querySelector('[data-section="children"]') as HTMLElement;
    expect(branch.getAttribute('data-hidden')).toBe('true');
  });
});

describe('useComplianceFieldEditor — data-type validation', () => {
  it('rejects an invalid email and keeps the prior value', () => {
    const span = addField('email', 'a@x.com', 'email');
    renderHook(() => useComplianceFieldEditor(true));
    span.textContent = 'not-an-email';
    span.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(send).not.toHaveBeenCalled();
    expect(span.textContent).toBe('a@x.com');
  });

  it('accepts a valid email', () => {
    const span = addField('email', 'a@x.com', 'email');
    renderHook(() => useComplianceFieldEditor(true));
    span.textContent = 'legal@acme.com';
    span.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(send).toHaveBeenCalledWith({
      type: 'COMPLIANCE_FIELD_UPDATED',
      data: { documentType: 'privacy-policy', fieldKey: 'email', newValue: 'legal@acme.com' },
    });
  });

  it('normalizes a url value to a bare domain', () => {
    const span = addField('domainName', 'acme.com', 'url');
    renderHook(() => useComplianceFieldEditor(true));
    span.textContent = 'https://www.beta.io/path';
    span.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(send).toHaveBeenCalledWith({
      type: 'COMPLIANCE_FIELD_UPDATED',
      data: { documentType: 'privacy-policy', fieldKey: 'domainName', newValue: 'www.beta.io' },
    });
  });

  it('rejects an invalid domain', () => {
    const span = addField('domainName', 'acme.com', 'url');
    renderHook(() => useComplianceFieldEditor(true));
    span.textContent = 'not a domain';
    span.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(send).not.toHaveBeenCalled();
    expect(span.textContent).toBe('acme.com');
  });

  it('renders a US-state dropdown for us_states and is not contentEditable', () => {
    const span = addField('jurisdiction', 'California', 'us_states');
    renderHook(() => useComplianceFieldEditor(true));
    const select = span.querySelector('select.airo-state-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(span.hasAttribute('contenteditable')).toBe(false);
    expect(select.value).toBe('California');
    // All 50 states present.
    expect(select.options.length).toBeGreaterThanOrEqual(50);
  });

  it('fires on state selection change', () => {
    const span = addField('jurisdiction', 'California', 'us_states');
    renderHook(() => useComplianceFieldEditor(true));
    const select = span.querySelector('select.airo-state-select') as HTMLSelectElement;
    select.value = 'New York';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(send).toHaveBeenCalledWith({
      type: 'COMPLIANCE_FIELD_UPDATED',
      data: { documentType: 'privacy-policy', fieldKey: 'jurisdiction', newValue: 'New York' },
    });
  });

  it('keeps an unknown current jurisdiction selectable but reverts + flashes if re-chosen', () => {
    // Current value is not a real state — it should appear as a prepended option.
    const span = addField('jurisdiction', 'Atlantis', 'us_states');
    renderHook(() => useComplianceFieldEditor(true));
    const select = span.querySelector('select.airo-state-select') as HTMLSelectElement;
    expect(select.value).toBe('Atlantis');

    // First switch to a valid state (persists), then back to the invalid one.
    select.value = 'Texas';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    send.mockClear();

    select.value = 'Atlantis';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    // Invalid: must not send, must revert to the last persisted value, and flash.
    expect(send).not.toHaveBeenCalled();
    expect(select.value).toBe('Texas');
    expect(span.classList.contains('airo-editable-field-invalid')).toBe(true);
  });
});

describe('useComplianceFieldEditor — teardown when edit mode is disabled', () => {
  it('un-wires a text field so it is read-only again', () => {
    const span = addField('businessName', 'Acme Inc.');
    const { rerender } = renderHook(({ enabled }) => useComplianceFieldEditor(enabled), {
      initialProps: { enabled: true },
    });
    expect(span.getAttribute('contenteditable')).toBe('true');

    rerender({ enabled: false });

    expect(span.hasAttribute('contenteditable')).toBe(false);
    expect(span.classList.contains('airo-editable-field')).toBe(false);
  });

  it('restores a us_states field to plain text on teardown', () => {
    const span = addField('jurisdiction', 'California', 'us_states');
    const { rerender } = renderHook(({ enabled }) => useComplianceFieldEditor(enabled), {
      initialProps: { enabled: true },
    });
    const select = span.querySelector('select.airo-state-select') as HTMLSelectElement;
    select.value = 'New York';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    rerender({ enabled: false });

    expect(span.querySelector('select.airo-state-select')).toBeNull();
    expect(span.textContent).toBe('New York');
  });

  it('removes the section toggle but preserves the committed branch visibility', () => {
    const truthy = addSectionBranch('children', 'true', true, 'COPPA yes');
    const falsy = addSectionBranch('children', 'false', false, 'COPPA no');
    const { rerender } = renderHook(({ enabled }) => useComplianceFieldEditor(enabled), {
      initialProps: { enabled: true },
    });

    const toggle = document.getElementById('airo-section-toggle-children') as HTMLButtonElement;
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // true branch now visible, false branch hidden.
    expect(truthy.getAttribute('data-hidden')).toBeNull();
    expect(falsy.getAttribute('data-hidden')).toBe('true');

    rerender({ enabled: false });

    // Toggle control is gone, but the committed visibility state stays.
    expect(document.getElementById('airo-section-toggle-children')).toBeNull();
    expect(truthy.getAttribute('data-hidden')).toBeNull();
    expect(falsy.getAttribute('data-hidden')).toBe('true');
  });

  it('re-wires fields when edit mode is re-enabled after a teardown', () => {
    const span = addField('businessName', 'Acme Inc.');
    const { rerender } = renderHook(({ enabled }) => useComplianceFieldEditor(enabled), {
      initialProps: { enabled: true },
    });
    rerender({ enabled: false });
    expect(span.hasAttribute('contenteditable')).toBe(false);

    rerender({ enabled: true });
    expect(span.getAttribute('contenteditable')).toBe('true');
  });
});
