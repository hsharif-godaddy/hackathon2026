/**
 * Tests for the `trigger: 'heal'` entry point in `conformPageToContentLayer`.
 *
 * Heal bypasses the `isPageCreate` gate — it runs the extractable-check →
 * tryConform path unconditionally for the named page. The 'create' path must
 * remain byte-identical in behaviour.
 *
 * Uses the same `TempWorkspaceFiles` double the scan/partial tests use.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateForWorkspace } from '../../workspace/client.js';
import { conformPageToContentLayer, type ConformInput, type ConformOutcome } from '../content-conform.js';
import { tempWorkspaceFactory } from './temp-workspace-files.js';

// GitUtils is mocked so commitConform can be asserted without a real git repo.
vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.commitFilesIfChanged = vi.fn().mockResolvedValue(true);
  }),
}));

// createForWorkspace is called directly by commitConform (not via the injected
// factory). We return a stub with a fake tasks object so GitUtils can be
// constructed without a real workspace supervisor.
vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn().mockReturnValue({ tasks: {} }),
}));

import { GitUtils } from '../../utils/git.js';

const VITE_CONFIG: string = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;

// A page with one extractable array — heal must conform it even without isPageCreate.
const EXTRACTABLE_PAGE: string = `const services = [
  { title: 'Web Design', desc: 'We build sites' },
  { title: 'SEO', desc: 'We rank sites' },
];

export default function ServicesPage() {
  return <div>{services.map((s) => <p key={s.title}>{s.desc}</p>)}</div>;
}
`;

// A page with no extractable arrays — heal must be a no-op (note: null).
const STATIC_PAGE: string = `export default function StaticPage() {
  return <div><h1>Nothing to extract</h1></div>;
}
`;

interface AppLayout {
  appPath: string;
  factory: CreateForWorkspace;
}

function setupApp(pageSource: string): AppLayout {
  const created: string = mkdtempSync(join(tmpdir(), 'conform-heal-'));
  mkdirSync(join(created, 'src', 'pages'), { recursive: true });
  writeFileSync(join(created, 'vite.config.ts'), VITE_CONFIG);
  writeFileSync(join(created, 'src', 'pages', 'services.tsx'), pageSource);
  return { appPath: created, factory: tempWorkspaceFactory(created) };
}

async function conformPage(layout: AppLayout, appId: string, overrides: Partial<ConformInput> = {}): Promise<ConformOutcome> {
  return conformPageToContentLayer({
    appId,
    appPath: layout.appPath,
    fullPath: join(layout.appPath, 'src/pages/services.tsx'),
    command: 'edit',
    isPageCreate: false,
    workspaceFactory: layout.factory,
    ...overrides,
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

describe('conformPageToContentLayer — heal commits to git on apply', () => {
  it('commits all touched paths after a successful heal so the result survives a container restart', async () => {
    const layout: AppLayout = setupApp(EXTRACTABLE_PAGE);
    dir = layout.appPath;

    vi.mocked(GitUtils).mockClear();
    const outcome: ConformOutcome = await conformPage(layout, 'app-commit-heal', { trigger: 'heal' });

    // Must have applied.
    expect(outcome.note).not.toBeNull();
    // GitUtils must have been constructed (commitConform ran).
    expect(vi.mocked(GitUtils)).toHaveBeenCalled();
    // commitFilesIfChanged must have been called with the page path and content paths.
    const instance: Record<string, ReturnType<typeof vi.fn>> =
      vi.mocked(GitUtils).mock.results.at(-1)?.value as Record<string, ReturnType<typeof vi.fn>>;
    expect(instance.commitFilesIfChanged).toHaveBeenCalledOnce();
    const [, , paths]: [string, string, string[]] =
      instance.commitFilesIfChanged.mock.calls[0] as [string, string, string[]];
    expect(paths).toContain('src/pages/services.tsx');
    expect(paths).toContain('vite.config.ts');
    // Content directory paths must be staged.
    expect(paths.some((p: string) => p.includes('src/content'))).toBe(true);
  });

  it('does NOT commit when nothing is conformed (note: null)', async () => {
    const created: string = mkdtempSync(join(tmpdir(), 'conform-heal-nocommit-'));
    dir = created;
    mkdirSync(join(created, 'src', 'pages'), { recursive: true });
    writeFileSync(join(created, 'vite.config.ts'), VITE_CONFIG);
    writeFileSync(join(created, 'src', 'pages', 'services.tsx'), STATIC_PAGE);
    const factory: CreateForWorkspace = tempWorkspaceFactory(created);

    vi.mocked(GitUtils).mockClear();
    const outcome: ConformOutcome = await conformPageToContentLayer({
      appId: 'app-nocommit',
      appPath: created,
      fullPath: join(created, 'src/pages/services.tsx'),
      command: 'edit',
      isPageCreate: false,
      trigger: 'heal',
      workspaceFactory: factory,
    });

    expect(outcome.note).toBeNull();
    expect(vi.mocked(GitUtils)).not.toHaveBeenCalled();
  });
});

describe('conformPageToContentLayer — heal trigger', () => {
  it('heal on a conformable page applies (note non-null)', async () => {
    const layout: AppLayout = setupApp(EXTRACTABLE_PAGE);
    dir = layout.appPath;

    const outcome: ConformOutcome = await conformPage(layout, 'app-heal-1', { trigger: 'heal' });

    expect(outcome.note).not.toBeNull();
    expect(outcome.note).toContain('virtual:content');
    // Conformed page no longer has the local const.
    expect(
      existsSync(join(layout.appPath, 'src', 'content', 'pages', 'services.json')),
    ).toBe(true);
    const pageSource: string = readFileSync(
      join(layout.appPath, 'src', 'pages', 'services.tsx'),
      'utf8',
    );
    expect(pageSource).toContain('virtual:content');
    expect(pageSource).not.toMatch(/const services\s*=/);
  });

  it('heal on a page with no extractable arrays returns { note: null }', async () => {
    const created: string = mkdtempSync(join(tmpdir(), 'conform-heal-static-'));
    dir = created;
    mkdirSync(join(created, 'src', 'pages'), { recursive: true });
    writeFileSync(join(created, 'vite.config.ts'), VITE_CONFIG);
    writeFileSync(join(created, 'src', 'pages', 'services.tsx'), STATIC_PAGE);
    const factory: CreateForWorkspace = tempWorkspaceFactory(created);

    const outcome: ConformOutcome = await conformPageToContentLayer({
      appId: 'app-heal-static',
      appPath: created,
      fullPath: join(created, 'src/pages/services.tsx'),
      command: 'edit',
      isPageCreate: false,
      trigger: 'heal',
      workspaceFactory: factory,
    });

    expect(outcome.note).toBeNull();
  });

  it('create path is unchanged: non-page-create returns { note: null } when trigger is omitted', async () => {
    const layout: AppLayout = setupApp(EXTRACTABLE_PAGE);
    dir = layout.appPath;

    // No trigger (defaults to 'create'), isPageCreate: false → no-op.
    const outcome: ConformOutcome = await conformPage(layout, 'app-create-nogate', {
      command: 'edit',
      isPageCreate: false,
    });

    expect(outcome.note).toBeNull();
    // Page source must be untouched.
    const pageSource: string = readFileSync(
      join(layout.appPath, 'src', 'pages', 'services.tsx'),
      'utf8',
    );
    expect(pageSource).toContain('const services');
  });

  it('create path is unchanged: trigger=create with isPageCreate:false returns { note: null }', async () => {
    const layout: AppLayout = setupApp(EXTRACTABLE_PAGE);
    dir = layout.appPath;

    const outcome: ConformOutcome = await conformPage(layout, 'app-create-explicit', {
      trigger: 'create',
      isPageCreate: false,
    });

    expect(outcome.note).toBeNull();
  });
});
