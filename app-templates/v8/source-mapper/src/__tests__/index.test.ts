import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { transformSync } from '@babel/core';
import { afterEach, describe, it, expect, vi } from 'vitest';
import jsxSourceMapper from '../index.js';
import { isFormatBoundTextRuntimeAvailable } from '../format-bound-text.js';

const tempRoots: string[] = [];

function transform(
  code: string,
  filename = '/app/src/pages/index.tsx',
  pluginOptions: Record<string, unknown> = { formatBoundTextRuntime: true },
) {
  const result = transformSync(code, {
    filename,
    parserOpts: { plugins: ['jsx'] },
    plugins: [[jsxSourceMapper, pluginOptions]],
    configFile: false,
    babelrc: false,
  });
  if (result === null || result.code == null) {
    throw new Error('transformSync returned null');
  }
  return result.code;
}

function createTempRoot(): string {
  const root = join(tmpdir(), `source-mapper-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

function write(root: string, file: string, content = ''): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function seedFormatBoundTextRuntime(root: string): void {
  write(root, 'format-overrides-plugin.ts');
  write(root, 'src/components/FormattedBoundText.tsx');
  write(root, 'src/lib/format-overrides.ts');
  write(root, 'src/lib/format-overrides-store.ts');
  write(root, 'vite.config.ts', 'import { formatOverridesPlugin } from "./format-overrides-plugin";\n');
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

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

describe('jsxSourceMapper — structural {children} passthrough is not dynamic', () => {
  it('should NOT mark a layout wrapper with {children}', () => {
    const output = transform('<div className="min-h-screen">{children}</div>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should NOT mark a <main> wrapper with {children}', () => {
    const output = transform('<main>{children}</main>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should NOT mark a wrapper with {props.children}', () => {
    const output = transform('<div>{props.children}</div>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should NOT mark a wrapper with {this.props.children}', () => {
    const output = transform('<div>{this.props.children}</div>');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('should still mark a wrapper mixing {children} with a real dynamic child', () => {
    const output = transform('<div>{children}{badge}</div>');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('should still mark a static-text element next to a variable expression', () => {
    const output = transform('<p>Hello {name}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
  });
});

describe('jsxSourceMapper — Commerce component ownership', () => {
  it('wraps imported Commerce product components in a Commerce-owned dev marker', () => {
    const output = transform(`
      import { ProductDetails } from '@godaddy/react';
      export default () => <ProductDetails productId="sku-group-1" />;
    `);

    expect(output).toContain('data-dev-source-origin="commerce"');
    expect(output).toContain('data-dev-commerce-component="ProductDetails"');
    expect(output).toContain('display: "contents"');
  });

  it('tags legacy direct-DOM Commerce fields when they read Commerce data', () => {
    const output = transform(`
      import { getPrimaryImageUrl } from '../lib/commerce/catalog-subgraph';
      export default function ProductCard({ skuGroup }) {
        return (
          <article>
            <img src={getPrimaryImageUrl(skuGroup) ?? ''} alt={skuGroup.label ?? ''} />
            <h2>{skuGroup.label}</h2>
            <p>{skuGroup.description}</p>
          </article>
        );
      }
    `);

    expect(output.match(/data-dev-source-origin="commerce"/g)).toHaveLength(3);
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

  it('emits a template key for a nested .map (map over a map-item field)', () => {
    // Mirrors a real menu page: categories.map → cat.items.map → {item.price}.
    // The inner map iterates `cat.items`, where `cat` is the OUTER map's param,
    // so the inner field must resolve through the parent frame.
    const output = transform(`
      import { menu } from 'virtual:content';
      export default () => (
        <div>{menu.categories.map((cat) => (
          <section>{cat.items.map((item) => <span>{item.price}</span>)}</section>
        ))}</div>
      );
    `);
    expect(output).toContain('data-dev-content-key-template="menu.categories[].items[].price"');
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

  it('attributes a numeric computed member access in canonical bracket form', () => {
    const output = transform(`
      import { site } from 'virtual:content';
      export default () => <p>{site.nav[0].label}</p>;
    `);
    expect(output).toContain('data-dev-content-key="site.nav[0].label"');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('falls through for a non-numeric computed member access', () => {
    const output = transform(`
      import { site } from 'virtual:content';
      export default function Nav({ i }) {
        return <p>{site.nav[i].label}</p>;
      }
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

  it('resolves a nested .map() over a map-param field to a deep template key', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>{products.map((p) => <li>{p.tags.map((tag) => <span>{tag.name}</span>)}</li>)}</ul>
      );
    `);
    // Nested collections are attributable: the inner map (p.tags) resolves
    // through its parent frame (p → products), so tag.name becomes a two-level
    // template key. (Previously a documented v1 limitation; now lifted.)
    expect(output).toContain('data-dev-content-key-template="products[].tags[].name"');
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

describe('jsxSourceMapper — multi-field collection item (canonical S3 pattern)', () => {
  // The canonical pattern the agent emits: ContentListContext wrapping a .map()
  // with name / description / price fields. This locks attribution for every
  // field and guards against regressions in the pre-pass mixed-child wrap path
  // (price has a literal "$" sibling → triggers wrap instead of direct attribution).

  it('attributes all three fields of a multi-field map item', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>
          {products.map((p) => (
            <article key={p.id}>
              <h3>{p.name}</h3>
              <p>{p.description}</p>
              <span>$\{p.price}</span>
            </article>
          ))}
        </ul>
      );
    `);
    // name and description: sole expression children → direct attribution on the element
    expect(output).toContain('data-dev-content-key-template="products[].name"');
    expect(output).toContain('data-dev-content-key-template="products[].description"');
    // price: mixed "$" text + expression → pre-pass wraps the expression in a span
    expect(output).toContain('data-dev-content-key-template="products[].price"');
    // No plain content-key should leak for any products field (all are template keys inside a map).
    expect(output).not.toMatch(/data-dev-content-key="products\./);
  });

  it('price field with literal-dollar prefix gets a wrapper span, not direct outer-span attribution', () => {
    // <span>${p.price}</span> has two children (JSXText "$" + JSXExpressionContainer).
    // The pre-pass wraps {p.price} in a new <span data-dev-content-key-template="products[].price">.
    // The outer <span> itself must NOT carry data-dev-content-key-template directly.
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>
          {products.map((p) => (
            <span>$\{p.price}</span>
          ))}
        </ul>
      );
    `);
    expect(output).toContain('data-dev-content-key-template="products[].price"');
    // The wrapper span with the template key should appear as a child, not on the
    // outermost <span> that also holds the literal "$" text node.
    // We verify by checking there is exactly one template key attribution in the output.
    expect((output.match(/data-dev-content-key-template="products\[\]\.price"/g) ?? []).length).toBe(1);
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

describe('jsxSourceMapper — bound text format overrides', () => {
  it('does not instrument the format override runtime component', () => {
    const output = transform(`
      export function FormattedBoundText({ children }) {
        return <span data-airo-formatted-bound-text="true">{children}</span>;
      }
    `, '/app/src/components/FormattedBoundText.tsx');

    expect(output).not.toContain('import { FormattedBoundText } from "@/components/FormattedBoundText";');
    expect(output).not.toContain('data-dev-bound-text');
    expect(output).not.toContain('data-dev-id');
  });

  it('wraps eligible generic bound text with FormattedBoundText', () => {
    const output = transform(`
      const user = { name: 'Ada' };
      export default () => <h1>{user.name}</h1>;
    `);

    expect(output).toContain('import { FormattedBoundText } from "@/components/FormattedBoundText";');
    expect(output).toContain('data-dev-bound-text="true"');
    expect(output).toContain('data-dev-bound-source-kind="bound-expression"');
    expect(output).toContain('data-dev-bound-expression-hash="sha256:');
    expect(output).toContain('<FormattedBoundText');
    expect(output).toContain('devId=');
    expect(output).toContain('sourceKind: "bound-expression"');
    expect(output).toContain('{user.name}');
  });

  it('wraps eligible motion text elements with FormattedBoundText', () => {
    const output = transform(`
      const user = { name: 'Ada' };
      export default () => <motion.h1>{user.name}</motion.h1>;
    `);

    expect(output).toContain('import { FormattedBoundText } from "@/components/FormattedBoundText";');
    expect(output).toContain('data-dev-bound-text="true"');
    expect(output).toContain('data-dev-bound-source-kind="bound-expression"');
    expect(output).toContain('<FormattedBoundText');
    expect(output).toContain('tagName: "h1"');
  });

  it('does not emit FormattedBoundText imports when the runtime files are absent', () => {
    const root = createTempRoot();
    const output = transform(
      `
        const user = { name: 'Ada' };
        export default () => <h1>{user.name}</h1>;
      `,
      join(root, 'src/pages/index.tsx'),
      {},
    );

    expect(output).not.toContain('import { FormattedBoundText } from "@/components/FormattedBoundText";');
    expect(output).not.toContain('<FormattedBoundText');
    expect(output).toContain('data-dev-dynamic="true"');
  });

  it('emits FormattedBoundText wrappers when the runtime and Vite plugin are installed', () => {
    const root = createTempRoot();
    seedFormatBoundTextRuntime(root);

    const output = transform(
      `
        const user = { name: 'Ada' };
        export default () => <h1>{user.name}</h1>;
      `,
      join(root, 'src/pages/index.tsx'),
      {},
    );

    expect(output).toContain('import { FormattedBoundText } from "@/components/FormattedBoundText";');
    expect(output).toContain('<FormattedBoundText');
  });

  it('warns and skips format wrapping when the Vite config cannot be read', () => {
    const root = createTempRoot();
    write(root, 'format-overrides-plugin.ts');
    write(root, 'src/components/FormattedBoundText.tsx');
    write(root, 'src/lib/format-overrides.ts');
    write(root, 'src/lib/format-overrides-store.ts');
    mkdirSync(join(root, 'vite.config.ts'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(isFormatBoundTextRuntimeAvailable(join(root, 'src/pages/index.tsx'))).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      '[source-mapper] Unable to read Vite config while checking format override runtime',
      expect.objectContaining({ configFile: join(root, 'vite.config.ts') }),
    );
  });

  it('does not infer runtime availability from cwd when the filename has no src segment', () => {
    const root = createTempRoot();
    seedFormatBoundTextRuntime(root);
    const originalCwd = process.cwd();

    try {
      process.chdir(root);
      expect(isFormatBoundTextRuntimeAvailable(join(root, 'pages/index.tsx'))).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('uses content-key guards for recognized virtual content fields', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => <h1>{home.hero.title}</h1>;
    `);

    expect(output).toContain('data-dev-content-key="home.hero.title"');
    expect(output).toContain('data-dev-bound-source-kind="content-key"');
    expect(output).toContain('contentKey: "home.hero.title"');
    expect(output).toContain('expressionHash: null');
  });

  it('does not wrap loop-rendered content-template expressions in v1', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => <ul>{products.map((p) => <li>{p.name}</li>)}</ul>;
    `);

    expect(output).toContain('data-dev-content-key-template="products[].name"');
    expect(output).not.toContain('data-dev-bound-text="true"');
    expect(output).not.toContain('<FormattedBoundText');
  });

  it('does not wrap generic expressions inside non-content .map() output in v1', () => {
    const output = transform(`
      const items = [{ name: 'Ada' }];
      export default () => <ul>{items.map((item) => <li>{item.name}</li>)}</ul>;
    `);

    expect(output).not.toContain('data-dev-bound-text="true"');
    expect(output).not.toContain('<FormattedBoundText');
  });

  it('does not wrap unsupported tags or mixed children', () => {
    const unsupported = transform(`const user = { name: 'Ada' }; export default () => <button>{user.name}</button>;`);
    const mixed = transform(`const user = { name: 'Ada' }; export default () => <h1>Hello {user.name}</h1>;`);

    expect(unsupported).not.toContain('<FormattedBoundText');
    expect(mixed).not.toContain('<FormattedBoundText');
  });

  it('does not wrap direct JSX or fragment expression children', () => {
    const elementExpression = transform(`export default () => <h1>{<span>Ada</span>}</h1>;`);
    const fragmentExpression = transform(`export default () => <h1>{<>Ada</>}</h1>;`);

    expect(elementExpression).not.toContain('<FormattedBoundText');
    expect(fragmentExpression).not.toContain('<FormattedBoundText');
  });

  it('injects the wrapper in production while omitting dev-only data attributes', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const output = transform(`
        const user = { name: 'Ada' };
        export default () => <h1>{user.name}</h1>;
      `);

      expect(output).toContain('<FormattedBoundText');
      expect(output).not.toContain('data-dev-bound-text');
      expect(output).not.toContain('data-dev-id');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('does not double-wrap already wrapped bound text', () => {
    const first = transform(`const user = { name: 'Ada' }; export default () => <h1>{user.name}</h1>;`);
    const second = transform(first);

    expect((second.match(/<FormattedBoundText/g) ?? []).length).toBe(1);
  });
});

describe('jsxSourceMapper — per-item list instrumentation (gap 2b)', () => {
  // Single-level content map: must inject data-dev-content-list + index attrs
  // and synthesize an index param when the callback has none.
  it('single-level map: injects data-dev-content-list and data-dev-content-list-index on the item element', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>{products.map((p) => <div>{p.name}</div>)}</ul>
      );
    `);
    expect(output).toContain('data-dev-content-list="products"');
    expect(output).toContain('data-dev-content-list-index={');
  });

  it('single-level map: callback gains an index param when none was provided', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>{products.map((p) => <div>{p.name}</div>)}</ul>
      );
    `);
    // The arrow callback should have a second param injected; the expression
    // container for the index attr should reference that same identifier.
    // Arrow with 2 params: "(p, _airoIdx) =>"
    expect(output).toMatch(/\(p,\s*\w+\)\s*=>/);
  });

  // Nested map: both levels must carry correct template-form pathBase values.
  it('nested map: emits data-dev-content-list for both outer and inner levels', () => {
    const output = transform(`
      import { menu } from 'virtual:content';
      export default () => (
        <div>{menu.categories.map((cat) => (
          <section>{cat.items.map((item) => <div><span>{item.price}</span></div>)}</section>
        ))}</div>
      );
    `);
    // Outer item (section) gets the outer frame's pathBase
    expect(output).toContain('data-dev-content-list="menu.categories"');
    // Inner item (div) gets the inner frame's pathBase (template-form)
    expect(output).toContain('data-dev-content-list="menu.categories[].items"');
    // Both carry index attrs
    expect(output.match(/data-dev-content-list-index=\{/g)?.length).toBeGreaterThanOrEqual(2);
  });

  // Existing index param reuse: callback already has (item, i) => — must reuse i, not add another.
  it('reuses existing index param when callback already declares one', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>{products.map((p, i) => <div>{p.name}</div>)}</ul>
      );
    `);
    expect(output).toContain('data-dev-content-list="products"');
    // The index expression should reference "i"
    expect(output).toContain('data-dev-content-list-index={i}');
    // Callback still has exactly two params — no duplication
    expect(output).toMatch(/\(p,\s*i\)\s*=>/);
  });

  // Block-body callback must also get injection.
  it('block-body callback: injects list attrs on the returned element', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>{products.map((p) => { return <div>{p.name}</div>; })}</ul>
      );
    `);
    expect(output).toContain('data-dev-content-list="products"');
    expect(output).toContain('data-dev-content-list-index={');
  });

  // Non-content map must NOT get list instrumentation.
  it('non-content map: does NOT inject list attributes', () => {
    const output = transform(`
      export default () => (
        <ul>{[1, 2, 3].map((n) => <li>{n}</li>)}</ul>
      );
    `);
    expect(output).not.toContain('data-dev-content-list');
    expect(output).not.toContain('data-dev-content-list-index');
  });

  // 3-level nested map: all three list-field attrs + leaf template key + distinct index params.
  it('3-level nested map: injects list attrs for all three levels with distinct index params', () => {
    const output = transform(`
      import { a } from 'virtual:content';
      export default () => (
        <div>{a.b.map(x => (
          <section>{x.c.map(y => (
            <article>{y.d.map(z => (
              <div><span>{z.e}</span></div>
            ))}</article>
          ))}</section>
        ))}</div>
      );
    `);
    // All three list-field data attrs must be present
    expect(output).toContain('data-dev-content-list="a.b"');
    expect(output).toContain('data-dev-content-list="a.b[].c"');
    expect(output).toContain('data-dev-content-list="a.b[].c[].d"');
    // Leaf template key must reach the 4th level
    expect(output).toContain('data-dev-content-key-template="a.b[].c[].d[].e"');
    // Three distinct index attrs must be injected (one per level)
    expect((output.match(/data-dev-content-list-index=\{/g) ?? []).length).toBe(3);
    // The injected index param names must be distinct — source-mapper uses _airoIdx, _airoIdx2, _airoIdx3
    expect(output).toContain('_airoIdx}');
    expect(output).toContain('_airoIdx2}');
    expect(output).toContain('_airoIdx3}');
  });

  // Double-emit guard: element already carrying data-dev-content-list must NOT receive a second one.
  it('double-emit guard: does not add a second data-dev-content-list when one is already present', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => <div>{products.map(p => <div data-dev-content-list="manual">{p.name}</div>)}</div>;
    `);
    // Original manual value must be preserved
    expect(output).toContain('data-dev-content-list="manual"');
    // Plugin must NOT inject the computed "products" value on top of an existing attr
    expect(output).not.toContain('data-dev-content-list="products"');
  });

  // Bail-out contract paths (skip injection without side effects).

  it('destructuring 2nd param: skips injection and synthesizes no index param', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => <ul>{products.map((p, [i]) => <li>{p.name}</li>)}</ul>;
    `);
    // Can't reference a destructured 2nd param by name → no list instrumentation...
    expect(output).not.toContain('data-dev-content-list');
    expect(output).not.toContain('data-dev-content-list-index');
    // ...and no orphaned index param is synthesized.
    expect(output).not.toContain('_airoIdx');
  });

  it('fragment root: no injection and no orphaned index param', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => <div>{products.map((p) => <>{p.name}</>)}</div>;
    `);
    // A fragment has nothing to tag — must not inject, and must not synthesize a
    // param that would never be referenced (the rootless-map guard).
    expect(output).not.toContain('data-dev-content-list');
    expect(output).not.toContain('_airoIdx');
  });

  it('conditional root: instruments both ternary branches', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => <ul>{products.map((p) => p.featured ? <li>{p.name}</li> : <div>{p.name}</div>)}</ul>;
    `);
    expect((output.match(/data-dev-content-list="products"/g) ?? []).length).toBe(2);
    expect(output).toContain('data-dev-content-list-index={');
  });

  it('block-body with a guard return: instruments the JSX return, ignores the null return', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => <ul>{products.map((p) => { if (!p) return null; return <li>{p.name}</li>; })}</ul>;
    `);
    expect(output).toContain('data-dev-content-list="products"');
    expect(output).toContain('data-dev-content-list-index={');
  });

  it('injects data-dev-item-id from an identifier map param', () => {
    const out = transform(`
      import { home } from 'virtual:content';
      export default () => <>{home.items.map((item) => <div>{item.name}</div>)}</>;
    `);
    expect(out).toContain('data-dev-item-id={item.id}');
  });

  it('does not instrument a .map with a destructured param (analyzeMapCall gates it upstream)', () => {
    // When the first param is destructured ({name}), analyzeMapCall returns null
    // at its `if (!t.isIdentifier(first)) return null;` guard, so the map frame
    // is never created and injectListAttrs never runs. The whole .map is uninstrumented.
    // This proves the guard works: no frame → no list attrs → no item-id.
    const out = transform(`
      import { home } from 'virtual:content';
      export default () => <>{home.items.map(({name}) => <div>{name}</div>)}</>;
    `);
    expect(out).not.toContain('data-dev-item-id');
    expect(out).not.toContain('data-dev-content-list');
  });
});

describe('jsxSourceMapper — indexed and derived content keys', () => {
  it('attributes a direct indexed array access in canonical bracket form', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => <span>{home.about.stats[0].value}</span>;
    `);
    expect(output).toContain('data-dev-content-key="home.about.stats[0].value"');
    expect(output).not.toContain('data-dev-dynamic');
    expect(output).not.toContain('data-dev-content-derived');
  });

  it('attributes a value derived through a single-arg call (destructured)', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default function StatCounter0() {
        const { display } = useCounter(home.about.stats[0].value);
        return <span ref={ref}>{display}</span>;
      }
    `);
    expect(output).toContain('data-dev-content-key="home.about.stats[0].value"');
    expect(output).toContain('data-dev-content-derived="true"');
    expect(output).not.toContain('data-dev-dynamic');
    expect(output).not.toContain('data-dev-bound-source-kind');
    expect(output).not.toContain('FormattedBoundText');
  });

  it('attributes a value derived through a single-arg call (non-destructured scalar)', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default function Title() {
        const x = animate(home.hero.title);
        return <h1>{x}</h1>;
      }
    `);
    expect(output).toContain('data-dev-content-key="home.hero.title"');
    expect(output).toContain('data-dev-content-derived="true"');
    expect(output).not.toContain('data-dev-dynamic');
  });

  it('does not attribute when multiple args resolve to content keys (ambiguous)', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default function Combined() {
        const x = combine(home.a.b, home.c.d);
        return <span>{x}</span>;
      }
    `);
    expect(output).toContain('data-dev-dynamic="true"');
    expect(output).not.toContain('data-dev-content-key');
    expect(output).not.toContain('data-dev-content-derived');
  });

  it('attributes a multi-arg call with exactly one content arg (e.g. useCountUp(key, duration, started))', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default function Counter() {
        const count = useCountUp(home.about.stats[0].value, 2000, true);
        return <span>{count}</span>;
      }
    `);
    expect(output).toContain('data-dev-content-key="home.about.stats[0].value"');
    expect(output).toContain('data-dev-content-derived="true"');
    expect(output).not.toContain('data-dev-dynamic="true"');
  });

  it('does not attribute a value derived through a call with no content arg', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default function Counter() {
        const x = useState(0);
        return <span>{x}</span>;
      }
    `);
    expect(output).toContain('data-dev-dynamic="true"');
    expect(output).not.toContain('data-dev-content-key');
    expect(output).not.toContain('data-dev-content-derived');
  });

  it('does not attribute a non-numeric computed index', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default function List({ i }) {
        return <span>{home.items[i].name}</span>;
      }
    `);
    expect(output).toContain('data-dev-dynamic="true"');
    expect(output).not.toContain('data-dev-content-key');
    expect(output).not.toContain('data-dev-content-derived');
  });

  it('leaves a plain content key byte-identical (no derived attr)', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => <h2>{home.about.heading}</h2>;
    `);
    expect(output).toContain('data-dev-content-key="home.about.heading"');
    expect(output).not.toContain('data-dev-content-derived');
  });

  it('keeps mapped array template keys unchanged', () => {
    const output = transform(`
      import { products } from 'virtual:content';
      export default () => (
        <ul>{products.map((p) => <li>{p.name}</li>)}</ul>
      );
    `);
    expect(output).toContain('data-dev-content-key-template="products[].name"');
    expect(output).not.toContain('data-dev-content-derived');
  });
});

describe('jsxSourceMapper — data-dev-editable authoritative marker', () => {
  it('marks a static text element', () => {
    const output = transform('<h1>Hi</h1>');
    expect(output).toContain('data-dev-editable="text"');
  });

  it('marks a static element with inline-formatting children', () => {
    const output = transform('<h2>Static <strong>bold</strong></h2>');
    expect(output).toContain('data-dev-editable="text"');
  });

  it('does NOT mark an element with dynamic expression children', () => {
    const output = transform('<span>{prefix}{display}{suffix}</span>');
    expect(output).not.toContain('data-dev-editable');
  });

  it('does NOT mark an element with mixed static text and a dynamic expression', () => {
    const output = transform('<p>Label {x}</p>');
    expect(output).not.toContain('data-dev-editable');
  });

  it('does NOT mark a content-keyed element (content path owns it)', () => {
    const output = transform(`
      import { home } from 'virtual:content';
      export default () => <h2>{home.x}</h2>;
    `);
    expect(output).not.toContain('data-dev-editable');
    expect(output).toContain('data-dev-content-key="home.x"');
  });

  it('does NOT mark a data-dev-dynamic element', () => {
    const output = transform('<p>{product.price}</p>');
    expect(output).toContain('data-dev-dynamic="true"');
    expect(output).not.toContain('data-dev-editable');
  });

  it('does NOT mark a non-text container tag', () => {
    const output = transform('<div>Hi</div>');
    expect(output).not.toContain('data-dev-editable');
  });

  it('marks a static element whose only child is a static expression container', () => {
    const output = transform('<p>{"static string"}</p>');
    expect(output).toContain('data-dev-editable="text"');
  });

  // Regression guards: these shapes are editable today via the client's
  // hasOnlyText path — the marker MUST be emitted for them or clicking them
  // would silently go read-only with no test failing.
  it('marks a static <li> (list-item click path)', () => {
    const output = transform('<li>Item</li>');
    expect(output).toContain('data-dev-editable="text"');
  });

  it('marks a heading containing a <br/>', () => {
    const output = transform('<h1>Shop better.<br />Spend less.</h1>');
    expect(output).toContain('data-dev-editable="text"');
  });

  it('marks an element with a JSX whitespace expression among static text', () => {
    const output = transform("<h1>Hi{' '}there</h1>");
    expect(output).toContain('data-dev-editable="text"');
  });

  // Contract guards for the inline-child tag list — a future edit to the tag set
  // (here vs the client's hasOnlyText) breaks a test instead of silently going
  // read-only.
  it('marks a heading with a plain inline-format child', () => {
    const output = transform('<span>Hi</span>');
    expect(output).toContain('data-dev-editable="text"');
  });

  it('marks a heading whose only child is an <a>', () => {
    const output = transform('<h2>Read <a>more</a></h2>');
    expect(output).toContain('data-dev-editable="text"');
  });

  // Regression: motion.* inline wrappers must NOT lose the marker (server accepts
  // them; pre-fix they were disqualified as JSXMemberExpression children).
  it('marks a static heading with a motion.* inline-format child', () => {
    const output = transform('<h1>Shop <motion.span>smarter</motion.span></h1>');
    expect(output).toContain('data-dev-editable="text"');
  });

  it('does NOT mark a heading with a motion.* BLOCK child (not inline-format)', () => {
    const output = transform('<h1>Big <motion.div>block</motion.div></h1>');
    expect(output).not.toContain('data-dev-editable');
  });

  it('does NOT mark a heading with a custom-component child (unknown render)', () => {
    const output = transform('<h1>Text <Highlight>word</Highlight></h1>');
    expect(output).not.toContain('data-dev-editable');
  });
});

describe('jsxSourceMapper — data-dev-conformable-array heal hint', () => {
  it('marks a raw local-array .map item as conformable', () => {
    const code = `const stats = [{ value: 'DOJ', icon: Target }];
export default function P() { return <>{stats.map((s, i) => <div><span>{s.value}</span></div>)}</>; }`;
    const out = transform(code, 'src/pages/index.tsx');
    expect(out).toMatch(/data-dev-conformable-array="stats"/);
    expect(out).toMatch(/data-dev-conformable-page="src\/pages\/index\.tsx"/);
  });

  it('does NOT mark content-rooted maps (already attributed)', () => {
    const code = `import { home } from 'virtual:content';
export default function P() { return <>{home.stats.map((s, i) => <div><span>{s.value}</span></div>)}</>; }`;
    const out = transform(code, 'src/pages/index.tsx');
    expect(out).not.toMatch(/data-dev-conformable-array/);
    expect(out).toMatch(/data-dev-content-list/); // existing attribution still fires
  });

  it('does NOT mark a map over a non-array-literal local (e.g. API/derived)', () => {
    const code = `export default function P({ data }) { return <>{data.map((s, i) => <div>{s.value}</div>)}</>; }`;
    const out = transform(code, 'src/pages/index.tsx');
    expect(out).not.toMatch(/data-dev-conformable-array/);
  });

  it('strips absolute path prefix so data-dev-conformable-page is src-relative', () => {
    const code = `const items = [{ label: 'A' }];
export default function P() { return <>{items.map((x, i) => <div>{x.label}</div>)}</>; }`;
    const out = transform(code, '/workspace/myapp/src/pages/index.tsx');
    expect(out).toMatch(/data-dev-conformable-page="src\/pages\/index\.tsx"/);
  });

  it('does NOT mark children of a fragment-returning callback (unwrapToJsxElements skips JSXFragment)', () => {
    // collectCallbackRootElements → unwrapToJsxElements only handles JSXElement, not JSXFragment,
    // so a callback returning <><div/><span/></> yields no roots and nothing is marked.
    const code = `const cards = [{ label: 'A', desc: 'B' }];
export default function P() { return <>{cards.map((s) => <><div>{s.label}</div><span>{s.desc}</span></>)}</>; }`;
    const out: string = transform(code, 'src/pages/index.tsx');
    expect(out).not.toMatch(/data-dev-conformable-array/);
  });

  it('does NOT mark a map over an empty array literal (length guard)', () => {
    // isLocalObjectArray requires init.elements.length > 0, so empty arrays are excluded.
    const code = `const items = [];
export default function P() { return <>{items.map((x) => <div>{x.label}</div>)}</>; }`;
    const out: string = transform(code, 'src/pages/index.tsx');
    expect(out).not.toMatch(/data-dev-conformable-array/);
  });

  it('does NOT double-mark when data-dev-conformable-array is already present (hasAttr guard)', () => {
    // The hasAttr check skips elements that already carry the attribute, preventing duplication.
    const code = `const opts = [{ name: 'X' }];
export default function P() { return <>{opts.map((o) => <div data-dev-conformable-array="opts">{o.name}</div>)}</>; }`;
    const out: string = transform(code, 'src/pages/index.tsx');
    const occurrences: number = (out.match(/data-dev-conformable-array/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('stamps a stable conformable-id (declarator loc) on the item root', () => {
    const code = `const stats = [{ value: 'DOJ' }];\nexport default function P(){ return <>{stats.map((s,i)=><div><span>{s.value}</span></div>)}</>; }`;
    const out = transform(code, 'src/pages/index.tsx');
    // binding.path is the VariableDeclarator node (`stats = [...]`); `stats` starts at col 6 (after `const `)
    expect(out).toMatch(/data-dev-conformable-id="L1C6"/);
  });

  it('stamps distinct ids for two same-named function-local arrays', () => {
    const code = `export function A(){ const items=[{t:'a'}]; return items.map((s,i)=><span key={i}>{s.t}</span>); }\nexport function B(){ const items=[{t:'b'}]; return items.map((s,i)=><span key={i}>{s.t}</span>); }`;
    const out = transform(code, 'src/pages/x.tsx');
    const ids = [...out.matchAll(/data-dev-conformable-id="(L\d+C\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2); // two distinct declarator locs
  });
});
