/**
 * Behavior-preservation tests for the partial-split conform (CP2): a page whose
 * `.map`-backed array mixes literal text with a retained non-literal field
 * (`icon: Target`). The literal text must lift to `virtual:content` while the
 * retained field stays in a local `const <name>Meta` remainder, and the render
 * must survive byte-for-byte in outcome.
 *
 * These run against a REAL temp app dir through the same injected
 * `TempWorkspaceFiles` double the scan tests use — customer files via the
 * Workspace API, content via scaffold's `node:fs`, both rooted at one temp tree.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateForWorkspace } from '../../workspace/client.js';
import { conformPageToContentLayer, type ConformOutcome } from '../content-conform.js';
import { tempWorkspaceFactory } from './temp-workspace-files.js';

const VITE_CONFIG: string = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;

// stats mixes literal text (value/label → content) with a retained icon tag.
const PARTIAL_PAGE: string = `import { Target } from 'lucide-react';

const stats = [
  { value: 'DOJ', label: 'CCW', icon: Target },
  { value: 'NRA', label: 'Certified', icon: Target },
];

export default function HomePage() {
  return <>{stats.map((s, i) => <div key={i}><span>{s.value}</span><s.icon/></div>)}</>;
}
`;

// The same array, but a retained read leaks OUTSIDE the map callback — the gate
// declines it entirely (array referenced beyond `.map`), so conform is a no-op.
const OUTSIDE_CALLBACK_PAGE: string = `import { Target } from 'lucide-react';

const stats = [
  { value: 'DOJ', icon: Target },
  { value: 'NRA', icon: Target },
];

const FirstIcon = stats[0].icon;

export default function HomePage() {
  return <>{stats.map((s, i) => <div key={i}><span>{s.value}</span><s.icon/></div>)}</>;
}
`;

interface AppLayout {
  appPath: string;
  factory: CreateForWorkspace;
}

function setupApp(pageSource: string): AppLayout {
  const created: string = mkdtempSync(join(tmpdir(), 'conform-partial-'));
  mkdirSync(join(created, 'src', 'pages'), { recursive: true });
  writeFileSync(join(created, 'vite.config.ts'), VITE_CONFIG);
  writeFileSync(join(created, 'src', 'pages', 'index.tsx'), pageSource);
  return { appPath: created, factory: tempWorkspaceFactory(created) };
}

async function conformIndex(layout: AppLayout, appId: string): Promise<ConformOutcome> {
  return conformPageToContentLayer({
    appId,
    appPath: layout.appPath,
    fullPath: join(layout.appPath, 'src/pages/index.tsx'),
    command: 'create',
    isPageCreate: true,
    workspaceFactory: layout.factory,
  });
}

let dir: string | undefined;

beforeEach(() => {
  dir = undefined;
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('conformPageToContentLayer — partial split', () => {
  it('applies the split: content holds text, page keeps the statsMeta remainder', async () => {
    const layout: AppLayout = setupApp(PARTIAL_PAGE);
    dir = layout.appPath;

    const outcome: ConformOutcome = await conformIndex(layout, 'app-partial');

    // Applied (not rolled back).
    expect(outcome.note).not.toBeNull();

    const page: string = readFileSync(join(dir, 'src/pages/index.tsx'), 'utf8');
    // Content is iterated from virtual:content…
    expect(page).toMatch(/import \{ home \} from 'virtual:content'/);
    expect(page).toMatch(/home\.stats\.map/);
    // …the local remainder survives (so the icon render survives)…
    expect(page).toMatch(/const statsMeta =/);
    expect(page).toMatch(/statsMeta\[i\]\.icon/);
    // …and the original full const is gone.
    expect(page).not.toMatch(/const stats = \[/);

    // Content JSON written with only the literal (text) fields.
    const json: string = readFileSync(join(dir, 'src/content/pages/home.json'), 'utf8');
    const parsed: Record<string, unknown> = JSON.parse(json) as Record<string, unknown>;
    const rows: Record<string, unknown>[] = parsed.stats as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ value: 'DOJ', label: 'CCW' });
    expect(rows[0]).not.toHaveProperty('icon');

    // vite plugin registered; validateConform passed (no rollback → note set).
    expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toMatch(/contentPlugin/);
  });

  it('rolls back to a no-op when a retained read appears outside the callback', async () => {
    const layout: AppLayout = setupApp(OUTSIDE_CALLBACK_PAGE);
    dir = layout.appPath;

    const outcome: ConformOutcome = await conformIndex(layout, 'app-outside');

    // Declined — the gate rejects `stats` (referenced beyond `.map`), so nothing
    // is conformed and the page is byte-restored.
    expect(outcome.note).toBeNull();
    expect(readFileSync(join(dir, 'src/pages/index.tsx'), 'utf8')).toBe(OUTSIDE_CALLBACK_PAGE);
    expect(existsSync(join(dir, 'src/content/pages/home.json'))).toBe(false);
  });
});
