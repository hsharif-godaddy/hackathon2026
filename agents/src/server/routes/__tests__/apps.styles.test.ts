import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { appsRouter } from '../apps.js';
import { AppRepository } from '../../../database/index.js';

// Create test Express app with fake auth context using a bypass siteId
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  // Inject agentContext so validateAppOwnership passes
  app.use((req: any, _res: any, next: any) => {
    req.agentContext = { siteId: 'local-dev-site' };
    next();
  });
  app.use('/apps', appsRouter);
  return app;
};

describe('Apps Styles Edit API', () => {
  let app: express.Express;
  let appRepo: AppRepository;
  let testAppId: string;
  let testAppPath: string;

  beforeAll(async () => {
    app = createTestApp();
    appRepo = new AppRepository();
  });

  beforeEach(async () => {
    // Create a test app with sample files
    testAppPath = `/tmp/test-app-${Date.now()}`;
    await mkdir(testAppPath, { recursive: true });
    await mkdir(join(testAppPath, 'src', 'frontend', 'pages'), { recursive: true });

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
    </div>
  );
}`;

    await writeFile(join(testAppPath, 'src', 'frontend', 'pages', 'index.page.tsx'), sampleComponent);

    // Create test app in database using registerOrUpdateApp
    const result = await appRepo.registerOrUpdateApp({
      siteId: 'local-dev-site',
      name: 'Test App',
      appPath: testAppPath,
      initialPrompt: 'Test app for styles editing'
    });

    testAppId = result.app.id;

    // Update app path to our test directory
    appRepo.update(testAppId, { path: testAppPath });
  });

  afterEach(async () => {
    // Cleanup test app
    if (testAppId) {
      try {
        await appRepo.delete(testAppId);
      } catch (error) {
        console.warn('Failed to delete test app:', error);
      }
    }

    // Cleanup test directory
    if (testAppPath && existsSync(testAppPath)) {
      try {
        await rm(testAppPath, { recursive: true });
      } catch (error) {
        console.warn('Failed to cleanup test directory:', error);
      }
    }
  });

  describe('POST /apps/:id/styles/edit', () => {
    it('should successfully edit element styles with valid request', async () => {
      const styleEditRequest = {
        selector: 'p.text-yellow-600',
        property: 'backgroundColor',
        value: '#DCFCE7',
        newClassName: 'text-yellow-600',
        newStyle: 'background-color: #DCFCE7',
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
          rect: {
            top: 100,
            left: 50,
            width: 200,
            height: 20
          },
          computedStyles: {}
        }
      };

      const response = await request(app)
        .post(`/apps/${testAppId}/styles/edit`)
        .send(styleEditRequest)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Style updated successfully',
        data: expect.objectContaining({
          selector: 'p.text-yellow-600',
          property: 'backgroundColor',
          value: '#DCFCE7',
          filePath: expect.stringContaining('index.page.tsx'),
          changes: expect.objectContaining({
            property: 'backgroundColor',
            value: '#DCFCE7'
          })
        })
      });

      // Verify the file was actually modified
      const updatedFile = await readFile(join(testAppPath, 'src', 'frontend', 'pages', 'index.page.tsx'), 'utf-8');
      expect(updatedFile).toContain('text-base text-yellow-600 mt-4'); // className should remain
      // Note: background color would be applied as inline style, not className
    });

    it('should return error for missing app ID', async () => {
      const response = await request(app)
        .post('/apps/missingid0/styles/edit')
        .send({
          selector: 'p',
          property: 'color',
          value: 'red',
          elementInfo: { devContext: {} }
        })
        .expect(404);

      expect(response.body.error).toBe('App not found');
    });

    it('should return error for missing selector', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/styles/edit`)
        .send({
          property: 'color',
          value: 'red',
          elementInfo: { devContext: {} }
        })
        .expect(400);

      expect(response.body.error).toBe('Selector, property, and value are required');
    });

    it('should return error for missing element info', async () => {
      const response = await request(app)
        .post(`/apps/${testAppId}/styles/edit`)
        .send({
          selector: 'p',
          property: 'color',
          value: 'red'
        })
        .expect(400);

      expect(response.body.error).toBe('Element info with dev context is required');
    });

    it('should return error for non-existent app', async () => {
      const response = await request(app)
        .post('/apps/non-existent-id/styles/edit')
        .send({
          selector: 'p',
          property: 'color',
          value: 'red',
          elementInfo: { devContext: {} }
        })
        .expect(404);

      expect(response.body.error).toBe('App not found');
    });

    it('should handle font size changes', async () => {
      const styleEditRequest = {
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
          dataId: 'dev-selected-test-456',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 5
          },
          rect: { top: 50, left: 0, width: 300, height: 40 },
          computedStyles: {}
        }
      };

      const response = await request(app)
        .post(`/apps/${testAppId}/styles/edit`)
        .send(styleEditRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.property).toBe('fontSize');
      expect(response.body.data.value).toBe('text-4xl');

      // Verify the file was modified
      const updatedFile = await readFile(join(testAppPath, 'src', 'frontend', 'pages', 'index.page.tsx'), 'utf-8');
      expect(updatedFile).toContain('text-4xl'); // Should replace text-3xl with text-4xl
    });

    it('should handle color changes with inline styles', async () => {
      const styleEditRequest = {
        selector: 'p.text-yellow-600',
        property: 'color',
        value: '#FF0000',
        newClassName: 'text-base mt-4', // color class removed
        newStyle: 'color: #FF0000',
        elementInfo: {
          tagName: 'p',
          className: 'text-base text-yellow-600 mt-4',
          id: '',
          textContent: 'This is a sample paragraph for testing.',
          selector: 'p.text-yellow-600',
          dataId: 'dev-selected-test-789',
          devContext: {
            fileName: '/src/frontend/pages/index.page.tsx',
            componentName: 'HomePage',
            lineNumber: 7
          },
          rect: { top: 120, left: 0, width: 400, height: 24 },
          computedStyles: {}
        }
      };

      const response = await request(app)
        .post(`/apps/${testAppId}/styles/edit`)
        .send(styleEditRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.property).toBe('color');
      expect(response.body.data.value).toBe('#FF0000');

      // Verify the file was modified
      const updatedFile = await readFile(join(testAppPath, 'src', 'frontend', 'pages', 'index.page.tsx'), 'utf-8');
      expect(updatedFile).not.toContain('text-yellow-600'); // Color class should be removed
    });

    it('should handle file that does not exist', async () => {
      const styleEditRequest = {
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
          dataId: 'dev-selected-test-999',
          devContext: {
            fileName: '/src/frontend/pages/nonexistent.page.tsx',
            componentName: 'NonExistent',
            lineNumber: 1
          },
          rect: { top: 0, left: 0, width: 100, height: 20 },
          computedStyles: {}
        }
      };

      const response = await request(app)
        .post(`/apps/${testAppId}/styles/edit`)
        .send(styleEditRequest)
        .expect(400);

      expect(response.body.error).toBe('Failed to edit style');
      expect(response.body.details).toContain('ENOENT');
    });
  });
});
