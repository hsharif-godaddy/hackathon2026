import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock git operations and logging
vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp: vi.fn().mockReturnValue(null),
  },
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
  GitTool: vi.fn().mockImplementation(() => ({
    executeGitOperation: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

import { ASTImageEditor } from '../ast-image-editor.js';

/**
 * Test fixture: a simple component with an image using a media slot URL.
 * After importSlot, code references the slot URL /airo-assets/images/pages/home/hero.
 * The slot manifest maps this to the actual image.
 */
const COMPONENT_WITH_SLOT_IMAGE = `import React from 'react';

export default function HeroSection() {
  return (
    <section className="hero">
      <h1>Welcome to Bean Counter Coffee</h1>
      <p>The best beans in town.</p>
      <img
        src="/airo-assets/images/pages/home/hero"
        alt="Coffee shop hero"
        className="hero-image"
      />
    </section>
  );
}
`;

/**
 * After the first AST replacement, the code has a direct upload URL
 * instead of the slot URL.
 */
const COMPONENT_WITH_DIRECT_UPLOAD_URL = `import React from 'react';

export default function HeroSection() {
  return (
    <section className="hero">
      <h1>Welcome to Bean Counter Coffee</h1>
      <p>The best beans in town.</p>
      <img
        src="/airo-assets/uploads/hero-abc12345.jpg"
        alt="Coffee shop hero"
        className="hero-image"
      />
    </section>
  );
}
`;

const COMPONENT_WITH_BG_SLOT_IMAGE = `import React from 'react';

export default function HeroSection() {
  return (
    <section className="hero">
      <div
        className="hero-bg"
        style={{ backgroundImage: "url('/airo-assets/images/pages/home/hero-bg')" }}
      >
        <h1>Welcome</h1>
      </div>
    </section>
  );
}
`;

const SOURCE_FILE = 'src/pages/index.tsx';

describe('ASTImageEditor - slot indirection', () => {
  let editor: ASTImageEditor;
  let testDir: string;
  let appPath: string;
  let sourcePath: string;

  beforeEach(async () => {
    editor = new ASTImageEditor();
    testDir = await mkdtemp(join(tmpdir(), 'ast-image-editor-'));
    appPath = join(testDir, 'app');
    sourcePath = join(appPath, SOURCE_FILE);
    await mkdir(join(appPath, 'src', 'pages'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('slot URL replacement (bug reproduction)', () => {
    // TODO: Once the fix lands (AST replacement should preserve slot URLs by updating
    // the manifest instead of rewriting code), flip these to regular `it()` tests and
    // invert the assertions so they validate the fixed behavior.

    it.fails('replacing a slot image should preserve slot URL in source code', async () => {
      // Setup: code uses a slot URL (after importSlot)
      await writeFile(sourcePath, COMPONENT_WITH_SLOT_IMAGE);

      // Act: AST replacement currently replaces the slot URL with a direct upload URL.
      // The CORRECT behavior would be to update the manifest and keep the slot URL.
      const result = await editor.replaceImage(appPath, {
        elementInfo: {
          tagName: 'img',
          className: 'hero-image',
          id: '',
          selector: 'img.hero-image',
          devContext: {
            fileName: SOURCE_FILE,
            componentName: 'HeroSection',
            lineNumber: 9,
          },
        },
        imageInfo: {
          type: 'img',
          currentUrl: '/airo-assets/images/pages/home/hero',
        },
        newImageUrl: '/airo-assets/uploads/hero-abc12345.jpg',
      }, 'test-app');

      expect(result.success).toBe(true);

      // EXPECTED (fixed) behavior: slot URL should be preserved in source code
      const updatedCode = await readFile(sourcePath, 'utf-8');
      expect(updatedCode).toContain('/airo-assets/images/pages/home/hero');
    });

    it('after first replacement breaks slot URL, second replacement using slot URL as currentUrl fails', async () => {
      // Step 1: Start with slot URL in source, replace via AST (breaks slot indirection)
      await writeFile(sourcePath, COMPONENT_WITH_SLOT_IMAGE);

      const firstResult = await editor.replaceImage(appPath, {
        elementInfo: {
          tagName: 'img',
          className: 'hero-image',
          id: '',
          selector: 'img.hero-image',
          devContext: {
            fileName: SOURCE_FILE,
            componentName: 'HeroSection',
            lineNumber: 9,
          },
        },
        imageInfo: {
          type: 'img',
          currentUrl: '/airo-assets/images/pages/home/hero',
        },
        newImageUrl: '/airo-assets/uploads/hero-abc12345.jpg',
      }, 'test-app');

      expect(firstResult.success).toBe(true);

      // Source now has direct upload URL, slot URL is gone
      const codeAfterFirst = await readFile(sourcePath, 'utf-8');
      expect(codeAfterFirst).toContain('/airo-assets/uploads/hero-abc12345.jpg');
      expect(codeAfterFirst).not.toContain('/airo-assets/images/');

      // Step 2: Simulate second replacement where the manifest was updated
      // (e.g. via MediaSlotDetail upload) but the browser still reports
      // the slot-resolved URL. The AST editor can't find the element because
      // the source has a direct URL, not the slot URL.
      const secondResult = await editor.replaceImage(appPath, {
        elementInfo: {
          tagName: 'img',
          className: 'hero-image',
          id: '',
          selector: 'img.hero-image',
          devContext: {
            fileName: SOURCE_FILE,
            componentName: 'HeroSection',
            lineNumber: 9,
          },
        },
        imageInfo: {
          type: 'img',
          currentUrl: '/airo-assets/images/pages/home/hero',
        },
        newImageUrl: '/airo-assets/uploads/hero-def67890.jpg',
      }, 'test-app');

      // TODO: Once slot indirection is preserved in replaceImage, this scenario
      // goes away entirely — the code would still have the slot URL so the second
      // replacement would match. Remove or rework this test when the fix lands.

      // Fails: source has /airo-assets/uploads/hero-abc12345.jpg but
      // currentUrl says /airo-assets/images/pages/home/hero — no match
      expect(secondResult.success).toBe(false);

      // Source is unchanged — still has the stale first upload URL
      const codeAfterSecond = await readFile(sourcePath, 'utf-8');
      expect(codeAfterSecond).toContain('/airo-assets/uploads/hero-abc12345.jpg');
      expect(codeAfterSecond).not.toContain('/airo-assets/uploads/hero-def67890.jpg');
    });

    it('second AST replacement works when imageInfo.currentUrl matches the direct URL', async () => {
      // Setup: code has direct upload URL from first replacement
      await writeFile(sourcePath, COMPONENT_WITH_DIRECT_UPLOAD_URL);

      // The browser reports the current src attribute value
      // If it matches what's in the code, the replacement should work
      const result = await editor.replaceImage(appPath, {
        elementInfo: {
          tagName: 'img',
          className: 'hero-image',
          id: '',
          selector: 'img.hero-image',
          devContext: {
            fileName: SOURCE_FILE,
            componentName: 'HeroSection',
            lineNumber: 9,
          },
        },
        imageInfo: {
          type: 'img',
          currentUrl: '/airo-assets/uploads/hero-abc12345.jpg',
        },
        newImageUrl: '/airo-assets/uploads/hero-def67890.jpg',
      }, 'test-app');

      expect(result.success).toBe(true);

      const updatedCode = await readFile(sourcePath, 'utf-8');
      expect(updatedCode).toContain('/airo-assets/uploads/hero-def67890.jpg');
      expect(updatedCode).not.toContain('/airo-assets/uploads/hero-abc12345.jpg');
    });

    it('second AST replacement fails when browser reports a different URL than what is in source', async () => {
      // Setup: code has direct upload URL from first replacement
      await writeFile(sourcePath, COMPONENT_WITH_DIRECT_UPLOAD_URL);

      // The browser might report a resolved URL that doesn't match the source.
      // For example, if the manifest was updated (second upload) and the preview
      // was reloaded via slot, the browser might show the NEW image URL from
      // the manifest, but the source code still has the OLD direct URL.
      const result = await editor.replaceImage(appPath, {
        elementInfo: {
          tagName: 'img',
          className: 'hero-image',
          id: '',
          selector: 'img.hero-image',
          devContext: {
            fileName: SOURCE_FILE,
            componentName: 'HeroSection',
            lineNumber: 9,
          },
        },
        imageInfo: {
          type: 'img',
          // Browser reports the slot-resolved URL, but code has direct URL
          currentUrl: '/airo-assets/images/pages/home/hero',
        },
        newImageUrl: '/airo-assets/uploads/hero-ghi99999.jpg',
      }, 'test-app');

      // This FAILS because the source has /airo-assets/uploads/hero-abc12345.jpg
      // but imageInfo.currentUrl says /airo-assets/images/pages/home/hero
      // The urlsMatch function can't match these different URL patterns
      expect(result.success).toBe(false);
    });
  });

  describe('background image slot replacement', () => {
    // TODO: Same as above — once the fix lands, this should validate that
    // background slot URLs are preserved in source code.
    it.fails('replacing a background slot image should preserve slot URL', async () => {
      await writeFile(sourcePath, COMPONENT_WITH_BG_SLOT_IMAGE);

      const result = await editor.replaceImage(appPath, {
        elementInfo: {
          tagName: 'div',
          className: 'hero-bg',
          id: '',
          selector: 'div.hero-bg',
          devContext: {
            fileName: SOURCE_FILE,
            componentName: 'HeroSection',
            lineNumber: 7,
          },
        },
        imageInfo: {
          type: 'background',
          currentUrl: '/airo-assets/images/pages/home/hero-bg',
        },
        newImageUrl: '/airo-assets/uploads/hero-bg-abc.jpg',
      }, 'test-app');

      expect(result.success).toBe(true);

      // EXPECTED (fixed) behavior: slot URL should be preserved
      const updatedCode = await readFile(sourcePath, 'utf-8');
      expect(updatedCode).toContain('/airo-assets/images/pages/home/hero-bg');
    });
  });
});
