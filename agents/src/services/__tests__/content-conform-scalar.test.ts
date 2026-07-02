/**
 * Tests for S4 — bare scalar arrays (`const capabilities = ['a','b','c']`) healed
 * end-to-end through `conformPageToContentLayer`.
 *
 * These are the load-bearing checks for the CP3 round-trip symmetry fix: before
 * `validateConform`'s `want`/`got` mappings were both object-guarded, a scalar
 * array's `want` destructured each string into `{0:'…',1:'…'}`, the round-trip
 * comparison false-failed, and every scalar heal rolled back (note: null). A
 * unit test on `content-extract` cannot see that — only driving the full
 * snapshot→apply→validate→commit pipeline surfaces it.
 *
 * Covers both heal paths: batch (module-level, no conformId) and id-addressed
 * (function-local, conformId). The stored content shape must be a NATIVE scalar
 * array (`["a","b"]`), not wrapped objects.
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

// Module-level bare string[] iterated by a single `.map` with a plain param read.
const MODULE_SCALAR_PAGE: string = `const capabilities = ['Strategy', 'Media', 'Design'];

export default function ServicesPage() {
  return <ul>{capabilities.map((c) => <li key={c}>{c}</li>)}</ul>;
}
`;

// Function-local bare string[] — heals only via the id-addressed path.
const FUNCTION_LOCAL_SCALAR_PAGE: string = `export default function ServicesPage() {
  const capabilities = ['Strategy', 'Media', 'Design'];
  return <ul>{capabilities.map((c) => <li key={c}>{c}</li>)}</ul>;
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
  const created: string = mkdtempSync(join(tmpdir(), 'conform-scalar-'));
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

describe('conformPageToContentLayer — scalar array heal (S4)', () => {
  it('batch path: module-level string[] commits with a native scalar-array content shape', async () => {
    const layout: { appPath: string; factory: CreateForWorkspace } = setupApp(MODULE_SCALAR_PAGE);
    dir = layout.appPath;

    const outcome: ConformOutcome = await conformPageToContentLayer({
      appId: 'app-scalar-batch',
      appPath: layout.appPath,
      fullPath: join(layout.appPath, 'src/pages/services.tsx'),
      command: 'edit',
      isPageCreate: false,
      trigger: 'heal',
      workspaceFactory: layout.factory,
    });

    // Applied (NOT rolled back — this is what the CP3 symmetry fix protects).
    expect(outcome.note).not.toBeNull();
    expect(outcome.note).toContain('virtual:content');

    // Content JSON holds a NATIVE scalar array, not wrapped objects.
    const contentRaw: string = readFileSync(
      join(layout.appPath, 'src', 'content', 'pages', 'services.json'),
      'utf8',
    );
    const content: Record<string, unknown> = JSON.parse(contentRaw) as Record<string, unknown>;
    expect(content.capabilities).toEqual(['Strategy', 'Media', 'Design']);

    // Page rewritten: local const gone, binding imported, map callee prefixed,
    // loop-var body `{c}` left byte-unchanged (NOT `{c.value}`).
    const pageSource: string = readFileSync(join(layout.appPath, 'src', 'pages', 'services.tsx'), 'utf8');
    expect(pageSource).not.toMatch(/const\s+capabilities\s*=/);
    expect(pageSource).toContain('virtual:content');
    expect(pageSource).toContain('services.capabilities.map');
    expect(pageSource).toContain('<li key={c}>{c}</li>');
  });

  it('id-addressed path: function-local string[] commits with a native scalar-array content shape', async () => {
    const layout: { appPath: string; factory: CreateForWorkspace } = setupApp(FUNCTION_LOCAL_SCALAR_PAGE);
    dir = layout.appPath;
    const conformId: string = locIdFor(FUNCTION_LOCAL_SCALAR_PAGE, 'capabilities');

    const outcome: ConformOutcome = await conformPageToContentLayer({
      appId: 'app-scalar-id',
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

    const contentRaw: string = readFileSync(
      join(layout.appPath, 'src', 'content', 'pages', 'services.json'),
      'utf8',
    );
    const content: Record<string, unknown> = JSON.parse(contentRaw) as Record<string, unknown>;
    expect(content.capabilities).toEqual(['Strategy', 'Media', 'Design']);

    const pageSource: string = readFileSync(join(layout.appPath, 'src', 'pages', 'services.tsx'), 'utf8');
    expect(pageSource).not.toMatch(/const\s+capabilities\s*=/);
    expect(pageSource).toContain('services.capabilities.map');
    expect(pageSource).toContain('<li key={c}>{c}</li>');
  });
});
