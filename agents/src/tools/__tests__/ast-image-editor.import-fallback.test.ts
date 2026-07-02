import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let appPath = '';
const hoistedFs = { mkdirSync: mkdir, writeFile, readFile };
const hoistedPath = { join };

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(function () {
    const files = {
      view: vi.fn(async function ({ path: filePath }: { path: string }) {
        const fullPath = hoistedPath.join(appPath, filePath);
        const content = await hoistedFs.readFile(fullPath, 'utf-8');
        return {
          content,
          encoding: 'utf-8',
          path: filePath,
          lines: content.split('\n').length,
          size: content.length,
          truncated: false,
        };
      }),
      readText: vi.fn(async function ({ path: filePath }: { path: string }) {
        const fullPath = hoistedPath.join(appPath, filePath);
        return await hoistedFs.readFile(fullPath, 'utf-8');
      }),
      write: vi.fn(async function ({ path: filePath, content }: { path: string; content: string }) {
        const fullPath = hoistedPath.join(appPath, filePath);
        await hoistedFs.writeFile(fullPath, content);
        return { bytesWritten: content.length };
      }),
    };
    return { files, tasks: undefined };
  }),
}));

vi.mock('../../logging/index.js', () => {
  const instance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    logger: instance,
    Logger: {
      create: vi.fn().mockReturnValue(instance),
    },
  };
});

vi.mock('../../logging/events/index.js', () => ({
  toolAstEditEvents: {
    begin: vi.fn(),
    success: vi.fn(),
    failure: vi.fn(),
    editSuccess: vi.fn(),
    editFailure: vi.fn(),
  },
}));

vi.mock('../git-tool.js', () => ({
  GitTool: vi.fn().mockImplementation(function () {
    return {
      executeGitOperation: vi.fn().mockResolvedValue({ success: true }),
    };
  }),
}));

import { ASTImageEditor } from '../ast-image-editor.js';

const PAGE_FILE = 'src/pages/services.tsx';
const OLD_URL = '/assets/services/eng.jpg';
const NEW_SLOT_URL = '/airo-assets/images/pages/services/engineering-7';

describe('ASTImageEditor - import URL fallback (data array + map pattern)', function packageTests() {
  let editor: ASTImageEditor;
  let testDir: string;

  beforeEach(async function setup() {
    editor = new ASTImageEditor();
    testDir = await mkdtemp(join(tmpdir(), 'ast-import-fallback-'));
    appPath = join(testDir, 'app');
    await mkdir(join(appPath, 'src', 'pages'), { recursive: true });
  });

  afterEach(async function teardown() {
    await rm(testDir, { recursive: true, force: true });
  });

  it('rewrites the data-array image literal matching the label when JSX uses a dynamic s.image expression', async function objectArrayMap() {
    await writeFile(
      join(appPath, PAGE_FILE),
      `const services = [
  { title: 'Engineering', image: '${OLD_URL}' },
  { title: 'Design', image: '/assets/services/design.jpg' },
];
export function Services() {
  return services.map((s) => <img src={s.image} alt={s.title} />);
}
`
    );

    const result = await editor.replaceUrlInSource(
      appPath,
      {
        oldUrl: OLD_URL,
        newUrl: NEW_SLOT_URL,
        label: 'Engineering',
        scopeFile: PAGE_FILE,
      },
      'test-app'
    );

    expect(result.success).toBe(true);

    const updated = await readFile(join(appPath, PAGE_FILE), 'utf-8');
    const engLine = updated.split('\n').find((line) => line.includes('Engineering'));
    const designLine = updated.split('\n').find((line) => line.includes('Design'));
    expect(engLine).toContain(NEW_SLOT_URL);
    expect(engLine).not.toContain(OLD_URL);
    // Other records stay untouched.
    expect(designLine).toContain('/assets/services/design.jpg');
    expect(designLine).not.toContain(NEW_SLOT_URL);
  });

  it('rewrites by URL occurrence when no label is available', async function occurrenceFallback() {
    await writeFile(
      join(appPath, PAGE_FILE),
      `const services = [
  { image: '${OLD_URL}' },
];
export function Services() {
  return services.map((s) => <img src={s.image} />);
}
`
    );

    const result = await editor.replaceUrlInSource(
      appPath,
      {
        oldUrl: OLD_URL,
        newUrl: NEW_SLOT_URL,
        scopeFile: PAGE_FILE,
      },
      'test-app'
    );

    expect(result.success).toBe(true);

    const updated = await readFile(join(appPath, PAGE_FILE), 'utf-8');
    expect(updated).toContain(NEW_SLOT_URL);
    expect(updated).not.toContain(OLD_URL);
  });

  it('returns success:false (both strategies miss) when the URL is absent from source', async function bothFail() {
    await writeFile(
      join(appPath, PAGE_FILE),
      `const services = [
  { title: 'Engineering', image: '/assets/services/something-else.jpg' },
];
export function Services() {
  return services.map((s) => <img src={s.image} alt={s.title} />);
}
`
    );

    const result = await editor.replaceUrlInSource(
      appPath,
      {
        oldUrl: OLD_URL,
        newUrl: NEW_SLOT_URL,
        label: 'Engineering',
        scopeFile: PAGE_FILE,
      },
      'test-app'
    );

    expect(result.success).toBe(false);

    // Source is left untouched — no partial/garbage rewrite.
    const updated = await readFile(join(appPath, PAGE_FILE), 'utf-8');
    expect(updated).toContain('/assets/services/something-else.jpg');
    expect(updated).not.toContain(NEW_SLOT_URL);
  });
});
