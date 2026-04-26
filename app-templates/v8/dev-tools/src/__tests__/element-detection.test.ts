/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { isTextEditable } from '../utils/element-detection.js';

function el(html: string): HTMLElement {
  // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const element = doc.body.firstElementChild as HTMLElement | null;
  if (!element) throw new Error(`fixture produced no element: ${JSON.stringify(html)}`);
  return element;
}

describe('isTextEditable — data-dev-dynamic guard', () => {
  it('should reject elements with data-dev-dynamic attribute', () => {
    const element = el('<p data-dev-dynamic="true">500+</p>');
    expect(isTextEditable(element)).toBe(false);
  });

  it('should reject elements containing a descendant with data-dev-dynamic', () => {
    const element = el('<p><span data-dev-dynamic="true">500+</span></p>');
    expect(isTextEditable(element)).toBe(false);
  });

  it('should allow plain text elements without data-dev-dynamic', () => {
    const element = el('<p>Hello World</p>');
    expect(isTextEditable(element)).toBe(true);
  });

  it('should allow elements with inline formatting but no data-dev-dynamic', () => {
    const element = el('<p><strong>Bold text</strong></p>');
    expect(isTextEditable(element)).toBe(true);
  });

  it('should reject deeply nested data-dev-dynamic descendants', () => {
    const element = el('<p><em><span data-dev-dynamic="true">price</span></em></p>');
    expect(isTextEditable(element)).toBe(false);
  });
});
