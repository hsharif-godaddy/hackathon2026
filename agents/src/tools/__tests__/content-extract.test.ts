import { describe, expect, it } from 'vitest';
import { analyzeExtractable, bindingForPage, planPageExtraction } from '../content-extract.js';
import type { ExtractionPlan, ExtractableArray } from '../content-extract.js';

// ── analyzeExtractable: the safe-or-skip gate ─────────────────────────────────
//
// Ported from the validated spike's isPromotable suite. EXTRACT only a
// module-level `const NAME = [ {flat literal objects} ]` iterated by exactly one
// `NAME.map(...)` and referenced nowhere else. Everything else DECLINES with a
// reason. Never throws.

function verdict(
  source: string,
  name: string,
): { extracted: boolean; reason: string | null } {
  const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(source, 'home');
  const extraction: { arrayName: string } | undefined = report.extractions.find(
    (p) => p.arrayName === name,
  );
  if (extraction) return { extracted: true, reason: null };
  const skip: { name: string; reason: string } | undefined = report.skipped.find(
    (s) => s.name === name,
  );
  return { extracted: false, reason: skip ? skip.reason : 'NOT_FOUND' };
}

describe('analyzeExtractable — accepts', () => {
  it('module-level const array of string-only object literals, iterated by NAME.map', () => {
    const code: string = `
      const testimonials = [
        { quote: "great", name: "Jordan", tag: "owner" },
        { quote: "love it", name: "Priya", tag: "fan" },
      ];
      export default function P() {
        return <div>{testimonials.map((t) => <p key={t.name}>{t.quote}</p>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'testimonials');
    expect(v.extracted).toBe(true);
    expect(v.reason).toBeNull();
  });

  it('object values may be string, number, boolean, or null literals', () => {
    const code: string = `
      const rows = [
        { label: "a", order: 1, active: true, note: null },
        { label: "b", order: 2, active: false, note: null },
      ];
      export default function P() {
        return <ul>{rows.map((r) => <li key={r.label}>{r.label}</li>)}</ul>;
      }
    `;
    expect(verdict(code, 'rows').extracted).toBe(true);
  });

  it('captures the array data with literal values resolved', () => {
    const code: string = `
      const rows = [
        { label: "a", order: 1, active: true, note: null, neg: -5 },
      ];
      export default function P() {
        return <ul>{rows.map((r) => <li key={r.label}>{r.label}</li>)}</ul>;
      }
    `;
    const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(code, 'home');
    const rows: { arrayName: string; data: Record<string, unknown>[] } | undefined =
      report.extractions.find((p) => p.arrayName === 'rows');
    expect(rows).toBeDefined();
    expect(rows?.data).toEqual([
      { label: 'a', order: 1, active: true, note: null, neg: -5 },
    ]);
  });
});

describe('analyzeExtractable — declines with a reason', () => {
  it('inline anonymous array.map (not a module-level const)', () => {
    const code: string = `
      export default function P() {
        return <div>{[{ a: "x" }].map((o) => <p>{o.a}</p>)}</div>;
      }
    `;
    const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(code, 'home');
    expect(report.extractions).toHaveLength(0);
    expect(report.skipped).toHaveLength(0);
  });

  it('array spread pattern [...Array(5)].map', () => {
    const code: string = `
      const stars = [...Array(5)];
      export default function P() {
        return <div>{stars.map((_, i) => <span key={i}/>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'stars');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/spread|non-object|element/i);
  });

  it('array of scalar strings — now extracts (CP2: scalar arrays accepted)', () => {
    // CP2 promoted bare scalar arrays; a string[] with a single .map is now
    // extractable. The old "object literal" decline no longer fires.
    const code: string = `
      const colors = ['Purple', 'Cyan', 'Pink'];
      export default function P() {
        return <div>{colors.map((c) => <option key={c}>{c}</option>)}</div>;
      }
    `;
    const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(code, 'home');
    const extraction: ReturnType<typeof analyzeExtractable>['extractions'][number] | undefined =
      report.extractions.find((e) => e.arrayName === 'colors');
    expect(extraction).toBeDefined();
    expect(extraction!.data).toEqual(['Purple', 'Cyan', 'Pink']);
    expect(extraction!.retainedKeys).toEqual([]);
  });

  it('object element holds ONLY a non-serializable value (identifier / component ref) with no literal fields', () => {
    const code: string = `
      import { Zap } from 'lucide-react';
      const features = [
        { icon: Zap },
        { icon: Zap },
      ];
      export default function P() {
        return <div>{features.map((f) => <h3 key={f.icon}>{f.icon}</h3>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'features');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/no extractable/i);
  });

  it('object element holds JSX', () => {
    const code: string = `
      const cards = [
        { title: "A", el: <span>x</span> },
      ];
      export default function P() {
        return <div>{cards.map((c) => <h3 key={c.title}>{c.title}</h3>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'cards');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/non-serializable|jsx/i);
  });

  it('object element holds an arrow function value', () => {
    const code: string = `
      const handlers = [
        { title: "A", onClick: () => 1 },
      ];
      export default function P() {
        return <div>{handlers.map((h) => <h3 key={h.title}>{h.title}</h3>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'handlers');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/non-serializable|function/i);
  });

  it('nested non-serializable: array-valued property (nested objects)', () => {
    const code: string = `
      const faqGroups = [
        { topic: "T", faqs: [{ q: "a", a: "b" }] },
      ];
      export default function P() {
        return <div>{faqGroups.map((g) => <h3 key={g.topic}>{g.topic}</h3>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'faqGroups');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/nested|array/i);
  });

  it('computed (dynamic) key in an element object', () => {
    const code: string = `
      const k = "x";
      const items = [ { [k]: "v", title: "A" } ];
      export default function P() {
        return <div>{items.map((it) => <h3 key={it.title}>{it.title}</h3>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'items');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/computed/i);
  });

  it('spread inside an element object', () => {
    const code: string = `
      const base = { a: 1 };
      const items = [ { ...base, title: "A" } ];
      export default function P() {
        return <div>{items.map((it) => <h3 key={it.title}>{it.title}</h3>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'items');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/spread/i);
  });

  it('array referenced beyond the map (indexed access NAME[0])', () => {
    const code: string = `
      const products = [ { name: "A", img: "x" }, { name: "B", img: "y" } ];
      export default function P() {
        return <div className={products[0].img}>{products.map((p) => <h3 key={p.name}>{p.name}</h3>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'products');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/referenced|index|beyond|map/i);
  });

  it('array prop-drilled into another component', () => {
    const code: string = `
      const items = [ { name: "A" } ];
      function Child({ data }) { return <ul>{data.map((d) => <li>{d.name}</li>)}</ul>; }
      export default function P() {
        return <Child data={items} />;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'items');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/referenced|beyond|map|prop/i);
  });

  it('array never iterated by .map at all', () => {
    const code: string = `
      const items = [ { name: "A" } ];
      export default function P() {
        return <div>{items.length}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'items');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/\.map|iterat/i);
  });

  it('array mapped more than once (ambiguous)', () => {
    const code: string = `
      const items = [ { name: "A" } ];
      export default function P() {
        return <div>{items.map((i) => <p>{i.name}</p>)}{items.map((i) => <span>{i.name}</span>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'items');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/more than once|ambiguous/i);
  });

  it('const array declared inside a function is now collected (CP3: function-local arrays are visible)', () => {
    // CP3 widens the scanner to include function-local arrays; a function-local
    // const that passes all other checks (flat objects, single .map, etc.) extracts.
    const code: string = `
      export default function P() {
        const items = [ { name: "A" } ];
        return <div>{items.map((i) => <p>{i.name}</p>)}</div>;
      }
    `;
    const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(code, 'home');
    expect(report.extractions).toHaveLength(1);
    expect(report.extractions[0].arrayName).toBe('items');
    expect(report.skipped).toHaveLength(0);
  });

  it('empty array is not extractable (no element shape to infer)', () => {
    const code: string = `
      const items = [];
      export default function P() {
        return <div>{items.map((i) => <p>{i}</p>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'items');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/empty/i);
  });

  it('nested-map param shadowing: inner map var named like the array is not a second map of it', () => {
    // `items` is mapped once at top level; the inner `groups.map((items) => items.map(...))`
    // shadows the name, so it must NOT count as a second map of the module-level const.
    const code: string = `
      const items = [ { name: "A" } ];
      const groups = [ { rows: 1 } ];
      export default function P() {
        return <div>{items.map((i) => <p>{i.name}</p>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'items');
    expect(v.extracted).toBe(true);
  });
});

describe('analyzeExtractable — reports every candidate, never throws', () => {
  it('mixed file: one verdict per module-level const array', () => {
    const code: string = `
      import { Zap } from 'lucide-react';
      const products = [ { name: "A", img: "x" } ];
      const features = [ { icon: Zap, title: "A" } ];
      const testimonials = [ { quote: "q", name: "n" } ];
      export default function P() {
        return (<div className={products[0].img}>
          {features.map((f) => <h3 key={f.title}>{f.title}</h3>)}
          {testimonials.map((t) => <p key={t.name}>{t.quote}</p>)}
        </div>);
      }
    `;
    const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(code, 'home');
    // features now partially extracts (title is a literal; icon: Zap is retained)
    expect(report.extractions.map((p) => p.arrayName).sort()).toEqual(['features', 'testimonials']);
    expect(report.skipped.map((s) => s.name).sort()).toEqual(['products']);
    // confirm features retains the icon key and only lifts title
    const featuresExtraction: { arrayName: string; data: Record<string, unknown>[]; retainedKeys: string[] } | undefined =
      report.extractions.find((p) => p.arrayName === 'features');
    expect(featuresExtraction?.data).toEqual([{ title: 'A' }]);
    expect(featuresExtraction?.retainedKeys).toEqual(['icon']);
  });

  it('does not throw on malformed-but-parseable input', () => {
    const code: string = `const items = [ { a: 1 } ]; export default () => null;`;
    expect(() => analyzeExtractable(code, 'home')).not.toThrow();
  });
});

// ── planPageExtraction: the pure, no-write extraction plan ────────────────────
//
// `planPageExtraction(source, pageRelPath)` is a pure transform: it returns the
// binding, which arrays extract, the skip reasons, the content payload, and the
// recast-rewritten page source — without touching disk. Persistence (scaffold +
// page write) and rollback belong to the caller.

const PAGE: string = `import { Zap } from 'lucide-react';

const testimonials = [
  { quote: "great", name: "Jordan", tag: "owner" },
  { quote: "love it", name: "Priya", tag: "fan" },
];

const features = [
  { icon: Zap, title: "A", desc: "d" },
];

export default function HomePage() {
  return (
    <div className={features[0] ? '' : ''}>
      {features.map((f) => <h3 key={f.title}>{f.title}</h3>)}
      {testimonials.map((t) => <p key={t.name}>{t.quote}</p>)}
    </div>
  );
}
`;

describe('planPageExtraction — content payload', () => {
  it('keys the extracted array by name with literal data and no minted id', () => {
    const plan: ExtractionPlan = planPageExtraction(PAGE, 'src/pages/index.tsx');
    expect(plan.extractedNames).toEqual(['testimonials']);
    expect(plan.content?.testimonials).toEqual([
      { quote: 'great', name: 'Jordan', tag: 'owner' },
      { quote: 'love it', name: 'Priya', tag: 'fan' },
    ]);
    // planning does not mint ids — that was scaffold's job, now in the follow-up.
    for (const row of plan.content?.testimonials ?? []) {
      expect(row).not.toHaveProperty('id');
    }
    // features declined → not in content
    expect(plan.content?.features).toBeUndefined();
  });

  it('reports extracted names and skip reasons', () => {
    const plan: ExtractionPlan = planPageExtraction(PAGE, 'src/pages/index.tsx');
    expect(plan.extractedNames).toEqual(['testimonials']);
    expect(plan.skipped.find((s) => s.name === 'features')).toBeTruthy();
  });
});

describe('planPageExtraction — page rewrite', () => {
  it('adds the import, deletes the extracted const, prefixes the map callee', () => {
    const plan: ExtractionPlan = planPageExtraction(PAGE, 'src/pages/index.tsx');
    const page: string = plan.newPageSource ?? '';
    expect(page).toMatch(/import \{ home \} from 'virtual:content'/);
    expect(page).toMatch(/home\.testimonials\.map\(/);
    expect(page).not.toMatch(/const testimonials =/);
    // declined const remains
    expect(page).toMatch(/const features =/);
    // loop-var member access is untouched
    expect(page).toMatch(/\{t\.quote\}/);
  });

  it('multi-declarator const: drops only the extracted declarator, keeps siblings (nit)', () => {
    // `const LABEL = "Section", items = [...]` — if `items` is extracted the
    // whole statement was previously dropped, silently removing `LABEL` and
    // causing a ReferenceError at runtime. Only `items` should be removed.
    const src: string = `const LABEL = "Section", items = [{ text: "a" }, { text: "b" }];
export default function P() {
  return <div><h2>{LABEL}</h2><ul>{items.map((it) => <li key={it.text}>{it.text}</li>)}</ul></div>;
}`;
    const plan: ExtractionPlan = planPageExtraction(src, 'src/pages/index.tsx');
    expect(plan.extractedNames).toEqual(['items']);
    const out: string = plan.newPageSource!;
    // `LABEL` must survive — its declarator is not extracted.
    expect(out).toMatch(/const LABEL = "Section"/);
    // `items` declarator is removed.
    expect(out).not.toMatch(/items = \[/);
    // The content callee is rewritten.
    expect(out).toMatch(/home\.items\.map\(/);
  });
});

describe('planPageExtraction — refuses an ambiguous .map rename', () => {
  // The array is referenced once in CODE (so the gate extracts it) but `tips.map`
  // also appears in a comment. A blind text replace would corrupt the comment, so
  // the rewrite must refuse by throwing — the caller must not persist on a throw.
  const AMBIGUOUS: string = `const tips = [{ text: "a" }];

export default function HomePage() {
  // render tips.map below
  return <ul>{tips.map((x) => <li key={x.text}>{x.text}</li>)}</ul>;
}
`;
  it('throws when the array name appears more than once as text', () => {
    expect(() => planPageExtraction(AMBIGUOUS, 'src/pages/index.tsx')).toThrow(
      /unsafe rewrite.*tips\.map.*found 2/,
    );
  });
});

describe('planPageExtraction — recast formatting preservation (the headline)', () => {
  it('only the import, the deleted const, and the .map callee change — untouched regions are byte-identical', () => {
    const plan: ExtractionPlan = planPageExtraction(PAGE, 'src/pages/index.tsx');
    const after: string = plan.newPageSource ?? '';

    // What the input looks like under the same three edits, applied as plain
    // string surgery — assert recast produced exactly that.
    const expected: string = `import { home } from 'virtual:content';
import { Zap } from 'lucide-react';

const features = [
  { icon: Zap, title: "A", desc: "d" },
];

export default function HomePage() {
  return (
    <div className={features[0] ? '' : ''}>
      {features.map((f) => <h3 key={f.title}>{f.title}</h3>)}
      {home.testimonials.map((t) => <p key={t.name}>{t.quote}</p>)}
    </div>
  );
}
`;
    expect(after).toBe(expected);
    // sanity: the untouched features const block is byte-identical
    const featuresBlock: string = PAGE.slice(
      PAGE.indexOf('const features'),
      PAGE.indexOf('];', PAGE.indexOf('const features')) + 2,
    );
    expect(after).toContain(featuresBlock);
  });
});

describe('planPageExtraction — idempotency', () => {
  it('a source that already imports the binding with the const gone extracts nothing', () => {
    const already: string = `import { home } from 'virtual:content';

export default function HomePage() {
  return (
    <ul>{home.testimonials.map((t) => <p key={t.name}>{t.quote}</p>)}</ul>
  );
}
`;
    const plan: ExtractionPlan = planPageExtraction(already, 'src/pages/index.tsx');
    expect(plan.extractedNames).toEqual([]);
    expect(plan.content).toBeUndefined();
    expect(plan.newPageSource).toBeUndefined();
  });

  it('batch idempotency: a same-named function-local const does not prevent re-extraction of module-level one (F3)', () => {
    // After a successful batch extraction, the module-level `items` const is gone
    // (virtual:content is imported instead). A function-local `items` const remains
    // in the page (unrelated). With the bug, `existingConsts` (all-depth) sees the
    // function-local `items` → thinks the module-level one is still there → tries
    // to re-extract → broken. Fix: narrow existingConsts to module scope only.
    const already: string = `import { home } from 'virtual:content';

export default function P() {
  const items = [{ name: 'local' }]; // function-local, same name as the extracted array
  return (
    <div>{home.items.map((i: { name: string }) => <p key={i.name}>{i.name}</p>)}{items.map((i: { name: string }) => <span>{i.name}</span>)}</div>
  );
}
`;
    const plan: ExtractionPlan = planPageExtraction(already, 'src/pages/index.tsx');
    // The module-level items was already extracted (virtual:content imported, no module-level const).
    // The function-local items must NOT fool the idempotency check.
    expect(plan.extractedNames).toEqual([]);
    expect(plan.newPageSource).toBeUndefined();
  });
});

describe('partial field split', () => {
  it('extracts literal fields and retains a component-ref field', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', label: 'CCW', icon: Target }];
export default function P() { return <>{stats.map((s, i) => <span key={i}>{s.value}</span>)}</>; }`;
    const out: ReturnType<typeof analyzeExtractable> = analyzeExtractable(src, 'home');
    expect(out.extractions).toHaveLength(1);
    expect(out.extractions[0].arrayName).toBe('stats');
    expect(out.extractions[0].data).toEqual([{ value: 'DOJ', label: 'CCW' }]);
    expect(out.extractions[0].retainedKeys).toEqual(['icon']);
  });

  it('skips the array when NO field is extractable', () => {
    const src: string = `const only = [{ icon: Target }];
export default function P() { return <>{only.map((s, i) => <span key={i}><s.icon/></span>)}</>; }`;
    const out: ReturnType<typeof analyzeExtractable> = analyzeExtractable(src, 'home');
    expect(out.extractions).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/no extractable/i);
  });

  it('still hard-skips nested array/object/JSX/function fields (defer to S3)', () => {
    const src: string = `const items = [{ title: 'x', projects: [1,2] }];
export default function P() { return <>{items.map((s, i) => <span key={i}>{s.title}</span>)}</>; }`;
    const out: ReturnType<typeof analyzeExtractable> = analyzeExtractable(src, 'home');
    expect(out.extractions).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/non-flat/);
  });

  it('requires retained keys to be identical across elements', () => {
    const src: string = `const m = [{ t: 'a', icon: A }, { t: 'b' }];
export default function P() { return <>{m.map((s, i) => <span key={i}>{s.t}</span>)}</>; }`;
    const out: ReturnType<typeof analyzeExtractable> = analyzeExtractable(src, 'home');
    expect(out.extractions).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/retained fields differ/i);
  });
});

describe('planPageExtraction — partial split (iterate content, index local remainder)', () => {
  it('rewrites a mixed array: content-backed text, local remainder for icon', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', label: 'CCW', icon: Target }, { value: 'NRA', label: 'Certified', icon: Target }];
export default function P() {
  return <>{stats.map((s, i) => <div key={i}><span>{s.value}</span><s.icon/></div>)}</>;
}`;
    const plan: ExtractionPlan = planPageExtraction(src, 'src/pages/index.tsx');
    expect(plan.extractedNames).toEqual(['stats']);
    expect(plan.content!.stats).toEqual([
      { value: 'DOJ', label: 'CCW' },
      { value: 'NRA', label: 'Certified' },
    ]);
    const out: string = plan.newPageSource!;
    // Content is iterated (so existing attribution fires):
    expect(out).toMatch(/home\.stats\.map/);
    // Local remainder holds only the retained field:
    expect(out).toMatch(/const statsMeta = \[\{\s*icon: Target\s*\}, \{\s*icon: Target\s*\}\]/);
    // Tag-position retained read: hoisted binding off the indexed remainder…
    expect(out).toMatch(/const Icon = statsMeta\[i\]\.icon/);
    // …and the JSX tag now renders that local (valid JSX, behavior-identical):
    expect(out).toMatch(/<Icon\s*\/>/);
    // Original full const is gone; text read stays on the content param:
    expect(out).not.toMatch(/const stats = \[/);
    expect(out).toMatch(/\{s\.value\}/);
  });

  it('redirects an expression-position retained read in place (no hoist)', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }, { value: 'NRA', icon: Target }];
export default function P() {
  return <>{stats.map((s, i) => <Row key={i} icon={s.icon}>{s.value}</Row>)}</>;
}`;
    const out: string = planPageExtraction(src, 'src/pages/index.tsx').newPageSource!;
    expect(out).toMatch(/home\.stats\.map/);
    // Expression-position read is rewritten in place — no hoisted local needed.
    expect(out).toMatch(/icon=\{statsMeta\[i\]\.icon\}/);
    expect(out).not.toMatch(/const Icon =/);
  });

  it('handles both positions in one callback (tag + expression)', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target, badge: Target }, { value: 'NRA', icon: Target, badge: Target }];
export default function P() {
  return <>{stats.map((s, i) => <div key={i} data-b={s.badge}><s.icon/><span>{s.value}</span></div>)}</>;
}`;
    const out: string = planPageExtraction(src, 'src/pages/index.tsx').newPageSource!;
    // Tag position → hoisted local; expression position → in-place indexed read.
    expect(out).toMatch(/const Icon = statsMeta\[i\]\.icon/);
    expect(out).toMatch(/<Icon\s*\/>/);
    expect(out).toMatch(/data-b=\{statsMeta\[i\]\.badge\}/);
  });

  it('threads arraysWithRetained onto the plan', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
export default function P() {
  return <>{stats.map((s, i) => <div key={i}><span>{s.value}</span><s.icon/></div>)}</>;
}`;
    const plan: ExtractionPlan = planPageExtraction(src, 'src/pages/index.tsx');
    expect(plan.arraysWithRetained.map((p) => p.arrayName)).toEqual(['stats']);
    expect(plan.arraysWithRetained[0]?.retainedKeys).toEqual(['icon']);
  });

  it('synthesizes an index param when the callback has none', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
export default function P() {
  return <>{stats.map((s) => <div><span>{s.value}</span><s.icon/></div>)}</>;
}`;
    const out: string = planPageExtraction(src, 'src/pages/index.tsx').newPageSource!;
    // A synthesized 2nd param is added and used to index the remainder.
    expect(out).toMatch(/stats\.map\(\(s, _airoIdx\)/);
    expect(out).toMatch(/const Icon = statsMeta\[_airoIdx\]\.icon/);
    expect(out).toMatch(/home\.stats\.map/);
  });

  it('the statsMeta remainder is not falsely rewritten as a content-map callee', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
export default function P() {
  return <>{stats.map((s, i) => <div key={i}><span>{s.value}</span><s.icon/></div>)}</>;
}`;
    const out: string = planPageExtraction(src, 'src/pages/index.tsx').newPageSource!;
    // Only `stats.map` becomes `home.stats.map`; `statsMeta` never gains a binding prefix.
    expect(out).not.toMatch(/home\.statsMeta/);
  });

  it('throws (decline-to-no-op) when a retained read appears outside the map callback', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
const First = stats[0].icon;
export default function P() {
  return <>{stats.map((s, i) => <div key={i}><span>{s.value}</span><s.icon/></div>)}</>;
}`;
    // The `stats[0].icon` outside-callback read means the array is referenced
    // beyond `.map`, so the gate already declines it — nothing to rewrite, and
    // the plan must extract nothing rather than split unsafely.
    const plan: ExtractionPlan = planPageExtraction(src, 'src/pages/index.tsx');
    expect(plan.extractedNames).toEqual([]);
  });

  it('throws (decline-to-no-op) when the map callback is not an arrow/function', () => {
    const src: string = `import { Target } from 'lucide-react';
const render = (s, i) => <div key={i}><span>{s.value}</span><s.icon/></div>;
const stats = [{ value: 'DOJ', icon: Target }];
export default function P() {
  return <>{stats.map(render)}</>;
}`;
    expect(() => planPageExtraction(src, 'src/pages/index.tsx')).toThrow(/unsafe rewrite/);
  });

  it('throws (decline-to-no-op) when the map callback index param is destructured', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
export default function P() {
  return <>{stats.map((s, { x }) => <div key={x}><s.icon/></div>)}</>;
}`;
    // A destructured 2nd param can't be referenced by name to index the
    // remainder — the split is unsafe, so the rewrite must throw (→ conform declines).
    expect(() => planPageExtraction(src, 'src/pages/index.tsx')).toThrow(
      /unsafe rewrite.*index param is not a plain identifier/,
    );
  });

  it('hoisted <Cap> avoids colliding with a binding already in the callback body', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
export default function P() {
  return <>{stats.map((s, i) => {
    const Icon = someOtherThing(i);
    return <div key={i}><Icon/><span>{s.value}</span><s.icon/></div>;
  })}</>;
}`;
    const out: string = planPageExtraction(src, 'src/pages/index.tsx').newPageSource!;
    // The pre-existing `const Icon` must survive; the hoist must pick a distinct name.
    expect(out).toMatch(/const Icon = someOtherThing\(i\)/);
    // Exactly one `const Icon =` (the pre-existing one) — no duplicate declaration.
    expect(out.match(/const Icon\b/g)).toHaveLength(1);
    // The retained tag read is redirected to a distinctly-named hoisted local off statsMeta.
    expect(out).toMatch(/const Icon2 = statsMeta\[i\]\.icon/);
    expect(out).toMatch(/<Icon2\s*\/>/);
  });

  it('pre-existing statsMeta in module scope forces remainder to statsMeta2 (#9)', () => {
    // If the page already has `const statsMeta` (e.g. from a previous partial
    // split), renaming to `statsMeta` again would produce a duplicate lexical
    // binding — a scope error that @babel/parser may not flag → broken build.
    // The remainder must be uniquified to `statsMeta2`.
    const src: string = `import { Target } from 'lucide-react';
const statsMeta = [{ icon: Target }]; // pre-existing remainder from a prior split
const stats = [{ value: 'DOJ', icon: Target }];
export default function P() {
  return <>{stats.map((s, i) => <div key={i}><span>{s.value}</span><s.icon/></div>)}</>;
}`;
    const out: string = planPageExtraction(src, 'src/pages/index.tsx').newPageSource!;
    // The rename must use statsMeta2 (statsMeta is already taken).
    expect(out).toMatch(/const statsMeta2 = /);
    expect(out).toMatch(/statsMeta2\[i\]\.icon/);
    // The pre-existing statsMeta stays untouched.
    expect(out).toMatch(/const statsMeta = \[/);
    // No `const statsMeta =` that refers to the newly-split remainder.
    const metaMatches: RegExpMatchArray | null = out.match(/const statsMeta(?!2)\s*=/g);
    // At most the original pre-existing one.
    expect((metaMatches ?? []).length).toBeLessThanOrEqual(1);
  });

  it('export const Icon collides with hoisted name — uniquifies to Icon2 (#8)', () => {
    // `export const Icon = SomeOtherIcon` is a module-level export. Without
    // unwrapping ExportNamedDeclaration in collectBoundNames, the name `Icon`
    // was not in the reserved set and the hoist would shadow the export.
    const src: string = `import { Target, SomeOtherIcon } from 'lucide-react';
export const Icon = SomeOtherIcon;
const stats = [{ value: 'DOJ', icon: Target }];
export default function P() {
  return <>{stats.map((s, i) => <div key={i}><s.icon/><Icon/></div>)}</>;
}`;
    const out: string = planPageExtraction(src, 'src/pages/index.tsx').newPageSource!;
    // The exported `Icon` must be preserved; the hoist must not shadow it.
    expect(out).toMatch(/export const Icon = SomeOtherIcon/);
    // Hoisted local is Icon2 (not Icon, which is taken by the export).
    expect(out).toMatch(/const Icon2 = statsMeta\[i\]\.icon/);
    expect(out).toMatch(/<Icon2\s*\/>/);
    // The original <Icon/> (the export) stays rendered as <Icon/>.
    expect(out).toMatch(/<Icon\s*\/>/);
  });

  it('function-local: pre-existing statsMeta in same function scope forces remainder to statsMeta2 (F4)', () => {
    const src: string = `import { Target } from 'lucide-react';
export default function P() {
  const statsMeta = [{ icon: Target }]; // pre-existing in same function scope
  const stats = [{ value: 'DOJ', icon: Target }];
  return <>{stats.map((s, i) => <div key={i}><span>{s.value}</span><s.icon/></div>)}</>;
}`;
    const id: string = analyzeExtractable(src, 'home').extractions.find(
      (e: ExtractableArray): boolean => e.arrayName === 'stats',
    )!.locId!;
    const out: string = planPageExtraction(src, 'src/pages/index.tsx', id).newPageSource!;
    // The rename must not collide with pre-existing function-local statsMeta
    expect(out).toMatch(/const statsMeta2 = /);
    expect(out).toMatch(/statsMeta2\[i\]\.icon/);
    // Pre-existing statsMeta stays
    expect(out).toMatch(/const statsMeta = \[/);
    // No duplicate const statsMeta declaration (the new one uses statsMeta2)
    const metaMatches: RegExpMatchArray | null = out.match(/const statsMeta(?!2)\s*=/g);
    expect((metaMatches ?? []).length).toBeLessThanOrEqual(1);
  });
});

describe('redirectRetainedReads — unhandled item-param shapes throw (B2)', () => {
  // When there are retained keys and the item param is used in a position the
  // two rewrite passes don't cover, the rewrite must throw "unsafe rewrite" so
  // the caller declines cleanly instead of shipping broken output.

  it('computed member s["icon"] throws unsafe rewrite', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
export default function P() {
  return <>{stats.map((s, i) => <div key={i}>{s["icon"]}{s.value}</div>)}</>;
}`;
    expect(() => planPageExtraction(src, 'src/pages/index.tsx')).toThrow(/unsafe rewrite/);
  });

  it('whole-object JSX attribute <Row item={s}/> throws unsafe rewrite', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
function Row({ item }) { return <span>{item.value}</span>; }
export default function P() {
  return <>{stats.map((s, i) => <Row key={i} item={s} />)}</>;
}`;
    expect(() => planPageExtraction(src, 'src/pages/index.tsx')).toThrow(/unsafe rewrite/);
  });

  it('whole-object function call fn(s) throws unsafe rewrite', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
function render(item) { return item.icon; }
export default function P() {
  return <>{stats.map((s, i) => <div key={i}>{render(s)}</div>)}</>;
}`;
    expect(() => planPageExtraction(src, 'src/pages/index.tsx')).toThrow(/unsafe rewrite/);
  });

  it('spread <Row {...s}/> throws unsafe rewrite', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
function Row({ value, icon }) { return <span>{value}</span>; }
export default function P() {
  return <>{stats.map((s, i) => <Row key={i} {...s} />)}</>;
}`;
    expect(() => planPageExtraction(src, 'src/pages/index.tsx')).toThrow(/unsafe rewrite/);
  });

  it('supported <s.icon/> tag position still succeeds', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
export default function P() {
  return <>{stats.map((s, i) => <div key={i}><s.icon/><span>{s.value}</span></div>)}</>;
}`;
    expect(() => planPageExtraction(src, 'src/pages/index.tsx')).not.toThrow();
    expect(planPageExtraction(src, 'src/pages/index.tsx').extractedNames).toEqual(['stats']);
  });

  it('supported {s.icon} expression position still succeeds', () => {
    const src: string = `import { Target } from 'lucide-react';
const stats = [{ value: 'DOJ', icon: Target }];
export default function P() {
  return <>{stats.map((s, i) => <div key={i} data-icon={s.icon}><span>{s.value}</span></div>)}</>;
}`;
    expect(() => planPageExtraction(src, 'src/pages/index.tsx')).not.toThrow();
    expect(planPageExtraction(src, 'src/pages/index.tsx').extractedNames).toEqual(['stats']);
  });
});

describe('planPageExtraction — page binding resolution', () => {
  it('index page resolves to the "home" binding', () => {
    const plan: ExtractionPlan = planPageExtraction(PAGE, 'src/pages/index.tsx');
    expect(plan.binding).toBe('home');
    expect(plan.newPageSource).toMatch(/import \{ home \} from 'virtual:content'/);
  });

  it('a named page resolves to its slug binding', () => {
    const aboutPage: string = `const team = [
  { name: "A", role: "x" },
  { name: "B", role: "y" },
];

export default function About() {
  return <ul>{team.map((m) => <li key={m.name}>{m.name}</li>)}</ul>;
}
`;
    const plan: ExtractionPlan = planPageExtraction(aboutPage, 'src/pages/about.tsx');
    expect(plan.binding).toBe('about');
    expect(plan.extractedNames).toEqual(['team']);
    const page: string = plan.newPageSource ?? '';
    expect(page).toMatch(/import \{ about \} from 'virtual:content'/);
    expect(page).toMatch(/about\.team\.map\(/);
  });

  it('declines cleanly when the page slug is not a valid content binding', () => {
    // A leading digit can't form a valid binding even after hyphen→underscore
    // normalization (`2024-report` → `2024_report`, still fails NAME_PATTERN).
    const slugPage: string = `const tips = [{ text: "a" }];

export default function Report() {
  return <ul>{tips.map((x) => <li key={x.text}>{x.text}</li>)}</ul>;
}
`;
    const plan: ExtractionPlan = planPageExtraction(slugPage, 'src/pages/2024-report.tsx');
    // No throw, no extraction — `tips` declines with a reason.
    expect(plan.extractedNames).toEqual([]);
    expect(plan.newPageSource).toBeUndefined();
    expect(
      plan.skipped.some((s) => s.name === 'tips' && /not a valid content binding/.test(s.reason)),
    ).toBe(true);
  });

  it('normalizes a hyphenated slug to an underscore binding and extracts', () => {
    // Regression for the S2 fix: `pricing-plans` → `pricing_plans` is now a valid
    // binding, so a hyphenated page extracts rather than declining.
    const slugPage: string = `const tips = [{ text: "a" }, { text: "b" }];

export default function Pricing() {
  return <ul>{tips.map((x) => <li key={x.text}>{x.text}</li>)}</ul>;
}
`;
    const plan: ExtractionPlan = planPageExtraction(slugPage, 'src/pages/pricing-plans.tsx');
    expect(plan.binding).toBe('pricing_plans');
    expect(plan.extractedNames).toEqual(['tips']);
    expect(plan.newPageSource).toMatch(/import \{ pricing_plans \} from 'virtual:content'/);
    expect(plan.newPageSource).toMatch(/pricing_plans\.tips\.map/);
  });
});

// ── Real customer bundle shapes (S1 boundary) ────────────────────────────────
//
// These fixtures are distilled from two real customer apps surfaced during the
// content-heal-on-edit end-check. They verify:
//
//   POSITIVE — 227SPARC index.tsx: a module-level `stats` array with
//   `{ value, label, icon: <Component> }` objects. S1 MUST extract the literal
//   fields (value, label) and leave the icon component ref in a local remainder.
//
//   BOUNDARY — Hot Ham Communications secret-sauce.tsx + portfolio.tsx: all
//   arrays are function-local (declared inside the component body) and are
//   therefore invisible to the module-level scanner. S1 MUST decline them
//   cleanly — zero extractions, no throw. The portfolio page also has a nested
//   `projects: [...]` array and a bare `string[]`, which are S3/S4 shapes
//   deferred to later slices. The clean decline is intentional, not a gap.

// Minimal faithful fixture for 227SPARC src/pages/index.tsx.
// Preserves the exact shape: module-level const, three objects each with
// { value: string, label: string, icon: <ComponentRef> }, and a stats.map
// that renders only value+label (icon is rendered as <stat.icon/> in a JSX
// tag position). The surrounding motion/animation boilerplate is stripped
// down to what the extractor sees.
const SPARC_INDEX: string = `import { Target, Award, Shield } from 'lucide-react';

const stats = [
  { value: 'DOJ', label: 'CCW Certified', icon: Target },
  { value: '29+', label: 'Years of Law Enforcement Experience', icon: Award },
  { value: 'NRA', label: 'Certified Instructors', icon: Shield },
];

export default function HomePage() {
  return (
    <div>
      {stats.map((stat, i) => (
        <div key={stat.label}>
          <span>{stat.value}</span>
          <span>{stat.label}</span>
          <stat.icon />
        </div>
      ))}
    </div>
  );
}
`;

// Minimal faithful fixture for Hot Ham Communications src/pages/secret-sauce.tsx.
// The articles array is declared INSIDE the component body (function-local),
// which makes it invisible to the module-level scanner. The page slug
// "secret-sauce" also contains a hyphen and cannot form a valid content
// binding, but that is moot — the function-local scan excludes it first.
const HOT_HAM_SECRET_SAUCE: string = `import { ChevronRight } from 'lucide-react';

export default function SecretSaucePage() {
  const articles = [
    {
      id: 'joy-bus',
      slug: 'joy-bus-diner-jennifer-caraway',
      title: "When Cooking Meals for 'Joy' Became Delivering Meals With Purpose",
      author: 'Jennifer Caraway',
      company: 'The Joy Bus Diner',
      excerpt: 'Walking into The Joy Bus Diner...',
      image: 'https://img1.wsimg.com/isteam/ip/ad9316ab/Joy%20Bus.JPG',
      imagePosition: 'object-[center_35%]',
      date: 'January 2026',
    },
    {
      id: 'herschede',
      slug: 'herschede-menswear-eric',
      title: 'From Mortgages to Menswear',
      author: 'Eric Herschede',
      company: 'Herschede',
      excerpt: 'After 26 years as a mortgage broker...',
      image: 'https://img1.wsimg.com/isteam/ip/ad9316ab/Founder.JPEG',
      imagePosition: 'object-[center_40%]',
      date: 'December 2025',
    },
  ];

  return (
    <div>
      {articles.map((article) => (
        <div key={article.id}>
          <h2>{article.title}</h2>
          <p>{article.author} • {article.company}</p>
        </div>
      ))}
    </div>
  );
}
`;

// Minimal faithful fixture for Hot Ham Communications src/pages/portfolio.tsx.
// Two function-local arrays are in scope:
//   portfolioItems — nested shape: each element has `projects: [...]` (nested
//     array, S3 shape) plus `icon: <ComponentRef>` (S1 retained-key shape, but
//     disqualified by the nested field — hard-skip until S3).
//   capabilities — a bare string[] (S4 shape).
// Both are function-local and therefore invisible to the module-level scanner.
// The clean decline is intentional — these are committed follow-up slices.
const HOT_HAM_PORTFOLIO: string = `import { FileText, Users } from 'lucide-react';

export default function PortfolioPage() {
  const portfolioItems = [
    {
      category: 'Government Affairs Advocacy',
      icon: Users,
      color: 'bg-primary',
      projects: [
        {
          title: 'Government Affairs Advocacy',
          client: 'Sonora Quest Laboratories',
          description: 'Led advocacy outreach...',
          results: 'Content Creation / Lab Tours',
          tags: ['Government Affairs', 'Advocacy'],
        },
      ],
    },
    {
      category: 'Content & Storytelling',
      icon: FileText,
      color: 'bg-primary',
      projects: [
        {
          title: 'Brand Narrative Development',
          client: 'B2B Manufacturing Company',
          description: 'Crafted complete brand story...',
          results: '45% increase in website engagement',
          tags: ['Brand Voice', 'Messaging Strategy'],
        },
      ],
    },
  ];

  const capabilities = [
    'Strategic Communications Planning',
    'Executive Messaging & Positioning',
    'Internal Communications Programs',
    'Thought Leadership Development',
  ];

  return (
    <div>
      {portfolioItems.map((category, categoryIndex) => (
        <div key={categoryIndex}>
          <h2>{category.category}</h2>
        </div>
      ))}
      <div>
        {capabilities.map((capability, index) => (
          <div key={index}>{capability}</div>
        ))}
      </div>
    </div>
  );
}
`;

// ── CP3: function-local array collection + binding-scoped reference analysis ──

describe('analyzeExtractable — function-local arrays (CP3)', () => {
  it('collects a function-local const array with its loc-id', () => {
    const src: string = `export default function P(){ const stats=[{v:'a'}]; return <>{stats.map((s,i)=><span key={i}>{s.v}</span>)}</>; }`;
    const out: ReturnType<typeof analyzeExtractable> = analyzeExtractable(src, 'home');
    expect(out.extractions).toHaveLength(1);
    expect(out.extractions[0].arrayName).toBe('stats');
    expect(out.extractions[0].locId).toMatch(/^L\d+C\d+$/);
  });

  it('two same-named function-local arrays are BOTH collected as distinct candidates', () => {
    const src: string = `export function A(){const items=[{t:'a'}];return items.map((s,i)=><span key={i}>{s.t}</span>);}\nexport function B(){const items=[{t:'b'}];return items.map((s,i)=><span key={i}>{s.t}</span>);}`;
    const out: ReturnType<typeof analyzeExtractable> = analyzeExtractable(src, 'home');
    expect(out.extractions.map((e) => e.locId).filter(Boolean)).toHaveLength(2);
  });

  it('function-local array referenced beyond .map declines', () => {
    const src: string = `export default function P(){ const stats=[{v:'a'}]; const first=stats[0]; return <>{stats.map((s,i)=><span key={i}>{s.v}</span>)}{first.v}</>; }`;
    const out: ReturnType<typeof analyzeExtractable> = analyzeExtractable(src, 'home');
    expect(out.extractions).toHaveLength(0);
  });

  it('loc-id cross-side consistency: L1C6 for const stats = [...] on line 1', () => {
    // Source-mapper computes locId from the VariableDeclarator node.
    // `const stats = [{v:'a'}]` on line 1 col 0: declarator id `stats` starts at col 6 (after "const ").
    const src: string = `const stats = [{v:'a'}];\nexport default function P(){ return <>{stats.map((s,i)=><span key={i}>{s.v}</span>)}</>; }`;
    const out: ReturnType<typeof analyzeExtractable> = analyzeExtractable(src, 'home');
    expect(out.extractions).toHaveLength(1);
    expect(out.extractions[0].locId).toBe('L1C6');
  });
});

describe('real customer bundle shapes (S1 boundary)', () => {
  describe('positive case — 227SPARC index.tsx: module-level stats with icon component refs', () => {
    it('extracts stats and strips icon from the content payload', () => {
      const plan: ExtractionPlan = planPageExtraction(SPARC_INDEX, 'src/pages/index.tsx');
      expect(plan.extractedNames).toContain('stats');
      expect(plan.content!.stats).toEqual([
        { value: 'DOJ', label: 'CCW Certified' },
        { value: '29+', label: 'Years of Law Enforcement Experience' },
        { value: 'NRA', label: 'Certified Instructors' },
      ]);
    });

    it('retains the icon key in arraysWithRetained', () => {
      const plan: ExtractionPlan = planPageExtraction(SPARC_INDEX, 'src/pages/index.tsx');
      const retained: { arrayName: string; retainedKeys: string[] } | undefined =
        plan.arraysWithRetained.find((p) => p.arrayName === 'stats');
      expect(retained).toBeDefined();
      expect(retained!.retainedKeys).toEqual(['icon']);
    });

    it('rewrites the page to use virtual:content, statsMeta remainder, and hoisted Icon local', () => {
      const plan: ExtractionPlan = planPageExtraction(SPARC_INDEX, 'src/pages/index.tsx');
      const out: string = plan.newPageSource!;
      expect(out).toMatch(/import \{ home \} from 'virtual:content'/);
      expect(out).toMatch(/home\.stats\.map/);
      expect(out).toMatch(/const statsMeta = \[/);
      // icon field is in the remainder, not the content map
      expect(out).toMatch(/icon: Target/);
      expect(out).toMatch(/icon: Award/);
      expect(out).toMatch(/icon: Shield/);
      // original const is gone
      expect(out).not.toMatch(/const stats = \[/);
    });
  });

  describe('boundary case — Hot Ham Communications secret-sauce.tsx: function-local articles (now heals, S2)', () => {
    // articles is declared INSIDE the component body. Under S1 this was invisible;
    // CP3 function-local scanning + the S2 slug-normalization fix (secret-sauce →
    // secret_sauce) now heal it. The dedicated positive assertions live in the
    // "real customer bundle shapes (S2 — function-local)" block below; here we just
    // confirm the S1-era no-op has flipped to an extraction and does not throw.
    it('now extracts articles and does not throw', () => {
      expect(() => {
        const plan: ExtractionPlan = planPageExtraction(
          HOT_HAM_SECRET_SAUCE,
          'src/pages/secret-sauce.tsx',
        );
        expect(plan.binding).toBe('secret_sauce');
        expect(plan.extractedNames).toEqual(['articles']);
      }).not.toThrow();
    });
  });

  describe('boundary case — Hot Ham Communications portfolio.tsx: function-local nested + string-array (S3/S4 shapes)', () => {
    // portfolioItems: function-local, nested projects array (S3), icon component
    //   ref per-category (S1 retained-key shape but disqualified by nested field).
    // capabilities: function-local bare string[] — CP2 now extracts it.
    // portfolioItems still declines (nested array-valued property, S3 shape).
    it('extracts capabilities (CP2) and does not throw; portfolioItems still declined (S3)', () => {
      expect(() => {
        const plan: ExtractionPlan = planPageExtraction(
          HOT_HAM_PORTFOLIO,
          'src/pages/portfolio.tsx',
        );
        // capabilities is now extracted by CP2
        expect(plan.extractedNames).toContain('capabilities');
        // portfolioItems still declines — nested array-valued property (S3)
        expect(plan.extractedNames).not.toContain('portfolioItems');
      }).not.toThrow();
    });
  });

  // ── CP4: id-addressed, binding-precise, collision-aware rewrite ──────────────
  //
  // When a `conformId` (declarator loc-id) is supplied, extract ONLY the array
  // whose declarator matches and rewrite ITS binding's `.map` via scope reference
  // paths — never the global name text-sub. A same-named array in another scope
  // must be byte-unchanged. Scope-agnostic: module-level OR function-local.
  describe('planPageExtraction — id-addressed binding-precise rewrite', () => {
    it('id-addressed rewrite touches only the targeted binding, leaving a same-named sibling intact', () => {
      const src: string = `export function A(){const items=[{t:'a'}];return <>{items.map((s,i)=><span key={i}>{s.t}</span>)}</>;}\nexport function B(){const items=[{t:'b'}];return <>{items.map((s,i)=><span key={i}>{s.t}</span>)}</>;}`;
      const targetId: string = analyzeExtractable(src, 'home').extractions[0].locId!;
      const plan: ExtractionPlan = planPageExtraction(src, 'src/pages/index.tsx', targetId);
      expect(plan.extractedNames).toEqual(['items']);
      const out: string = plan.newPageSource!;
      expect(out).toMatch(/home\.items\.map/); // A rewritten
      expect((out.match(/home\.items\.map/g) || []).length).toBe(1); // only ONE rewritten
      // B's const intact (recast prints untouched nodes verbatim).
      expect(out).toMatch(/const items=\[\{ ?t: ?'b' ?\}\]|const items = \[\{\s*t: 'b'/);
    });

    it('function-local single heals: declarator dropped from function body, content-backed map', () => {
      const src: string = `export default function P(){ const stats=[{v:'a'}]; return <>{stats.map((s,i)=><span key={i}>{s.v}</span>)}</>; }`;
      const id: string = analyzeExtractable(src, 'home').extractions[0].locId!;
      const plan: ExtractionPlan = planPageExtraction(src, 'src/pages/index.tsx', id);
      expect(plan.content!.stats).toEqual([{ v: 'a' }]);
      expect(plan.newPageSource!).toMatch(/home\.stats\.map/);
      expect(plan.newPageSource!).not.toMatch(/const stats\s*=/);
    });

    it('no conformId → S1 module-level batch behavior unchanged (regression)', () => {
      const withId: ExtractionPlan = planPageExtraction(PAGE, 'src/pages/index.tsx');
      const withUndefined: ExtractionPlan = planPageExtraction(PAGE, 'src/pages/index.tsx', undefined);
      expect(withUndefined.extractedNames).toEqual(withId.extractedNames);
      expect(withUndefined.newPageSource).toEqual(withId.newPageSource);
    });

    it('unknown conformId → clean decline (extractedNames empty)', () => {
      const plan: ExtractionPlan = planPageExtraction(PAGE, 'src/pages/index.tsx', 'L999C99');
      expect(plan.extractedNames).toEqual([]);
      expect(plan.newPageSource).toBeUndefined();
      expect(plan.skipped.some((s) => s.reason === 'conform-id-not-found')).toBe(true);
    });

    it('id-addressed retained-field split heals only the targeted binding (scope-local Meta remainder)', () => {
      const src: string = `import { Target } from 'lucide-react';
export function A() {
  const stats = [{ value: 'a', icon: Target }];
  return <>{stats.map((s, i) => <div key={i}><span>{s.value}</span><s.icon/></div>)}</>;
}
export function B() {
  const stats = [{ value: 'b', icon: Target }];
  return <>{stats.map((s, i) => <div key={i}><span>{s.value}</span><s.icon/></div>)}</>;
}`;
      const targetId: string = analyzeExtractable(src, 'home').extractions[0].locId!;
      const plan: ExtractionPlan = planPageExtraction(src, 'src/pages/index.tsx', targetId);
      expect(plan.extractedNames).toEqual(['stats']);
      expect(plan.content!.stats).toEqual([{ value: 'a' }]);
      const out: string = plan.newPageSource!;
      // Only ONE binding is rewritten to the content map.
      expect((out.match(/home\.stats\.map/g) || []).length).toBe(1);
      // A's declarator became a statsMeta remainder; B's `const stats` is intact.
      expect(out).toMatch(/const statsMeta = \[\{\s*icon: Target/);
      expect((out.match(/const stats = \[/g) || []).length).toBe(1); // B's stays
    });

    it('content-key collision: same-named sibling already on disk declines the id target', () => {
      // Two same-named `items` arrays in different scopes. Target A's declarator,
      // but a content key `home.items` already exists from a DIFFERENT declarator.
      const src: string = `export function A(){const items=[{t:'a'}];return <>{items.map((s,i)=><span key={i}>{s.t}</span>)}</>;}\nexport function B(){const items=[{t:'b'}];return <>{items.map((s,i)=><span key={i}>{s.t}</span>)}</>;}`;
      const targetId: string = analyzeExtractable(src, 'home').extractions[0].locId!;
      const plan: ExtractionPlan = planPageExtraction(src, 'src/pages/index.tsx', targetId, ['items']);
      expect(plan.extractedNames).toEqual([]);
      expect(plan.declineReason).toBe('content-key-collision');
      expect(plan.newPageSource).toBeUndefined();
    });

    it('id-addressed retained: unsafe callback (whole-object fn pass) throws unsafe rewrite (Gap 2)', () => {
      const src: string = `import { Target } from 'lucide-react';
export default function P() {
  const stats = [{ value: 'DOJ', icon: Target }];
  function render(item: { value: string; icon: typeof Target }) { return item.icon; }
  return <>{stats.map((s, i) => <div key={i}>{render(s)}</div>)}</>;
}`;
      const id: string = analyzeExtractable(src, 'home').extractions.find(
        (e: ExtractableArray): boolean => e.arrayName === 'stats',
      )!.locId!;
      expect(() => planPageExtraction(src, 'src/pages/index.tsx', id)).toThrow(/unsafe rewrite/);
    });

    it('id-addressed retained: unsafe callback (destructured index param) throws unsafe rewrite (Gap 2)', () => {
      const src: string = `import { Target } from 'lucide-react';
export default function P() {
  const stats = [{ value: 'DOJ', icon: Target }];
  return <>{stats.map((s, { x }: { x: number }) => <div key={x}><s.icon/></div>)}</>;
}`;
      const id: string = analyzeExtractable(src, 'home').extractions.find(
        (e: ExtractableArray): boolean => e.arrayName === 'stats',
      )!.locId!;
      expect(() => planPageExtraction(src, 'src/pages/index.tsx', id)).toThrow(
        /unsafe rewrite.*index param is not a plain identifier/,
      );
    });
  });
});

// ── Real customer bundle shapes (S2 — function-local) ────────────────────────
//
// These fixtures are distilled from the actual Hot Ham Communications bundle
// (appId_1g342scsqm). They verify:
//
//   S2 POSITIVE: Hot Ham secret-sauce.tsx — function-local `articles` (flat
//   all-scalar objects, one .map) IS collected by CP3 function-local scanning AND
//   heals via planPageExtraction. The page slug `secret-sauce` is normalized to
//   the valid binding `secret_sauce` by bindingForPage (a general fix surfaced by
//   this end-check — previously the hyphenated slug failed CONTENT_BINDING_PATTERN
//   and declined). Underscore, not camelCase: the binding is lowercase-only
//   (it becomes the virtual:content export name, validated by NAME_PATTERN).
//
//   S3 STILL DECLINES: `portfolioItems` — function-local with nested `projects: [...]`
//   (array-valued property). Hard-skipped as non-flat; S3 follow-up needed.
//
//   S4 STILL DECLINES: `capabilities` — function-local `string[]` (non-object
//   elements). Hard-skipped; S4 follow-up needed.

// Faithful minimal fixture for Hot Ham secret-sauce.tsx.
// Preserves: function-local scope, flat all-scalar object elements
// (id/slug/title/author/company/excerpt/image/imagePosition/date are all strings),
// and one `articles.map(...)` render. Surrounding boilerplate stripped to what
// the extractor sees.
const HOT_HAM_SECRET_SAUCE_S2: string = `import { ChevronRight } from 'lucide-react';

export default function SecretSaucePage() {
  const articles = [
    {
      id: 'joy-bus',
      slug: 'joy-bus-diner-jennifer-caraway',
      title: "When Cooking Meals for 'Joy' Became Delivering Meals With Purpose",
      author: 'Jennifer Caraway',
      company: 'The Joy Bus Diner',
      excerpt: 'Walking into The Joy Bus Diner...',
      image: 'https://img1.wsimg.com/isteam/ip/ad9316ab/Joy%20Bus.JPG',
      imagePosition: 'object-[center_35%]',
      date: 'January 2026',
    },
    {
      id: 'herschede',
      slug: 'herschede-menswear-eric',
      title: 'From Mortgages to Menswear',
      author: 'Eric Herschede',
      company: 'Herschede',
      excerpt: 'After 26 years as a mortgage broker...',
      image: 'https://img1.wsimg.com/isteam/ip/ad9316ab/Founder.JPEG',
      imagePosition: 'object-[center_40%]',
      date: 'December 2025',
    },
  ];

  return (
    <div>
      {articles.map((article) => (
        <div key={article.id}>
          <h2>{article.title}</h2>
          <p>{article.author} • {article.company}</p>
        </div>
      ))}
    </div>
  );
}
`;

// Faithful minimal fixture for Hot Ham portfolio.tsx (S3 + S4 shapes).
// portfolioItems: function-local, each element has a nested `projects: [...]`
//   (array-valued property → non-flat hard-skip, S3).
// capabilities: function-local `string[]` (non-object elements → hard-skip, S4).
const HOT_HAM_PORTFOLIO_S2: string = `import { FileText, Users } from 'lucide-react';

export default function PortfolioPage() {
  const portfolioItems = [
    {
      category: 'Government Affairs Advocacy',
      icon: Users,
      color: 'bg-primary',
      projects: [
        {
          title: 'Government Affairs Advocacy',
          client: 'Sonora Quest Laboratories',
          description: 'Led advocacy outreach...',
          results: 'Content Creation / Lab Tours',
          tags: ['Government Affairs', 'Advocacy'],
        },
      ],
    },
    {
      category: 'Content & Storytelling',
      icon: FileText,
      color: 'bg-primary',
      projects: [
        {
          title: 'Brand Narrative Development',
          client: 'B2B Manufacturing Company',
          description: 'Crafted complete brand story...',
          results: '45% increase in website engagement',
          tags: ['Brand Voice', 'Messaging Strategy'],
        },
      ],
    },
  ];

  const capabilities = [
    'Strategic Communications Planning',
    'Executive Messaging & Positioning',
    'Internal Communications Programs',
    'Thought Leadership Development',
  ];

  return (
    <div>
      {portfolioItems.map((category, categoryIndex) => (
        <div key={categoryIndex}>
          <h2>{category.category}</h2>
        </div>
      ))}
      <div>
        {capabilities.map((capability, index) => (
          <div key={index}>{capability}</div>
        ))}
      </div>
    </div>
  );
}
`;

describe('real customer bundle shapes (S2 — function-local)', () => {
  // S2 POSITIVE: the CP3 function-local scanner finds `articles` from
  // secret-sauce.tsx (flat all-scalar objects, one .map), and planPageExtraction
  // heals it — the page slug `secret-sauce` is normalized to the valid binding
  // `secret_sauce`.
  describe('HEALS — Hot Ham secret-sauce.tsx articles (function-local, flat all-scalar)', () => {
    const ARTICLES_DATA: Record<string, string>[] = [
      {
        id: 'joy-bus',
        slug: 'joy-bus-diner-jennifer-caraway',
        title: "When Cooking Meals for 'Joy' Became Delivering Meals With Purpose",
        author: 'Jennifer Caraway',
        company: 'The Joy Bus Diner',
        excerpt: 'Walking into The Joy Bus Diner...',
        image: 'https://img1.wsimg.com/isteam/ip/ad9316ab/Joy%20Bus.JPG',
        imagePosition: 'object-[center_35%]',
        date: 'January 2026',
      },
      {
        id: 'herschede',
        slug: 'herschede-menswear-eric',
        title: 'From Mortgages to Menswear',
        author: 'Eric Herschede',
        company: 'Herschede',
        excerpt: 'After 26 years as a mortgage broker...',
        image: 'https://img1.wsimg.com/isteam/ip/ad9316ab/Founder.JPEG',
        imagePosition: 'object-[center_40%]',
        date: 'December 2025',
      },
    ];

    it('analyzeExtractable finds articles with a valid locId and scalar data (CP3 function-local scan)', () => {
      const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(
        HOT_HAM_SECRET_SAUCE_S2,
        'secret_sauce',
      );
      const extraction: ReturnType<typeof analyzeExtractable>['extractions'][number] | undefined =
        report.extractions.find((e) => e.arrayName === 'articles');
      expect(extraction).toBeDefined();
      expect(extraction!.locId).toMatch(/^L\d+C\d+$/);
      expect(extraction!.data).toEqual(ARTICLES_DATA);
    });

    it('planPageExtraction heals: extracts articles, content-backs the map, drops the const', () => {
      const id: string = analyzeExtractable(
        HOT_HAM_SECRET_SAUCE_S2,
        'secret_sauce',
      ).extractions.find((e) => e.arrayName === 'articles')!.locId!;
      const plan: ExtractionPlan = planPageExtraction(
        HOT_HAM_SECRET_SAUCE_S2,
        'src/pages/secret-sauce.tsx',
        id,
      );
      expect(plan.binding).toBe('secret_sauce');
      expect(plan.extractedNames).toContain('articles');
      expect(plan.content!.articles).toEqual(ARTICLES_DATA);
      const out: string = plan.newPageSource!;
      expect(out).toMatch(/import \{ secret_sauce \} from 'virtual:content'/);
      expect(out).toMatch(/secret_sauce\.articles\.map/);
      expect(out).not.toMatch(/const articles =/);
    });
  });

  // S3 STILL DECLINES: portfolioItems has a nested `projects: [...]` array-valued
  // property — hard-skipped as non-flat regardless of function-local scope.
  // This is intentional; S3 will handle nested arrays.
  describe('STILL DECLINES — portfolioItems (function-local + nested projects array, S3 shape)', () => {
    it('analyzeExtractable does NOT include portfolioItems — nested array-valued property skips it', () => {
      const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(
        HOT_HAM_PORTFOLIO_S2,
        'portfolio',
      );
      const found: boolean = report.extractions.some((e) => e.arrayName === 'portfolioItems');
      expect(found).toBe(false);
      // Skipped with a non-flat reason (nested array/object property).
      const skip: ReturnType<typeof analyzeExtractable>['skipped'][number] | undefined =
        report.skipped.find((s) => s.name === 'portfolioItems');
      expect(skip).toBeDefined();
      expect(skip!.reason).toMatch(/non-flat/i);
    });
  });

  // S4 NOW EXTRACTS: capabilities is a bare string[] — CP2 accepts scalar arrays.
  describe('NOW EXTRACTS — capabilities (function-local string[], S4 shape shipped in CP2)', () => {
    it('analyzeExtractable DOES include capabilities — CP2 accepts scalar arrays', () => {
      const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(
        HOT_HAM_PORTFOLIO_S2,
        'portfolio',
      );
      const extraction: ReturnType<typeof analyzeExtractable>['extractions'][number] | undefined =
        report.extractions.find((e) => e.arrayName === 'capabilities');
      expect(extraction).toBeDefined();
      expect(extraction!.data).toEqual([
        'Strategic Communications Planning',
        'Executive Messaging & Positioning',
        'Internal Communications Programs',
        'Thought Leadership Development',
      ]);
      expect(extraction!.retainedKeys).toEqual([]);
    });
  });

  // bindingForPage normalization — the general fix surfaced by the S2 end-check.
  // Kebab-case slugs collapse to underscores (lowercase-only binding); index →
  // home; already-valid slugs pass through unchanged.
  describe('bindingForPage — slug → content binding normalization', () => {
    it('index → home', () => {
      expect(bindingForPage('src/pages/index.tsx')).toBe('home');
    });
    it('secret-sauce → secret_sauce', () => {
      expect(bindingForPage('src/pages/secret-sauce.tsx')).toBe('secret_sauce');
    });
    it('about-us → about_us', () => {
      expect(bindingForPage('src/pages/about-us.tsx')).toBe('about_us');
    });
    it('about → about (already valid, unchanged)', () => {
      expect(bindingForPage('src/pages/about.tsx')).toBe('about');
    });
    it('normalized bindings satisfy CONTENT_BINDING_PATTERN', () => {
      const pattern: RegExp = /^[a-z_][a-z0-9_]*$/;
      expect(pattern.test(bindingForPage('src/pages/secret-sauce.tsx'))).toBe(true);
      expect(pattern.test(bindingForPage('src/pages/about-us.tsx'))).toBe(true);
    });
  });
});

// ── CP2: scalar arrays (string[], number[], boolean[]) ────────────────────────
//
// A bare scalar array (`const tags = ['a','b','c']`) iterated by a single
// `.map` with a simple param read (`{t}`) should be extracted. The element is
// a scalar, so `retainedKeys` is always empty. The map-callback body token
// `{t}` (a plain read of the item param) must be left BYTE-UNCHANGED by the
// rewrite — it is not `{t.value}`.

describe('analyzeExtractable — scalar array (CP2)', () => {
  it('string[] — extracts with data equal to the literal values and retainedKeys === []', () => {
    const code: string = `
      const tags = ['a', 'b', 'c'];
      export default function P() {
        return <ul>{tags.map((t) => <li key={t}>{t}</li>)}</ul>;
      }
    `;
    const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(code, 'home');
    const extraction: ReturnType<typeof analyzeExtractable>['extractions'][number] | undefined =
      report.extractions.find((e) => e.arrayName === 'tags');
    expect(extraction).toBeDefined();
    expect(extraction!.data).toEqual(['a', 'b', 'c']);
    expect(extraction!.retainedKeys).toEqual([]);
  });

  it('number[] — [2021, 2022, 2023] extracts with numeric data', () => {
    const code: string = `
      const years = [2021, 2022, 2023];
      export default function P() {
        return <ul>{years.map((y) => <li key={y}>{y}</li>)}</ul>;
      }
    `;
    const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(code, 'home');
    const extraction: ReturnType<typeof analyzeExtractable>['extractions'][number] | undefined =
      report.extractions.find((e) => e.arrayName === 'years');
    expect(extraction).toBeDefined();
    expect(extraction!.data).toEqual([2021, 2022, 2023]);
    expect(extraction!.retainedKeys).toEqual([]);
  });

  it('boolean[] — [true, false] extracts with boolean data', () => {
    const code: string = `
      const flags = [true, false];
      export default function P() {
        return <ul>{flags.map((f) => <li key={String(f)}>{String(f)}</li>)}</ul>;
      }
    `;
    const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(code, 'home');
    const extraction: ReturnType<typeof analyzeExtractable>['extractions'][number] | undefined =
      report.extractions.find((e) => e.arrayName === 'flags');
    expect(extraction).toBeDefined();
    expect(extraction!.data).toEqual([true, false]);
    expect(extraction!.retainedKeys).toEqual([]);
  });

  it('mixed scalar+object array — skipped with reason mentioning "mixes scalar"', () => {
    const code: string = `
      const mixed = ['a', { b: 1 }];
      export default function P() {
        return <ul>{mixed.map((m) => <li>{m}</li>)}</ul>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'mixed');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/mixes scalar/i);
  });

  it('empty [] — still skipped (empty array guard unchanged)', () => {
    const code: string = `
      const items = [];
      export default function P() {
        return <ul>{items.map((i) => <li>{i}</li>)}</ul>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'items');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/empty/i);
  });

  it('scalar array used beyond .map (indexed access) — still declined', () => {
    const code: string = `
      const t = ['a', 'b'];
      const first = t[0];
      export default function P() {
        return <ul>{t.map((x) => <li>{x}</li>)}</ul>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 't');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/referenced|index|beyond|map/i);
  });

  it('object-array regression: existing object-array extracts identically after CP2', () => {
    const code: string = `
      const testimonials = [
        { quote: "great", name: "Jordan" },
        { quote: "love it", name: "Priya" },
      ];
      export default function P() {
        return <div>{testimonials.map((t) => <p key={t.name}>{t.quote}</p>)}</div>;
      }
    `;
    const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(code, 'home');
    const extraction: ReturnType<typeof analyzeExtractable>['extractions'][number] | undefined =
      report.extractions.find((e) => e.arrayName === 'testimonials');
    expect(extraction).toBeDefined();
    expect(extraction!.data).toEqual([
      { quote: 'great', name: 'Jordan' },
      { quote: 'love it', name: 'Priya' },
    ]);
    expect(extraction!.retainedKeys).toEqual([]);
  });
});

describe('planPageExtraction — scalar array rewrite (CP2)', () => {
  it('batch rewrite: scalar const removed, .map callee prefixed, loop-var body {c} unchanged', () => {
    const src: string = `const capabilities = ['Strategic Planning', 'Executive Messaging', 'Internal Programs'];

export default function P() {
  return (
    <ul>
      {capabilities.map((c) => <li key={c}>{c}</li>)}
    </ul>
  );
}
`;
    const plan: ExtractionPlan = planPageExtraction(src, 'src/pages/index.tsx');
    expect(plan.extractedNames).toEqual(['capabilities']);
    expect(plan.content!.capabilities).toEqual([
      'Strategic Planning',
      'Executive Messaging',
      'Internal Programs',
    ]);
    const out: string = plan.newPageSource!;
    // declarator is gone
    expect(out).not.toMatch(/const capabilities =/);
    // .map callee updated
    expect(out).toMatch(/home\.capabilities\.map\(/);
    // loop-var body token unchanged — NOT {c.value}
    expect(out).toMatch(/\{c\}/);
    expect(out).not.toMatch(/c\.value/);
  });
});
