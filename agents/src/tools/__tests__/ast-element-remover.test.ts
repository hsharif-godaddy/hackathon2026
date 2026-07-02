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
      readText: vi.fn(async function ({ path: filePath }: { path: string }) {
        const fullPath = hoistedPath.join(appPath, filePath);
        if (!hoistedFs.existsSync(fullPath)) {
          throw new Error(`ENOENT: file not found: ${filePath}`);
        }
        return hoistedFs.readFileSync(fullPath, 'utf-8');
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
  GitTool: vi.fn().mockImplementation(function () {
    return {
      executeGitOperation: vi.fn().mockImplementation(async (_appPath: string, op: { operation: string }) => {
        if (op.operation === 'log') {
          return { success: true, commits: [{ hash: 'abc1234' }] };
        }
        return { success: true };
      }),
    };
  }),
}));

import { ASTElementRemover } from '../ast-element-remover.js';

const SOURCE_FILE = 'src/pages/index.tsx';

const COMPONENT_WITH_IMG = `import React from 'react';

export default function HeroSection() {
  return (
    <section className="hero">
      <h1>Welcome to Bean Counter Coffee</h1>
      <p>The best beans in town.</p>
      <img
        src="/airo-assets/uploads/hero.jpg"
        alt="Coffee shop hero"
        className="hero-image"
      />
    </section>
  );
}
`;

const COMPONENT_WITH_VIDEO = `import React from 'react';

export default function Promo() {
  return (
    <section className="promo">
      <h2>Watch our story</h2>
      <video
        src="/airo-assets/uploads/promo.mp4"
        className="promo-video"
        controls
      />
    </section>
  );
}
`;

const COMPONENT_WITH_MULTIPLE_IMGS = `import React from 'react';

export default function Gallery() {
  return (
    <section className="gallery">
      <img src="/airo-assets/uploads/first.jpg" alt="first" className="img-first" />
      <img src="/airo-assets/uploads/second.jpg" alt="second" className="img-second" />
    </section>
  );
}
`;

// Single <img> with no className — exercises the tag-only fallback in isTargetElement.
const COMPONENT_WITH_UNCLASSED_IMG = `import React from 'react';

export default function Banner() {
  return (
    <section className="banner">
      <img src="/airo-assets/uploads/banner.jpg" alt="banner" />
    </section>
  );
}
`;

const COMPONENT_WITH_SVG = `import React from 'react';

export default function Logo() {
  return (
    <section className="brand">
      <svg className="logo-mark" viewBox="0 0 10 10">
        <circle cx="5" cy="5" r="4" />
      </svg>
    </section>
  );
}
`;

const COMPONENT_WITH_PICTURE = `import React from 'react';

export default function Figure() {
  return (
    <section className="figure">
      <picture className="responsive-pic">
        <img src="/airo-assets/uploads/figure.jpg" alt="figure" />
      </picture>
    </section>
  );
}
`;

const COMPONENT_WITH_PICTURE_SOURCES = `import React from 'react';

export default function Banner() {
  return (
    <section className="banner">
      <picture className="art-directed">
        <source srcSet="/airo-assets/uploads/wide.jpg" media="(min-width: 800px)" />
        <img src="/airo-assets/uploads/banner.jpg" alt="banner" />
      </picture>
    </section>
  );
}
`;

describe('ASTElementRemover', () => {
  let remover: ASTElementRemover;
  let testDir: string;
  let sourcePath: string;

  beforeEach(async () => {
    remover = new ASTElementRemover();
    testDir = await mkdtemp(join(tmpdir(), 'ast-element-remover-'));
    appPath = join(testDir, 'app');
    sourcePath = join(appPath, SOURCE_FILE);
    await mkdir(join(appPath, 'src', 'pages'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('removes a matched <img> and leaves surrounding markup intact', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_IMG);

    const result = await remover.removeElement(appPath, {
      selector: 'img.hero-image',
      isVideo: false,
      elementInfo: {
        tagName: 'img',
        className: 'hero-image',
        selector: 'img.hero-image',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'HeroSection',
          lineNumber: 8,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(true);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    expect(updatedCode).not.toContain('/airo-assets/uploads/hero.jpg');
    expect(updatedCode).not.toContain('hero-image');
    // Surrounding markup preserved
    expect(updatedCode).toContain('Welcome to Bean Counter Coffee');
    expect(updatedCode).toContain('The best beans in town.');
    expect(updatedCode).toContain('<section className="hero">');
  });

  it('removes a matched <video>', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_VIDEO);

    const result = await remover.removeElement(appPath, {
      selector: 'video.promo-video',
      isVideo: true,
      elementInfo: {
        tagName: 'video',
        className: 'promo-video',
        selector: 'video.promo-video',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'Promo',
          lineNumber: 7,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(true);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    expect(updatedCode).not.toContain('/airo-assets/uploads/promo.mp4');
    expect(updatedCode).not.toContain('promo-video');
    expect(updatedCode).toContain('Watch our story');
  });

  it('returns failure and leaves the file unchanged when no element matches', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_IMG);

    const result = await remover.removeElement(appPath, {
      selector: 'img.nonexistent',
      isVideo: false,
      elementInfo: {
        tagName: 'img',
        className: 'nonexistent',
        selector: 'img.nonexistent',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'HeroSection',
          // Far from any element
          lineNumber: 99,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(false);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    // File untouched
    expect(updatedCode).toBe(COMPONENT_WITH_IMG);
  });

  it('removes only the targeted img when multiple elements are present', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_MULTIPLE_IMGS);

    const result = await remover.removeElement(appPath, {
      selector: 'img.img-second',
      isVideo: false,
      elementInfo: {
        tagName: 'img',
        className: 'img-second',
        selector: 'img.img-second',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'Gallery',
          lineNumber: 7,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(true);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    // Targeted sibling gone
    expect(updatedCode).not.toContain('/airo-assets/uploads/second.jpg');
    expect(updatedCode).not.toContain('img-second');
    // Other sibling preserved
    expect(updatedCode).toContain('/airo-assets/uploads/first.jpg');
    expect(updatedCode).toContain('img-first');
  });

  it('does not remove a non-media container even when it matches the line', async () => {
    const componentWithContainer = `import React from 'react';

export default function Layout() {
  return (
    <section className="outer">
      <div className="big-container">
        <p>lots of content</p>
      </div>
    </section>
  );
}
`;
    await writeFile(sourcePath, componentWithContainer);

    const result = await remover.removeElement(appPath, {
      selector: 'div.big-container',
      isVideo: false,
      elementInfo: {
        tagName: 'div',
        className: 'big-container',
        selector: 'div.big-container',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'Layout',
          lineNumber: 6,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(false);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    expect(updatedCode).toBe(componentWithContainer);
  });

  it('matches by tagName alone when no className is provided', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_UNCLASSED_IMG);

    const result = await remover.removeElement(appPath, {
      selector: 'img',
      isVideo: false,
      elementInfo: {
        tagName: 'img',
        // No className — forces the tag-only fallback branch.
        className: '',
        selector: 'img',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'Banner',
          lineNumber: 6,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(true);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    expect(updatedCode).not.toContain('/airo-assets/uploads/banner.jpg');
    expect(updatedCode).toContain('<section className="banner">');
  });

  it('matches an element within 3 lines of the target', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_UNCLASSED_IMG);

    const result = await remover.removeElement(appPath, {
      selector: 'img',
      isVideo: false,
      elementInfo: {
        tagName: 'img',
        className: '',
        selector: 'img',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'Banner',
          // img is on line 6; distance of 3 is within tolerance.
          lineNumber: 9,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(true);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    expect(updatedCode).not.toContain('/airo-assets/uploads/banner.jpg');
  });

  it('does not match an element 4 lines from the target', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_UNCLASSED_IMG);

    const result = await remover.removeElement(appPath, {
      selector: 'img',
      isVideo: false,
      elementInfo: {
        tagName: 'img',
        className: '',
        selector: 'img',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'Banner',
          // img is on line 6; distance of 4 is just outside tolerance.
          lineNumber: 10,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(false);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    expect(updatedCode).toBe(COMPONENT_WITH_UNCLASSED_IMG);
  });

  it('removes a matched <svg>', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_SVG);

    const result = await remover.removeElement(appPath, {
      selector: 'svg.logo-mark',
      isVideo: false,
      elementInfo: {
        tagName: 'svg',
        className: 'logo-mark',
        selector: 'svg.logo-mark',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'Logo',
          lineNumber: 6,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(true);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    expect(updatedCode).not.toContain('logo-mark');
    expect(updatedCode).not.toContain('viewBox');
    expect(updatedCode).toContain('<section className="brand">');
  });

  it('removes a matched <picture>', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_PICTURE);

    const result = await remover.removeElement(appPath, {
      selector: 'picture.responsive-pic',
      isVideo: false,
      elementInfo: {
        tagName: 'picture',
        className: 'responsive-pic',
        selector: 'picture.responsive-pic',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'Figure',
          lineNumber: 6,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(true);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    expect(updatedCode).not.toContain('responsive-pic');
    expect(updatedCode).toContain('<section className="figure">');
  });

  it('removes the whole <picture> when the target is its inner <img> (no orphaned <picture>/<source>)', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_PICTURE_SOURCES);

    // Hover detection resolves a <picture> to its inner <img>, so the payload
    // carries tagName 'img' and the img's line — not the <picture>.
    const result = await remover.removeElement(appPath, {
      selector: 'picture.art-directed img',
      isVideo: false,
      elementInfo: {
        tagName: 'img',
        selector: 'picture.art-directed img',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'Banner',
          lineNumber: 8,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(true);

    const updatedCode = await readFile(sourcePath, 'utf-8');
    expect(updatedCode).not.toContain('<picture');
    expect(updatedCode).not.toContain('<source');
    expect(updatedCode).not.toContain('<img');
    expect(updatedCode).toContain('<section className="banner">');
  });

  it('commits when appId is provided (returns commitHash)', async () => {
    await writeFile(sourcePath, COMPONENT_WITH_IMG);

    const result = await remover.removeElement(appPath, {
      selector: 'img.hero-image',
      isVideo: false,
      elementInfo: {
        tagName: 'img',
        className: 'hero-image',
        selector: 'img.hero-image',
        devContext: {
          fileName: SOURCE_FILE,
          componentName: 'HeroSection',
          lineNumber: 8,
        },
      },
    }, 'test-app');

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');
  });
});
