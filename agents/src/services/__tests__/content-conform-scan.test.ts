/**
 * Tests for `conformExistingPages` — the first-turn, per-app, one-time scan that
 * conforms every `src/pages/*.tsx` once (closing the gap left by the on-create
 * conform, which only heals pages written via `command === 'create'`).
 *
 * These run against a REAL temp app dir with several pages, the same way the
 * auto-conform wiring tests do: customer files go through an injected
 * `WorkspaceFiles` (TempWorkspaceFiles, rooted at the temp appPath) while the
 * real content-scaffold machinery writes content via `node:fs` to that same
 * tree. That proves the scan's per-page conform, idempotency, and fail-safety
 * across the two mechanisms.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateForWorkspace } from '../../workspace/client.js';
import { conformExistingPages } from '../content-conform.js';
import { tempWorkspaceFactory } from './temp-workspace-files.js';

const VITE_CONFIG: string = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;

// A page with one clean extractable array — the scan must conform this one.
const EXTRACTABLE_PAGE: string = `const testimonials = [
  { quote: "great", name: "Jordan" },
  { quote: "love it", name: "Priya" },
];

export default function HomePage() {
  return <div>{testimonials.map((t) => <p key={t.name}>{t.quote}</p>)}</div>;
}
`;

// A page whose only array is genuinely declinable: every field is a non-literal
// component ref, so nothing lifts to the content layer (a partial split needs at
// least one literal field). The scan must leave it untouched.
const DECLINABLE_PAGE: string = `import { Zap } from 'lucide-react';

const features = [
  { icon: Zap },
  { icon: Zap },
];

export default function FeaturesPage() {
  return <div>{features.map((f, i) => <h3 key={i}><f.icon/></h3>)}</div>;
}
`;

// A page with no extractable arrays at all — pure static JSX, a no-op.
const STATIC_PAGE: string = `export default function AboutPage() {
  return <div><h1>About us</h1><p>Static copy.</p></div>;
}
`;

interface AppLayout {
  appPath: string;
  factory: CreateForWorkspace;
}

function setupApp(pages: Record<string, string>): AppLayout {
  const created: string = mkdtempSync(join(tmpdir(), 'conform-scan-'));
  mkdirSync(join(created, 'src', 'pages'), { recursive: true });
  writeFileSync(join(created, 'vite.config.ts'), VITE_CONFIG);
  for (const [rel, source] of Object.entries(pages)) {
    const full: string = join(created, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, source);
  }
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

describe('conformExistingPages — scan', () => {
  it('conforms the extractable page, leaves the declinable and static pages untouched, and reports correct counts', async () => {
    const layout: AppLayout = setupApp({
      'src/pages/home.tsx': EXTRACTABLE_PAGE,
      'src/pages/features.tsx': DECLINABLE_PAGE,
      'src/pages/about.tsx': STATIC_PAGE,
    });
    dir = layout.appPath;

    const summary: { scanned: number; conformed: string[]; skipped: number } =
      await conformExistingPages({
        appId: 'app-scan',
        appPath: layout.appPath,
        workspaceFactory: layout.factory,
      });

    expect(summary.scanned).toBe(3);
    expect(summary.conformed).toEqual(['src/pages/home.tsx']);
    expect(summary.skipped).toBe(2);

    // The extractable page was rewired into the content layer.
    const home: string = readFileSync(join(dir, 'src/pages/home.tsx'), 'utf8');
    expect(home).toMatch(/import \{ home \} from 'virtual:content'/);
    expect(home).toMatch(/home\.testimonials\.map\(/);
    expect(home).not.toMatch(/const testimonials =/);
    expect(existsSync(join(dir, 'src/content/pages/home.json'))).toBe(true);
    expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toMatch(/contentPlugin/);

    // The declinable page is byte-unchanged; no content scaffolded for it.
    expect(readFileSync(join(dir, 'src/pages/features.tsx'), 'utf8')).toBe(DECLINABLE_PAGE);
    expect(existsSync(join(dir, 'src/content/pages/features.json'))).toBe(false);

    // The static page is byte-unchanged.
    expect(readFileSync(join(dir, 'src/pages/about.tsx'), 'utf8')).toBe(STATIC_PAGE);
  });

  it('treats an already-conformed page as a no-op (no double-extraction)', async () => {
    const layout: AppLayout = setupApp({ 'src/pages/home.tsx': EXTRACTABLE_PAGE });
    dir = layout.appPath;

    const first: { conformed: string[] } = await conformExistingPages({
      appId: 'app-idem',
      appPath: layout.appPath,
      workspaceFactory: layout.factory,
    });
    expect(first.conformed).toEqual(['src/pages/home.tsx']);

    const conformedPage: string = readFileSync(join(dir, 'src/pages/home.tsx'), 'utf8');
    const conformedJson: string = readFileSync(join(dir, 'src/content/pages/home.json'), 'utf8');

    // A 2nd scan (mirrors the 2nd conversation) must be a pure no-op.
    const second: { scanned: number; conformed: string[]; skipped: number } =
      await conformExistingPages({
        appId: 'app-idem',
        appPath: layout.appPath,
        workspaceFactory: layout.factory,
      });

    expect(second.scanned).toBe(1);
    expect(second.conformed).toEqual([]);
    expect(second.skipped).toBe(1);
    expect(readFileSync(join(dir, 'src/pages/home.tsx'), 'utf8')).toBe(conformedPage);
    expect(readFileSync(join(dir, 'src/content/pages/home.json'), 'utf8')).toBe(conformedJson);
  });

  it('isolates a per-page failure: a page that throws does not stop the others, and the scan never throws', async () => {
    const layout: AppLayout = setupApp({
      'src/pages/aaa.tsx': EXTRACTABLE_PAGE,
      'src/pages/zzz.tsx': EXTRACTABLE_PAGE,
    });
    dir = layout.appPath;

    // Force scaffold to blow up ONLY for the first page (binding 'aaa'), leaving
    // the second (binding 'zzz') to conform normally. scaffoldContent is the
    // narrow seam the per-page conform funnels writes through.
    const scaffold = await import('../../tools/content-scaffold.js');
    const real = scaffold.scaffoldContent;
    vi.spyOn(scaffold, 'scaffoldContent').mockImplementation(
      async (contentDir: string, opts: Parameters<typeof real>[1]) => {
        if (opts.name === 'aaa') throw new Error('boom');
        return real(contentDir, opts);
      },
    );

    const summary: { scanned: number; conformed: string[]; skipped: number } =
      await conformExistingPages({
        appId: 'app-isolate',
        appPath: layout.appPath,
        workspaceFactory: layout.factory,
      });

    // aaa failed (rolled back → not recorded); zzz still conformed.
    expect(summary.scanned).toBe(2);
    expect(summary.conformed).toEqual(['src/pages/zzz.tsx']);
    expect(summary.skipped).toBe(1);

    // aaa's page is byte-restored; zzz is rewired.
    expect(readFileSync(join(dir, 'src/pages/aaa.tsx'), 'utf8')).toBe(EXTRACTABLE_PAGE);
    expect(readFileSync(join(dir, 'src/pages/zzz.tsx'), 'utf8')).toMatch(/virtual:content/);
  });

  it('fail-safe: returns a zeroed summary (does not throw) when the workspace is unavailable', async () => {
    const layout: AppLayout = setupApp({ 'src/pages/home.tsx': EXTRACTABLE_PAGE });
    dir = layout.appPath;

    const summary: { scanned: number; conformed: string[]; skipped: number } =
      await conformExistingPages({
        appId: 'app-noworkspace',
        appPath: layout.appPath,
        workspaceFactory: () => null,
      });

    expect(summary).toEqual({ scanned: 0, conformed: [], skipped: 0 });
    // No content scaffolded — the page is untouched.
    expect(existsSync(join(dir, 'src/content'))).toBe(false);
  });

  it('only considers .tsx files under src/pages (ignores non-tsx siblings)', async () => {
    const layout: AppLayout = setupApp({
      'src/pages/home.tsx': EXTRACTABLE_PAGE,
      'src/pages/styles.css': 'body { color: red; }',
      'src/pages/data.json': '{}',
    });
    dir = layout.appPath;

    const summary: { scanned: number } = await conformExistingPages({
      appId: 'app-tsx-only',
      appPath: layout.appPath,
      workspaceFactory: layout.factory,
    });

    expect(summary.scanned).toBe(1);
  });
});
