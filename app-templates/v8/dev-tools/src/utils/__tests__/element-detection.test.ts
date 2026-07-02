/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import {
  isTextEditable,
  isBodyTextElement,
  resolveContentKey,
  resolveConformTarget,
  getMediaSlotPath,
  isTextElement,
  isTextBlockElement,
  isListElement,
  isContentElement,
  isClickable,
  isInsideNavSurface,
  isManagedPath,
  hasManagedDocMarkup,
  HEADING_TAGS,
  INLINE_TEXT_TAGS,
  BLOCK_TEXT_TAGS,
  TEXT_TAGS,
  LIST_TAGS,
  CONTENT_TAGS,
  MEDIA_TAGS,
  FORM_TAGS
} from '../element-detection.js';

function buildElement(html: string): HTMLElement {
  // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const element = doc.body.firstElementChild as HTMLElement | null;
  if (!element) throw new Error(`fixture produced no element: ${JSON.stringify(html)}`);
  return element;
}

describe('element-detection', () => {
  // ─── Tag set composition ──────────────────────────────────────────────────────

  describe('tag set composition', () => {
    it('HEADING_TAGS contains h1–h6', () => {
      expect([...HEADING_TAGS]).toEqual(expect.arrayContaining(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']));
      expect(HEADING_TAGS.size).toBe(6);
    });

    it('BLOCK_TEXT_TAGS is a superset of HEADING_TAGS', () => {
      for (const tag of HEADING_TAGS) {
        expect(BLOCK_TEXT_TAGS.has(tag)).toBe(true);
      }
    });

    it('TEXT_TAGS is a superset of both BLOCK_TEXT_TAGS and INLINE_TEXT_TAGS', () => {
      for (const tag of BLOCK_TEXT_TAGS) {
        expect(TEXT_TAGS.has(tag)).toBe(true);
      }
      for (const tag of INLINE_TEXT_TAGS) {
        expect(TEXT_TAGS.has(tag)).toBe(true);
      }
    });

    it('LIST_TAGS does not overlap with TEXT_TAGS', () => {
      for (const tag of LIST_TAGS) {
        expect(TEXT_TAGS.has(tag)).toBe(false);
      }
    });

    it('CONTENT_TAGS is a superset of TEXT_TAGS, LIST_TAGS, MEDIA_TAGS, and FORM_TAGS', () => {
      for (const tag of [...TEXT_TAGS, ...LIST_TAGS, ...MEDIA_TAGS, ...FORM_TAGS]) {
        expect(CONTENT_TAGS.has(tag)).toBe(true);
      }
    });
  });

  // ─── isTextElement ────────────────────────────────────────────────────────────

  describe('isTextElement', () => {
    it('returns true for inline text tags', () => {
      expect(isTextElement(buildElement('<span>text</span>'))).toBe(true);
      expect(isTextElement(buildElement('<a href="#">link</a>'))).toBe(true);
      expect(isTextElement(buildElement('<label>label</label>'))).toBe(true);
    });

    it('returns true for block text tags', () => {
      expect(isTextElement(buildElement('<p>paragraph</p>'))).toBe(true);
      expect(isTextElement(buildElement('<h1>heading</h1>'))).toBe(true);
      expect(isTextElement(buildElement('<h6>heading</h6>'))).toBe(true);
      expect(isTextElement(buildElement('<li>item</li>'))).toBe(true);
      expect(isTextElement(buildElement('<blockquote>quote</blockquote>'))).toBe(true);
    });

    it('returns false for list containers', () => {
      expect(isTextElement(buildElement('<ul><li>item</li></ul>'))).toBe(false);
      expect(isTextElement(buildElement('<ol><li>item</li></ol>'))).toBe(false);
    });

    it('returns false for media and layout elements', () => {
      expect(isTextElement(buildElement('<img src="x.png" />'))).toBe(false);
      expect(isTextElement(buildElement('<div>container</div>'))).toBe(false);
      expect(isTextElement(buildElement('<section>section</section>'))).toBe(false);
    });
  });

  // ─── isTextBlockElement ───────────────────────────────────────────────────────

  describe('isTextBlockElement', () => {
    it('returns true for headings', () => {
      for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        expect(isTextBlockElement(buildElement(`<${h}>heading</${h}>`))).toBe(true);
      }
    });

    it('returns true for block text elements', () => {
      expect(isTextBlockElement(buildElement('<p>paragraph</p>'))).toBe(true);
      expect(isTextBlockElement(buildElement('<li>item</li>'))).toBe(true);
      expect(isTextBlockElement(buildElement('<blockquote>quote</blockquote>'))).toBe(true);
    });

    it('returns false for inline text elements', () => {
      expect(isTextBlockElement(buildElement('<span>text</span>'))).toBe(false);
      expect(isTextBlockElement(buildElement('<a href="#">link</a>'))).toBe(false);
      expect(isTextBlockElement(buildElement('<label>label</label>'))).toBe(false);
    });

    it('returns false for list containers and layout elements', () => {
      expect(isTextBlockElement(buildElement('<ul><li>item</li></ul>'))).toBe(false);
      expect(isTextBlockElement(buildElement('<ol><li>item</li></ol>'))).toBe(false);
      expect(isTextBlockElement(buildElement('<div>container</div>'))).toBe(false);
    });
  });

  // ─── isListElement ────────────────────────────────────────────────────────────

  describe('isListElement', () => {
    it('returns true for <ul>', () => {
      expect(isListElement(buildElement('<ul><li>item</li></ul>'))).toBe(true);
    });

    it('returns true for <ol>', () => {
      expect(isListElement(buildElement('<ol><li>item</li></ol>'))).toBe(true);
    });

    it('returns false for list items (li)', () => {
      const doc = new DOMParser().parseFromString('<ul><li>item</li></ul>', 'text/html');
      const li = doc.querySelector('li') as HTMLElement;
      expect(isListElement(li)).toBe(false);
    });

    it('returns false for text and layout elements', () => {
      expect(isListElement(buildElement('<p>paragraph</p>'))).toBe(false);
      expect(isListElement(buildElement('<div>container</div>'))).toBe(false);
      expect(isListElement(buildElement('<h1>heading</h1>'))).toBe(false);
    });
  });

  // ─── isContentElement ─────────────────────────────────────────────────────────

  describe('isContentElement', () => {
    it('returns true for text elements', () => {
      expect(isContentElement(buildElement('<p>text</p>'))).toBe(true);
      expect(isContentElement(buildElement('<h1>heading</h1>'))).toBe(true);
      expect(isContentElement(buildElement('<span>inline</span>'))).toBe(true);
      expect(isContentElement(buildElement('<button>btn</button>'))).toBe(true);
    });

    it('returns true for list elements', () => {
      expect(isContentElement(buildElement('<ul><li>item</li></ul>'))).toBe(true);
      expect(isContentElement(buildElement('<ol><li>item</li></ol>'))).toBe(true);
    });

    it('returns true for media elements', () => {
      expect(isContentElement(buildElement('<img src="x.png" />'))).toBe(true);
      expect(isContentElement(buildElement('<video src="x.mp4"></video>'))).toBe(true);
    });

    it('returns true for form elements', () => {
      expect(isContentElement(buildElement('<input type="text" />'))).toBe(true);
      expect(isContentElement(buildElement('<textarea></textarea>'))).toBe(true);
      expect(isContentElement(buildElement('<select><option>a</option></select>'))).toBe(true);
    });
  });

  // ─── isClickable ─────────────────────────────────────────────────────────────

  describe('isClickable', () => {
    it('returns true for <a> and <button>', () => {
      expect(isClickable(buildElement('<a href="#">link</a>'))).toBe(true);
      expect(isClickable(buildElement('<button>click</button>'))).toBe(true);
    });

    it('returns true for role=button', () => {
      expect(isClickable(buildElement('<div role="button">click</div>'))).toBe(true);
    });

    it('returns false for non-interactive elements', () => {
      expect(isClickable(buildElement('<p>text</p>'))).toBe(false);
      expect(isClickable(buildElement('<div>container</div>'))).toBe(false);
      expect(isClickable(buildElement('<span>inline</span>'))).toBe(false);
    });
  });

  // ─── isInsideNavSurface ───────────────────────────────────────────────────────────────

  describe('isInsideNavSurface', () => {
    it('returns true for an <a> inside <nav>', () => {
      const nav = buildElement('<nav><a href="/about">About</a></nav>');
      const anchor = nav.querySelector('a') as HTMLElement;
      expect(isInsideNavSurface(anchor)).toBe(true);
    });

    it('returns true for a span inside <nav> (target-agnostic)', () => {
      const nav = buildElement('<nav><a href="/x"><span>label</span></a></nav>');
      const span = nav.querySelector('span') as HTMLElement;
      expect(isInsideNavSurface(span)).toBe(true);
    });

    it('returns true for an anchor inside breadcrumb <nav>', () => {
      const nav = buildElement('<nav aria-label="breadcrumb"><a href="/home">Home</a></nav>');
      const anchor = nav.querySelector('a') as HTMLElement;
      expect(isInsideNavSurface(anchor)).toBe(true);
    });

    it('returns true for the <nav> element itself', () => {
      const nav = buildElement('<nav><a>x</a></nav>');
      expect(isInsideNavSurface(nav)).toBe(true);
    });

    it('returns false for a standalone <a>', () => {
      expect(isInsideNavSurface(buildElement('<a href="#">link</a>'))).toBe(false);
    });

    it('returns false for an <a> inside <header> with no <nav>', () => {
      const header = buildElement('<header><a href="/x">link</a></header>');
      const anchor = header.querySelector('a') as HTMLElement;
      expect(isInsideNavSurface(anchor)).toBe(false);
    });

    it('returns false for a body-content <p>', () => {
      expect(isInsideNavSurface(buildElement('<p>body text</p>'))).toBe(false);
    });

    it('returns true for an item inside [role="menu"] (Radix dropdown portal)', () => {
      const menu = buildElement('<div role="menu"><a href="/x">Item</a></div>');
      const anchor = menu.querySelector('a') as HTMLElement;
      expect(isInsideNavSurface(anchor)).toBe(true);
    });

    it('returns true for an item inside [role="menubar"]', () => {
      const bar = buildElement('<div role="menubar"><a href="/x">Item</a></div>');
      const anchor = bar.querySelector('a') as HTMLElement;
      expect(isInsideNavSurface(anchor)).toBe(true);
    });

    it('returns true for an item inside [role="navigation"] without <nav>', () => {
      const region = buildElement('<div role="navigation"><a href="/x">Link</a></div>');
      const anchor = region.querySelector('a') as HTMLElement;
      expect(isInsideNavSurface(anchor)).toBe(true);
    });
  });

  // ─── isTextEditable — data-dev-dynamic guard ─────────────────────────────────

  describe('isTextEditable — data-dev-dynamic guard', () => {
    it('should reject elements with data-dev-dynamic attribute', () => {
      const element = buildElement('<p data-dev-dynamic="true">500+</p>');
      expect(isTextEditable(element, true)).toBe(false);
    });

    it('should reject elements containing a descendant with data-dev-dynamic', () => {
      const element = buildElement('<p><span data-dev-dynamic="true">500+</span></p>');
      expect(isTextEditable(element, true)).toBe(false);
    });

    it('should reject formatted descendants inside data-dev-dynamic elements', () => {
      const element = buildElement('<h1 data-dev-dynamic="true"><span data-airo-formatted-bound-text="true">Welcome</span></h1>');
      const formatted = element.querySelector('span') as HTMLElement;
      expect(isTextEditable(formatted)).toBe(false);
    });

    it('should allow plain text elements without data-dev-dynamic (with editable marker)', () => {
      const element = buildElement('<p data-dev-editable="text">Hello World</p>');
      expect(isTextEditable(element, true)).toBe(true);
    });

    it('should allow elements with inline formatting but no data-dev-dynamic (with editable marker)', () => {
      const element = buildElement('<p data-dev-editable="text"><strong>Bold text</strong></p>');
      expect(isTextEditable(element, true)).toBe(true);
    });

    it('should reject deeply nested data-dev-dynamic descendants', () => {
      const element = buildElement('<p><em><span data-dev-dynamic="true">price</span></em></p>');
      expect(isTextEditable(element, true)).toBe(false);
    });

    it('treats content-keyed elements as editable even if they also have dynamic markup around them', () => {
      const element = buildElement('<h1 data-dev-content-key="home.hero.title">Welcome</h1>');
      expect(isTextEditable(element, true)).toBe(true);
    });
  });

  // ─── isTextEditable — data-dev-bound-text render-prop exception ───────────────

  describe('isTextEditable — data-dev-bound-text render-prop exception', () => {
    it('allows a bound-text element with data-dev-dynamic on itself to be editable', () => {
      const element = buildElement('<p data-dev-dynamic="true" data-dev-bound-text="true">Paragraph text</p>');
      expect(isTextEditable(element, true)).toBe(true);
    });

    it('allows a bound-text element with inline children and data-dev-dynamic on itself', () => {
      const element = buildElement(
        '<p data-dev-dynamic="true" data-dev-bound-text="true">Text with <em>italic</em> and <strong>bold</strong></p>',
      );
      expect(isTextEditable(element, true)).toBe(true);
    });

    it('allows a bound-text element when only its ancestor has data-dev-dynamic', () => {
      // Page-level conditional renders (e.g. {items.length > 0 && <Section>}) make
      // ancestor divs data-dev-dynamic, but bound-text elements inside are still
      // user-authored text. The source mapper never adds data-dev-bound-text inside
      // .map() calls (genericMapDepth > 0), so ancestor checks are not needed.
      const parent = buildElement('<div data-dev-dynamic="true"><p data-dev-bound-text="true">text</p></div>');
      const element = parent.querySelector('p') as HTMLElement;
      expect(isTextEditable(element, true)).toBe(true);
    });

    it('blocks a bound-text element that contains a descendant with data-dev-dynamic', () => {
      const element = buildElement(
        '<p data-dev-dynamic="true" data-dev-bound-text="true"><span data-dev-dynamic="true">computed</span></p>',
      );
      expect(isTextEditable(element, true)).toBe(false);
    });
  });

  // ─── isTextEditable — CMS inline-edit flag gate ───────────────────────────────

  describe('isTextEditable — CMS inline-edit flag gate', () => {
    function contentKeyed(): HTMLElement {
      const el = document.createElement('p');
      el.setAttribute('data-dev-content-key', 'home.hero.title');
      el.textContent = 'Welcome';
      return el;
    }

    it('content-keyed element is NOT editable when the flag is off', () => {
      expect(isTextEditable(contentKeyed(), false)).toBe(false);
    });

    it('content-keyed element IS editable when the flag is on', () => {
      expect(isTextEditable(contentKeyed(), true)).toBe(true);
    });

    it('content-keyed element with flag off does not fall through to AST-editable', () => {
      // a plain <p> with text would be AST-editable; the content key must force false
      const el = contentKeyed();
      expect(isTextEditable(el, false)).toBe(false);
    });

    it('non-content text element (with editable marker) is editable regardless of the flag', () => {
      const el = document.createElement('p');
      el.setAttribute('data-dev-editable', 'text');
      el.textContent = 'Plain text';
      expect(isTextEditable(el, false)).toBe(true);
      expect(isTextEditable(el, true)).toBe(true);
    });

    it('rejects text inside a Commerce-managed product root', () => {
      const root = buildElement(`
        <article data-dev-source-origin="commerce" data-dev-commerce-product-id="sku-group-1">
          <h2>Product name</h2>
        </article>
      `);
      expect(isTextEditable(root.querySelector('h2') as HTMLElement, true)).toBe(false);
    });
  });

  // ─── isTextEditable — authoritative data-dev-editable marker ─────────────────

  describe('isTextEditable — authoritative data-dev-editable marker', () => {
    it('a static element WITH the marker is editable', () => {
      const element = buildElement('<h1 data-dev-editable="text">Hello</h1>');
      expect(isTextEditable(element, true)).toBe(true);
    });

    it('the SAME element WITHOUT the marker is NOT editable', () => {
      const element = buildElement('<h1>Hello</h1>');
      expect(isTextEditable(element, true)).toBe(false);
    });

    it('inline-formatting element is editable only with the marker', () => {
      expect(isTextEditable(buildElement('<p data-dev-editable="text"><strong>Bold</strong></p>'), true)).toBe(true);
      expect(isTextEditable(buildElement('<p><strong>Bold</strong></p>'), true)).toBe(false);
    });

    it('content-keyed elements are unaffected by the marker (content fork owns them)', () => {
      // Content-keyed nodes never carry data-dev-editable; the content fork
      // decides editability purely from the flag, regardless of the marker.
      const el = document.createElement('p');
      el.setAttribute('data-dev-content-key', 'home.hero.title');
      el.textContent = 'Welcome';
      expect(isTextEditable(el, true)).toBe(true);
      expect(isTextEditable(el, false)).toBe(false);
    });
  });

  // ─── getMediaSlotPath ─────────────────────────────────────────────────────────

  describe('getMediaSlotPath', () => {
    it('extracts the slot path from an /airo-assets/images/ URL', () => {
      expect(getMediaSlotPath('/airo-assets/images/pages/home/hero')).toBe('pages/home/hero');
    });

    it('strips query string from /airo-assets/images/ URL', () => {
      expect(getMediaSlotPath('/airo-assets/images/pages/home/hero?v=1')).toBe('pages/home/hero');
    });

    it('returns null for /assets/ URLs (not a registered media slot path)', () => {
      expect(getMediaSlotPath('/assets/images/logo.png')).toBeNull();
    });

    it('returns null for /airo-assets/uploads/ URLs', () => {
      expect(getMediaSlotPath('/airo-assets/uploads/abc123.jpg')).toBeNull();
    });

    it('returns null for external Unsplash URLs', () => {
      expect(getMediaSlotPath('https://images.unsplash.com/photo-123?w=800')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(getMediaSlotPath(null)).toBeNull();
    });

    it('extracts slot path from /airo-assets/videos/ URL', () => {
      expect(getMediaSlotPath('/airo-assets/videos/pages/home/hero')).toBe('pages/home/hero');
    });

    it('extracts slot path from /airo-assets/videos/ URL with query string', () => {
      expect(getMediaSlotPath('/airo-assets/videos/pages/home/hero?_v=123&_t=456')).toBe('pages/home/hero');
    });
  });

  // ─── resolveContentKey ────────────────────────────────────────────────────────

  describe('resolveContentKey', () => {
    it('returns null for elements without any content attribution', () => {
      expect(resolveContentKey(buildElement('<p>text</p>'))).toBeNull();
    });

    it('returns the direct key when data-dev-content-key is set', () => {
      const element = buildElement('<h1 data-dev-content-key="site.brand">Acme</h1>');
      expect(resolveContentKey(element)).toEqual({ key: 'site.brand', kind: 'copy' });
    });

    it('reads kind=richText from data-dev-content-kind', () => {
      const element = buildElement('<div data-dev-content-key="home.body" data-dev-content-kind="richText">x</div>');
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
      const element = buildElement('<h3 data-dev-content-key-template="products[].name">A</h3>');
      expect(resolveContentKey(element)).toBeNull();
    });

    it('resolves all three fields of a multi-field collection item at index 2', () => {
      // Mirrors the canonical S3 agent pattern:
      //   <ContentListContext field="products"> injects data-dev-content-list="products"
      //   Each child gets data-dev-content-list-index (injected by ContentListContext)
      //   source-mapper emits data-dev-content-key-template for name/description/price
      // This test locks the full attribution + resolution chain for a 3-field item.
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="products">
          <article data-dev-content-list-index="2">
            <h3 data-dev-content-key-template="products[].name">Gadget</h3>
            <p data-dev-content-key-template="products[].description">A great gadget</p>
            <span><span data-dev-content-key-template="products[].price">9.99</span></span>
          </article>
        </div>
      `;
      const nameEl = root.querySelector('h3') as HTMLElement;
      const descEl = root.querySelector('p') as HTMLElement;
      // price is on the inner wrapper span (the pre-pass wraps ${p.price} in a child span)
      const priceEl = root.querySelector('span[data-dev-content-key-template]') as HTMLElement;

      expect(resolveContentKey(nameEl)).toEqual({ key: 'products[2].name', kind: 'copy' });
      expect(resolveContentKey(descEl)).toEqual({ key: 'products[2].description', kind: 'copy' });
      expect(resolveContentKey(priceEl)).toEqual({ key: 'products[2].price', kind: 'copy' });
    });

    it('stashes data-dev-item-id from a field-less child onto the field-bearing wrapper above (split layout → [@id])', () => {
      // Manual <ContentListContext> layout: field on the wrapper, index+item-id on
      // the field-less child. Exercises the pendingId stash branch — the id is held
      // until the next field-bearing ancestor, then applied as the @id ref.
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="products">
          <article data-dev-content-list-index="2" data-dev-item-id="gizmo">
            <h3 data-dev-content-key-template="products[].name">Gizmo</h3>
          </article>
        </div>
      `;
      const nameEl = root.querySelector('h3') as HTMLElement;
      expect(resolveContentKey(nameEl)).toEqual({ key: 'products[@gizmo].name', kind: 'copy' });
    });

    it('resolves a 2-level nested key using self-describing layout (field+index on same element)', () => {
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="menu.categories" data-dev-content-list-index="0">
          <div data-dev-content-list="menu.categories[].items" data-dev-content-list-index="0">
            <span data-dev-content-key-template="menu.categories[].items[].price">$9.99</span>
          </div>
        </div>
      `;
      const span = root.querySelector('span') as HTMLElement;
      expect(resolveContentKey(span)).toEqual({ key: 'menu.categories[0].items[0].price', kind: 'copy' });
    });

    // Backward-compat: this field-on-wrapper / index-on-child shape is what a
    // MANUAL <ContentListContext> emits — source-mapper auto-injection always
    // puts field + index on the same node (covered by the self-describing tests
    // above). The resolver must handle both layouts.
    it('resolves a 2-level nested key using nested-ContentListContext layout (field on wrapper, index on child)', () => {
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="menu.categories">
          <div data-dev-content-list-index="0">
            <div data-dev-content-list="menu.categories[].items">
              <div data-dev-content-list-index="0">
                <span data-dev-content-key-template="menu.categories[].items[].price">$9.99</span>
              </div>
            </div>
          </div>
        </div>
      `;
      const span = root.querySelector('span') as HTMLElement;
      expect(resolveContentKey(span)).toEqual({ key: 'menu.categories[0].items[0].price', kind: 'copy' });
    });

    it('resolves a 2-level nested key with non-zero indices', () => {
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="menu.categories" data-dev-content-list-index="1">
          <div data-dev-content-list="menu.categories[].items" data-dev-content-list-index="2">
            <span data-dev-content-key-template="menu.categories[].items[].price">$9.99</span>
          </div>
        </div>
      `;
      const span = root.querySelector('span') as HTMLElement;
      expect(resolveContentKey(span)).toEqual({ key: 'menu.categories[1].items[2].price', kind: 'copy' });
    });

    it('returns null when a template [] prefix matches no collected list field', () => {
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="other.field" data-dev-content-list-index="0">
          <span data-dev-content-key-template="menu.categories[].price">$9.99</span>
        </div>
      `;
      const span = root.querySelector('span') as HTMLElement;
      expect(resolveContentKey(span)).toBeNull();
    });

    it('returns null when a list field is present but no index is found anywhere', () => {
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="menu.categories">
          <span data-dev-content-key-template="menu.categories[].price">$9.99</span>
        </div>
      `;
      const span = root.querySelector('span') as HTMLElement;
      expect(resolveContentKey(span)).toBeNull();
    });

    it('resolves a single-level key using self-describing layout (backward compat)', () => {
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="products" data-dev-content-list-index="5">
          <span data-dev-content-key-template="products[].name">Widget</span>
        </div>
      `;
      const span = root.querySelector('span') as HTMLElement;
      expect(resolveContentKey(span)).toEqual({ key: 'products[5].name', kind: 'copy' });
    });

    it('resolves a 3-level nested key using self-describing layout (distinct indices per level)', () => {
      // Each ancestor element carries both list field and index on the same node
      // (self-describing layout — the form source-mapper emits).
      // Distinct indices 0/1/2 prove each [] placeholder maps to the correct level.
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="a.b" data-dev-content-list-index="0">
          <div data-dev-content-list="a.b[].c" data-dev-content-list-index="1">
            <div data-dev-content-list="a.b[].c[].d" data-dev-content-list-index="2">
              <div><span data-dev-content-key-template="a.b[].c[].d[].e">X</span></div>
            </div>
          </div>
        </div>
      `;
      const span = root.querySelector('span') as HTMLElement;
      expect(resolveContentKey(span)).toEqual({ key: 'a.b[0].c[1].d[2].e', kind: 'copy' });
    });

    it('substitutes [@id] when data-dev-item-id is present on the list element', () => {
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="items" data-dev-content-list-index="0" data-dev-item-id="burger">
          <span data-dev-content-key-template="items[].price">$9.99</span>
        </div>
      `;
      const span = root.querySelector('span') as HTMLElement;
      expect(resolveContentKey(span)).toEqual({ key: 'items[@burger].price', kind: 'copy' });
    });

    it('falls back to [index] when data-dev-item-id is absent', () => {
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="items" data-dev-content-list-index="0">
          <span data-dev-content-key-template="items[].price">$9.99</span>
        </div>
      `;
      const span = root.querySelector('span') as HTMLElement;
      expect(resolveContentKey(span)).toEqual({ key: 'items[0].price', kind: 'copy' });
    });

    it('resolves a 2-level nested key with outer id-anchored and inner positional', () => {
      // Mixed per-level resolution: outer level uses @id, inner level uses index.
      // Verifies that data-dev-item-id preference is applied independently at each level.
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="menu" data-dev-content-list-index="0" data-dev-item-id="burgers">
          <div data-dev-content-list="menu[].items" data-dev-content-list-index="2">
            <span data-dev-content-key-template="menu[].items[].name">Cheese</span>
          </div>
        </div>
      `;
      const span = root.querySelector('span') as HTMLElement;
      expect(resolveContentKey(span)).toEqual({ key: 'menu[@burgers].items[2].name', kind: 'copy' });
    });

    it('resolves a 2-level nested key with inner id-anchored and outer positional', () => {
      // Mixed per-level resolution: outer level uses index, inner level uses @id.
      // Verifies that data-dev-item-id preference is applied independently at each level.
      const root = document.createElement('div');
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      root.innerHTML = `
        <div data-dev-content-list="menu" data-dev-content-list-index="0">
          <div data-dev-content-list="menu[].items" data-dev-content-list-index="2" data-dev-item-id="cheeseburger">
            <span data-dev-content-key-template="menu[].items[].name">Cheese</span>
          </div>
        </div>
      `;
      const span = root.querySelector('span') as HTMLElement;
      expect(resolveContentKey(span)).toEqual({ key: 'menu[0].items[@cheeseburger].name', kind: 'copy' });
    });
  });

  // ─── isBodyTextElement ────────────────────────────────────────────────────────

  describe('isBodyTextElement', () => {
    it('returns true for <p>', () => {
      expect(isBodyTextElement(buildElement('<p>Hello</p>'))).toBe(true);
    });

    it('returns true for <li>', () => {
      const doc = new DOMParser().parseFromString('<ul><li>Item</li></ul>', 'text/html');
      const li = doc.querySelector('li') as HTMLElement;
      expect(isBodyTextElement(li)).toBe(true);
    });

    it('returns false for headings', () => {
      expect(isBodyTextElement(buildElement('<h1>Title</h1>'))).toBe(false);
      expect(isBodyTextElement(buildElement('<h2>Subtitle</h2>'))).toBe(false);
    });

    it('returns false for inline elements', () => {
      expect(isBodyTextElement(buildElement('<span>Text</span>'))).toBe(false);
      expect(isBodyTextElement(buildElement('<em>Italic</em>'))).toBe(false);
    });

    it('returns true for <ul> (allows un-listing)', () => {
      expect(isBodyTextElement(buildElement('<ul><li>Item</li></ul>'))).toBe(true);
    });

    it('returns true for <ol> (allows un-listing)', () => {
      expect(isBodyTextElement(buildElement('<ol><li>Item</li></ol>'))).toBe(true);
    });

    it('returns false for container elements', () => {
      expect(isBodyTextElement(buildElement('<div>Content</div>'))).toBe(false);
    });
  });

  // ─── isManagedPath ────────────────────────────────────────────────────────────

  describe('isManagedPath', () => {
    it('returns true for the privacy and terms pages (and their subpaths)', () => {
      expect(isManagedPath('/privacy')).toBe(true);
      expect(isManagedPath('/privacy/')).toBe(true);
      expect(isManagedPath('/privacy-policy')).toBe(true);
      expect(isManagedPath('/terms')).toBe(true);
      expect(isManagedPath('/terms-of-use')).toBe(true);
    });

    it('returns false for non-managed pages', () => {
      expect(isManagedPath('/')).toBe(false);
      expect(isManagedPath('/about')).toBe(false);
      expect(isManagedPath('/contact')).toBe(false);
      expect(isManagedPath('/pricing')).toBe(false);
    });
  });

  // ─── resolveConformTarget ─────────────────────────────────────────────────────

  describe('resolveConformTarget', () => {
    it('returns {page, arrayName} for the conformable root itself', () => {
      const el = document.createElement('div');
      el.setAttribute('data-dev-conformable-array', 'stats');
      el.setAttribute('data-dev-conformable-page', 'src/pages/index.tsx');
      document.body.appendChild(el);
      expect(resolveConformTarget(el)).toEqual({ page: 'src/pages/index.tsx', arrayName: 'stats' });
      el.remove();
    });

    it('returns {page, arrayName} for a child inside a conformable root', () => {
      const host = document.createElement('div');
      host.setAttribute('data-dev-conformable-array', 'features');
      host.setAttribute('data-dev-conformable-page', 'src/pages/about.tsx');
      const child = document.createElement('p');
      child.textContent = 'child';
      host.appendChild(child);
      document.body.appendChild(host);
      expect(resolveConformTarget(child)).toEqual({ page: 'src/pages/about.tsx', arrayName: 'features' });
      host.remove();
    });

    it('returns null when data-dev-conformable-page is missing', () => {
      const el = document.createElement('div');
      el.setAttribute('data-dev-conformable-array', 'stats');
      document.body.appendChild(el);
      expect(resolveConformTarget(el)).toBeNull();
      el.remove();
    });

    it('returns null when neither attribute is present', () => {
      const el = document.createElement('p');
      el.textContent = 'plain text';
      document.body.appendChild(el);
      expect(resolveConformTarget(el)).toBeNull();
      el.remove();
    });
  });

  // ─── hasManagedDocMarkup ──────────────────────────────────────────────────────

  describe('hasManagedDocMarkup', () => {
    // Parse via DOMParser (not innerHTML) into a wrapping <div> so the markup is
    // a descendant of the returned root, matching how querySelector scopes.
    function buildContainer(html: string): HTMLElement {
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
      return doc.body.firstElementChild as HTMLElement;
    }

    it('returns true when an editable compliance field span is present', () => {
      const root = buildContainer('<p>Contact <span data-field="email" data-type="email" data-editable="true">a@x.com</span></p>');
      expect(hasManagedDocMarkup(root)).toBe(true);
    });

    it('returns true when a section branch is present', () => {
      const root = buildContainer('<span data-section="children" data-section-when="true">COPPA</span>');
      expect(hasManagedDocMarkup(root)).toBe(true);
    });

    it('returns false for a plain page with no compliance markup', () => {
      const root = buildContainer('<h1>Privacy Policy</h1><p>Some hand-written legal prose.</p>');
      expect(hasManagedDocMarkup(root)).toBe(false);
    });

    it('returns false for a data-field span that is not marked editable', () => {
      const root = buildContainer('<span data-field="businessName">Acme</span>');
      expect(hasManagedDocMarkup(root)).toBe(false);
    });
  });
})
