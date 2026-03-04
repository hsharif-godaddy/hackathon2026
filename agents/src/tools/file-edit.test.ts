import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileEditTool } from './file-edit.js';
import { fileUploadService } from '../services/FileUploadService.js';
import { clearExtensionResolved } from '../utils/upload-resolution-tracking.js';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

describe('FileEditTool - Auto Resolution from Uploads', () => {
  const testAppId = 'test-app-resolution';
  const testProjectDir = `/tmp/test-project-file-edit/${testAppId}`;
  const tool = new FileEditTool();

  beforeEach(async () => {
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }

    await mkdir(testProjectDir, { recursive: true });

    clearExtensionResolved(testAppId);

    const testAppUploadsDir = fileUploadService['pathBuilder'].join(testAppId);
    if (existsSync(testAppUploadsDir)) {
      await rm(testAppUploadsDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }

    clearExtensionResolved(testAppId);

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
    const testFile = {
      originalname: 'my-logo.png',
      mimetype: 'image/png',
      size: 12,
      buffer: Buffer.from('logo-content')
    } as Express.Multer.File;

    await fileUploadService.processUpload(testAppId, [testFile]);

    const result = await tool.editFiles(testProjectDir, {
      operations: [{
        path: 'public/my-logo.png',
        mode: 'create',
        content: ''
      }],
      createDirs: true
    }, { appId: testAppId });

    expect(result.success).toBe(true);

    const projectFilePath = join(testProjectDir, 'public/my-logo.png');
    expect(existsSync(projectFilePath)).toBe(true);

    const content = await readFile(projectFilePath);
    expect(content.toString()).toBe('logo-content');
  });

  it('should resolve two different uploaded images to different target files (no duplicates)', async () => {
    // Upload two distinct images with the same extension
    const slide1File = {
      originalname: 'slide1.jpg',
      mimetype: 'image/jpeg',
      size: 13,
      buffer: Buffer.from('slide1-content')
    } as Express.Multer.File;

    const slide2File = {
      originalname: 'slide2.jpg',
      mimetype: 'image/jpeg',
      size: 13,
      buffer: Buffer.from('slide2-content')
    } as Express.Multer.File;

    await fileUploadService.processUpload(testAppId, [slide1File, slide2File]);

    // Sequential calls simulating what the LLM does via Promise.all with custom names
    const result1 = await tool.editFiles(testProjectDir, {
      operations: [{ path: 'public/hero.jpg', mode: 'create', content: '' }],
      createDirs: true
    }, { appId: testAppId });

    const result2 = await tool.editFiles(testProjectDir, {
      operations: [{ path: 'public/banner.jpg', mode: 'create', content: '' }],
      createDirs: true
    }, { appId: testAppId });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    const heroContent = (await readFile(join(testProjectDir, 'public/hero.jpg'))).toString();
    const bannerContent = (await readFile(join(testProjectDir, 'public/banner.jpg'))).toString();

    // Each target file must have received a distinct uploaded image
    expect(heroContent).not.toBe(bannerContent);
    expect(new Set([heroContent, bannerContent])).toEqual(
      new Set(['slide1-content', 'slide2-content'])
    );
  });

  it('should clear tracking state after processUpload so next upload batch starts fresh', async () => {
    const imageFile = {
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: 12,
      buffer: Buffer.from('first-upload')
    } as Express.Multer.File;

    await fileUploadService.processUpload(testAppId, [imageFile]);

    // Consume the upload via extension resolution
    await tool.editFiles(testProjectDir, {
      operations: [{ path: 'public/a.jpg', mode: 'create', content: '' }],
      createDirs: true
    }, { appId: testAppId });

    // Second upload batch — clearExtensionResolved should have been called
    const newImage = {
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: 11,
      buffer: Buffer.from('second-upload')
    } as Express.Multer.File;

    await fileUploadService.processUpload(testAppId, [newImage]);

    const result = await tool.editFiles(testProjectDir, {
      operations: [{ path: 'public/b.jpg', mode: 'create', content: '' }],
      createDirs: true
    }, { appId: testAppId });

    expect(result.success).toBe(true);

    const content = (await readFile(join(testProjectDir, 'public/b.jpg'))).toString();
    expect(content).toBe('second-upload');
  });
});
