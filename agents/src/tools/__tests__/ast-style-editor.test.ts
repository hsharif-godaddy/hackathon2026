import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile, mkdir, rmdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { ASTStyleEditor } from '../ast-style-editor.js';

describe('AST Style Editor Integration Tests', () => {
  let astEditor: ASTStyleEditor;
  let testAppPath: string;
  let testFilePath: string;

  beforeEach(async () => {
    astEditor = new ASTStyleEditor();
    
    // Create test directory
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

      const result = await astEditor.editElementStyle(testAppPath, request);

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

      const result = await astEditor.editElementStyle(testAppPath, request);

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

      const result = await astEditor.editElementStyle(testAppPath, request);

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

      const result = await astEditor.editElementStyle(testAppPath, request);

      expect(result.success).toBe(true);
      expect(result.changes.newClassName).toContain('text-base');
      expect(result.changes.newClassName).toContain('text-gray-500');

      // Verify the file was modified
      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-base text-gray-500');
      expect(updatedFile).not.toContain('text-sm text-gray-500');
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

      const colorResult = await astEditor.editElementStyle(testAppPath, colorRequest);
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

      const sizeResult = await astEditor.editElementStyle(testAppPath, sizeRequest);
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

      const result = await astEditor.editElementStyle(testAppPath, request);

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

      const result = await astEditor.editElementStyle(testAppPath, request);

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

      const result = await astEditor.editElementStyle(testAppPath, request);

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

      const result = await astEditor.editElementStyle(testAppPath, request);

      // This should fail gracefully since we can't easily edit template literals
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Cannot edit dynamic className|Element not found/);
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

      const result = await astEditor.editElementStyle(testAppPath, request);

      expect(result.success).toBe(true);
      expect(result.changes.property).toBe('color');

      const updatedFile = await readFile(testFilePath, 'utf-8');
      expect(updatedFile).toContain('text-base mt-4');
      expect(updatedFile).not.toContain('text-blue-600');
    });
  });
});
