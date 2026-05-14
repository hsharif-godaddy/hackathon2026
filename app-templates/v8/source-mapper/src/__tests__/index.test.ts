import { transformSync } from '@babel/core';
import { describe, it, expect } from 'vitest';
import jsxSourceMapper from '../index.js';

function transform(code: string, filename = '/app/src/pages/index.tsx') {
  const result = transformSync(code, {
    filename,
    parserOpts: { plugins: ['jsx'] },
    plugins: [jsxSourceMapper],
    configFile: false,
    babelrc: false,
  });
  if (result === null || result.code == null) {
    throw new Error('transformSync returned null');
  }
  return result.code;
}

describe('jsxSourceMapper — data-dev-dynamic', () => {
  it('should mark elements with variable expressions', () => {
    const output = transform('<p>{product.price}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('should mark elements with function call expressions', () => {
    const output = transform('<p>{formatPrice(100)}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('should mark elements with conditional expressions', () => {
    const output = transform('<p>{active ? "yes" : "no"}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('should NOT mark elements with string literal expressions', () => {
    const output = transform('<p>{"static string"}</p>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should NOT mark elements with static template literals', () => {
    const output = transform('<p>{`static template`}</p>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should NOT mark elements with empty expressions (comments)', () => {
    const output = transform('<p>{/* comment */}</p>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should NOT mark elements with only literal text children', () => {
    const output = transform('<p>Hello World</p>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should mark elements with dynamic template literals', () => {
    const output = transform('<p>{`$${price}`}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('should NOT mark elements in excluded paths', () => {
    const output = transform('<p>{value}</p>', '/app/src/components/ui/button.tsx');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should mark even when data-dev-file already exists', () => {
    const output = transform('<p data-dev-file="/test" data-dev-line={1}>{value}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
    // Should not duplicate data-dev-file
    expect(output.match(/data-dev-file/g)?.length).toBe(1);
  });
});

describe('jsxSourceMapper — data-dev-content-key', () => {
  it('emits content-key for direct member access on a content binding', () => {
    const output = transform(`
      import { site } from 'virtual:content';
      export default () => <h1>{site.brand}</h1>;
    `);
    expect(output).toContain('data-dev-content-key="site.brand"');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('emits content-key for nested member chains', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => <p>{home.hero.title}</p>;
    `);
    expect(output).toContain('data-dev-content-key="home.hero.title"');
  });

  it('emits a template key for .map iteration over a content binding', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>{products.map((p) => <li>{p.name}</li>)}</ul>
      );
    `);
    expect(output).toContain('data-dev-content-key-template="products[].name"');
  });

  it('emits a template key for nested field access on a map item', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>{products.map((p) => <li>{p.image.alt}</li>)}</ul>
      );
    `);
    expect(output).toContain('data-dev-content-key-template="products[].image.alt"');
  });

  it('falls through to data-dev-dynamic when expression is not content-rooted', () => {
    const output = transform(`
      const product = { price: 1 };
      export default () => <p>{product.price}</p>;
    `);
    expect(output).not.toContain('data-dev-content-key');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('falls through for destructured content bindings', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => {
        const { hero } = home;
        return <h1>{hero.title}</h1>;
      };
    `);
    expect(output).not.toContain('data-dev-content-key');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('falls through for computed member access', () => {
    const output = transform(`
      import { site } from 'virtual:content';
      export default () => <p>{site.nav[0].label}</p>;
    `);
    expect(output).not.toContain('data-dev-content-key');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('wraps content expressions in mixed-child parents (Phase 2.6 auto-wrap)', () => {
    // Previously: mixed children → data-dev-dynamic, no content-key.
    // Phase 2.6 reverses that: the content expression is wrapped in a
    // <span data-dev-content-key="site.brand"> so it becomes editable.
    // The outer <p> no longer has a raw expression child → no data-dev-dynamic.
    const output = transform(`
      import { site } from 'virtual:content';
      export default () => <p>Hello {site.brand}</p>;
    `);
    expect(output).toContain('data-dev-content-key="site.brand"');
    // Outer <p>'s only dynamic child got wrapped into a JSXElement, so
    // the outer no longer carries data-dev-dynamic.
    expect(output).not.toMatch(/<p[^>]*data-dev-dynamic/);
  });

  it('ignores imports from other modules with the same local name', () => {
    const output = transform(`
      import { site } from 'some-other-module';
      export default () => <h1>{site.brand}</h1>;
    `);
    expect(output).not.toContain('data-dev-content-key');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('supports namespace imports', () => {
    const output = transform(`
      import * as content from 'virtual:content';
      export default () => <h1>{content.site.brand}</h1>;
    `);
    expect(output).toContain('data-dev-content-key="content.site.brand"');
  });

  it('does not re-tag when data-dev-content-key is already present', () => {
    const output = transform(`
      import { site } from 'virtual:content';
      export default () => <h1 data-dev-content-key="site.brand">{site.brand}</h1>;
    `);
    expect(output.match(/data-dev-content-key=/g)?.length).toBe(1);
  });

  it('pops map frame cleanly so outer JSX after the map is unaffected', () => {
    const output = transform(`
      import { products, site } from 'virtual:content';
      export default () => (
        <div>
          <ul>{products.map((p) => <li>{p.name}</li>)}</ul>
          <h1>{site.brand}</h1>
        </div>
      );
    `);
    expect(output).toContain('data-dev-content-key-template="products[].name"');
    expect(output).toContain('data-dev-content-key="site.brand"');
  });

  it('does not treat .map on a non-content binding as content iteration', () => {
    const output = transform(`
      const items = [{ name: 'a' }];
      export default () => <ul>{items.map((p) => <li>{p.name}</li>)}</ul>;
    `);
    expect(output).not.toContain('data-dev-content-key');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('attributes member-expression tag names (e.g. motion.h1)', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      import { motion } from 'motion';
      export default () => <motion.h1>{home.hero.title}</motion.h1>;
    `);
    expect(output).toContain('data-dev-content-key="home.hero.title"');
  });

  it('attributes deeper member-expression chains (Foo.Bar.Baz)', () => {
    const output = transform(`
      import { site } from 'virtual:content';
      export default () => <Heading.Primary>{site.brand}</Heading.Primary>;
    `);
    expect(output).toContain('data-dev-content-key="site.brand"');
  });

  it('still marks motion elements with non-content expressions as dynamic', () => {
    const output = transform(`
      const value = 42;
      export default () => <motion.span>{value}</motion.span>;
    `);
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('attributes sole content child inside a React component', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      function Button({ children }) { return <button>{children}</button>; }
      export default () => <Button>{home.cta}</Button>;
    `);
    expect(output).toContain('data-dev-content-key="home.cta"');
  });

  it('handles function-expression .map() callback', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>{products.map(function(p) { return <li>{p.name}</li>; })}</ul>
      );
    `);
    expect(output).toContain('data-dev-content-key-template="products[].name"');
  });

  it('resolves aliased named import', () => {
    const output = transform(`
      import { home as h } from 'virtual:content';
      export default () => <h1>{h.title}</h1>;
    `);
    expect(output).toContain('data-dev-content-key="h.title"');
  });

  it('falls through for nested .map() on a map-param field', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>{products.map((p) => <li>{p.tags.map((tag) => <span>{tag.name}</span>)}</li>)}</ul>
      );
    `);
    // p.tags.map(...) is a computed expression (not a simple member access),
    // so the <li> gets data-dev-dynamic. The inner tag.name is not a content
    // binding either — nested .map() is a v1 limitation.
    expect(output).not.toContain('data-dev-content-key');
    expect(output).toMatch(/<span[^>]*data-dev-dynamic/);
  });

  it('attributes content through a JSX comment sibling', () => {
    const output = transform(`
      import { site } from 'virtual:content';
      export default () => <h1>{/* greeting */}{site.brand}</h1>;
    `);
    expect(output).toContain('data-dev-content-key="site.brand"');
  });
});

describe('auto-wrap content expressions in mixed-child parents', () => {
  it('1. wraps both content expressions when parent has mixed children with text between', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => (
        <span>{home.hero.rating} · {home.hero.socialProof}</span>
      );
    `);
    expect(output).toContain('data-dev-content-key="home.hero.rating"');
    expect(output).toContain('data-dev-content-key="home.hero.socialProof"');
    // With all content expressions wrapped into elements, the outer span no
    // longer has a raw expression child, so no data-dev-dynamic.
    expect(output).not.toMatch(/<span[^>]*data-dev-dynamic[^>]*>\{home\.hero\.rating\}/);
  });

  it('2. leaves a sole content-expression child alone (existing direct attribution path)', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => <h1>{home.title}</h1>;
    `);
    // Direct attribution on the h1 — no inner wrapper needed
    expect(output).toContain('data-dev-content-key="home.title"');
    // There should be exactly one data-dev-content-key in the output (on h1, not a wrapper)
    expect(output.match(/data-dev-content-key=/g)?.length).toBe(1);
  });

  it('3. wraps only the content expression when mixed with a non-content expression', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      const count = 5;
      export default () => <p>{count} and {home.title}</p>;
    `);
    expect(output).toContain('data-dev-content-key="home.title"');
    // count is not content-rooted, so it stays as a raw expression child
    // → the outer <p> still has a raw expression child → data-dev-dynamic stays
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('4. leaves elements with only non-content expressions untouched', () => {
    const output = transform(`
      const count = 5;
      export default () => <p>Total: {count} items</p>;
    `);
    expect(output).not.toContain('data-dev-content-key');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('5. wraps within motion.h1 (member-expression parent)', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => (
        <motion.h1>{home.title} · {home.subtitle}</motion.h1>
      );
    `);
    expect(output).toContain('data-dev-content-key="home.title"');
    expect(output).toContain('data-dev-content-key="home.subtitle"');
  });

  it('6. does NOT wrap children of React component parents (capital-letter JSX)', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      function Button({ children }) { return <button>{children}</button>; }
      export default () => <Button>{home.cta} now!</Button>;
    `);
    // Wrapping Button's children in a span would change the children prop
    // shape and could break the component. Skip.
    expect(output).not.toContain('data-dev-content-key="home.cta"');
  });

  it('6b. does NOT wrap children of uppercase member-expression components (Heading.Primary)', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => <Heading.Primary>{home.title} · {home.subtitle}</Heading.Primary>;
    `);
    expect(output).not.toContain('data-dev-content-key="home.title"');
    expect(output).not.toContain('data-dev-content-key="home.subtitle"');
  });

  it('7. wraps when two content expressions sit adjacent with no text between', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => <div>{home.greeting}{home.name}</div>;
    `);
    expect(output).toContain('data-dev-content-key="home.greeting"');
    expect(output).toContain('data-dev-content-key="home.name"');
  });

  it('8. wraps with template keys inside a content-rooted .map() callback', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>{products.map((p) => <li>{p.name} — {p.price}</li>)}</ul>
      );
    `);
    expect(output).toContain('data-dev-content-key-template="products[].name"');
    expect(output).toContain('data-dev-content-key-template="products[].price"');
  });

  it('9. is idempotent — re-transforming already-wrapped output does not double-wrap', () => {
    const input = `
      import { home } from 'virtual:content';
      export default () => (
        <span>{home.a} · {home.b}</span>
      );
    `;
    const firstPass = transform(input);
    const secondPass = transform(firstPass);
    // Key count stable across passes
    expect((firstPass.match(/data-dev-content-key="home\.a"/g) ?? []).length).toBe(
      (secondPass.match(/data-dev-content-key="home\.a"/g) ?? []).length,
    );
    // Wrapper span count stable — catches double-wrap bugs
    for (const key of ['home\\.a', 'home\\.b']) {
      const pattern = new RegExp(`<span[^>]*data-dev-content-key="${key}"`, 'g');
      expect((firstPass.match(pattern) ?? []).length).toBe(
        (secondPass.match(pattern) ?? []).length,
      );
    }
  });

  it('10. wraps only expression-container children, ignoring element siblings', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => (
        <p><span>literal text</span>{home.a}</p>
      );
    `);
    expect(output).toContain('data-dev-content-key="home.a"');
    // The literal text span is not an expression child; it stays untouched
    // (no new data-dev-content-key ON that inner <span>literal text</span>)
    expect(output).toMatch(/<span[^>]*>literal text<\/span>/);
  });
});

describe('jsxSourceMapper — data-dev-id', () => {
  it('injects data-dev-id on every element', () => {
    const output = transform('<section><div><h1>Hello</h1></div></section>');
    const matches = output.match(/data-dev-id="[0-9a-f]{6}"/g);
    expect(matches).toHaveLength(3);
  });

  it('produces stable IDs across whitespace/reformat changes', () => {
    const compact = transform('<section><div><h1>Hello</h1></div></section>');
    const formatted = transform(`
      <section>
        <div>
          <h1>Hello</h1>
        </div>
      </section>
    `);
    const extractIds = (code: string) =>
      (code.match(/data-dev-id="([0-9a-f]{6})"/g) || []).map(m => m.match(/"(.+)"/)![1]);
    expect(extractIds(compact)).toEqual(extractIds(formatted));
  });

  it('produces different IDs for elements at different structural positions', () => {
    const output = transform('<div><p>First</p><p>Second</p></div>');
    const ids = (output.match(/data-dev-id="([0-9a-f]{6})"/g) || []).map(m => m.match(/"(.+)"/)![1]);
    // div, p#0, p#1 — all different
    expect(new Set(ids).size).toBe(3);
  });

  it('produces different IDs when structure changes (new wrapper)', () => {
    const before = transform('<section><h1>Title</h1></section>');
    const after = transform('<section><div><h1>Title</h1></div></section>');
    const extractH1Id = (code: string) => {
      const match = code.match(/data-dev-id="([0-9a-f]{6})"[^>]*>\s*Title/);
      return match?.[1];
    };
    expect(extractH1Id(before)).not.toBe(extractH1Id(after));
  });

  it('does not inject data-dev-id in excluded paths', () => {
    const output = transform('<p>Hello</p>', '/app/src/components/ui/button.tsx');
    expect(output).not.toContain('data-dev-id');
  });

  it('includes component names in structural path', () => {
    const withComp = transform('<Layout><Hero><h1>Hi</h1></Hero></Layout>');
    const withDiv = transform('<Layout><div><h1>Hi</h1></div></Layout>');
    const extractH1Id = (code: string) => {
      const match = code.match(/data-dev-id="([0-9a-f]{6})"[^>]*>\s*Hi/);
      return match?.[1];
    };
    // Different ancestor (Hero vs div) → different ID
    expect(extractH1Id(withComp)).not.toBe(extractH1Id(withDiv));
  });

  it('handles member-expression tags (motion.h1)', () => {
    const output = transform('<motion.div><motion.h1>Title</motion.h1></motion.div>');
    expect(output).toContain('data-dev-id=');
    const ids = (output.match(/data-dev-id="([0-9a-f]{6})"/g) || []).map(m => m.match(/"(.+)"/)![1]);
    expect(new Set(ids).size).toBe(2);
  });

  it('does not duplicate data-dev-id when data-dev-file already present', () => {
    const output = transform('<p data-dev-file="/test" data-dev-line={1}>text</p>');
    expect(output.match(/data-dev-id/g)).toBeNull();
  });

  it('produces different IDs for cousin elements with identical tag paths', () => {
    // Two <h1> elements nested inside sibling <div> parents — previously collided
    // because ancestor chain only used tag names without sibling indices
    const output = transform(`
      <section>
        <div><h1>First</h1></div>
        <div><h1>Second</h1></div>
      </section>
    `);
    const ids = (output.match(/data-dev-id="([0-9a-f]{6})"/g) || []).map(m => m.match(/"(.+)"/)![1]);
    // section, div#0, h1(in div#0), div#1, h1(in div#1) — 5 elements, all unique
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('produces different IDs for deeply nested cousins', () => {
    // Same structure repeated at depth — ensures ancestor indices propagate
    const output = transform(`
      <main>
        <section><div><p>A</p></div></section>
        <section><div><p>B</p></div></section>
      </main>
    `);
    const devIdPattern = /data-dev-id="([0-9a-f]{6})"[^>]*>[^<]*(A|B)/g;
    const ids = new Map<string, string>();
    let m: RegExpExecArray | null;
    while ((m = devIdPattern.exec(output)) !== null) { ids.set(m[2], m[1]); }
    expect(ids.get('A')).not.toBe(ids.get('B'));
  });

  it('loop-rendered elements share dev-id AND dev-line; cousin collisions differ on dev-line', () => {
    // .map() elements: single source <li> → one dev-id + one dev-line in output
    const mapOutput = transform(`
      <ul>
        {items.map(item => <li key={item.id}>{item.name}</li>)}
      </ul>
    `);
    // The <li> appears once in source with a single dev-line — verify it has both attributes
    // Note: source-mapper outputs dev-line as JSX expression {N} not string "N"
    const liDevLine = mapOutput.match(/<li[^>]*data-dev-line=\{(\d+)\}/)?.[1];
    const liDevId = mapOutput.match(/<li[^>]*data-dev-id="([0-9a-f]{6})"/)?.[1];
    expect(liDevLine).toBeDefined();
    expect(liDevId).toBeDefined();

    // Cousin elements: different source lines → dev-lines differ
    const cousinOutput = transform(`
      <section>
        <div><h1>First</h1></div>
        <div><h1>Second</h1></div>
      </section>
    `);
    // Extract dev-line for each h1 (source-mapper outputs dev-line as JSX expression {N})
    const firstH1Line = cousinOutput.match(/<h1[^>]*data-dev-line=\{(\d+)\}[^>]*>First/)?.[1];
    const secondH1Line = cousinOutput.match(/<h1[^>]*data-dev-line=\{(\d+)\}[^>]*>Second/)?.[1];
    expect(firstH1Line).toBeDefined();
    expect(secondH1Line).toBeDefined();
    // Different source lines — UI uses this to distinguish from loop-rendering
    expect(firstH1Line).not.toBe(secondH1Line);
  });
});
