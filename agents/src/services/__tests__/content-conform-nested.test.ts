/**
 * Tests for S3 — nested collections healed end-to-end through
 * `conformPageToContentLayer`.
 *
 * Load-bearing for the CP3 recursive id-strip: scaffold's `ensureCollectionIds`
 * mints an `id` on every object that is an array element at ANY depth, so the
 * on-disk value has ids on inner (`rows[]`, `projects[]`) elements too. The
 * round-trip validator must strip ids recursively on BOTH the pre-scaffold clone
 * (no ids) and the on-disk value (ids at all depths); a top-level-only strip
 * leaves inner ids on one side, the comparison false-fails, and every nested
 * heal rolls back. These tests fail (rollback → note null) without the recursive
 * strip.
 *
 * Covers both heal paths: batch (module-level nested, no conformId) and
 * id-addressed (function-local nested + a top-level retained `icon`).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateForWorkspace } from '../../workspace/client.js';
import { analyzeExtractable, type ExtractableArray } from '../../tools/content-extract.js';
import { conformPageToContentLayer, type ConformOutcome } from '../content-conform.js';
import { tempWorkspaceFactory } from './temp-workspace-files.js';

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.commitFilesIfChanged = vi.fn().mockResolvedValue(true);
  }),
}));

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn().mockReturnValue({ tasks: {} }),
}));

const VITE_CONFIG: string = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;

// Module-level nested collection (array of objects, each with a nested array of
// objects). Heals via the batch path (no conformId). No retained refs.
const MODULE_NESTED_PAGE: string = `const faqs = [
  { topic: 'Billing', items: [{ q: 'How much?', a: 'A lot' }, { q: 'When?', a: 'Monthly' }] },
  { topic: 'Support', items: [{ q: 'Hours?', a: '24/7' }] },
];

export default function FaqPage() {
  return (
    <div>
      {faqs.map((group, gi) => (
        <section key={gi}>
          <h2>{group.topic}</h2>
          {group.items.map((it, ii) => <p key={ii}>{it.q}: {it.a}</p>)}
        </section>
      ))}
    </div>
  );
}
`;

// Function-local nested collection with a top-level retained component ref
// (portfolioItems shape). Heals via the id-addressed path.
const FUNCTION_LOCAL_NESTED_PAGE: string = `import { Users } from 'lucide-react';

export default function PortfolioPage() {
  const portfolioItems = [
    {
      category: 'Government Affairs',
      icon: Users,
      projects: [
        { title: 'Advocacy', tags: ['Gov', 'Comms'] },
      ],
    },
  ];
  return (
    <div>
      {portfolioItems.map((category, i) => (
        <section key={i}>
          <h2>{category.category}</h2>
          {category.projects.map((proj, j) => (
            <article key={j}>{proj.title}</article>
          ))}
        </section>
      ))}
    </div>
  );
}
`;

function setupApp(pageSource: string): { appPath: string; factory: CreateForWorkspace } {
  const created: string = mkdtempSync(join(tmpdir(), 'conform-nested-'));
  mkdirSync(join(created, 'src', 'pages'), { recursive: true });
  writeFileSync(join(created, 'vite.config.ts'), VITE_CONFIG);
  writeFileSync(join(created, 'src', 'pages', 'services.tsx'), pageSource);
  return { appPath: created, factory: tempWorkspaceFactory(created) };
}

let dir: string | undefined;

beforeEach(() => {
  dir = undefined;
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('conformPageToContentLayer — nested collection heal (S3)', () => {
  it('batch path: module-level nested collection commits with the nested structure lifted', async () => {
    const layout: { appPath: string; factory: CreateForWorkspace } = setupApp(MODULE_NESTED_PAGE);
    dir = layout.appPath;

    const outcome: ConformOutcome = await conformPageToContentLayer({
      appId: 'app-nested-batch',
      appPath: layout.appPath,
      fullPath: join(layout.appPath, 'src/pages/services.tsx'),
      command: 'edit',
      isPageCreate: false,
      trigger: 'heal',
      workspaceFactory: layout.factory,
    });

    // Applied, NOT rolled back — this is what the recursive id-strip protects.
    expect(outcome.note).not.toBeNull();

    const content: Record<string, unknown> = JSON.parse(
      readFileSync(join(layout.appPath, 'src', 'content', 'pages', 'services.json'), 'utf8'),
    ) as Record<string, unknown>;
    const faqs: Record<string, unknown>[] = content.faqs as Record<string, unknown>[];
    expect(faqs).toHaveLength(2);
    // Nested items[] lifted; leaf literals preserved.
    const items: Record<string, unknown>[] = faqs[0].items as Record<string, unknown>[];
    expect(items[0].q).toBe('How much?');
    expect(items[0].a).toBe('A lot');
    // Scaffold minted ids at BOTH depths (top-level faqs[] and nested items[]).
    expect(typeof faqs[0].id).toBe('string');
    expect(typeof items[0].id).toBe('string');

    const pageSource: string = readFileSync(join(layout.appPath, 'src', 'pages', 'services.tsx'), 'utf8');
    expect(pageSource).not.toMatch(/const faqs\s*=/);
    expect(pageSource).toContain('services.faqs.map');
    // Inner map reads the loop param — untouched.
    expect(pageSource).toContain('group.items.map');
  });

  it('id-addressed path: function-local nested collection with a retained icon commits', async () => {
    const layout: { appPath: string; factory: CreateForWorkspace } = setupApp(FUNCTION_LOCAL_NESTED_PAGE);
    dir = layout.appPath;
    const conformId: string = analyzeExtractable(FUNCTION_LOCAL_NESTED_PAGE, 'services').extractions.find(
      (e: ExtractableArray): boolean => e.arrayName === 'portfolioItems',
    )!.locId!;

    const outcome: ConformOutcome = await conformPageToContentLayer({
      appId: 'app-nested-id',
      appPath: layout.appPath,
      fullPath: join(layout.appPath, 'src/pages/services.tsx'),
      command: 'edit',
      isPageCreate: false,
      trigger: 'heal',
      conformId,
      workspaceFactory: layout.factory,
    });

    expect(outcome.note).not.toBeNull();

    const content: Record<string, unknown> = JSON.parse(
      readFileSync(join(layout.appPath, 'src', 'content', 'pages', 'services.json'), 'utf8'),
    ) as Record<string, unknown>;
    const items: Record<string, unknown>[] = content.portfolioItems as Record<string, unknown>[];
    expect(items[0].category).toBe('Government Affairs');
    // icon (a component ref) is NOT in content — retained locally in the page.
    expect(items[0].icon).toBeUndefined();
    // Nested projects[] with nested tags[] scalar array lifted.
    const projects: Record<string, unknown>[] = items[0].projects as Record<string, unknown>[];
    expect(projects[0].title).toBe('Advocacy');
    expect(projects[0].tags).toEqual(['Gov', 'Comms']);

    const pageSource: string = readFileSync(join(layout.appPath, 'src', 'pages', 'services.tsx'), 'utf8');
    expect(pageSource).not.toMatch(/const portfolioItems\s*=/);
    expect(pageSource).toContain('services.portfolioItems.map');
    expect(pageSource).toContain('portfolioItemsMeta'); // icon remainder retained locally
    expect(pageSource).toContain('category.projects.map'); // inner map untouched
  });
});
