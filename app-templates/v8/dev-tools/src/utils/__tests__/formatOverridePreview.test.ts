/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyOptimisticFormatPreview } from '../formatOverridePreview';

describe('applyOptimisticFormatPreview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    window.dispatchEvent(new CustomEvent('airo-format-overrides:will-update'));
    document.body.innerHTML = '';
  });

  it('applies optimistic marks to an unformatted bound element', () => {
    const element = document.createElement('h1');
    document.body.appendChild(element);

    const preview = applyOptimisticFormatPreview(element, {
      bold: true,
      italic: true,
      color: '#123abc',
    });

    expect(element.style.fontWeight).toBe('700');
    expect(element.style.fontStyle).toBe('italic');
    expect(element.style.color).toBe('rgb(18, 58, 188)');

    preview.rollback();

    expect(element.style.fontWeight).toBe('');
    expect(element.style.fontStyle).toBe('');
    expect(element.style.color).toBe('');
  });

  it('clears disabled marks from an existing formatted wrapper', () => {
    const element = document.createElement('h1');
    element.innerHTML = '<span data-airo-formatted-bound-text="true">Title</span>';
    document.body.appendChild(element);
    const formatted = element.querySelector('[data-airo-formatted-bound-text]') as HTMLElement;
    formatted.style.fontWeight = '700';
    formatted.style.fontStyle = 'italic';
    formatted.style.color = '#123abc';

    applyOptimisticFormatPreview(element, {
      bold: false,
      italic: false,
      color: null,
    });

    expect(formatted.style.fontWeight).toBe('');
    expect(formatted.style.fontStyle).toBe('');
    expect(formatted.style.color).toBe('');
  });

  it('restores the previous active preview before applying the next one', () => {
    const first = document.createElement('h1');
    const second = document.createElement('p');
    document.body.append(first, second);

    applyOptimisticFormatPreview(first, {
      bold: true,
      italic: false,
      color: null,
    });
    applyOptimisticFormatPreview(second, {
      bold: false,
      italic: true,
      color: null,
    });

    expect(first.style.fontWeight).toBe('');
    expect(second.style.fontStyle).toBe('italic');
  });
});
