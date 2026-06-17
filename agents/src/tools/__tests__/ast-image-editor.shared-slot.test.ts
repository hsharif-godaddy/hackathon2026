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
import { imageSlotUrl } from '../../utils/slot-reference-utils.js';

const DATA_FILE = 'src/data/trucks.ts';
const SLOT_PATH = 'pages/home/featured-truck';

describe('ASTImageEditor - shared slot fork', function packageTests() {
  let editor: ASTImageEditor;
  let testDir: string;

  beforeEach(async function setup() {
    editor = new ASTImageEditor();
    testDir = await mkdtemp(join(tmpdir(), 'ast-shared-slot-'));
    appPath = join(testDir, 'app');
    await mkdir(join(appPath, 'src', 'data'), { recursive: true });
  });

  afterEach(async function teardown() {
    await rm(testDir, { recursive: true, force: true });
  });

  it('replaces only the targeted occurrence in a data collection file', async function dataCollection() {
    await writeFile(
      join(appPath, DATA_FILE),
      `export const trucks = [
  { name: 'A', image: '${imageSlotUrl(SLOT_PATH)}' },
  { name: 'B', image: '${imageSlotUrl(SLOT_PATH)}' },
  { name: 'C', image: '${imageSlotUrl(SLOT_PATH)}' },
];
`
    );

    const result = await editor.replaceSharedSlotReference(
      appPath,
      {
        elementInfo: {
          tagName: 'img',
          className: 'truck-image',
          id: '',
          selector: 'li:nth-child(2) > img:nth-child(1)',
          devContext: {
            fileName: 'src/pages/home.tsx',
            componentName: 'HomePage',
            lineNumber: 20,
          },
        },
        imageInfo: {
          type: 'img',
          currentUrl: imageSlotUrl(SLOT_PATH),
        },
        newImageUrl: imageSlotUrl(`${SLOT_PATH}-2`),
        oldSlotPath: SLOT_PATH,
        newSlotPath: `${SLOT_PATH}-2`,
        occurrenceIndex: 1,
      },
      'test-app'
    );

    expect(result.success).toBe(true);

    const updated = await readFile(join(appPath, DATA_FILE), 'utf-8');
    expect(updated).toContain(imageSlotUrl(SLOT_PATH));
    expect(updated).toContain(imageSlotUrl(`${SLOT_PATH}-2`));
    expect(updated.match(new RegExp(`["']${imageSlotUrl(SLOT_PATH).replace(/\//g, '\\/')}["']`, 'g'))).toHaveLength(2);
    expect(updated.match(new RegExp(`["']${imageSlotUrl(`${SLOT_PATH}-2`).replace(/\//g, '\\/')}["']`, 'g'))).toHaveLength(1);
  });

  it('replaces the data record matching img alt when occurrence index is wrong', async function labeledRecord() {
    await writeFile(
      join(appPath, DATA_FILE),
      `export const trucks = [
  { name: 'Noodle Theory', image: '${imageSlotUrl(SLOT_PATH)}' },
  { name: 'Pho King Good', image: '${imageSlotUrl(SLOT_PATH)}' },
];
`
    );

    const result = await editor.replaceSharedSlotReference(
      appPath,
      {
        elementInfo: {
          tagName: 'img',
          className: 'truck-image',
          id: '',
          selector: 'li:nth-child(99) > img:nth-child(1)',
          devContext: {
            fileName: 'src/pages/trucks.tsx',
            componentName: 'TrucksPage',
            lineNumber: 48,
          },
        },
        imageInfo: {
          type: 'img',
          currentUrl: imageSlotUrl(SLOT_PATH),
          alt: 'Pho King Good',
        },
        newImageUrl: imageSlotUrl(`${SLOT_PATH}-fork`),
        oldSlotPath: SLOT_PATH,
        newSlotPath: `${SLOT_PATH}-fork`,
        occurrenceIndex: 0,
      },
      'test-app'
    );

    expect(result.success).toBe(true);

    const updated = await readFile(join(appPath, DATA_FILE), 'utf-8');
    const lines = updated.split('\n');
    const noodleLine = lines.find((line) => line.includes('Noodle Theory'));
    const phoLine = lines.find((line) => line.includes('Pho King Good'));
    expect(noodleLine).toContain(imageSlotUrl(SLOT_PATH));
    expect(phoLine).toContain(imageSlotUrl(`${SLOT_PATH}-fork`));
    expect(phoLine).not.toMatch(new RegExp(`image: ['"]${imageSlotUrl(SLOT_PATH).replace(/\//g, '\\/')}['"]`));
  });

  it('prefers src/data files over page components when matching by label', async function dataFileFirst() {
    await mkdir(join(appPath, 'src', 'pages'), { recursive: true });
    await writeFile(
      join(appPath, 'src/pages/home.tsx'),
      `export const featured = { name: 'Pho King Good', image: '${imageSlotUrl(SLOT_PATH)}' };
`
    );
    await writeFile(
      join(appPath, DATA_FILE),
      `export const trucks = [
  { name: 'Pho King Good', image: '${imageSlotUrl(SLOT_PATH)}' },
];
`
    );

    const result = await editor.replaceSharedSlotReference(
      appPath,
      {
        elementInfo: {
          tagName: 'img',
          className: 'truck-image',
          id: '',
          selector: 'img',
          devContext: {
            fileName: 'src/pages/home.tsx',
            componentName: 'HomePage',
            lineNumber: 1,
          },
        },
        imageInfo: {
          type: 'img',
          currentUrl: imageSlotUrl(SLOT_PATH),
          alt: 'Pho King Good',
        },
        newImageUrl: imageSlotUrl(`${SLOT_PATH}-fork`),
        oldSlotPath: SLOT_PATH,
        newSlotPath: `${SLOT_PATH}-fork`,
      },
      'test-app'
    );

    expect(result.success).toBe(true);
    expect(result.filePath).toBe(DATA_FILE);

    const pageSource = await readFile(join(appPath, 'src/pages/home.tsx'), 'utf-8');
    const dataSource = await readFile(join(appPath, DATA_FILE), 'utf-8');
    expect(pageSource).toContain(imageSlotUrl(SLOT_PATH));
    expect(dataSource).toContain(imageSlotUrl(`${SLOT_PATH}-fork`));
  });
});
