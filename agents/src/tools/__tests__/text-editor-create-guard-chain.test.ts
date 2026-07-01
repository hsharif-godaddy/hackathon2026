import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindById, mockFiles } = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockFiles: {
    view: vi.fn(),
    tree: vi.fn(),
    search: vi.fn(),
    write: vi.fn(),
    edit: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(function () {
    return {
      findById: mockFindById,
    };
  }),
}));

vi.mock('../../database/connection.js', () => ({
  getDatabase: () => ({ transaction: (fn: () => unknown) => fn }),
}));

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(function () {
    return {
      workspaceId: 'test-app',
      variant: 'preview',
      files: mockFiles,
    };
  }),
}));

vi.mock('../text-editor-workspace.js', () => ({
  handleCreate: vi.fn().mockResolvedValue('Successfully created file'),
  handleInsert: vi.fn(),
  handleStrReplace: vi.fn(),
  handleView: vi.fn(),
}));

import { DevSupervisorError } from '../../services/DevSupervisorClient.js';
import { fileUploadService } from '../../services/FileUploadService.js';
import type { UploadedFile } from '../../services/FileUploadService.js';
import { handleCreate } from '../text-editor-workspace.js';
import { textEditorSchemaAITool } from '../ai-lib-tools/text-editor.js';

describe('text-editor create guard integration', function textEditorCreateGuardIntegrationTests() {
  let appPath: string;
  const appId = 'test-create-guard-integration';

  beforeEach(async function setup() {
    vi.clearAllMocks();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    appPath = join(tmpdir(), `text-editor-create-guard-int-${unique}`);
    mkdirSync(appPath, { recursive: true });
    mockFindById.mockReturnValue({ id: appId, path: appPath });
    mockFiles.view.mockRejectedValue(new DevSupervisorError('not_found', 404, 'not found'));

    const uploadsDir = fileUploadService.getAppUploadsDir(appId);
    if (existsSync(uploadsDir)) {
      await rm(uploadsDir, { recursive: true, force: true });
    }
    await mkdir(uploadsDir, { recursive: true });
  });

  afterEach(async function teardown() {
    if (appPath && existsSync(appPath)) {
      rmSync(appPath, { recursive: true, force: true });
    }
    const uploadsDir = fileUploadService.getAppUploadsDir(appId);
    if (existsSync(uploadsDir)) {
      await rm(uploadsDir, { recursive: true, force: true });
    }
  });

  it('does not write an empty logo when no uploads exist', async function logoNoUploads() {
    const result = await textEditorSchemaAITool.execute(
      {
        command: 'create',
        path: 'public/assets/logo.png',
        file_text: '',
      },
      { experimental_context: { metadata: { appId } } },
    );

    expect(result).toContain('No upload available to fill logo.png');
    expect(handleCreate).not.toHaveBeenCalled();
    expect(mockFiles.upload).not.toHaveBeenCalled();
    expect(mockFiles.write).not.toHaveBeenCalled();
  });

  it('copies bytes from upload store when a matching logo upload exists', async function logoWithUpload() {
    await fileUploadService.processUpload(appId, [{
      originalname: 'logo.png',
      mimetype: 'image/png',
      size: 8,
      buffer: Buffer.from('PNG_DATA'),
    }] as Express.Multer.File[]);

    const result = await textEditorSchemaAITool.execute(
      {
        command: 'create',
        path: 'public/assets/logo.png',
        file_text: '',
      },
      { experimental_context: { metadata: { appId } } },
    );

    expect(result).toContain('binary auto-resolved from uploads');
    expect(handleCreate).not.toHaveBeenCalled();
    expect(mockFiles.upload).toHaveBeenCalledWith({
      path: 'public/assets/logo.png',
      data: expect.any(Buffer),
    });
    expect((mockFiles.upload as ReturnType<typeof vi.fn>).mock.calls[0][0].data.toString()).toBe('PNG_DATA');
  });

  it('throws for empty pdf create when no uploads exist', async function pdfNoUploads() {
    await expect(
      textEditorSchemaAITool.execute(
        {
          command: 'create',
          path: 'public/assets/brochure.pdf',
          file_text: '',
        },
        { experimental_context: { metadata: { appId } } },
      ),
    ).rejects.toThrow(/no matching upload found/);

    expect(handleCreate).not.toHaveBeenCalled();
    expect(mockFiles.upload).not.toHaveBeenCalled();
    expect(mockFiles.write).not.toHaveBeenCalled();
  });

  it('lists at most five upload filenames in the pdf guard error', async function pdfListsUploadsTruncated() {
    for (let index = 0; index < 6; index += 1) {
      await fileUploadService.processUpload(appId, [{
        originalname: `doc-${index}.pdf`,
        mimetype: 'application/pdf',
        size: 4 + index,
        buffer: Buffer.from(`PDF-${index}`),
      }] as Express.Multer.File[]);
    }

    const uploads = await fileUploadService.listUploadedFiles(appId);
    expect(uploads.length).toBeGreaterThanOrEqual(6);

    const error: unknown = await textEditorSchemaAITool.execute(
      {
        command: 'create',
        path: 'public/assets/brochure.pdf',
        file_text: '',
      },
      { experimental_context: { metadata: { appId } } },
    ).catch((err: unknown) => err);

    const message: string = error instanceof Error ? error.message : String(error);
    expect(message).toMatch(/no matching upload found/);
    const listedInError: UploadedFile[] = uploads.filter((upload: UploadedFile) => message.includes(upload.filename));
    expect(listedInError.length).toBe(5);
    const omittedFromError: UploadedFile[] = uploads.filter((upload: UploadedFile) => !message.includes(upload.filename));
    expect(omittedFromError.length).toBeGreaterThanOrEqual(1);
  });
});
