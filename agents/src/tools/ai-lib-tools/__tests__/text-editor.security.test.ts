import { existsSync, mkdirSync, rmSync } from 'node:fs';
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

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(() => ({
    findById: mockFindById,
  })),
}));

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(() => ({
    workspaceId: 'test-app',
    variant: 'preview',
    files: mockFiles,
  })),
}));

vi.mock('../../text-editor-workspace.js', () => ({
  handleCreate: vi.fn(),
  handleInsert: vi.fn(),
  handleStrReplace: vi.fn(),
  handleView: vi.fn(),
}));

import {
  handleCreate,
  handleInsert,
  handleStrReplace,
  handleView,
} from '../../text-editor-workspace.js';
import { isFileBlocked } from '../../read-file.js';
import { textEditorAITool, textEditorSchemaAITool } from '../text-editor.js';

const createExecutionOptions = (appId: string) => ({
  experimental_context: {
    metadata: { appId },
  },
});

describe('textEditorAITool — blocked path wiring', function textEditorSecurityTests() {
  let appPath: string;
  const appId = 'test-text-editor-security-app';

  beforeEach(function setup() {
    vi.clearAllMocks();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    appPath = join(tmpdir(), `text-editor-sec-${unique}`);
    mkdirSync(appPath, { recursive: true });
    mockFindById.mockReturnValue({ id: appId, path: appPath });
    mockFiles.view.mockResolvedValue({ content: '', encoding: 'utf-8', lines: 0, size: 0, truncated: false, path: '' });
  });

  afterEach(function teardown() {
    if (appPath && existsSync(appPath)) {
      rmSync(appPath, { recursive: true, force: true });
    }
  });

  it('rejects str_replace before handleStrReplace for blocked image paths', async function strReplaceBlocked() {
    await expect(
      textEditorAITool.execute(
        {
          command: 'str_replace',
          path: 'assets/logo.png',
          old_str: 'a',
          new_str: 'b',
        },
        createExecutionOptions(appId),
      ),
    ).rejects.toThrow(/File blocked:/);

    expect(handleStrReplace).not.toHaveBeenCalled();
  });

  it('rejects insert before handleInsert for blocked image paths', async function insertBlocked() {
    await expect(
      textEditorAITool.execute(
        {
          command: 'insert',
          path: 'photo.jpg',
          insert_line: 1,
          insert_text: 'x',
        },
        createExecutionOptions(appId),
      ),
    ).rejects.toThrow(/File blocked:/);

    expect(handleInsert).not.toHaveBeenCalled();
  });

  it('rejects view before handleView for blocked image paths', async function viewBlocked() {
    await expect(
      textEditorAITool.execute(
        {
          command: 'view',
          path: 'hero.webp',
        },
        createExecutionOptions(appId),
      ),
    ).rejects.toThrow(/File blocked:/);

    expect(handleView).not.toHaveBeenCalled();
  });

  it('invokes handleView through the schema tool with execution context', async function schemaViewAllowed() {
    vi.mocked(handleView).mockResolvedValue('viewed');

    await textEditorSchemaAITool.execute(
      {
        command: 'view',
        path: 'src/app.tsx',
        view_range: [1, -1],
      },
      createExecutionOptions(appId),
    );

    expect(handleView).toHaveBeenCalledTimes(1);
    expect(handleView).toHaveBeenCalledWith(
      mockFiles,
      'src/app.tsx',
      [1, -1],
    );
  });

  it('rejects invalid view_range before handleView', async function viewRangeInvalid() {
    await expect(
      textEditorSchemaAITool.execute(
        {
          command: 'view',
          path: 'src/app.tsx',
          view_range: [0, 1],
        },
        createExecutionOptions(appId),
      ),
    ).rejects.toThrow(/view_range must be/);

    expect(handleView).not.toHaveBeenCalled();
  });

  it('rejects view_range with end < start before handleView', async function viewRangeInverted() {
    await expect(
      textEditorSchemaAITool.execute(
        {
          command: 'view',
          path: 'src/app.tsx',
          view_range: [100, 5],
        },
        createExecutionOptions(appId),
      ),
    ).rejects.toThrow(/end_line must be >= start_line/);

    expect(handleView).not.toHaveBeenCalled();
  });

  it('throws App ID is required when schema tool runs without execution context', async function schemaMissingContext() {
    await expect(
      textEditorSchemaAITool.execute(
        {
          command: 'view',
          path: 'src/app.tsx',
        },
        {} as never,
      ),
    ).rejects.toThrow(/App ID is required/);

    expect(handleView).not.toHaveBeenCalled();
  });

  it('allows create for image paths that are blocked for view/str_replace/insert', async function createNotBlocked() {
    expect(isFileBlocked('public/assets/hero.webp').blocked).toBe(true);

    vi.mocked(handleCreate).mockResolvedValue('created');

    await textEditorAITool.execute(
      {
        command: 'create',
        path: 'public/assets/hero.webp',
        file_text: 'minimal placeholder',
      },
      createExecutionOptions(appId),
    );

    expect(handleCreate).toHaveBeenCalledTimes(1);
    expect(handleCreate).toHaveBeenCalledWith(
      mockFiles,
      'public/assets/hero.webp',
      'minimal placeholder',
    );
  });

  it('invokes handleStrReplace for non-blocked paths after guardrails', async function strReplaceAllowed() {
    vi.mocked(handleStrReplace).mockResolvedValue('ok');

    await textEditorAITool.execute(
      {
        command: 'str_replace',
        path: 'src/app.tsx',
        old_str: 'foo',
        new_str: 'bar',
      },
      createExecutionOptions(appId),
    );

    expect(handleStrReplace).toHaveBeenCalledTimes(1);
    expect(handleStrReplace).toHaveBeenCalledWith(
      mockFiles,
      'src/app.tsx',
      'foo',
      'bar',
    );
  });
});

describe('isProtectedWorkspacePath', () => {
  it('detects .airo dir itself', async () => {
    const { isProtectedWorkspacePath } = await import('../../file-edit-utils.js');
    expect(isProtectedWorkspacePath('/app/.airo', '/app')).toBe(true);
  });

  it('detects file inside .airo', async () => {
    const { isProtectedWorkspacePath } = await import('../../file-edit-utils.js');
    expect(isProtectedWorkspacePath('/app/.airo/video.json', '/app')).toBe(true);
  });

  it('detects nested path inside .airo', async () => {
    const { isProtectedWorkspacePath } = await import('../../file-edit-utils.js');
    expect(isProtectedWorkspacePath('/app/.airo/qa-runs/qa-run-1.json', '/app')).toBe(true);
  });

  it('allows adjacent path with similar prefix', async () => {
    const { isProtectedWorkspacePath } = await import('../../file-edit-utils.js');
    expect(isProtectedWorkspacePath('/app/.airo-backup', '/app')).toBe(false);
  });

  it('allows normal source files', async () => {
    const { isProtectedWorkspacePath } = await import('../../file-edit-utils.js');
    expect(isProtectedWorkspacePath('/app/src/index.ts', '/app')).toBe(false);
  });
});

