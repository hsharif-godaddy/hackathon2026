import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  Logger: {
    create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

vi.mock('../../../services/vite-dedupe.js', () => ({
  ensureViteResolveDedupe: vi.fn(),
}));

const { readFile, readdir } = await import('node:fs/promises');
const { ensureViteResolveDedupe } = await import('../../../services/vite-dedupe.js');
const { listSectionsTool, hooks } = await import('../tools/index.js');

describe('listSectionsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('returns sections table of contents when appId is present', async () => {
      vi.mocked(readdir).mockResolvedValue([
        '01-discovery-questions.md',
        '02-configuration-examples.md',
      ] as never);
      vi.mocked(readFile)
        .mockResolvedValueOnce('## § Discovery Questions\nSome content.' as never)
        .mockResolvedValueOnce('## § Configuration Examples\nMore content.' as never);

      const result = await listSectionsTool.execute(
        {},
        { metadata: { appId: 'testapp123' } },
      );

      expect(result).toEqual({
        sections: [
          { slug: '01-discovery-questions', title: 'Discovery Questions' },
          { slug: '02-configuration-examples', title: 'Configuration Examples' },
        ],
      });
    });

    it('returns sections when appId is absent', async () => {
      vi.mocked(readdir).mockResolvedValue(['01-discovery-questions.md'] as never);
      vi.mocked(readFile).mockResolvedValue('## § Discovery Questions\n...' as never);

      const result = await listSectionsTool.execute({}, {});

      expect(result).toEqual({
        sections: [{ slug: '01-discovery-questions', title: 'Discovery Questions' }],
      });
    });

    it('returns empty title when file has no heading', async () => {
      vi.mocked(readdir).mockResolvedValue(['01-discovery-questions.md'] as never);
      vi.mocked(readFile).mockResolvedValue('no heading here' as never);

      const result = await listSectionsTool.execute({}, {});

      expect(result).toEqual({
        sections: [{ slug: '01-discovery-questions', title: '' }],
      });
    });

    it('propagates readdir errors', async () => {
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT: directory not found'));

      await expect(listSectionsTool.execute({}, {})).rejects.toThrow(
        'ENOENT: directory not found',
      );
    });
  });
});

describe('hooks.onInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls ensureViteResolveDedupe with appPath when present', async () => {
    vi.mocked(ensureViteResolveDedupe).mockImplementation(() => {});
    await hooks.onInstall!({ skillName: 'online-appointments', appPath: '/app/path' });
    expect(ensureViteResolveDedupe).toHaveBeenCalledWith('/app/path');
  });

  it('rethrows when ensureViteResolveDedupe throws', async () => {
    const error = new Error('dedupe failed');
    vi.mocked(ensureViteResolveDedupe).mockImplementation(() => {
      throw error;
    });
    await expect(
      hooks.onInstall!({ skillName: 'online-appointments', appPath: '/app/path' }),
    ).rejects.toThrow('dedupe failed');
  });

  it('skips ensureViteResolveDedupe when appPath is absent', async () => {
    await hooks.onInstall!({ skillName: 'online-appointments' });
    expect(ensureViteResolveDedupe).not.toHaveBeenCalled();
  });
});
