import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

let appPath = '';
const hoistedFs = { existsSync, mkdirSync, readFileSync, writeFileSync };
const hoistedPath = { join, dirname };

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(function () {
    const files = {
      view: vi.fn(async function ({ path: filePath }: { path: string }) {
        const fullPath = hoistedPath.join(appPath, filePath);
        if (!hoistedFs.existsSync(fullPath)) {
          throw new Error(`ENOENT: file not found: ${filePath}`);
        }
        const content = hoistedFs.readFileSync(fullPath, 'utf-8');
        return { content, encoding: 'utf-8', path: filePath, lines: content.split('\n').length, size: content.length, truncated: false };
      }),
      write: vi.fn(async function ({ path: filePath, content }: { path: string; content: string }) {
        const fullPath = hoistedPath.join(appPath, filePath);
        hoistedFs.mkdirSync(hoistedPath.dirname(fullPath), { recursive: true });
        hoistedFs.writeFileSync(fullPath, content);
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
  GitTool: vi.fn().mockImplementation(function () { return {
    executeGitOperation: vi.fn().mockResolvedValue({ success: true }),
  }; }),
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

const COMPONENT_WITH_LITERAL_INDEX_SRC = `import React from 'react';

export default function Gallery() {
  const urls = ['/airo-assets/uploads/original.png', '/airo-assets/uploads/other.png'];
  return (
    <section>
      <img className="thumb" src={urls[0]} alt="" />
    </section>
  );
}
`;

const COMPONENT_WITH_CAROUSEL_MAP_SRC = `import React from 'react';

export default function Carousel() {
  const carouselUrls = [
    '/assets/cube-1655118_640.webp',
    '/assets/download (5).jpeg',
    '/assets/download (6).jpeg',
    '/assets/download (7).jpeg',
    '/assets/download (8).jpeg'
  ];
  return (
    <div className="overflow-hidden">
      {carouselUrls.map((url, i) => (
        <div key={i}>
          <img src={carouselUrls[i]} alt="" className="w-full" />
        </div>
      ))}
    </div>
  );
}
`;

const COMPONENT_WITH_PROP_SRC = `import React from 'react';

export default function Hero({ heroUrl }: { heroUrl: string }) {
  return (
    <section>
      <img className="hero" src={heroUrl} alt="" />
    </section>
  );
}
`;

describe('ASTImageEditor - dynamic src expressions', () => {
  let editor: ASTImageEditor;
  let testDir: string;
  let sourcePath: string;

  beforeEach(async () => {
    editor = new ASTImageEditor();
    testDir = await mkdtemp(join(tmpdir(), 'ast-image-editor-dynamic-'));
    appPath = join(testDir, 'app');
    sourcePath = join(appPath, 'src', 'pages', 'index.tsx');
    await mkdir(join(appPath, 'src', 'pages'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('mutates array element when src is a literal-index member expression (arr[0])', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_LITERAL_INDEX_SRC);

    const result = await editor.replaceImage(appPath, {
      elementInfo: {
        tagName: 'img',
        className: 'thumb',
        id: '',
        selector: 'img.thumb',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'Gallery',
          lineNumber: 7,
        },
      },
      imageInfo: {
        type: 'img',
        currentUrl: '/airo-assets/uploads/original.png',
      },
      newImageUrl: '/airo-assets/uploads/replaced.png',
    }, 'test-app');

    expect(result.success).toBe(true);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    // JSX expression preserved so the array indirection stays intact
    expect(updatedCode).toContain('src={urls[0]}');
    // Array element updated (Babel may emit either quote style)
    expect(updatedCode).toContain('/airo-assets/uploads/replaced.png');
    expect(updatedCode).not.toContain('/airo-assets/uploads/original.png');
    // Sibling element untouched
    expect(updatedCode).toContain('/airo-assets/uploads/other.png');
  });

  it('mutates the matching array element for a .map carousel (arr[i]) without breaking other slides', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_CAROUSEL_MAP_SRC);

    const result = await editor.replaceImage(appPath, {
      elementInfo: {
        tagName: 'img',
        className: 'w-full',
        id: '',
        selector: 'img.w-full',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'Carousel',
          lineNumber: 15,
        },
      },
      imageInfo: {
        type: 'img',
        currentUrl: '/assets/download (6).jpeg',
      },
      newImageUrl: '/assets/replaced.jpeg',
    }, 'test-app');

    expect(result.success).toBe(true);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    // JSX still references the array
    expect(updatedCode).toContain('src={carouselUrls[i]}');
    // Only the matching element was replaced; siblings preserved
    expect(updatedCode).toContain('/assets/replaced.jpeg');
    expect(updatedCode).not.toContain('/assets/download (6).jpeg');
    expect(updatedCode).toContain('/assets/cube-1655118_640.webp');
    expect(updatedCode).toContain('/assets/download (5).jpeg');
    expect(updatedCode).toContain('/assets/download (7).jpeg');
    expect(updatedCode).toContain('/assets/download (8).jpeg');
  });

  it('refuses to mutate arr[0] when expectedOldUrl does not match the element value', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_LITERAL_INDEX_SRC);

    // Browser reports a URL that doesn't match urls[0]'s value. With only line-proximity
    // targeting, blindly trusting the literal index would overwrite the wrong slot.
    const result = await editor.replaceImage(appPath, {
      elementInfo: {
        tagName: 'img',
        className: 'thumb',
        id: '',
        selector: 'img.thumb',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'Gallery',
          lineNumber: 7,
        },
      },
      imageInfo: {
        type: 'img',
        currentUrl: '/airo-assets/uploads/something-else.png',
      },
      newImageUrl: '/airo-assets/uploads/replaced.png',
    }, 'test-app');

    expect(result.success).toBe(false);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    // Source must be unchanged — neither array element touched
    expect(updatedCode).toContain('/airo-assets/uploads/original.png');
    expect(updatedCode).toContain('/airo-assets/uploads/other.png');
    expect(updatedCode).not.toContain('/airo-assets/uploads/replaced.png');
  });

  it('respects lexical scope: same-named arrays in two components do not cross-mutate', async () => {
    const sharedNameComponent = `import React from 'react';

export function GalleryA() {
  const urls = ['/airo-assets/uploads/a-original.png'];
  return <img className="a-thumb" src={urls[0]} alt="" />;
}

export function GalleryB() {
  const urls = ['/airo-assets/uploads/b-original.png'];
  return <img className="b-thumb" src={urls[0]} alt="" />;
}
`;
    await writeFile(sourcePath, sharedNameComponent);

    // Replace the image in GalleryB. The 'urls' identifier is declared in both
    // components; without scope-aware resolution we'd find GalleryA's array first.
    const result = await editor.replaceImage(appPath, {
      elementInfo: {
        tagName: 'img',
        className: 'b-thumb',
        id: '',
        selector: 'img.b-thumb',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'GalleryB',
          lineNumber: 10,
        },
      },
      imageInfo: {
        type: 'img',
        currentUrl: '/airo-assets/uploads/b-original.png',
      },
      newImageUrl: '/airo-assets/uploads/b-replaced.png',
    }, 'test-app');

    expect(result.success).toBe(true);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    // GalleryB's array updated
    expect(updatedCode).toContain('/airo-assets/uploads/b-replaced.png');
    expect(updatedCode).not.toContain('/airo-assets/uploads/b-original.png');
    // GalleryA's array left alone
    expect(updatedCode).toContain('/airo-assets/uploads/a-original.png');
  });

  it('refuses to corrupt opaque dynamic src (e.g. prop) and returns failure for LLM fallback', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_PROP_SRC);

    const result = await editor.replaceImage(appPath, {
      elementInfo: {
        tagName: 'img',
        className: 'hero',
        id: '',
        selector: 'img.hero',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'Hero',
          lineNumber: 6,
        },
      },
      imageInfo: {
        type: 'img',
        currentUrl: '/airo-assets/uploads/original.png',
      },
      newImageUrl: '/airo-assets/uploads/replaced.png',
    }, 'test-app');

    expect(result.success).toBe(false);
    // The error must signal "located but refused" so the LLM switches strategy
    // (edit the prop/array declaration) instead of retrying with new selectors.
    expect(result.error).toMatch(/dynamic expression/i);
    expect(result.error).not.toMatch(/Could not find/i);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    // Source must be unchanged
    expect(updatedCode).toContain('src={heroUrl}');
    expect(updatedCode).not.toContain('replaced.png');
  });

  it('refuses arr[N] when N is out of bounds and leaves source unchanged', async () => {
    const componentWithOOBIndex = `import React from 'react';

export default function Gallery() {
  const urls = ['/airo-assets/uploads/first.png', '/airo-assets/uploads/second.png'];
  return (
    <section>
      <img className="thumb" src={urls[3]} alt="" />
    </section>
  );
}
`;
    await writeFile(sourcePath, componentWithOOBIndex);

    const result = await editor.replaceImage(appPath, {
      elementInfo: {
        tagName: 'img',
        className: 'thumb',
        id: '',
        selector: 'img.thumb',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'Gallery',
          lineNumber: 7,
        },
      },
      imageInfo: {
        type: 'img',
        currentUrl: '/airo-assets/uploads/first.png',
      },
      newImageUrl: '/airo-assets/uploads/replaced.png',
    }, 'test-app');

    expect(result.success).toBe(false);
    // OOB falls through to dynamic-src-refused so the LLM switches strategy
    expect(result.error).toMatch(/dynamic expression/i);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    // Both array elements untouched; JSX expression untouched
    expect(updatedCode).toContain('/airo-assets/uploads/first.png');
    expect(updatedCode).toContain('/airo-assets/uploads/second.png');
    expect(updatedCode).toContain('src={urls[3]}');
    expect(updatedCode).not.toContain('/airo-assets/uploads/replaced.png');
  });

  it('refuses arr[N] when the element is not a string literal (e.g. variable reference)', async () => {
    const componentWithComputedElement = `import React from 'react';

const FALLBACK = '/airo-assets/uploads/fallback.png';

export default function Gallery() {
  const urls = [FALLBACK, '/airo-assets/uploads/second.png'];
  return (
    <section>
      <img className="thumb" src={urls[0]} alt="" />
    </section>
  );
}
`;
    await writeFile(sourcePath, componentWithComputedElement);

    const result = await editor.replaceImage(appPath, {
      elementInfo: {
        tagName: 'img',
        className: 'thumb',
        id: '',
        selector: 'img.thumb',
        devContext: {
          fileName: 'src/pages/index.tsx',
          componentName: 'Gallery',
          lineNumber: 9,
        },
      },
      imageInfo: {
        type: 'img',
        currentUrl: '/airo-assets/uploads/fallback.png',
      },
      newImageUrl: '/airo-assets/uploads/replaced.png',
    }, 'test-app');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/dynamic expression/i);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    // Neither the FALLBACK constant nor the array was touched
    expect(updatedCode).toContain("const FALLBACK = '/airo-assets/uploads/fallback.png'");
    expect(updatedCode).toContain('[FALLBACK,');
    expect(updatedCode).not.toContain('/airo-assets/uploads/replaced.png');
  });
});
