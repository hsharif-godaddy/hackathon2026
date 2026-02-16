import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileEditTool } from './file-edit.js';
import { fileUploadService } from '../services/FileUploadService.js';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

describe('FileEditTool - Auto Resolution from Uploads', () => {
  const testAppId = 'test-app-resolution';
  const testProjectDir = `/tmp/test-project-file-edit/${testAppId}`;
  const tool = new FileEditTool();

  beforeEach(async () => {
    // Clean up test directories
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }

    await mkdir(testProjectDir, { recursive: true });

    // Clean up any test uploads
    const uploadsDir = fileUploadService['uploadsDir'];
    const testAppUploadsDir = fileUploadService['pathBuilder'].join(testAppId);
    if (existsSync(testAppUploadsDir)) {
      await rm(testAppUploadsDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    // Clean up
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }

    // Clean up test uploads
    const testAppUploadsDir = fileUploadService['pathBuilder'].join(testAppId);
    if (existsSync(testAppUploadsDir)) {
      await rm(testAppUploadsDir, { recursive: true, force: true });
    }
  });

  it('should auto-resolve file from uploads when creating new file', async () => {
    // Upload a test file
    const testFile = {
      originalname: 'logo.png',
      mimetype: 'image/png',
      size: 19,
      buffer: Buffer.from('test-image-content')
    } as Express.Multer.File;

    await fileUploadService.processUpload(testAppId, [testFile]);

    // Try to create the file in the project using file-edit tool
    const result = await tool.editFiles(testProjectDir, {
      operations: [{
        path: 'public/assets/logo.png',
        mode: 'create',
        content: '' // Empty content should be ignored, auto-resolve from uploads
      }],
      createDirs: true
    }, { appId: testAppId });

    expect(result.success).toBe(true);
    expect(result.completedOperations).toBe(1);

    // Verify file was copied to project
    const projectFilePath = join(testProjectDir, 'public/assets/logo.png');
    expect(existsSync(projectFilePath)).toBe(true);

    // Verify content matches uploaded file
    const content = await readFile(projectFilePath);
    expect(content.toString()).toBe('test-image-content');
  });

  it('should not auto-resolve if file already exists in project', async () => {
    // Create existing file in project first
    const projectFilePath = join(testProjectDir, 'public/assets/existing.png');
    await mkdir(join(testProjectDir, 'public/assets'), { recursive: true });
    await writeFile(projectFilePath, 'existing-project-content');

    // Upload a different file with the same name
    const testFile = {
      originalname: 'existing.png',
      mimetype: 'image/png',
      size: 11,
      buffer: Buffer.from('new-content')
    } as Express.Multer.File;

    await fileUploadService.processUpload(testAppId, [testFile]);

    // Try to rewrite - should not auto-resolve since file exists
    const result = await tool.editFiles(testProjectDir, {
      operations: [{
        path: 'public/assets/existing.png',
        mode: 'rewrite',
        content: 'manually-specified-content'
      }]
    }, { appId: testAppId });

    expect(result.success).toBe(true);

    // Verify file has the manually specified content, not the uploaded content
    const content = await readFile(projectFilePath, 'utf-8');
    expect(content).toBe('manually-specified-content');
  });

  it('should proceed normally if no matching upload found', async () => {
    // Try to create a file with no matching upload
    const result = await tool.editFiles(testProjectDir, {
      operations: [{
        path: 'public/assets/no-match.png',
        mode: 'create',
        content: 'regular-content'
      }],
      createDirs: true
    }, { appId: testAppId });

    expect(result.success).toBe(true);

    // Verify file was created with provided content
    const projectFilePath = join(testProjectDir, 'public/assets/no-match.png');
    expect(existsSync(projectFilePath)).toBe(true);

    const content = await readFile(projectFilePath, 'utf-8');
    expect(content).toBe('regular-content');
  });

  it('should match by originalName when filename is different', async () => {
    // Upload a file (filename will be auto-generated, different from originalname)
    const testFile = {
      originalname: 'my-logo.png',
      mimetype: 'image/png',
      size: 12,
      buffer: Buffer.from('logo-content')
    } as Express.Multer.File;

    await fileUploadService.processUpload(testAppId, [testFile]);

    // Try to create file using original name
    const result = await tool.editFiles(testProjectDir, {
      operations: [{
        path: 'public/my-logo.png',
        mode: 'create',
        content: ''
      }],
      createDirs: true
    }, { appId: testAppId });

    expect(result.success).toBe(true);

    // Verify file was auto-resolved
    const projectFilePath = join(testProjectDir, 'public/my-logo.png');
    expect(existsSync(projectFilePath)).toBe(true);

    const content = await readFile(projectFilePath);
    expect(content.toString()).toBe('logo-content');
  });
});
