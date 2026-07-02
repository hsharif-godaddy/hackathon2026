/**
 * Tests for the id-addressed heal path (CP5): `conformPageToContentLayer` threads
 * a `conformId` (declarator loc-id) into `planPageExtraction`, so a click on a
 * function-local conformable array heals ONLY that declarator — binding-precise.
 *
 * The conformId is derived from `analyzeExtractable` (the same loc-id the
 * source-mapper stamps onto `data-dev-conformable-id`), so the test never
 * hand-computes line/column offsets.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// A page whose extractable array is declared INSIDE the component function
// (function-local), not at module level. The id-addressed heal must still apply.
const FUNCTION_LOCAL_PAGE: string = `export default function ServicesPage() {
  const services = [
    { title: 'Web Design', desc: 'We build sites' },
    { title: 'SEO', desc: 'We rank sites' },
  ];
  return <div>{services.map((s) => <p key={s.title}>{s.desc}</p>)}</div>;
}
`;

function locIdFor(source: string, arrayName: string): string {
  const target: ExtractableArray | undefined = analyzeExtractable(source, 'services').extractions.find(
    (p: ExtractableArray): boolean => p.arrayName === arrayName,
  );
  if (!target || target.locId === null) {
    throw new Error(`no extractable array '${arrayName}' with a loc-id in test fixture`);
  }
  return target.locId;
}

function setupApp(pageSource: string): { appPath: string; factory: CreateForWorkspace } {
  const created: string = mkdtempSync(join(tmpdir(), 'conform-id-'));
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

describe('conformPageToContentLayer — id-addressed heal (conformId)', () => {
  it('heals a function-local array addressed by conformId (note non-null, const gone)', async () => {
    const layout: { appPath: string; factory: CreateForWorkspace } = setupApp(FUNCTION_LOCAL_PAGE);
    dir = layout.appPath;
    const conformId: string = locIdFor(FUNCTION_LOCAL_PAGE, 'services');

    const outcome: ConformOutcome = await conformPageToContentLayer({
      appId: 'app-conformid-local',
      appPath: layout.appPath,
      fullPath: join(layout.appPath, 'src/pages/services.tsx'),
      command: 'edit',
      isPageCreate: false,
      trigger: 'heal',
      conformId,
      workspaceFactory: layout.factory,
    });

    expect(outcome.note).not.toBeNull();
    expect(outcome.note).toContain('virtual:content');
    expect(existsSync(join(layout.appPath, 'src', 'content', 'pages', 'services.json'))).toBe(true);
    const pageSource: string = readFileSync(join(layout.appPath, 'src', 'pages', 'services.tsx'), 'utf8');
    expect(pageSource).toContain('virtual:content');
    // The function-local declarator must be gone from its scope.
    expect(pageSource).not.toMatch(/const services\s*=\s*\[/);
  });

  it('declines (note null) when the conformId matches no declarator', async () => {
    const layout: { appPath: string; factory: CreateForWorkspace } = setupApp(FUNCTION_LOCAL_PAGE);
    dir = layout.appPath;

    const outcome: ConformOutcome = await conformPageToContentLayer({
      appId: 'app-conformid-nomatch',
      appPath: layout.appPath,
      fullPath: join(layout.appPath, 'src/pages/services.tsx'),
      command: 'edit',
      isPageCreate: false,
      trigger: 'heal',
      conformId: 'L999C99',
      workspaceFactory: layout.factory,
    });

    expect(outcome.note).toBeNull();
    // Page untouched — the local const still there, no content written.
    const pageSource: string = readFileSync(join(layout.appPath, 'src', 'pages', 'services.tsx'), 'utf8');
    expect(pageSource).toContain('const services');
    expect(existsSync(join(layout.appPath, 'src', 'content', 'pages', 'services.json'))).toBe(false);
  });
});
