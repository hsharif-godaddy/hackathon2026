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

  it('object element holds a non-serializable value (identifier / component ref)', () => {
    const code: string = `
      import { Zap } from 'lucide-react';
      const features = [
        { icon: Zap, title: "A", desc: "d" },
        { icon: Zap, title: "B", desc: "e" },
      ];
      export default function P() {
        return <div>{features.map((f) => <h3 key={f.title}>{f.title}</h3>)}</div>;
      }
    `;
    const v: { extracted: boolean; reason: string | null } = verdict(code, 'features');
    expect(v.extracted).toBe(false);
    expect(v.reason).toMatch(/non-serializable|identifier|literal/i);
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
    expect(report.extractions.map((p) => p.arrayName)).toEqual(['testimonials']);
    expect(report.skipped.map((s) => s.name).sort()).toEqual(['features', 'products']);
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
