import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkContentRules, checkContentRulesForFile, isDirectContentPath } from '../content-rules-lint.js';

async function mkApp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'airo-rules-lint-'));
}

async function writeSrc(root: string, rel: string, source: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, source, 'utf8');
}

describe('checkContentRules', () => {
  let appDir: string;

  beforeEach(async () => { appDir = await mkApp(); });
  afterEach(async () => { await fs.rm(appDir, { recursive: true, force: true }); });

  it('returns no violations for a compliant page', async () => {
    await writeSrc(appDir, 'src/pages/home.tsx', `
      import { home, products } from 'virtual:content';
      import { ContentListContext } from '@airo/content';

      export default function Home() {
        return (
          <section>
            <h1>{home.hero.title}</h1>
            <ContentListContext field="products">
              {products.map((p) => <div key={p.id}>{p.name}</div>)}
            </ContentListContext>
          </section>
        );
      }
    `);

    const violations = await checkContentRules(appDir);
    expect(violations).toEqual([]);
  });

  it('flags destructured content imports', async () => {
    await writeSrc(appDir, 'src/pages/bad.tsx', `
      import { home } from 'virtual:content';
      export default function Bad() {
        const { hero } = home;
        return <h1>{hero.title}</h1>;
      }
    `);
    const violations = await checkContentRules(appDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: 'destructured-content-import' });
  });

  it('flags components that import from virtual:content', async () => {
    await writeSrc(appDir, 'src/components/Hero.tsx', `
      import { home } from 'virtual:content';
      export function Hero() { return <h1>{home.hero.title}</h1>; }
    `);
    const violations = await checkContentRules(appDir);
    expect(violations.some((v) => v.rule === 'component-imports-content')).toBe(true);
  });

  it('flags .map over a content binding without ContentListContext', async () => {
    await writeSrc(appDir, 'src/pages/products.tsx', `
      import { products } from 'virtual:content';
      export default function Products() {
        return <ul>{products.map((p) => <li key={p.id}>{p.name}</li>)}</ul>;
      }
    `);
    const violations = await checkContentRules(appDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: 'map-without-list-context' });
  });

  it('ignores .map on a non-content binding', async () => {
    await writeSrc(appDir, 'src/pages/other.tsx', `
      const items = [{ id: 1, name: 'A' }];
      export default function Other() {
        return <ul>{items.map((p) => <li key={p.id}>{p.name}</li>)}</ul>;
      }
    `);
    const violations = await checkContentRules(appDir);
    expect(violations).toEqual([]);
  });

  it('surfaces multiple distinct violations across files', async () => {
    await writeSrc(appDir, 'src/pages/a.tsx', `
      import { home } from 'virtual:content';
      export default function A() { const { hero } = home; return <h1>{hero.title}</h1>; }
    `);
    await writeSrc(appDir, 'src/components/B.tsx', `
      import { site } from 'virtual:content';
      export function B() { return <span>{site.brand}</span>; }
    `);
    const violations = await checkContentRules(appDir);
    const rules = violations.map((v) => v.rule).sort();
    expect(rules).toEqual(['component-imports-content', 'destructured-content-import']);
  });

  it('ignores unparseable files', async () => {
    await writeSrc(appDir, 'src/pages/broken.tsx', `syntax error {{{`);
    const violations = await checkContentRules(appDir);
    expect(violations).toEqual([]);
  });
});

describe('missed-content-opportunity rule', () => {
  it('fires on a page with many inline text strings and no virtual:content import', () => {
    const source = `
      export default function Home() {
        return (
          <>
            <h1>Welcome to my taco truck</h1>
            <p>Authentic Mexican street food served fresh every day</p>
            <button>See Our Menu</button>
            <p>Serving Downtown Since 2019</p>
          </>
        );
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule: 'missed-content-opportunity',
      file: 'src/pages/index.tsx',
    });
    expect(violations[0]?.message).toMatch(/content_scaffold/);
  });

  it('does NOT fire when the page imports from virtual:content', () => {
    const source = `
      import { home } from 'virtual:content';
      export default function Home() {
        return (
          <>
            <h1>{home.hero.title}</h1>
            <p>{home.hero.subtitle}</p>
            <button>{home.hero.cta}</button>
          </>
        );
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations.filter((v) => v.rule === 'missed-content-opportunity')).toEqual([]);
  });

  it('does NOT fire on component files (components legitimately have inline labels)', () => {
    const source = `
      export function CloseButton() {
        return <button aria-label="Close">Close the dialog</button>;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/components/CloseButton.tsx');
    expect(violations.filter((v) => v.rule === 'missed-content-opportunity')).toEqual([]);
  });

  it('does NOT fire on a page with only short/structural strings', () => {
    const source = `
      export default function Page() {
        return <div><span>X</span><span>Y</span></div>;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/test.tsx');
    expect(violations.filter((v) => v.rule === 'missed-content-opportunity')).toEqual([]);
  });

  it('does NOT fire below the threshold (2 strings)', () => {
    const source = `
      export default function Page() {
        return (
          <>
            <h1>Title that is long enough</h1>
            <p>One more string of reasonable length</p>
          </>
        );
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/test.tsx');
    expect(violations.filter((v) => v.rule === 'missed-content-opportunity')).toEqual([]);
  });

  it('does NOT fire on framework pages (_404, _app, etc.) — they hold chrome copy, not content', () => {
    const source = `
      export default function NotFound() {
        return (
          <div>
            <h1>Page not found</h1>
            <p>The page you are looking for does not exist.</p>
            <button onClick={() => window.history.back()}>← Go Back</button>
          </div>
        );
      }
    `;
    expect(checkContentRulesForFile(source, 'src/pages/_404.tsx')).toEqual([]);
    expect(checkContentRulesForFile(source, 'src/pages/_app.tsx')).toEqual([]);
  });
});

describe('local-content-object rule', () => {
  it('fires on a page with a local content object used in JSX', () => {
    const source = `
      export const home = {
        hero: { line1: 'Always', line2: 'summer.', badge: 'By Kara' },
      };
      export default function Home() {
        return <h1>{home.hero.line1}</h1>;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations.some((v) => v.rule === 'local-content-object')).toBe(true);
    expect(violations[0]?.message).toMatch(/content_scaffold/);
  });

  it('fires on an export const content object used in JSX', () => {
    const source = `
      export const data = {
        title: 'Welcome Home', subtitle: 'Your journey starts here', cta: 'Get Started',
      };
      export default function Home() {
        return <h1>{data.title}</h1>;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations.some((v) => v.rule === 'local-content-object')).toBe(true);
  });

  it('fires on a function-scope content object used in JSX', () => {
    const source = `
      export default function Home() {
        const data = {
          title: 'Welcome Home', subtitle: 'Your journey starts here', cta: 'Get Started',
        };
        return <h1>{data.title}</h1>;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations.some((v) => v.rule === 'local-content-object')).toBe(true);
  });

  it('fires even when the page also imports from virtual:content', () => {
    const source = `
      import { home } from 'virtual:content';
      const fallback = { title: 'Default Title', sub: 'Default Sub', cta: 'Click me now' };
      export default function Home() {
        return <h1>{fallback.title}</h1>;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations.some((v) => v.rule === 'local-content-object')).toBe(true);
  });

  it('does NOT fire on component files', () => {
    const source = `
      const labels = { save: 'Save Changes', cancel: 'Cancel Edit', confirm: 'Are you sure?' };
      export function Dialog() { return <button>{labels.save}</button>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/components/Dialog.tsx');
    expect(violations.filter((v) => v.rule === 'local-content-object')).toEqual([]);
  });

  it('does NOT fire when the object has fewer than 3 string leaves', () => {
    const source = `
      const cfg = { title: 'Hello World', count: 42 };
      export default function Page() { return <h1>{cfg.title}</h1>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/test.tsx');
    expect(violations.filter((v) => v.rule === 'local-content-object')).toEqual([]);
  });

  it('fires with nested objects totaling 3+ string leaves', () => {
    const source = `
      const content = {
        hero: { title: 'Welcome Home', subtitle: 'Your journey starts here' },
        cta: { label: 'Get Started' },
      };
      export default function Page() { return <div>{content.hero.title}</div>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations.some((v) => v.rule === 'local-content-object')).toBe(true);
  });

  it('does NOT fire when the object is declared but not used in JSX', () => {
    const source = `
      const config = { api: '/api/data', timeout: 'thirty seconds', retry: 'three times' };
      export default function Page() { return <div>Static page</div>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/test.tsx');
    expect(violations.filter((v) => v.rule === 'local-content-object')).toEqual([]);
  });
});

describe('isDirectContentPath (path-segment matching)', () => {
  it('matches paths where content is a full segment', () => {
    for (const p of [
      '@/content',
      '@/content/home',
      './content',
      '../content/home',
      '../../content/site',
    ]) {
      expect(isDirectContentPath(p)).toBe(true);
    }
  });

  it('does NOT match paths where content is only a substring of a segment', () => {
    for (const p of [
      '../utils/sanitize-content',
      './bio-content-helpers',
      '@/contentful',
      '@/components/x',
    ]) {
      expect(isDirectContentPath(p)).toBe(false);
    }
  });
});

describe('direct-content-import rule', () => {
  it('fires on import from @/content in a page file', () => {
    const source = `
      import { home } from '@/content';
      export default function Home() { return <h1>{home.hero.title}</h1>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations.some((v) => v.rule === 'direct-content-import')).toBe(true);
  });

  it('fires on import from ../content in a page file', () => {
    const source = `
      import { home } from '../content';
      export default function Home() { return <h1>{home.hero.title}</h1>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations.some((v) => v.rule === 'direct-content-import')).toBe(true);
  });

  it('fires on import from ../content/index in a page file', () => {
    const source = `
      import { home } from '../content/index';
      export default function Home() { return <h1>{home.hero.title}</h1>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations.some((v) => v.rule === 'direct-content-import')).toBe(true);
  });

  it('does NOT fire on import from virtual:content', () => {
    const source = `
      import { home } from 'virtual:content';
      export default function Home() { return <h1>{home.hero.title}</h1>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations.filter((v) => v.rule === 'direct-content-import')).toEqual([]);
  });

  it('fires on component files too (Vite resolveId blocks at build time)', () => {
    const source = `
      import { home } from '@/content';
      export function Hero() { return <h1>{home.hero.title}</h1>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/components/Hero.tsx');
    expect(violations.some((v) => v.rule === 'direct-content-import')).toBe(true);
  });

  it('message points at virtual:content as the fix', () => {
    const source = `
      import { home } from '@/content';
      export default function Home() { return <h1>{home.hero.title}</h1>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    const v = violations.find((v) => v.rule === 'direct-content-import');
    expect(v?.message).toMatch(/virtual:content/);
  });
});

describe('content-prop-drill rule', () => {
  it('flags a component receiving a content map param as a prop', () => {
    const source = `
      import { home } from 'virtual:content';
      import { ContentListContext } from '@airo/content';
      export default function Menu() {
        return (
          <ContentListContext field="categories">
            {home.menu.categories.map((cat) => (
              <MenuCategory key={cat.id} category={cat} />
            ))}
          </ContentListContext>
        );
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/menu.tsx');
    expect(violations.some((v) => v.rule === 'content-prop-drill')).toBe(true);
  });

  it('flags a nested map param drilled into a component (cat from categories, item from cat.items)', () => {
    const source = `
      import { home } from 'virtual:content';
      import { ContentListContext } from '@airo/content';
      export default function Menu() {
        return (
          <ContentListContext field="categories">
            {home.menu.categories.map((cat) =>
              cat.items.map((item) => (
                <MenuItem key={item.id} price={item.price} />
              ))
            )}
          </ContentListContext>
        );
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/menu.tsx');
    expect(violations.some((v) => v.rule === 'content-prop-drill')).toBe(true);
  });

  it('flags a direct virtual:content binding passed as a component prop', () => {
    const source = `
      import { products } from 'virtual:content';
      export default function Shop() {
        return <ProductGrid products={products} />;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/shop.tsx');
    expect(violations.some((v) => v.rule === 'content-prop-drill')).toBe(true);
  });

  it('flags a content value extracted to a local (IIFE) then drilled into a component', () => {
    // The "dodge": agents extract `const endVal = stat.value` before passing it,
    // believing it breaks the prop-drill detection. It does not change editability.
    const source = `
      import { home } from 'virtual:content';
      export default function Stats() {
        return (
          <div>
            {home.stats.items.map((stat) => {
              const endVal = stat.value;
              return <AnimatedCounter key={stat.id} endValue={endVal} />;
            })}
          </div>
        );
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/index.tsx');
    expect(violations.some((v) => v.rule === 'content-prop-drill')).toBe(true);
  });

  it('flags a direct content binding aliased to a local then drilled', () => {
    const source = `
      import { products } from 'virtual:content';
      export default function Shop() {
        const list = products;
        return <ProductGrid products={list} />;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/shop.tsx');
    expect(violations.some((v) => v.rule === 'content-prop-drill')).toBe(true);
  });

  it('does NOT flag a non-content local drilled into a component', () => {
    const source = `
      export default function Box() {
        const size = computeSize();
        return <Widget size={size} />;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/box.tsx');
    expect(violations.filter((v) => v.rule === 'content-prop-drill')).toEqual([]);
  });

  it('does NOT flag a non-content local reusing an alias name from another scope', () => {
    // `list` is a content alias in A, then a plain non-content local in B —
    // the second binding must shadow the first, not taint the name file-wide.
    const source = `
      import { products } from 'virtual:content';
      export function A() {
        const list = products;
        return <ProductGrid products={list} />;
      }
      export function B() {
        const list = computeThings();
        return <Other items={list} />;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/shop.tsx').filter(
      (v) => v.rule === 'content-prop-drill',
    );
    // A is still (correctly) flagged; B must not be.
    expect(violations).toHaveLength(1);
  });

  it('does NOT flag inline rendering of map params in page elements', () => {
    const source = `
      import { home } from 'virtual:content';
      import { ContentListContext } from '@airo/content';
      export default function Menu() {
        return (
          <ContentListContext field="categories">
            {home.menu.categories.map((cat) => (
              <div key={cat.id}>
                <span>{cat.name}</span>
              </div>
            ))}
          </ContentListContext>
        );
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/menu.tsx');
    expect(violations.filter((v) => v.rule === 'content-prop-drill')).toEqual([]);
  });

  it('does NOT flag content values passed as children (only JSX attributes are checked)', () => {
    const source = `
      import { home } from 'virtual:content';
      import { ContentListContext } from '@airo/content';
      export default function Menu() {
        return (
          <ContentListContext field="items">
            {home.items.map((item) => (
              <Card key={item.id}>
                <span>{item.price}</span>
              </Card>
            ))}
          </ContentListContext>
        );
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/menu.tsx');
    expect(violations.filter((v) => v.rule === 'content-prop-drill')).toEqual([]);
  });

  it('does NOT flag the key prop even when it is content-rooted', () => {
    const source = `
      import { home } from 'virtual:content';
      import { ContentListContext } from '@airo/content';
      export default function Menu() {
        return (
          <ContentListContext field="items">
            {home.items.map((item) => (
              <MenuItem key={item.id} />
            ))}
          </ContentListContext>
        );
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/menu.tsx');
    expect(violations.filter((v) => v.rule === 'content-prop-drill')).toEqual([]);
  });

  it('does NOT flag a non-content local variable passed as a prop', () => {
    const source = `
      const localVar = 'hello';
      export default function Page() {
        return <Foo bar={localVar} />;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/page.tsx');
    expect(violations.filter((v) => v.rule === 'content-prop-drill')).toEqual([]);
  });
});

describe('page/component root matching is a full path segment', () => {
  const pageWithLocalContent = `
    export const data = {
      title: 'Welcome Home', subtitle: 'Your journey starts here', cta: 'Get Started',
    };
    export default function Home() {
      return <h1>{data.title}</h1>;
    }
  `;

  it('treats src/pages/foo.tsx as a page (local-content-object fires)', () => {
    const violations = checkContentRulesForFile(pageWithLocalContent, 'src/pages/foo.tsx');
    expect(violations.some((v) => v.rule === 'local-content-object')).toBe(true);
  });

  it('does NOT treat src/pagesv2/foo.tsx as a page (page-only rules do not fire)', () => {
    const violations = checkContentRulesForFile(pageWithLocalContent, 'src/pagesv2/foo.tsx');
    expect(violations.filter((v) => v.rule === 'local-content-object')).toEqual([]);
    expect(violations.filter((v) => v.rule === 'missed-content-opportunity')).toEqual([]);
  });

  it('does NOT treat src/componentsv2/Foo.tsx as a component (component-imports-content does not fire)', () => {
    const source = `
      import { home } from 'virtual:content';
      export function Foo() { return <h1>{home.hero.title}</h1>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/componentsv2/Foo.tsx');
    expect(violations.filter((v) => v.rule === 'component-imports-content')).toEqual([]);
  });
});

describe('content-derived-array-map', () => {
  // helper: run the linter on a synthetic .tsx source string
  function lint(src: string): string[] {
    return checkContentRulesForFile(src, 'src/pages/index.tsx').map((v) => v.rule);
  }

  it('flags a content collection derived into a local then mapped with content leaves', () => {
    const src = `
      import { home } from 'virtual:content';
      export default function Page() {
        const activeItems = home.menu.categories.find((c) => c.id === 'x')?.items ?? [];
        return <div>{activeItems.map((item) => <span>{item.price}</span>)}</div>;
      }`;
    expect(lint(src)).toContain('content-derived-array-map');
  });

  it('does NOT flag a direct nested content chain map', () => {
    const src = `
      import { home } from 'virtual:content';
      export default function Page() {
        return <div>{home.menu.categories.map((cat) => (
          <div>{cat.items.map((item) => <span>{item.price}</span>)}</div>
        ))}</div>;
      }`;
    expect(lint(src)).not.toContain('content-derived-array-map');
  });

  it('does NOT flag a content-derived local that is not mapped', () => {
    const src = `
      import { home } from 'virtual:content';
      export default function Page() {
        const active = home.menu.categories.find((c) => c.id === 'x');
        return <h2>{active?.name}</h2>;
      }`;
    expect(lint(src)).not.toContain('content-derived-array-map');
  });

  it('does NOT flag a map over a non-content local array', () => {
    const src = `
      export default function Page() {
        const xs = [1, 2, 3];
        return <div>{xs.map((n) => <span>{n}</span>)}</div>;
      }`;
    expect(lint(src)).not.toContain('content-derived-array-map');
  });
});

describe('checkContentRulesForFile (single-file entry point)', () => {
  it('returns violations for the single file it was called with', () => {
    const source = `
      import { home } from 'virtual:content';
      export default function() {
        const { hero } = home;
        return <h1>{hero.title}</h1>;
      }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/home.tsx');
    expect(violations.some((v) => v.rule === 'destructured-content-import')).toBe(true);
  });

  it('returns empty for compliant single-file input', () => {
    const source = `
      import { home } from 'virtual:content';
      export default function() { return <h1>{home.title}</h1>; }
    `;
    const violations = checkContentRulesForFile(source, 'src/pages/home.tsx');
    expect(violations).toEqual([]);
  });
});
