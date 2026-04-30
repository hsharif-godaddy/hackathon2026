/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { isTextEditable, resolveContentKey } from '../utils/element-detection.js';

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

  it('treats content-keyed elements as editable even if they also have dynamic markup around them', () => {
    const element = el('<h1 data-dev-content-key="home.hero.title">Welcome</h1>');
    expect(isTextEditable(element)).toBe(true);
  });
});

describe('resolveContentKey', () => {
  it('returns null for elements without any content attribution', () => {
    expect(resolveContentKey(el('<p>text</p>'))).toBeNull();
  });

  it('returns the direct key when data-dev-content-key is set', () => {
    const element = el('<h1 data-dev-content-key="site.brand">Acme</h1>');
    expect(resolveContentKey(element)).toEqual({ key: 'site.brand', kind: 'copy' });
  });

  it('reads kind=richText from data-dev-content-kind', () => {
    const element = el('<div data-dev-content-key="home.body" data-dev-content-kind="richText">x</div>');
    expect(resolveContentKey(element)).toEqual({ key: 'home.body', kind: 'richText' });
  });

  it('resolves a template key using the enclosing list + index', () => {
    const root = document.createElement('div');
    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
    root.innerHTML = `
      <div data-dev-content-list="products">
        <div data-dev-content-list-index="0"><h3 data-dev-content-key-template="products[].name">A</h3></div>
        <div data-dev-content-list-index="3"><h3 data-dev-content-key-template="products[].name">D</h3></div>
      </div>
    `;
    const targets = root.querySelectorAll('h3');
    expect(resolveContentKey(targets[0] as HTMLElement)).toEqual({ key: 'products[0].name', kind: 'copy' });
    expect(resolveContentKey(targets[1] as HTMLElement)).toEqual({ key: 'products[3].name', kind: 'copy' });
  });

  it('returns null when a template element has no enclosing list context', () => {
    const element = el('<h3 data-dev-content-key-template="products[].name">A</h3>');
    expect(resolveContentKey(element)).toBeNull();
  });
});
