import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindById } = vi.hoisted(() => ({
  mockFindById: vi.fn(),
}));

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(() => ({
    findById: mockFindById,
  })),
}));

vi.mock('../../text-editor-handlers.js', () => ({
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
} from '../../text-editor-handlers.js';
import { isFileBlocked } from '../../read-file.js';
import { textEditorAITool } from '../text-editor.js';

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
      join(appPath, 'public/assets/hero.webp'),
      'minimal placeholder',
      expect.anything(),
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
      join(appPath, 'src/app.tsx'),
      'foo',
      'bar',
      expect.anything(),
    );
  });
});
