// agents/src/services/__tests__/FileUploadService.test.ts
import { FileUploadService } from '../FileUploadService.js';
import { describe, it, expect, beforeEach } from 'vitest';

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

describe('FileUploadService - List Files', () => {
  it('should list all uploaded files across upload sessions', async () => {
    const service = new FileUploadService('/tmp/test-uploads');

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
    const service = new FileUploadService('/tmp/test-uploads');

    const files = await service.listUploadedFiles('nonexistent-app');

    expect(files).toEqual([]);
  });
});
