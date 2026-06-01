/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { htmlToJsx, htmlToJsxStructured } from '../html-to-jsx';

describe('htmlToJsx', () => {
  it('unwraps plain text from <p>', () => {
    expect(htmlToJsx('<p>Hello world</p>')).toBe('Hello world');
  });

  it('preserves <strong>', () => {
    expect(htmlToJsx('<p><strong>bold</strong></p>')).toBe('<strong>bold</strong>');
  });

  it('preserves <em>', () => {
    expect(htmlToJsx('<p><em>italic</em></p>')).toBe('<em>italic</em>');
  });

  it('preserves nested bold+italic', () => {
    expect(htmlToJsx('<p><strong><em>both</em></strong></p>')).toBe('<strong><em>both</em></strong>');
  });

  it('converts class to className', () => {
    expect(htmlToJsx('<p><a href="https://x.com" class="c">link</a></p>'))
      .toBe('<a href="https://x.com" className="c">link</a>');
  });

  it('converts style string to JSX object (single prop)', () => {
    expect(htmlToJsx('<p><span style="color: #ef4444;">red</span></p>'))
      .toBe("<span style={{color: '#ef4444'}}>red</span>");
  });

  it('converts style string to JSX object (multiple props, camelCase)', () => {
    expect(htmlToJsx('<p><span style="color: red; font-weight: bold;">x</span></p>'))
      .toBe("<span style={{color: 'red', fontWeight: 'bold'}}>x</span>");
  });

  it('strips Lexical white-space: pre-wrap and unwraps bare span', () => {
    expect(htmlToJsx('<p><span style="white-space: pre-wrap;">text</span></p>'))
      .toBe('text');
  });

  it('keeps color but drops white-space: pre-wrap', () => {
    expect(htmlToJsx('<p><span style="color: #ef4444; white-space: pre-wrap;">red</span></p>'))
      .toBe("<span style={{color: '#ef4444'}}>red</span>");
  });

  it('handles real Lexical output: mixed plain + bold', () => {
    expect(htmlToJsx('<p><span style="white-space: pre-wrap;">Hello </span><strong style="white-space: pre-wrap;">world</strong></p>'))
      .toBe('Hello <strong>world</strong>');
  });

  it('keeps span with className even after stripping white-space', () => {
    expect(htmlToJsx('<p><span class="keep" style="white-space: pre-wrap;">text</span></p>'))
      .toBe('<span className="keep">text</span>');
  });

  it('converts for to htmlFor', () => {
    expect(htmlToJsx('<p><label for="email">Email</label></p>'))
      .toBe('<label htmlFor="email">Email</label>');
  });

  it('strips javascript: URLs from href', () => {
    expect(htmlToJsx('<p><a href="javascript:alert(1)">xss</a></p>'))
      .toBe('<a>xss</a>');
  });

  it('handles link with safe URL', () => {
    expect(htmlToJsx('<p><a href="https://example.com">link</a></p>'))
      .toBe('<a href="https://example.com">link</a>');
  });

  it('self-closes empty elements', () => {
    expect(htmlToJsx('<p><br></p>')).toBe('<br />');
  });

  it('handles bold+italic combined', () => {
    expect(htmlToJsx('<p><strong><em>text</em></strong></p>'))
      .toBe('<strong><em>text</em></strong>');
  });

  it('unwraps Lexical doubled bold tags: <b><strong>', () => {
    expect(htmlToJsx('<p><b><strong>bold</strong></b></p>'))
      .toBe('<strong>bold</strong>');
  });

  it('unwraps Lexical doubled italic tags: <i><em>', () => {
    expect(htmlToJsx('<p><i><em>italic</em></i></p>'))
      .toBe('<em>italic</em>');
  });

  it('collapses same-tag redundant nesting: <em><em>', () => {
    expect(htmlToJsx('<p><strong><em><em>text</em></em></strong></p>'))
      .toBe('<strong><em>text</em></strong>');
  });

  it('collapses deeply redundant nesting: <strong><strong><strong>', () => {
    expect(htmlToJsx('<p><strong><strong><strong>bold</strong></strong></strong></p>'))
      .toBe('<strong>bold</strong>');
  });

  it('preserves bold+italic from Lexical: <i><b><strong>', () => {
    expect(htmlToJsx('<p><i><b><strong style="white-space: pre-wrap;">Garden</strong></b></i></p>'))
      .toBe('<em><strong>Garden</strong></em>');
  });

  it('maps bare <b> to <strong>', () => {
    expect(htmlToJsx('<p><b>bold</b></p>'))
      .toBe('<strong>bold</strong>');
  });

  it('maps bare <i> to <em>', () => {
    expect(htmlToJsx('<p><i>italic</i></p>'))
      .toBe('<em>italic</em>');
  });
});

describe('htmlToJsxStructured', () => {
  it('plain <p> returns null rootTag and rootAttributes', () => {
    expect(htmlToJsxStructured('<p>Hello world</p>')).toEqual({
      childrenJsx: 'Hello world',
      rootTag: null,
      rootAttributes: null,
    });
  });

  it('preserves inline formatting in childrenJsx', () => {
    expect(htmlToJsxStructured('<p><strong>bold</strong></p>')).toEqual({
      childrenJsx: '<strong>bold</strong>',
      rootTag: null,
      rootAttributes: null,
    });
  });

  it('detects alignment style on <p>', () => {
    const result = htmlToJsxStructured('<p style="text-align: center">centered</p>');
    expect(result.rootTag).toBeNull();
    expect(result.rootAttributes).toBe("style={{textAlign: 'center'}}");
    expect(result.childrenJsx).toBe('centered');
  });

  it('detects heading tag', () => {
    const result = htmlToJsxStructured('<h2>heading text</h2>');
    expect(result.rootTag).toBe('h2');
    expect(result.rootAttributes).toBeNull();
    expect(result.childrenJsx).toBe('heading text');
  });

  it('detects heading with class', () => {
    const result = htmlToJsxStructured('<h1 class="title">Big Title</h1>');
    expect(result.rootTag).toBe('h1');
    expect(result.rootAttributes).toBe('className="title"');
    expect(result.childrenJsx).toBe('Big Title');
  });

  it('detects unordered list', () => {
    const result = htmlToJsxStructured('<ul><li>one</li><li>two</li></ul>');
    expect(result.rootTag).toBe('ul');
    expect(result.rootAttributes).toBeNull();
    expect(result.childrenJsx).toBe('<li>one</li><li>two</li>');
  });

  it('detects ordered list', () => {
    const result = htmlToJsxStructured('<ol><li>first</li><li>second</li></ol>');
    expect(result.rootTag).toBe('ol');
    expect(result.childrenJsx).toBe('<li>first</li><li>second</li>');
  });

  it('detects blockquote', () => {
    const result = htmlToJsxStructured('<blockquote>quoted</blockquote>');
    expect(result.rootTag).toBe('blockquote');
    expect(result.childrenJsx).toBe('quoted');
  });

  it('handles <p> with className', () => {
    const result = htmlToJsxStructured('<p class="text-center">aligned</p>');
    expect(result.rootTag).toBeNull();
    expect(result.rootAttributes).toBe('className="text-center"');
    expect(result.childrenJsx).toBe('aligned');
  });

  it('handles multiple attributes on root', () => {
    const result = htmlToJsxStructured('<p class="intro" style="color: red">text</p>');
    expect(result.rootTag).toBeNull();
    expect(result.rootAttributes).toBe("className=\"intro\" style={{color: 'red'}}");
  });

  it('falls back gracefully with no root element', () => {
    const result = htmlToJsxStructured('just text');
    expect(result.rootTag).toBeNull();
    expect(result.rootAttributes).toBeNull();
    expect(result.childrenJsx).toBe('just text');
  });

  it('filters Lexical dir attribute from root <p>', () => {
    const result = htmlToJsxStructured('<p dir="ltr"><em>italic</em> text</p>');
    expect(result.rootTag).toBeNull();
    expect(result.rootAttributes).toBeNull();
    expect(result.childrenJsx).toBe('<em>italic</em> text');
  });

  it('filters data-lexical-* attributes from root', () => {
    const result = htmlToJsxStructured('<p data-lexical-editor="true" dir="ltr"><strong>bold</strong></p>');
    expect(result.rootTag).toBeNull();
    expect(result.rootAttributes).toBeNull();
    expect(result.childrenJsx).toBe('<strong>bold</strong>');
  });

  it('filters Lexical artifacts but preserves real attributes', () => {
    const result = htmlToJsxStructured('<p dir="ltr" class="text-center" style="color: red"><em>styled</em></p>');
    expect(result.rootTag).toBeNull();
    expect(result.rootAttributes).toBe("className=\"text-center\" style={{color: 'red'}}");
    expect(result.childrenJsx).toBe('<em>styled</em>');
  });

  it('filters spellcheck and autocorrect from root', () => {
    const result = htmlToJsxStructured('<p spellcheck="false" autocorrect="off">text</p>');
    expect(result.rootTag).toBeNull();
    expect(result.rootAttributes).toBeNull();
  });

  it('strips cursor from style attribute (Hover Bar pointer leak)', () => {
    const result = htmlToJsxStructured('<p style="cursor: pointer">text</p>');
    expect(result.rootTag).toBeNull();
    expect(result.rootAttributes).toBeNull();
  });

  it('strips cursor but preserves other inline styles', () => {
    const result = htmlToJsxStructured('<p style="color: red; cursor: pointer; font-weight: 700">text</p>');
    expect(result.rootTag).toBeNull();
    expect(result.rootAttributes).toBe("style={{color: 'red', fontWeight: '700'}}");
  });

  it('strips all data-dev-* markers injected by source-mapper', () => {
    expect(
      htmlToJsx('<p><em data-dev-id="a" data-dev-file="/x.tsx" data-dev-line="10" data-dev-content-key="k" data-dev-dynamic="">italic</em></p>'),
    ).toBe('<em>italic</em>');
  });

  it('collapses span chains whose only attributes are source-mapper markers', () => {
    expect(
      htmlToJsx('<p><span data-dev-id="a"><span data-dev-id="b"><span data-dev-id="c">text</span></span></span></p>'),
    ).toBe('text');
  });
});
