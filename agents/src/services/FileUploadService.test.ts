import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { FileUploadService } from './FileUploadService.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('FileUploadService - File Type Validation', () => {
  let service: FileUploadService;

  beforeEach(() => {
    service = new FileUploadService('/tmp/test-uploads');
  });

  it('should reject executable files', () => {
    const file = {
      originalname: 'malware.exe',
      mimetype: 'application/x-msdownload',
      size: 1024,
      buffer: Buffer.from('test')
    } as Express.Multer.File;

    expect(() => service.validateFile(file)).toThrow('not allowed for security reasons');
  });

  it('should reject archive files', () => {
    const file = {
      originalname: 'archive.zip',
      mimetype: 'application/zip',
      size: 1024,
      buffer: Buffer.from('test')
    } as Express.Multer.File;

    expect(() => service.validateFile(file)).toThrow('not allowed for security reasons');
  });

  it('should accept image files', () => {
    const file = {
      originalname: 'photo.png',
      mimetype: 'image/png',
      size: 1024,
      buffer: Buffer.from('test')
    } as Express.Multer.File;

    expect(() => service.validateFile(file)).not.toThrow();
  });

  it('should accept JSON files', () => {
    const file = {
      originalname: 'data.json',
      mimetype: 'application/json',
      size: 1024,
      buffer: Buffer.from('test')
    } as Express.Multer.File;

    expect(() => service.validateFile(file)).not.toThrow();
  });

  it('should accept font files', () => {
    const file = {
      originalname: 'font.woff2',
      mimetype: 'font/woff2',
      size: 1024,
      buffer: Buffer.from('test')
    } as Express.Multer.File;

    expect(() => service.validateFile(file)).not.toThrow();
  });
});

describe('FileUploadService - Per-File Error Handling', () => {
  const batchTestDir = '/tmp/test-uploads-batch';

  afterEach(async () => {
    if (existsSync(batchTestDir)) {
      await rm(batchTestDir, { recursive: true, force: true });
    }
  });

  it('should process valid files and skip failures in the same batch', async () => {
    const service = new FileUploadService(batchTestDir);

    const validJpeg = {
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake-jpeg')
    } as Express.Multer.File;

    const validPng = {
      originalname: 'image.png',
      mimetype: 'image/png',
      size: 512,
      buffer: Buffer.from('fake-png')
    } as Express.Multer.File;

    const result = await service.processUpload('test-app-batch', [validJpeg, validPng]);

    expect(result.files).toHaveLength(2);
    expect(result.files.some(f => f.originalName === 'photo.jpg')).toBe(true);
    expect(result.files.some(f => f.originalName === 'image.png')).toBe(true);
  });

  it('should accept valid SVG files through sanitization', async () => {
    const service = new FileUploadService(batchTestDir);

    const validSvg = {
      originalname: 'icon.svg',
      mimetype: 'image/svg+xml',
      size: 100,
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>')
    } as Express.Multer.File;

    const result = await service.processUpload('test-app-batch', [validSvg]);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].originalName).toBe('icon.svg');
  });

  it('should process JPEG alongside SVG in mixed batch', async () => {
    const service = new FileUploadService(batchTestDir);

    const validJpeg = {
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake-jpeg')
    } as Express.Multer.File;

    const validSvg = {
      originalname: 'icon.svg',
      mimetype: 'image/svg+xml',
      size: 100,
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')
    } as Express.Multer.File;

    const result = await service.processUpload('test-app-batch', [validJpeg, validSvg]);

    expect(result.files).toHaveLength(2);
    expect(result.files.some(f => f.originalName === 'photo.jpg')).toBe(true);
    expect(result.files.some(f => f.originalName === 'icon.svg')).toBe(true);
  });
});

describe('FileUploadService - List Files', () => {
  const listTestDir = '/tmp/test-uploads-list';

  afterEach(async () => {
    if (existsSync(listTestDir)) {
      await rm(listTestDir, { recursive: true, force: true });
    }
  });

  it('should list all uploaded files across upload sessions', async () => {
    const service = new FileUploadService(listTestDir);

    // Upload files in two separate sessions
    const files1 = [
      {
        originalname: 'file1.png',
        mimetype: 'image/png',
        size: 1024,
        buffer: Buffer.from('test1')
      } as Express.Multer.File
    ];

    const files2 = [
      {
        originalname: 'file2.json',
        mimetype: 'application/json',
        size: 512,
        buffer: Buffer.from('test2')
      } as Express.Multer.File
    ];

    const result1 = await service.processUpload('test-app', files1);
    const result2 = await service.processUpload('test-app', files2);

    const allFiles = await service.listUploadedFiles('test-app');

    expect(allFiles).toHaveLength(2);
    expect(allFiles.map(f => f.originalName)).toContain('file1.png');
    expect(allFiles.map(f => f.originalName)).toContain('file2.json');
  });

  it('should return empty array for app with no uploads', async () => {
    const service = new FileUploadService(listTestDir);

    const files = await service.listUploadedFiles('nonexistent-app');

    expect(files).toEqual([]);
  });
});
