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
import { imageSlotUrl } from '../../utils/slot-reference-utils.js';

const PAGE_FILE = 'src/pages/index.tsx';
const SLOT_PATH = 'pages/home/hero';

describe('ASTImageEditor - stale line number fallback (AIROBUILD-3173)', function packageTests() {
  let editor: ASTImageEditor;
  let testDir: string;

  beforeEach(async function setup() {
    editor = new ASTImageEditor();
    testDir = await mkdtemp(join(tmpdir(), 'ast-stale-line-'));
    appPath = join(testDir, 'app');
    await mkdir(join(appPath, 'src', 'pages'), { recursive: true });
  });

  afterEach(async function teardown() {
    await rm(testDir, { recursive: true, force: true });
  });

  it('line-based lookup fails when line numbers are stale', async function staleLine() {
    const padding = Array.from({ length: 10 }, () => '// AI-added comment').join('\n');
    await writeFile(
      join(appPath, PAGE_FILE),
      `import React from 'react';\n${padding}\nexport default function Home() {\n  return (\n    <div>\n      <img src="${imageSlotUrl(SLOT_PATH)}" alt="Hero" className="w-full" />\n    </div>\n  );\n}\n`
    );

    const result = await editor.replaceImage(
      appPath,
      {
        elementInfo: {
          tagName: 'img',
          className: 'w-full',
          id: '',
          selector: 'div:nth-child(1) > img:nth-child(1)',
          devContext: { fileName: PAGE_FILE, componentName: 'Home', lineNumber: 10 },
        },
        imageInfo: { type: 'img', currentUrl: imageSlotUrl(SLOT_PATH) },
        newImageUrl: imageSlotUrl(`${SLOT_PATH}-fork`),
      },
      'test-app'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not find target img element at line 10');
  });

  it('recovers via src-URL fallback when line number is stale for <img>', async function imgFallback() {
    const padding = Array.from({ length: 10 }, () => '// AI-added comment').join('\n');
    await writeFile(
      join(appPath, PAGE_FILE),
      `import React from 'react';\n${padding}\nexport default function Home() {\n  return (\n    <div>\n      <img src="${imageSlotUrl(SLOT_PATH)}" alt="Hero" className="w-full" />\n    </div>\n  );\n}\n`
    );

    const result = await editor.replaceSharedSlotReference(
      appPath,
      {
        elementInfo: {
          tagName: 'img',
          className: 'w-full',
          id: '',
          selector: 'div:nth-child(1) > img:nth-child(1)',
          devContext: { fileName: PAGE_FILE, componentName: 'Home', lineNumber: 10 },
        },
        imageInfo: { type: 'img', currentUrl: imageSlotUrl(SLOT_PATH) },
        newImageUrl: imageSlotUrl(`${SLOT_PATH}-fork`),
        oldSlotPath: SLOT_PATH,
        newSlotPath: `${SLOT_PATH}-fork`,
        occurrenceIndex: 0,
      },
      'test-app'
    );

    expect(result.success).toBe(true);
    const updated = await readFile(join(appPath, PAGE_FILE), 'utf-8');
    expect(updated).toContain(imageSlotUrl(`${SLOT_PATH}-fork`));
    expect(updated).not.toContain(`"${imageSlotUrl(SLOT_PATH)}"`);
  });

  it('recovers via src-URL fallback for <video> elements', async function videoFallback() {
    const padding = Array.from({ length: 15 }, () => '// AI-added line').join('\n');
    await writeFile(
      join(appPath, PAGE_FILE),
      `import React from 'react';\n${padding}\nexport default function Home() {\n  return (\n    <div>\n      <video src="${imageSlotUrl(SLOT_PATH)}" className="w-full" />\n    </div>\n  );\n}\n`
    );

    const result = await editor.replaceSharedSlotReference(
      appPath,
      {
        elementInfo: {
          tagName: 'video',
          className: 'w-full',
          id: '',
          selector: 'div:nth-child(1) > video:nth-child(1)',
          devContext: { fileName: PAGE_FILE, componentName: 'Home', lineNumber: 5 },
        },
        imageInfo: { type: 'img', currentUrl: imageSlotUrl(SLOT_PATH) },
        newImageUrl: imageSlotUrl(`${SLOT_PATH}-fork`),
        oldSlotPath: SLOT_PATH,
        newSlotPath: `${SLOT_PATH}-fork`,
        occurrenceIndex: 0,
      },
      'test-app'
    );

    expect(result.success).toBe(true);
    const updated = await readFile(join(appPath, PAGE_FILE), 'utf-8');
    expect(updated).toContain(imageSlotUrl(`${SLOT_PATH}-fork`));
  });

  it('picks the correct occurrence among multiple shared media elements', async function multiOccurrence() {
    const padding = Array.from({ length: 10 }, () => '// shifted').join('\n');
    await writeFile(
      join(appPath, PAGE_FILE),
      `import React from 'react';\n${padding}\nexport default function Home() {\n  return (\n    <div>\n      <img src="${imageSlotUrl(SLOT_PATH)}" alt="First" />\n      <img src="${imageSlotUrl(SLOT_PATH)}" alt="Second" />\n      <img src="${imageSlotUrl(SLOT_PATH)}" alt="Third" />\n    </div>\n  );\n}\n`
    );

    const result = await editor.replaceSharedSlotReference(
      appPath,
      {
        elementInfo: {
          tagName: 'img',
          className: '',
          id: '',
          selector: 'div > img:nth-child(2)',
          devContext: { fileName: PAGE_FILE, componentName: 'Home', lineNumber: 5 },
        },
        imageInfo: { type: 'img', currentUrl: imageSlotUrl(SLOT_PATH), alt: 'Second' },
        newImageUrl: imageSlotUrl(`${SLOT_PATH}-fork`),
        oldSlotPath: SLOT_PATH,
        newSlotPath: `${SLOT_PATH}-fork`,
        occurrenceIndex: 1,
      },
      'test-app'
    );

    expect(result.success).toBe(true);
    const updated = await readFile(join(appPath, PAGE_FILE), 'utf-8');
    const lines = updated.split('\n');
    expect(lines.find((l) => l.includes('alt="First"'))).toContain(imageSlotUrl(SLOT_PATH));
    expect(lines.find((l) => l.includes('alt="Second"'))).toContain(imageSlotUrl(`${SLOT_PATH}-fork`));
    expect(lines.find((l) => l.includes('alt="Third"'))).toContain(imageSlotUrl(SLOT_PATH));
  });

  it('strategy #2 urlsMatch finds slot URL even when source has full origin prefix', async function urlsMatchStrategy2() {
    // Source has full preview-origin URL; oldSlotPath produces the relative path.
    // urlsMatch normalizes both to the same pathname so strategy #2 still matches.
    const fullOriginUrl = `https://abc123.preview.c36.airoapp.ai${imageSlotUrl(SLOT_PATH)}`;
    await writeFile(
      join(appPath, PAGE_FILE),
      `import React from 'react';\nexport default function Home() {\n  return <img src="${fullOriginUrl}" alt="Hero" />;\n}\n`
    );

    const result = await editor.replaceSharedSlotReference(
      appPath,
      {
        elementInfo: {
          tagName: 'img',
          className: '',
          id: '',
          selector: 'img',
          devContext: { fileName: PAGE_FILE, componentName: 'Home', lineNumber: 999 },
        },
        imageInfo: { type: 'img', currentUrl: imageSlotUrl(SLOT_PATH) },
        newImageUrl: imageSlotUrl(`${SLOT_PATH}-fork`),
        oldSlotPath: SLOT_PATH,
        newSlotPath: `${SLOT_PATH}-fork`,
        occurrenceIndex: 0,
      },
      'test-app'
    );

    expect(result.success).toBe(true);
    const updated = await readFile(join(appPath, PAGE_FILE), 'utf-8');
    expect(updated).toContain(imageSlotUrl(`${SLOT_PATH}-fork`));
    expect(updated).not.toContain(fullOriginUrl);
  });

  it('replaceMediaElementBySrcUrl rewrites <video> src by URL match', async function videoDirectFallback() {
    await writeFile(
      join(appPath, PAGE_FILE),
      `import React from 'react';\nexport default function Home() {\n  return <video src="${imageSlotUrl(SLOT_PATH)}" className="w-full" />;\n}\n`
    );

    const result = await (editor as any).replaceMediaElementBySrcUrl(
      appPath,
      { oldUrl: imageSlotUrl(SLOT_PATH), newUrl: imageSlotUrl(`${SLOT_PATH}-fork`), occurrenceIndex: 0, scopeFile: PAGE_FILE },
      'test-app'
    );

    expect(result.success).toBe(true);
    const updated = await readFile(join(appPath, PAGE_FILE), 'utf-8');
    expect(updated).toContain(imageSlotUrl(`${SLOT_PATH}-fork`));
  });

  it('replaceMediaElementBySrcUrl skips dynamic src and returns failure', async function dynamicSrcSkip() {
    await writeFile(
      join(appPath, PAGE_FILE),
      `import React from 'react';\nconst url = '${imageSlotUrl(SLOT_PATH)}';\nexport default function Home() {\n  return <img src={url} alt="Hero" />;\n}\n`
    );

    const result = await (editor as any).replaceMediaElementBySrcUrl(
      appPath,
      { oldUrl: imageSlotUrl(SLOT_PATH), newUrl: imageSlotUrl(`${SLOT_PATH}-fork`), occurrenceIndex: 0, scopeFile: PAGE_FILE },
      'test-app'
    );

    expect(result.success).toBe(false);
  });

  it('replaceMediaElementBySrcUrl counts occurrences across files without reset', async function crossFileOccurrence() {
    await mkdir(join(appPath, 'src', 'components'), { recursive: true });
    await writeFile(
      join(appPath, 'src', 'components', 'Header.tsx'),
      `import React from 'react';\nexport function Header() {\n  return <img src="${imageSlotUrl(SLOT_PATH)}" alt="Header" />;\n}\n`
    );
    await writeFile(
      join(appPath, PAGE_FILE),
      `import React from 'react';\nexport default function Home() {\n  return <img src="${imageSlotUrl(SLOT_PATH)}" alt="Page" />;\n}\n`
    );

    // scopeFile is PAGE_FILE, so ordering is: [PAGE_FILE, components/Header.tsx]
    // occurrenceIndex 0 = PAGE_FILE img, occurrenceIndex 1 = Header img
    const result = await (editor as any).replaceMediaElementBySrcUrl(
      appPath,
      { oldUrl: imageSlotUrl(SLOT_PATH), newUrl: imageSlotUrl(`${SLOT_PATH}-fork`), occurrenceIndex: 1, scopeFile: PAGE_FILE },
      'test-app'
    );

    expect(result.success).toBe(true);
    // Page (scope file, searched first) should be unchanged; Header should be rewritten
    const page = await readFile(join(appPath, PAGE_FILE), 'utf-8');
    const header = await readFile(join(appPath, 'src', 'components', 'Header.tsx'), 'utf-8');
    expect(page).toContain(imageSlotUrl(SLOT_PATH));
    expect(header).toContain(imageSlotUrl(`${SLOT_PATH}-fork`));
  });

  it('replaceMediaElementBySrcUrl returns failure when no match found', async function noMatch() {
    await writeFile(
      join(appPath, PAGE_FILE),
      `import React from 'react';\nexport default function Home() {\n  return <img src="/other-image.jpg" alt="Other" />;\n}\n`
    );

    const result = await (editor as any).replaceMediaElementBySrcUrl(
      appPath,
      { oldUrl: imageSlotUrl(SLOT_PATH), newUrl: imageSlotUrl(`${SLOT_PATH}-fork`), occurrenceIndex: 0, scopeFile: PAGE_FILE },
      'test-app'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not find media element');
  });
});
