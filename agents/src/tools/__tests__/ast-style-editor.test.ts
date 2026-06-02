import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, writeFile, mkdir, rmdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

let testAppPath = '';
const hoistedFs = { existsSync, mkdirSync, readFileSync, writeFileSync };
const hoistedPath = { join, dirname };

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(function () {
    const files = {
      view: vi.fn(async function ({ path: filePath }: { path: string }) {
        const fullPath = hoistedPath.join(testAppPath, filePath);
        if (!hoistedFs.existsSync(fullPath)) {
          throw new Error(`ENOENT: file not found: ${filePath}`);
        }
        const content = hoistedFs.readFileSync(fullPath, 'utf-8');
        return { content, encoding: 'utf-8', path: filePath, lines: content.split('\n').length, size: content.length, truncated: false };
      }),
      write: vi.fn(async function ({ path: filePath, content }: { path: string; content: string }) {
        const fullPath = hoistedPath.join(testAppPath, filePath);
        hoistedFs.mkdirSync(hoistedPath.dirname(fullPath), { recursive: true });
        hoistedFs.writeFileSync(fullPath, content);
        return { bytesWritten: content.length };
      }),
    };
    return { files, tasks: undefined };
  }),
}));

import { ASTStyleEditor } from '../ast-style-editor.js';

const TEST_APP_ID = 'test-app-id';

describe('AST Style Editor Integration Tests', () => {
  let astEditor: ASTStyleEditor;
  let testFilePath: string;

  beforeEach(async () => {
    astEditor = new ASTStyleEditor();

    testAppPath = `/tmp/ast-test-${Date.now()}`;
    await mkdir(testAppPath, { recursive: true });
    await mkdir(join(testAppPath, 'src', 'frontend', 'pages'), { recursive: true });
    
    testFilePath = join(testAppPath, 'src', 'frontend', 'pages', 'index.page.tsx');

    // Create sample React component file
    const sampleComponent = `import React from 'react';

export default function HomePage() {
  return (
    <div className="container mx-auto px-4">
      <h1 className="text-3xl font-bold text-gray-900">Welcome</h1>
      <p className="text-base text-yellow-600 mt-4">
        This is a sample paragraph for testing.
      </p>
      <button className="bg-blue-500 text-white px-4 py-2 rounded">
        Click me
      </button>
      <div className="flex items-center space-x-2">
        <span className="text-sm text-gray-500">Status:</span>
        <span className="text-green-600 font-medium">Active</span>
      </div>
    </div>
  );
}`;

    await writeFile(testFilePath, sampleComponent);
  });

  afterEach(async () => {
    // Cleanup test directory
    if (testAppPath && existsSync(testAppPath)) {
      try {
        await rmdir(testAppPath, { recursive: true });
      } catch (error) {
        console.warn('Failed to cleanup test directory:', error);
      }
    }
  });

  describe('Color Changes (Inline Styles)', () => {
    it('should change paragraph text color from yellow to red', async () => {
      const request = {
        selector: 'p.text-yellow-600',
        property: 'color',
        value: '#FF0000',
        newClassName: 'text-base mt-4', // yellow color class removed
        newStyle: 'color: #FF0000',
        elementInfo: {
          tagName: 'p',
          className: 'text-base text-yellow-600 mt-4',
          id: '',
          textContent: 'This is a sample paragraph for testing.',
          selector: 'p.text-yellow-600',
          dataId: 'dev-selected-test-123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 7
          },
          rect: { top: 100, left: 50, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      expect(result.changes.property).toBe('color');
      expect(result.changes.value).toBe('#FF0000');
      expect(result.changes.oldClassName).toBe('text-base text-yellow-600 mt-4');
      expect(result.changes.newClassName).toBe('text-base mt-4'); // yellow removed

      // Verify the file was actually modified
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-base mt-4'); // color class removed
      expect(updatedFile).not.toContain('text-yellow-600'); // old color class gone
    });

    it('should change span background color to light blue', async () => {
      const request = {
        selector: 'span.text-green-600',
        property: 'backgroundColor',
        value: '#DBEAFE',
        newClassName: 'font-medium',
        newStyle: 'background-color: #DBEAFE',
        elementInfo: {
          tagName: 'span',
          className: 'text-green-600 font-medium',
          id: '',
          textContent: 'Active',
          selector: 'span.text-green-600',
          dataId: 'dev-selected-test-456',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 13
          },
          rect: { top: 200, left: 50, width: 100, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      expect(result.changes.property).toBe('backgroundColor');
      expect(result.changes.value).toBe('#DBEAFE');

      // Verify the file was modified
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('font-medium'); // other classes preserved
      expect(updatedFile).toContain('text-green-600'); // text color preserved
    });
  });

  describe('Font Size Changes (Tailwind Classes)', () => {
    it('places the new size class at the FRONT of the className (locks ordering contract)', async () => {
      // Existing fontSize tests use toContain, which would still pass if a
      // refactor accidentally pushed the new size to the end. The contract
      // is "new size at the front" so it visually leads typography utilities
      // — this assertion locks it.
      const request = {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-5xl',
        newClassName: 'text-3xl font-bold text-gray-900',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl font-bold text-gray-900',
          id: '',
          textContent: 'Welcome',
          selector: 'h1',
          dataId: 'dev-selected-order-1',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 5,
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      // text-5xl must be the FIRST class in the className string
      expect(updatedFile).toMatch(/className="text-5xl /);
    });

    it('should change heading from text-3xl to text-4xl', async () => {
      const request = {
        selector: 'h1.text-3xl',
        property: 'fontSize',
        value: 'text-4xl',
        newClassName: 'text-4xl font-bold text-gray-900',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl font-bold text-gray-900',
          id: '',
          textContent: 'Welcome',
          selector: 'h1.text-3xl',
          dataId: 'dev-selected-test-789',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 5
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      expect(result.changes.property).toBe('fontSize');
      expect(result.changes.value).toBe('text-4xl');
      expect(result.changes.newClassName).toContain('text-4xl');
      expect(result.changes.newClassName).toContain('font-bold');
      expect(result.changes.newClassName).toContain('text-gray-900');

      // Verify the file was modified
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-4xl'); // new size class
      expect(updatedFile).not.toContain('text-3xl'); // old size class removed
      expect(updatedFile).toContain('font-bold text-gray-900'); // other classes preserved
    });

    it('should change small text from text-sm to text-base', async () => {
      const request = {
        selector: 'span.text-sm',
        property: 'fontSize',
        value: 'text-base',
        newClassName: 'text-base text-gray-500',
        elementInfo: {
          tagName: 'span',
          className: 'text-sm text-gray-500',
          id: '',
          textContent: 'Status:',
          selector: 'span.text-sm',
          dataId: 'dev-selected-test-101',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 12
          },
          rect: { top: 180, left: 0, width: 50, height: 16 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      expect(result.changes.newClassName).toContain('text-base');
      expect(result.changes.newClassName).toContain('text-gray-500');

      // Verify the file was modified
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-base text-gray-500');
      expect(updatedFile).not.toContain('text-sm text-gray-500');
    });

    it('should step up from text-5xl to text-6xl without stacking', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <h1 data-dev-id="big-heading" className="text-5xl text-gray-900 text-center">Big</h1>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-6xl',
        newClassName: 'text-6xl text-gray-900 text-center',
        elementInfo: {
          tagName: 'h1',
          className: 'text-5xl text-gray-900 text-center',
          id: '',
          textContent: 'Big',
          selector: 'h1',
          dataId: 'big-heading',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 5,
          },
          rect: { top: 0, left: 0, width: 100, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-6xl');
      expect(updatedFile).not.toContain('text-5xl');
      // Color and alignment must survive
      expect(updatedFile).toContain('text-gray-900');
      expect(updatedFile).toContain('text-center');
    });

    it('removes fontSize from JSX style={{...}} object literal when applying a fontSize class', async () => {
      // Real-world repro (Cole's PR review on AIROBUILD-1745): hero h1 has
      // style={{ fontFamily: "Bebas Neue", fontSize: "clamp(56px, 10vw, 120px)", ... }}.
      // The stepper used to disable itself entirely; now the AST also strips
      // the inline fontSize so the new text-{size} class wins. Other inline
      // properties (font-family, line-height, etc.) must survive.
      const component = `import React from 'react';

export default function Page() {
  return (
    <h1 data-dev-id="hero" className="mb-6" style={{ fontFamily: "Bebas Neue", fontSize: "clamp(56px, 10vw, 120px)", lineHeight: "1" }}>Hero</h1>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-7xl',
        newClassName: 'mb-6',
        elementInfo: {
          tagName: 'h1',
          className: 'mb-6',
          id: '',
          textContent: 'Hero',
          selector: 'h1',
          dataId: 'hero',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 5,
          },
          rect: { top: 0, left: 0, width: 100, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      // New size class applied
      expect(updatedFile).toContain('text-7xl');
      // Inline fontSize stripped
      expect(updatedFile).not.toContain('fontSize:');
      expect(updatedFile).not.toContain('clamp(56px');
      // Other inline properties preserved
      expect(updatedFile).toContain('Bebas Neue');
      expect(updatedFile).toContain('lineHeight');
    });

    it('drops the entire style={{...}} attribute when fontSize was its only property', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <h1 data-dev-id="solo" className="mb-6" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>Solo</h1>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-5xl',
        newClassName: 'mb-6',
        elementInfo: {
          tagName: 'h1',
          className: 'mb-6',
          id: '',
          textContent: 'Solo',
          selector: 'h1',
          dataId: 'solo',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 5,
          },
          rect: { top: 0, left: 0, width: 100, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-5xl');
      // Whole style attribute gone
      expect(updatedFile).not.toMatch(/style=\{/);
    });

    it('returns INLINE_STYLE_NOT_EDITABLE when JSX style is a variable reference', async () => {
      // Defensive: when the source is `style={heroStyle}` (variable ref), we
      // can't safely remove a key without touching the variable's declaration
      // site. Bail with a specific error code so the frontend can surface
      // "ask the agent" UX instead of silently committing a className-only
      // edit that won't visually change anything.
      const component = `import React from 'react';

const heroStyle = { fontSize: "clamp(2rem, 5vw, 4rem)" };

export default function Page() {
  return (
    <h1 data-dev-id="dynstyle" className="mb-6" style={heroStyle}>Dyn</h1>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-5xl',
        newClassName: 'mb-6',
        elementInfo: {
          tagName: 'h1',
          className: 'mb-6',
          id: '',
          textContent: 'Dyn',
          selector: 'h1',
          dataId: 'dynstyle',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 7,
          },
          rect: { top: 0, left: 0, width: 100, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(false);
      expect(result.error).toContain('INLINE_STYLE_NOT_EDITABLE');
      // Source must be untouched on failure — no half-edit
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).not.toContain('text-5xl');
    });

    it('preserves spread expressions while removing fontSize when both are present', async () => {
      const component = `import React from 'react';

const baseStyle = { transition: "all 0.3s" };

export default function Page() {
  return (
    <h1 data-dev-id="spread" className="mb-6" style={{ ...baseStyle, fontSize: "clamp(2rem, 5vw, 4rem)" }}>Mix</h1>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-5xl',
        newClassName: 'mb-6',
        elementInfo: {
          tagName: 'h1',
          className: 'mb-6',
          id: '',
          textContent: 'Mix',
          selector: 'h1',
          dataId: 'spread',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 7,
          },
          rect: { top: 0, left: 0, width: 100, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-5xl');
      expect(updatedFile).not.toContain('fontSize:');
      // Spread must survive
      expect(updatedFile).toMatch(/\.\.\.baseStyle/);
    });

    it('should strip arbitrary text-[<length>] classes so the new size class wins the cascade', async () => {
      // Real-world repro: hero h1 with text-[clamp(4rem,12vw,9rem)] for
      // responsive typography. The stepper applies a text-{size} class, but
      // without stripping the arbitrary class the cascade keeps it winning,
      // so visually nothing changes.
      const component = `import React from 'react';

export default function Page() {
  return (
    <h1 data-dev-id="hero" className="font-heading text-[clamp(4rem,12vw,9rem)] leading-none text-white">Hero</h1>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-7xl',
        newClassName: 'font-heading text-[clamp(4rem,12vw,9rem)] leading-none text-white',
        elementInfo: {
          tagName: 'h1',
          className: 'font-heading text-[clamp(4rem,12vw,9rem)] leading-none text-white',
          id: '',
          textContent: 'Hero',
          selector: 'h1',
          dataId: 'hero',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 5,
          },
          rect: { top: 0, left: 0, width: 100, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-7xl');
      expect(updatedFile).not.toContain('text-[clamp');
      // Other classes preserved
      expect(updatedFile).toContain('font-heading');
      expect(updatedFile).toContain('leading-none');
      expect(updatedFile).toContain('text-white');
    });

    it('should NOT strip arbitrary text-[<color>] classes when stepping fontSize', async () => {
      // Defensive: text-[#ff0000] / text-[red] are color utilities, not size
      // overrides. Stripping them on a fontSize edit would silently remove
      // the user's color choice.
      const component = `import React from 'react';

export default function Page() {
  return (
    <h1 data-dev-id="colored" className="text-3xl text-[#ff0000] font-bold">Title</h1>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-4xl',
        newClassName: 'text-3xl text-[#ff0000] font-bold',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl text-[#ff0000] font-bold',
          id: '',
          textContent: 'Title',
          selector: 'h1',
          dataId: 'colored',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 5,
          },
          rect: { top: 0, left: 0, width: 100, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-4xl');
      expect(updatedFile).not.toContain('text-3xl');
      expect(updatedFile).toContain('text-[#ff0000]'); // color survives
      expect(updatedFile).toContain('font-bold');
    });

    it('should strip arbitrary length classes carrying responsive variants (md:text-[clamp(...)])', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <h1 data-dev-id="resp-arb" className="text-3xl md:text-[clamp(2rem,5vw,4rem)] font-bold">Title</h1>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-5xl',
        newClassName: 'text-3xl md:text-[clamp(2rem,5vw,4rem)] font-bold',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl md:text-[clamp(2rem,5vw,4rem)] font-bold',
          id: '',
          textContent: 'Title',
          selector: 'h1',
          dataId: 'resp-arb',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 5,
          },
          rect: { top: 0, left: 0, width: 100, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-5xl');
      expect(updatedFile).not.toContain('text-3xl');
      expect(updatedFile).not.toContain('md:text-[clamp');
      expect(updatedFile).toContain('font-bold');
    });

    it('should strip responsive size variants (md:text-3xl) when stepping the base size', async () => {
      // Real-world case: an element generated by the agent often has both a
      // base size and a responsive-variant size (e.g. `md:text-3xl text-3xl`).
      // The stepper must remove the responsive variant too — otherwise the
      // user-chosen base size is visually overridden at md+ breakpoints.
      const component = `import React from 'react';

export default function Page() {
  return (
    <h3 data-dev-id="resp-heading" className="md:text-3xl font-heading font-bold text-foreground mb-1 text-3xl">Heading</h3>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h3',
        property: 'fontSize',
        value: 'text-2xl',
        newClassName: 'md:text-3xl font-heading font-bold text-foreground mb-1 text-3xl',
        elementInfo: {
          tagName: 'h3',
          className: 'md:text-3xl font-heading font-bold text-foreground mb-1 text-3xl',
          id: '',
          textContent: 'Heading',
          selector: 'h3',
          dataId: 'resp-heading',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 5,
          },
          rect: { top: 0, left: 0, width: 100, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      // Base + responsive size both gone, replaced with the new size only
      expect(updatedFile).toContain('text-2xl');
      expect(updatedFile).not.toContain('md:text-3xl');
      expect(updatedFile).not.toMatch(/(?<!md:)text-3xl/); // no bare text-3xl either
      // Non-size classes preserved
      expect(updatedFile).toContain('font-heading');
      expect(updatedFile).toContain('font-bold');
      expect(updatedFile).toContain('text-foreground');
      expect(updatedFile).toContain('mb-1');
    });

    it('should not stack font-size classes across the wider scale (text-7xl → text-9xl)', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <h1 data-dev-id="huge" className="text-7xl">Huge</h1>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-9xl',
        newClassName: 'text-9xl',
        elementInfo: {
          tagName: 'h1',
          className: 'text-7xl',
          id: '',
          textContent: 'Huge',
          selector: 'h1',
          dataId: 'huge',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 5,
          },
          rect: { top: 0, left: 0, width: 100, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-9xl');
      expect(updatedFile).not.toContain('text-7xl');
    });
  });

  describe('Multiple Style Changes', () => {
    it('should handle multiple sequential edits to the same file', async () => {
      // First edit: Change heading color
      const colorRequest = {
        selector: 'h1.text-3xl',
        property: 'color',
        value: '#2563EB',
        newClassName: 'text-3xl font-bold',
        newStyle: 'color: #2563EB',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl font-bold text-gray-900',
          id: '',
          textContent: 'Welcome',
          selector: 'h1.text-3xl',
          dataId: 'dev-selected-test-multi-1',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 5
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {}
        }
      };

      const colorResult = await astEditor.editElementStyle(testAppPath, colorRequest, TEST_APP_ID);
      expect(colorResult.success).toBe(true);

      // Second edit: Change heading size
      const sizeRequest = {
        selector: 'h1.text-3xl',
        property: 'fontSize',
        value: 'text-5xl',
        newClassName: 'text-5xl font-bold',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl font-bold', // Updated from first edit
          id: '',
          textContent: 'Welcome',
          selector: 'h1.text-5xl',
          dataId: 'dev-selected-test-multi-2',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 5
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {}
        }
      };

      const sizeResult = await astEditor.editElementStyle(testAppPath, sizeRequest, TEST_APP_ID);
      expect(sizeResult.success).toBe(true);

      // Verify both changes were applied
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-5xl'); // size change
      expect(updatedFile).toContain('font-bold'); // font weight preserved
      expect(updatedFile).not.toContain('text-3xl'); // old size removed
      expect(updatedFile).not.toContain('text-gray-900'); // old color class removed
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent file gracefully', async () => {
      const request = {
        selector: 'div',
        property: 'color',
        value: 'blue',
        newClassName: 'text-blue-500',
        elementInfo: {
          tagName: 'div',
          className: '',
          id: '',
          textContent: 'Test',
          selector: 'div',
          dataId: 'dev-selected-test-404',
          devContext: {
            fileName: '/src/frontend/pages/nonexistent.page.tsx',
            componentName: 'NonExistent',
            lineNumber: 1
          },
          rect: { top: 0, left: 0, width: 100, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should handle invalid element selector gracefully', async () => {
      const request = {
        selector: 'nonexistent.class',
        property: 'color',
        value: 'red',
        newClassName: 'text-red-500',
        elementInfo: {
          tagName: 'div',
          className: 'nonexistent class',
          id: '',
          textContent: 'Not found',
          selector: 'nonexistent.class',
          dataId: 'dev-selected-test-missing',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 999 // Way off line number
          },
          rect: { top: 0, left: 0, width: 100, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Element not found');
    });
  });

  describe('Edge Cases', () => {
    it('should handle elements with no existing className', async () => {
      // First, create a file with an element that has no className
      const componentWithoutClass = `import React from 'react';

export default function SimplePage() {
  return (
    <div>
      <p>Plain paragraph with no classes</p>
    </div>
  );
}`;

      await writeFile(testFilePath, componentWithoutClass);

      const request = {
        selector: 'p',
        property: 'color',
        value: '#FF0000',
        newClassName: '',
        newStyle: 'color: #FF0000',
        elementInfo: {
          tagName: 'p',
          className: '',
          id: '',
          textContent: 'Plain paragraph with no classes',
          selector: 'p',
          dataId: 'dev-selected-test-plain',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'SimplePage',
            lineNumber: 6
          },
          rect: { top: 50, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      expect(result.changes.oldClassName).toBe('');
      expect(result.changes.newClassName).toBe('');

      // Verify the file was modified with a className attribute
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('<p className=""'); // className attribute added
    });

    it('should preserve JSX expressions in className', async () => {
      // Create a file with dynamic className
      const componentWithDynamicClass = `import React from 'react';

export default function DynamicPage() {
  const isActive = true;
  return (
    <div>
      <p className={\`text-base \${isActive ? 'text-green-600' : 'text-gray-500'}\`}>
        Dynamic paragraph
      </p>
    </div>
  );
}`;

      await writeFile(testFilePath, componentWithDynamicClass);

      const request = {
        selector: 'p',
        property: 'fontSize',
        value: 'text-lg',
        newClassName: 'text-lg',
        elementInfo: {
          tagName: 'p',
          className: 'text-base text-green-600', // What would be computed
          id: '',
          textContent: 'Dynamic paragraph',
          selector: 'p',
          dataId: 'dev-selected-test-dynamic',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'DynamicPage',
            lineNumber: 7
          },
          rect: { top: 50, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      // This should fail gracefully since we can't easily edit template literals
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Cannot edit dynamic className|Element not found/);
    });
  });

  describe('Font Weight / Font Style (CSS Class Toggle)', () => {
    it('should add font-bold class when fontWeight is bold', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <h1 data-dev-id="abc123" className="text-3xl text-gray-900">Welcome</h1>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontWeight',
        value: 'bold',
        newClassName: 'text-3xl text-gray-900 font-bold',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl text-gray-900',
          id: '',
          textContent: 'Welcome',
          selector: 'h1',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('font-bold');
      expect(updatedFile).toContain('text-3xl');
      expect(updatedFile).toContain('text-gray-900');
    });

    it('should remove font-bold class when fontWeight is normal', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <h1 data-dev-id="abc123" className="text-3xl font-bold text-gray-900">Welcome</h1>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontWeight',
        value: 'normal',
        newClassName: 'text-3xl text-gray-900',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl font-bold text-gray-900',
          id: '',
          textContent: 'Welcome',
          selector: 'h1',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).not.toContain('font-bold');
      expect(updatedFile).toContain('text-3xl');
      expect(updatedFile).toContain('text-gray-900');
    });

    it('should add italic class when fontStyle is italic', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base mt-4">Hello world</p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'fontStyle',
        value: 'italic',
        newClassName: 'text-base mt-4 italic',
        elementInfo: {
          tagName: 'p',
          className: 'text-base mt-4',
          id: '',
          textContent: 'Hello world',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('italic');
      expect(updatedFile).toContain('text-base');
      expect(updatedFile).toContain('mt-4');
    });

    it('should remove italic class when fontStyle is normal', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base italic mt-4">Hello world</p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'fontStyle',
        value: 'normal',
        newClassName: 'text-base mt-4',
        elementInfo: {
          tagName: 'p',
          className: 'text-base italic mt-4',
          id: '',
          textContent: 'Hello world',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).not.toContain('italic');
      expect(updatedFile).toContain('text-base');
      expect(updatedFile).toContain('mt-4');
    });

    it('should not duplicate font-bold if already present', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <h1 data-dev-id="abc123" className="text-3xl font-bold">Title</h1>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontWeight',
        value: 'bold',
        newClassName: 'text-3xl font-bold',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl font-bold',
          id: '',
          textContent: 'Title',
          selector: 'h1',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      const matches = updatedFile.match(/font-bold/g);
      expect(matches).toHaveLength(1);
    });

    it('should remove not-italic when adding italic', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base not-italic">Reset text</p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'fontStyle',
        value: 'italic',
        newClassName: 'text-base italic',
        elementInfo: {
          tagName: 'p',
          className: 'text-base not-italic',
          id: '',
          textContent: 'Reset text',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('italic');
      expect(updatedFile).not.toContain('not-italic');
    });

    it('should not add inline style for fontWeight/fontStyle', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base">Some text</p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'fontWeight',
        value: 'bold',
        newClassName: 'text-base font-bold',
        elementInfo: {
          tagName: 'p',
          className: 'text-base',
          id: '',
          textContent: 'Some text',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).not.toContain('style=');
      expect(updatedFile).toContain('font-bold');
    });
  });

  describe('Text Alignment (Tailwind Classes)', () => {
    it('should add text-center class when textAlign is center', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base mt-4">Hello world</p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'textAlign',
        value: 'center',
        newClassName: 'text-base mt-4 text-center',
        elementInfo: {
          tagName: 'p',
          className: 'text-base mt-4',
          id: '',
          textContent: 'Hello world',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-center');
      expect(updatedFile).toContain('text-base');
      expect(updatedFile).toContain('mt-4');
    });

    it('should swap text-left for text-right when textAlign changes', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base text-left mt-4">Hello</p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'textAlign',
        value: 'right',
        newClassName: 'text-base text-right mt-4',
        elementInfo: {
          tagName: 'p',
          className: 'text-base text-left mt-4',
          id: '',
          textContent: 'Hello',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-right');
      expect(updatedFile).not.toContain('text-left');
      expect(updatedFile).toContain('text-base');
      expect(updatedFile).toContain('mt-4');
    });

    it('should remove alignment classes when textAlign value is empty', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base text-center mt-4">Hello</p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'textAlign',
        value: '',
        newClassName: 'text-base mt-4',
        elementInfo: {
          tagName: 'p',
          className: 'text-base text-center mt-4',
          id: '',
          textContent: 'Hello',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).not.toMatch(/text-(left|center|right|justify)/);
      expect(updatedFile).toContain('text-base');
      expect(updatedFile).toContain('mt-4');
    });

    it('should support text-justify', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base">A long paragraph that should justify across the line.</p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'textAlign',
        value: 'justify',
        newClassName: 'text-base text-justify',
        elementInfo: {
          tagName: 'p',
          className: 'text-base',
          id: '',
          textContent: 'A long paragraph that should justify across the line.',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-justify');
    });

    it('should preserve text-base/text-lg/etc. (not confuse font-size with alignment)', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <h2 data-dev-id="abc123" className="text-2xl text-gray-900">Heading</h2>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h2',
        property: 'textAlign',
        value: 'center',
        newClassName: 'text-2xl text-gray-900 text-center',
        elementInfo: {
          tagName: 'h2',
          className: 'text-2xl text-gray-900',
          id: '',
          textContent: 'Heading',
          selector: 'h2',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-center');
      expect(updatedFile).toContain('text-2xl');
      expect(updatedFile).toContain('text-gray-900');
    });
  });

  describe('Font Family (Inline Styles)', () => {
    it('should apply fontFamily as inline style on a paragraph', async () => {
      const request = {
        selector: 'p.text-base',
        property: 'fontFamily',
        value: 'Georgia, serif',
        newClassName: 'text-base mt-4',
        elementInfo: {
          tagName: 'p',
          className: 'text-base text-yellow-600 mt-4',
          id: '',
          textContent: 'This is a sample paragraph for testing.',
          selector: 'p.text-base',
          dataId: '',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 7
          },
          rect: { top: 100, left: 50, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);
      expect(result.success).toBe(true);

      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('fontFamily');
      expect(updatedFile).toContain('Georgia, serif');
    });

    it('should strip Tailwind font-sans class when applying fontFamily', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p className="font-sans text-base mt-4">Hello world</p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p.font-sans',
        property: 'fontFamily',
        value: "'Times New Roman', Times, serif",
        newClassName: 'text-base mt-4',
        elementInfo: {
          tagName: 'p',
          className: 'font-sans text-base mt-4',
          id: '',
          textContent: 'Hello world',
          selector: 'p.font-sans',
          dataId: '',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 0, left: 0, width: 100, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);
      expect(result.success).toBe(true);

      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).not.toContain('font-sans');
      expect(updatedFile).toContain('fontFamily');
      expect(updatedFile).toContain("'Times New Roman', Times, serif");
    });

    it('should override --font-heading CSS variable on heading elements', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <h1 className="text-3xl font-bold">Welcome</h1>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1.text-3xl',
        property: 'fontFamily',
        value: 'Georgia, serif',
        newClassName: 'text-3xl font-bold',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl font-bold',
          id: '',
          textContent: 'Welcome',
          selector: 'h1.text-3xl',
          dataId: '',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 0, left: 0, width: 200, height: 40 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);
      expect(result.success).toBe(true);

      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('fontFamily');
      expect(updatedFile).toContain('Georgia, serif');
      // Should also set --font-heading CSS variable to override !important rule
      expect(updatedFile).toContain('--font-heading');
      // Should wrap in `as React.CSSProperties` for type safety
      expect(updatedFile).toContain('as React.CSSProperties');
    });

    it('should preserve template literal style values when adding fontFamily', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <h2 className="text-3xl font-bold" style={{ color: \`hsl(var(--primary))\` }}>Styled</h2>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h2.text-3xl',
        property: 'fontFamily',
        value: 'Georgia, serif',
        newClassName: 'text-3xl font-bold',
        elementInfo: {
          tagName: 'h2',
          className: 'text-3xl font-bold',
          id: '',
          textContent: 'Styled',
          selector: 'h2.text-3xl',
          dataId: '',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 0, left: 0, width: 200, height: 40 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);
      expect(result.success).toBe(true);

      const updatedFile = await readFile(testFilePath, 'utf-8');
      // Original template literal style must be preserved
      expect(updatedFile).toContain('hsl(var(--primary))');
      // New fontFamily added
      expect(updatedFile).toContain('fontFamily');
      expect(updatedFile).toContain('Georgia, serif');
      // Heading override
      expect(updatedFile).toContain('--font-heading');
    });

    it('should preserve existing styles on second heading font edit (TSAsExpression unwrap)', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <h1 className="text-3xl font-bold" style={{ color: \`hsl(var(--primary))\` }}>Title</h1>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const makeRequest = (fontValue: string) => ({
        selector: 'h1.text-3xl',
        property: 'fontFamily',
        value: fontValue,
        newClassName: 'text-3xl font-bold',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl font-bold',
          id: '',
          textContent: 'Title',
          selector: 'h1.text-3xl',
          dataId: '',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 0, left: 0, width: 200, height: 40 },
          computedStyles: {}
        }
      });

      // First edit — adds fontFamily + --font-heading, wraps in `as React.CSSProperties`
      const result1 = await astEditor.editElementStyle(testAppPath, makeRequest('Georgia, serif'), TEST_APP_ID);
      expect(result1.success).toBe(true);

      const afterFirst = await readFile(testFilePath, 'utf-8');
      expect(afterFirst).toContain('as React.CSSProperties');
      expect(afterFirst).toContain('hsl(var(--primary))');

      // Second edit — changes font; must NOT drop the template-literal color
      const result2 = await astEditor.editElementStyle(testAppPath, makeRequest('Arial, sans-serif'), TEST_APP_ID);
      expect(result2.success).toBe(true);

      const afterSecond = await readFile(testFilePath, 'utf-8');
      // Original template literal preserved
      expect(afterSecond).toContain('hsl(var(--primary))');
      // Font updated to new value
      expect(afterSecond).toContain('Arial, sans-serif');
      // Old font value replaced
      expect(afterSecond).not.toContain('Georgia, serif');
      // Still type-safe
      expect(afterSecond).toContain('as React.CSSProperties');
    });
  });

  describe('List Style Type (Tailwind Classes)', () => {
    it('should add list-disc and [&>*]:list-item when listStyleType is disc', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <ul data-dev-id="abc123" className="mt-4"><li>Item</li></ul>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'ul',
        property: 'listStyleType',
        value: 'disc',
        newClassName: 'mt-4 list-disc [&>*]:list-item',
        elementInfo: {
          tagName: 'ul',
          className: 'mt-4',
          id: '',
          textContent: 'Item',
          selector: 'ul',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6,
          },
          rect: { top: 100, left: 0, width: 200, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('list-disc');
      expect(updatedFile).toContain('[&>*]:list-item');
      expect(updatedFile).toContain('mt-4');
    });

    it('should swap list-disc for list-decimal when listStyleType changes', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <ul data-dev-id="abc123" className="mt-4 list-disc [&>*]:list-item"><li>Item</li></ul>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'ul',
        property: 'listStyleType',
        value: 'decimal',
        newClassName: 'mt-4 list-decimal [&>*]:list-item',
        elementInfo: {
          tagName: 'ul',
          className: 'mt-4 list-disc [&>*]:list-item',
          id: '',
          textContent: 'Item',
          selector: 'ul',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6,
          },
          rect: { top: 100, left: 0, width: 200, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('list-decimal');
      expect(updatedFile).not.toContain('list-disc');
      expect(updatedFile).toContain('[&>*]:list-item');
    });

    it('should remove list type classes when listStyleType value is empty', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <ul data-dev-id="abc123" className="mt-4 list-disc [&>*]:list-item"><li>Item</li></ul>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'ul',
        property: 'listStyleType',
        value: '',
        newClassName: 'mt-4',
        elementInfo: {
          tagName: 'ul',
          className: 'mt-4 list-disc [&>*]:list-item',
          id: '',
          textContent: 'Item',
          selector: 'ul',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6,
          },
          rect: { top: 100, left: 0, width: 200, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).not.toMatch(/list-(disc|decimal)/);
      expect(updatedFile).not.toContain('[&>*]:list-item');
      expect(updatedFile).toContain('mt-4');
    });

    it('should preserve unrelated classes when changing list type', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <ul data-dev-id="abc123" className="mt-4 font-bold text-gray-700"><li>Item</li></ul>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'ul',
        property: 'listStyleType',
        value: 'decimal',
        newClassName: 'mt-4 font-bold text-gray-700 list-decimal [&>*]:list-item',
        elementInfo: {
          tagName: 'ul',
          className: 'mt-4 font-bold text-gray-700',
          id: '',
          textContent: 'Item',
          selector: 'ul',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6,
          },
          rect: { top: 100, left: 0, width: 200, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('list-decimal');
      expect(updatedFile).toContain('[&>*]:list-item');
      expect(updatedFile).toContain('mt-4');
      expect(updatedFile).toContain('font-bold');
      expect(updatedFile).toContain('text-gray-700');
    });
  });

  describe('Inline Formatting Normalization (unwrap em/strong/b/i)', () => {
    it('should unwrap <em> children when adding italic class', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <h1 data-dev-id="abc123" className="text-2xl"><em>Hello World</em></h1>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontStyle',
        value: 'italic',
        newClassName: 'text-2xl italic',
        elementInfo: {
          tagName: 'h1',
          className: 'text-2xl',
          id: '',
          textContent: 'Hello World',
          selector: 'h1',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('italic');
      expect(updatedFile).not.toContain('<em>');
      expect(updatedFile).not.toContain('</em>');
      expect(updatedFile).toContain('Hello World');
    });

    it('should unwrap <strong> children when adding font-bold class', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base"><strong>Bold text</strong> and normal</p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'fontWeight',
        value: 'bold',
        newClassName: 'text-base font-bold',
        elementInfo: {
          tagName: 'p',
          className: 'text-base',
          id: '',
          textContent: 'Bold text and normal',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('font-bold');
      expect(updatedFile).not.toContain('<strong>');
      expect(updatedFile).not.toContain('</strong>');
      expect(updatedFile).toContain('Bold text');
      expect(updatedFile).toContain('and normal');
    });

    it('should unwrap <b> and <i> tags the same as <strong> and <em>', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base"><b>Legacy bold</b></p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'fontWeight',
        value: 'bold',
        newClassName: 'text-base font-bold',
        elementInfo: {
          tagName: 'p',
          className: 'text-base',
          id: '',
          textContent: 'Legacy bold',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('font-bold');
      expect(updatedFile).not.toContain('<b>');
      expect(updatedFile).not.toContain('</b>');
      expect(updatedFile).toContain('Legacy bold');
    });

    it('should only unwrap bold tags for fontWeight, leave em/i for fontStyle', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base"><strong><em>Both</em></strong></p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'fontWeight',
        value: 'bold',
        newClassName: 'text-base font-bold',
        elementInfo: {
          tagName: 'p',
          className: 'text-base',
          id: '',
          textContent: 'Both',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('font-bold');
      expect(updatedFile).not.toContain('<strong>');
      expect(updatedFile).not.toContain('</strong>');
      // <em> should remain — it's not related to fontWeight
      expect(updatedFile).toContain('<em>');
      expect(updatedFile).toContain('Both');
    });

    it('should NOT unwrap when removing formatting (fontStyle normal)', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <p data-dev-id="abc123" className="text-base italic"><em>Styled text</em></p>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'p',
        property: 'fontStyle',
        value: 'normal',
        newClassName: 'text-base',
        elementInfo: {
          tagName: 'p',
          className: 'text-base italic',
          id: '',
          textContent: 'Styled text',
          selector: 'p',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 100, left: 0, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).not.toContain('italic');
      // <em> should remain — we're removing italic, not adding it
      expect(updatedFile).toContain('<em>');
    });

    it('should preserve mixed text and em children when unwrapping', async () => {
      const component = `import React from 'react';

export default function Page() {
  return (
    <div>
      <h1 data-dev-id="abc123" className="text-2xl"><em>Hello</em> World</h1>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontStyle',
        value: 'italic',
        newClassName: 'text-2xl italic',
        elementInfo: {
          tagName: 'h1',
          className: 'text-2xl',
          id: '',
          textContent: 'Hello World',
          selector: 'h1',
          dataId: 'abc123',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 6
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('italic');
      expect(updatedFile).not.toContain('<em>');
      expect(updatedFile).toContain('Hello');
      expect(updatedFile).toContain('World');
    });
  });

  describe('data-dev-id matching', () => {
    it('should match by data-dev-id even when line number is wrong', async () => {
      const componentWithDevId = `import React from 'react';

export default function Page() {
  return (
    <div>
      <h1 data-dev-id="abc123" className="text-3xl font-bold">Title</h1>
      <p data-dev-id="def456" className="text-base text-blue-600 mt-4">
        Paragraph text here.
      </p>
    </div>
  );
}`;

      await writeFile(testFilePath, componentWithDevId);

      const request = {
        selector: 'p.text-blue-600',
        property: 'color',
        value: '#FF0000',
        newClassName: 'text-base mt-4',
        newStyle: 'color: #FF0000',
        elementInfo: {
          tagName: 'p',
          className: 'text-base text-blue-600 mt-4',
          id: '',
          textContent: 'Paragraph text here.',
          selector: 'p.text-blue-600',
          dataId: 'def456',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 999, // Intentionally wrong — should still match via data-dev-id
          },
          rect: { top: 100, left: 50, width: 200, height: 20 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      expect(result.changes.property).toBe('color');

      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-base mt-4');
      expect(updatedFile).not.toContain('text-blue-600');
    });
  });

  describe('namespaced components (motion.h1, etc.)', () => {
    it('should match motion.h1 when DOM reports tagName as h1', async () => {
      const component = `import React from 'react';
import { motion } from 'framer-motion';

export default function Page() {
  return (
    <div>
      <motion.h1 className="font-heading font-bold text-lg">The Daily</motion.h1>
    </div>
  );
}`;
      await writeFile(testFilePath, component);

      const request = {
        selector: 'h1',
        property: 'fontWeight',
        value: 'normal',
        newClassName: 'font-heading text-lg',
        elementInfo: {
          tagName: 'h1',
          className: 'font-heading font-bold text-lg',
          id: '',
          textContent: 'The Daily',
          selector: 'h1',
          dataId: '',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'Page',
            lineNumber: 7,
          },
          rect: { top: 100, left: 0, width: 400, height: 60 },
          computedStyles: {}
        }
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('font-heading text-lg');
      expect(updatedFile).not.toContain('font-bold');
    });
  });

  describe('regex parity with dev-tools optimistic strip', () => {
    // Drift guard: dev-tools' TextSizeStepperButton mirrors the AST-side
    // strip in the browser so the optimistic DOM state matches the eventual
    // file edit. Because dev-tools is excluded from the workspace (it ships
    // bundled into customer preview containers), the patterns are duplicated
    // rather than shared via a package. This test fails if either side
    // adds/removes a unit without updating the other.

    it('BARE_SIZE / BARE_ARBITRARY / LENGTH_SHAPE literals match between agents and dev-tools', async () => {
      const agentsSrc = await readFile(
        join(process.cwd(), 'src/tools/ast-style-editor.ts'),
        'utf-8',
      );
      const devToolsSrc = await readFile(
        join(
          process.cwd(),
          '../app-templates/v8/dev-tools/src/components/TextSizeStepperButton.tsx',
        ),
        'utf-8',
      );

      // Extract the three regex literals from each file. The assertion
      // shape is: each regex appears in BOTH files. We don't assert
      // exact literal equality character-by-character because variable
      // naming differs (lengthShape vs LENGTH_SHAPE) — instead we extract
      // the regex source and compare those.
      const lengthShape = /\/\\d\(\?:\\\.\\d\+\)\?[^/]+min\|max\)\\s\*\\\(\/i/;
      const bareSize = /\/\^text-\(\?:xs\|sm\|base\|lg[^/]+9xl\)\$\//;
      const bareArbitrary = /\/\^text-\\\[\(\[\^\\\]\]\+\)\\\]\$\//;

      expect(agentsSrc).toMatch(lengthShape);
      expect(devToolsSrc).toMatch(lengthShape);
      expect(agentsSrc).toMatch(bareSize);
      expect(devToolsSrc).toMatch(bareSize);
      expect(agentsSrc).toMatch(bareArbitrary);
      expect(devToolsSrc).toMatch(bareArbitrary);
    });

    it('listTypePattern regex in agents matches ListType enum values in dev-tools', async () => {
      const agentsSrc = await readFile(
        join(process.cwd(), 'src/tools/ast-style-editor.ts'),
        'utf-8',
      );
      const devToolsSrc = await readFile(
        join(
          process.cwd(),
          '../app-templates/v8/dev-tools/src/components/ListTypeButton.tsx',
        ),
        'utf-8',
      );

      // Agents side: the listStyleType case must contain a pattern that accepts
      // both "disc" and "decimal" as the value after "list-".
      const listTypePattern = /\/\^list-\(disc\|decimal\)\$\//;
      expect(agentsSrc).toMatch(listTypePattern);

      // Dev-tools side: the ListType enum must declare exactly those two values.
      expect(devToolsSrc).toMatch(/DISC\s*=\s*"disc"/);
      expect(devToolsSrc).toMatch(/DECIMAL\s*=\s*"decimal"/);
    });
  });

  describe('commit message format', () => {
    // The commit message lands in per-app git history that users browse
    // through the in-app version-history UI. source-mapper sometimes can't
    // resolve the parent component and reports componentName: "unknown",
    // which produced unreadable messages like "Update h1 fontSize to
    // text-8xl in unknown". Fall back to the source file name when the
    // component name is missing or literally "unknown".

    it('omits the "in <component>" suffix when the component name is "unknown"', () => {
      const message = (astEditor as unknown as {
        generateCommitMessage: (c: unknown, r: unknown) => string;
      }).generateCommitMessage({}, {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-8xl',
        newClassName: 'text-8xl',
        elementInfo: {
          tagName: 'h1',
          className: 'text-8xl',
          id: '',
          textContent: '',
          selector: 'h1',
          dataId: '',
          devContext: {
            fileName: 'src/pages/index.tsx',
            componentName: 'unknown',
            lineNumber: 5,
          },
          rect: { top: 0, left: 0, width: 0, height: 0 },
          computedStyles: {},
        },
      });

      expect(message).not.toContain('unknown');
      // Falls back to the file name so git history is still navigable
      expect(message).toContain('index.tsx');
      // Core info is still present
      expect(message).toContain('h1');
      expect(message).toContain('text-8xl');
    });

    it('keeps the component name when it is a real identifier', () => {
      const message = (astEditor as unknown as {
        generateCommitMessage: (c: unknown, r: unknown) => string;
      }).generateCommitMessage({}, {
        selector: 'h1',
        property: 'fontSize',
        value: 'text-4xl',
        newClassName: 'text-4xl',
        elementInfo: {
          tagName: 'h1',
          className: 'text-4xl',
          id: '',
          textContent: '',
          selector: 'h1',
          dataId: '',
          devContext: {
            fileName: 'src/pages/index.tsx',
            componentName: 'HomePage',
            lineNumber: 5,
          },
          rect: { top: 0, left: 0, width: 0, height: 0 },
          computedStyles: {},
        },
      });

      expect(message).toContain('HomePage');
      expect(message).not.toContain('index.tsx');
    });
  });

  describe('git commit capture', () => {
    // The hover-bar requirement is that every stepper / class-toggle click
    // produces a per-app git commit so users can revert via the existing
    // version history. ASTEditorBase only commits when both shouldCommit
    // is true AND appId is present. editElementStyle had been calling
    // editTemplate without an appId, silently skipping the commit even on
    // success. This regression guard keeps the appId threaded through.

    it('invokes commitChanges with the supplied appId on a successful edit', async () => {
      const commitSpy = vi
        .spyOn(astEditor as unknown as { commitChanges: () => Promise<string | undefined> }, 'commitChanges')
        .mockResolvedValue('faked-commit-hash');

      const request = {
        selector: 'h1.text-3xl',
        property: 'fontSize',
        value: 'text-4xl',
        newClassName: 'text-4xl font-bold text-gray-900',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl font-bold text-gray-900',
          id: '',
          textContent: 'Welcome',
          selector: 'h1.text-3xl',
          dataId: 'dev-selected-commit-1',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 5,
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      expect(commitSpy).toHaveBeenCalledTimes(1);
      const callArgs = commitSpy.mock.calls[0];
      expect(callArgs[2]).toContain('fontSize'); // commit message includes the property
      expect(callArgs[3]).toBeDefined(); // gitTool instance passed
      expect(result.commitHash).toBe('faked-commit-hash');
    });

    it('always commits when appId is provided', async () => {
      const commitSpy = vi
        .spyOn(astEditor as unknown as { commitChanges: () => Promise<string | undefined> }, 'commitChanges')
        .mockResolvedValue('faked-commit-hash');

      const request = {
        selector: 'h1.text-3xl',
        property: 'fontSize',
        value: 'text-4xl',
        newClassName: 'text-4xl font-bold text-gray-900',
        elementInfo: {
          tagName: 'h1',
          className: 'text-3xl font-bold text-gray-900',
          id: '',
          textContent: 'Welcome',
          selector: 'h1.text-3xl',
          dataId: 'dev-selected-commit-2',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 5,
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {},
        },
      };

      const result = await astEditor.editElementStyle(testAppPath, request, TEST_APP_ID);

      expect(result.success).toBe(true);
      expect(commitSpy).toHaveBeenCalledTimes(1);
      expect(result.commitHash).toBe('faked-commit-hash');
    });
  });
});
