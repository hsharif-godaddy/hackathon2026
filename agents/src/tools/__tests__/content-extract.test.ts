import { describe, expect, it } from 'vitest';
import { analyzeExtractable, planPageExtraction } from '../content-extract.js';
import type { ExtractionPlan } from '../content-extract.js';

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

  it('array of non-object elements (strings)', () => {
    const code: string = `
      const colors = ['Purple', 'Cyan', 'Pink'];
      export default function P() {
        return <div>{colors.map((c) => <option key={c}>{c}</option>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'colors');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/object literal/i);
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

  it('const array declared inside a function (not module-level)', () => {
    const code: string = `
      export default function P() {
        const items = [ { name: "A" } ];
        return <div>{items.map((i) => <p>{i.name}</p>)}</div>;
      }
    `;
    const report: ReturnType<typeof analyzeExtractable> = analyzeExtractable(code, 'home');
    expect(report.extractions).toHaveLength(0);
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
    const slugPage: string = `const tips = [{ text: "a" }];

export default function Pricing() {
  return <ul>{tips.map((x) => <li key={x.text}>{x.text}</li>)}</ul>;
}
`;
    const plan: ExtractionPlan = planPageExtraction(slugPage, 'src/pages/pricing-plans.tsx');
    // No throw, no extraction — `tips` declines with a reason.
    expect(plan.extractedNames).toEqual([]);
    expect(plan.newPageSource).toBeUndefined();
    expect(
      plan.skipped.some((s) => s.name === 'tips' && /not a valid content binding/.test(s.reason)),
    ).toBe(true);
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

  describe('boundary case — Hot Ham Communications secret-sauce.tsx: function-local articles (S2 shape)', () => {
    // articles is declared INSIDE the component body. The module-level scanner
    // is blind to function-local consts, so this is a clean no-op, not a skip
    // with a reason. This is intentional — S2 will address function-local arrays.
    it('extracts nothing and does not throw', () => {
      expect(() => {
        const plan: ExtractionPlan = planPageExtraction(
          HOT_HAM_SECRET_SAUCE,
          'src/pages/secret-sauce.tsx',
        );
        expect(plan.extractedNames).toEqual([]);
        expect(plan.newPageSource).toBeUndefined();
        expect(plan.content).toBeUndefined();
      }).not.toThrow();
    });
  });

  describe('boundary case — Hot Ham Communications portfolio.tsx: function-local nested + string-array (S3/S4 shapes)', () => {
    // portfolioItems: function-local, nested projects array (S3), icon component
    //   ref per-category (S1 retained-key shape but disqualified by nested field).
    // capabilities: function-local bare string[] (S4).
    // All are invisible to the module-level scanner — clean no-op, not a crash.
    // These shapes are committed follow-up slices; the decline is intentional.
    it('extracts nothing and does not throw', () => {
      expect(() => {
        const plan: ExtractionPlan = planPageExtraction(
          HOT_HAM_PORTFOLIO,
          'src/pages/portfolio.tsx',
        );
        expect(plan.extractedNames).toEqual([]);
        expect(plan.newPageSource).toBeUndefined();
        expect(plan.content).toBeUndefined();
      }).not.toThrow();
    });
  });
});
