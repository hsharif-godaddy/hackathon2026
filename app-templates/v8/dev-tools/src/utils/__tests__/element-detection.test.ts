/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import {
  isTextEditable,
  isBodyTextElement,
  resolveContentKey,
  getMediaSlotPath,
  isTextElement,
  isTextBlockElement,
  isListElement,
  isContentElement,
  isClickable,
  isInsideNavSurface,
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
      expect(isTextEditable(element)).toBe(false);
    });

    it('should reject elements containing a descendant with data-dev-dynamic', () => {
      const element = buildElement('<p><span data-dev-dynamic="true">500+</span></p>');
      expect(isTextEditable(element)).toBe(false);
    });

    it('should allow plain text elements without data-dev-dynamic', () => {
      const element = buildElement('<p>Hello World</p>');
      expect(isTextEditable(element)).toBe(true);
    });

    it('should allow elements with inline formatting but no data-dev-dynamic', () => {
      const element = buildElement('<p><strong>Bold text</strong></p>');
      expect(isTextEditable(element)).toBe(true);
    });

    it('should reject deeply nested data-dev-dynamic descendants', () => {
      const element = buildElement('<p><em><span data-dev-dynamic="true">price</span></em></p>');
      expect(isTextEditable(element)).toBe(false);
    });

    it('treats content-keyed elements as editable even if they also have dynamic markup around them', () => {
      const element = buildElement('<h1 data-dev-content-key="home.hero.title">Welcome</h1>');
      expect(isTextEditable(element)).toBe(true);
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
})