import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindById, mockFiles, mockResolveSourceFile, mockListUploadedFiles } = vi.hoisted(() => ({
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
  mockResolveSourceFile: vi.fn(),
  mockListUploadedFiles: vi.fn(),
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

vi.mock('../../services/FileUploadService.js', () => ({
  fileUploadService: {
    listUploadedFiles: mockListUploadedFiles,
  },
}));

vi.mock('../file-edit-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../file-edit-utils.js')>();
  return {
    ...actual,
    resolveSourceFile: mockResolveSourceFile,
  };
});

vi.mock('../text-editor-workspace.js', () => ({
  handleCreate: vi.fn().mockResolvedValue('Successfully created file'),
  handleInsert: vi.fn(),
  handleStrReplace: vi.fn(),
  handleView: vi.fn(),
}));

import { handleCreate } from '../text-editor-workspace.js';
import { textEditorSchemaAITool } from '../ai-lib-tools/text-editor.js';

describe('text-editor create guard', function textEditorCreateGuardTests() {
  let appPath: string;
  const appId = 'test-create-guard-app';

  beforeEach(function setup() {
    vi.clearAllMocks();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    appPath = join(tmpdir(), `text-editor-create-guard-${unique}`);
    mkdirSync(appPath, { recursive: true });
    mockFindById.mockReturnValue({ id: appId, path: appPath });
    mockListUploadedFiles.mockResolvedValue([]);
    mockResolveSourceFile.mockResolvedValue({ skip: true, reason: 'no-match' });
    mockFiles.view.mockResolvedValue({
      content: '',
      encoding: 'utf-8',
      lines: 0,
      size: 0,
      truncated: false,
      path: '',
    });
  });

  afterEach(function teardown() {
    if (appPath && existsSync(appPath)) {
      rmSync(appPath, { recursive: true, force: true });
    }
  });

  it('returns no-match guidance instead of creating an empty raster image', async function noMatchGuidance() {
    const result = await textEditorSchemaAITool.execute(
      {
        command: 'create',
        path: 'public/assets/community.jpg',
        file_text: '',
      },
      { experimental_context: { metadata: { appId } } },
    );

    expect(result).toContain('No upload available to fill community.jpg');
    expect(result).toContain('import_upload');
    expect(handleCreate).not.toHaveBeenCalled();
  });

  it('throws for empty binary create when auto-resolve is not image-eligible', async function binaryThrow() {
    mockResolveSourceFile.mockResolvedValue(null);

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
  });

  it('lists available upload filenames in the binary guard error', async function listsUploads() {
    mockResolveSourceFile.mockResolvedValue(null);
    mockListUploadedFiles.mockResolvedValue([
      { filename: 'app_123_photo.jpg', originalName: 'photo.jpg' },
    ]);

    await expect(
      textEditorSchemaAITool.execute(
        {
          command: 'create',
          path: 'public/assets/brochure.pdf',
          file_text: '',
        },
        { experimental_context: { metadata: { appId } } },
      ),
    ).rejects.toThrow(/app_123_photo\.jpg/);
  });

  it('returns copy-error guidance without creating a file', async function copyErrorGuidance() {
    mockResolveSourceFile.mockResolvedValue({ skip: true, reason: 'copy-error' });

    const result = await textEditorSchemaAITool.execute(
      {
        command: 'create',
        path: 'public/assets/logo.png',
        file_text: '',
      },
      { experimental_context: { metadata: { appId } } },
    );

    expect(result).toContain('temporary error');
    expect(result).toContain('Please try again');
    expect(handleCreate).not.toHaveBeenCalled();
  });

  it('preserves an existing file when no upload matches', async function noUploadPreserveExisting() {
    mockResolveSourceFile.mockResolvedValue({ skip: true, reason: 'no-upload' });

    const result = await textEditorSchemaAITool.execute(
      {
        command: 'create',
        path: 'public/assets/logo.png',
        file_text: '',
      },
      { experimental_context: { metadata: { appId } } },
    );

    expect(result).toContain('Left logo.png unchanged');
    expect(result).toContain('already exists');
    expect(handleCreate).not.toHaveBeenCalled();
  });
});
