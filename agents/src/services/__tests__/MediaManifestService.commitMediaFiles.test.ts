import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () {
    return { findById: vi.fn().mockReturnValue({ id: 'test-app', path: '/tmp/test-app' }) };
  }),
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: { createForApp: vi.fn().mockReturnValue(null) },
}));

const { gitCommitFilesIfChanged } = vi.hoisted(() => ({
  gitCommitFilesIfChanged: vi.fn(),
}));

vi.mock('../../utils/git.js', () => ({ GitUtils: vi.fn() }));

vi.mock('../../logging/index.js', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: stub, Logger: { create: vi.fn(() => stub) } };
});

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: () => ({ tasks: {} }),
}));

vi.mock('../../tools/ast-image-editor.js', () => ({
  astImageEditor: { replaceImage: vi.fn().mockResolvedValue({ success: true }) },
}));

vi.mock('../GettyUploadService.js', () => ({
  gettyUploadService: { uploadAndReport: vi.fn().mockResolvedValue([]), reportUsage: vi.fn() },
}));

import { GitUtils } from '../../utils/git.js';
import { MediaManifestService } from '../MediaManifestService.js';

describe('MediaManifestService.commitMediaFiles (in-place edit/crop commit)', () => {
  let service: MediaManifestService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MediaManifestService();
    gitCommitFilesIfChanged.mockResolvedValue(true);
    vi.mocked(GitUtils).mockImplementation(function (this: Record<string, unknown>) {
      this.commitFilesIfChanged = gitCommitFilesIfChanged;
    } as unknown as () => GitUtils);
  });

  it('commits ONLY the given media paths via a scoped commit, and returns true', async () => {
    const committed = await service.commitMediaFiles('test-app', [
      'public/assets/media/hero-abcd1234.png',
      'public/assets/media/about-ef567890.png',
    ]);

    expect(committed).toBe(true);
    expect(gitCommitFilesIfChanged).toHaveBeenCalledTimes(1);
    const [repoPath, message, files] = gitCommitFilesIfChanged.mock.calls[0]!;
    expect(repoPath).toBe('/tmp/test-app');
    expect(message).toBe('Update edited media files');
    // Scoped pathspec: exactly the media files, and crucially NOT the manifest —
    // a scoped `git commit -- <paths>` can't sweep in unrelated staged state.
    expect(files).toEqual([
      'public/assets/media/hero-abcd1234.png',
      'public/assets/media/about-ef567890.png',
    ]);
    expect(files).not.toContain('airo-media.json');
  });

  it('de-dupes repeated paths and drops empties before committing', async () => {
    await service.commitMediaFiles('test-app', [
      'public/assets/media/x.png',
      'public/assets/media/x.png',
      '',
    ]);
    expect(gitCommitFilesIfChanged.mock.calls[0]![2]).toEqual(['public/assets/media/x.png']);
  });

  it('does not touch git and returns false for an empty path list', async () => {
    const committed = await service.commitMediaFiles('test-app', []);
    expect(committed).toBe(false);
    expect(gitCommitFilesIfChanged).not.toHaveBeenCalled();
  });

  it('returns false when the scoped commit was a no-op (bytes unchanged)', async () => {
    gitCommitFilesIfChanged.mockResolvedValue(false);
    const committed = await service.commitMediaFiles('test-app', ['public/assets/media/x.png']);
    expect(committed).toBe(false);
  });

  it('returns false (best-effort) when the scoped commit throws', async () => {
    gitCommitFilesIfChanged.mockRejectedValue(new Error('git boom'));
    const committed = await service.commitMediaFiles('test-app', ['public/assets/media/x.png']);
    expect(committed).toBe(false);
  });
});
