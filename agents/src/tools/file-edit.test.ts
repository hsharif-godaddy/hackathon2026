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
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }
    await mkdir(testProjectDir, { recursive: true });

    const testAppUploadsDir = fileUploadService.getAppUploadsDir(testAppId);
    if (existsSync(testAppUploadsDir)) {
      await rm(testAppUploadsDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (existsSync(testProjectDir)) {
      await rm(testProjectDir, { recursive: true, force: true });
    }
    const testAppUploadsDir = fileUploadService.getAppUploadsDir(testAppId);
    if (existsSync(testAppUploadsDir)) {
      await rm(testAppUploadsDir, { recursive: true, force: true });
    }
  });

  async function seedUpload(name: string, content: Buffer) {
    const file = {
      originalname: name,
      mimetype: name.endsWith('.png') ? 'image/png' : 'application/octet-stream',
      size: content.length,
      buffer: content
    } as Express.Multer.File;
    return fileUploadService.processUpload(testAppId, [file]);
  }

  it('should resolve file when target matches originalName exactly', async () => {
    const imageData = Buffer.from('FAKE_PNG_DATA');
    await seedUpload('logo.png', imageData);

    const resolved = await (tool as any).resolveSourceFile(
      testAppId,
      'public/assets/logo.png',
      testProjectDir
    );

    expect(resolved).toBe(true);
    const targetPath = join(testProjectDir, 'public/assets/logo.png');
    expect(existsSync(targetPath)).toBe(true);
    await expect(readFile(targetPath)).resolves.toEqual(imageData);
  });

  it('should NOT resolve when filename differs (no heuristic matching)', async () => {
    await seedUpload('hero-image.jpg', Buffer.from('JPEG'));

    const resolved = await (tool as any).resolveSourceFile(
      testAppId,
      'public/assets/banner.jpg',
      testProjectDir
    );

    expect(resolved).toBe(false);
  });

  it('should return false when no uploads exist', async () => {
    const resolved = await (tool as any).resolveSourceFile(
      testAppId,
      'public/assets/logo.png',
      testProjectDir
    );

    expect(resolved).toBe(false);
  });

  it('should overwrite existing file when exact match found', async () => {
    const targetPath = join(testProjectDir, 'public/assets/logo.png');
    await mkdir(join(testProjectDir, 'public/assets'), { recursive: true });
    await writeFile(targetPath, 'OLD_DATA');

    const newData = Buffer.from('NEW_PNG_DATA');
    await seedUpload('logo.png', newData);

    const resolved = await (tool as any).resolveSourceFile(
      testAppId,
      'public/assets/logo.png',
      testProjectDir
    );

    expect(resolved).toBe(true);
    await expect(readFile(targetPath)).resolves.toEqual(newData);
  });
});
