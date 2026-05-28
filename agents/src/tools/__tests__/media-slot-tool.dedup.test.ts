import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MediaManifest, MediaSlot } from '../../services/MediaManifestService.js';

const { setSlotMock, getManifestMock, searchMediaMock } = vi.hoisted(() => ({
  setSlotMock: vi.fn(),
  getManifestMock: vi.fn(),
  searchMediaMock: vi.fn(),
}));

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@airo/ai-lib');
  return { ...actual, getS2SToken: vi.fn().mockResolvedValue('mock-s2s-token') };
});

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: class {
    findById(id: string) {
      return { id, path: '/tmp/test-app', previewUrl: 'http://localhost:5173', name: 'test-app' };
    }
  },
}));

vi.mock('../../services/MediaManifestService.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../services/MediaManifestService.js');
  return {
    ...actual,
    mediaManifestService: {
      setSlot: setSlotMock,
      getManifest: getManifestMock,
      getSlot: vi.fn().mockResolvedValue({ success: true, slot: null }),
    },
  };
});

vi.mock('../media-search-tool.js', () => ({
  MediaSearchTool: class {
    searchMedia = searchMediaMock;
  },
}));

import { MediaSlotTool } from '../media-slot-tool.js';
import { logger } from '../../logging/index.js';

const APP_ID = 'test-app-id';

function slotFor(currentUrl: string, gettyId?: string): MediaSlot {
  return {
    mediaType: 'image',
    currentUrl,
    searchQuery: 'prior',
    alternatives: [],
    userModified: false,
    createdAt: '2026-05-27T00:00:00Z',
    lastUpdated: '2026-05-27T00:00:00Z',
    ...(gettyId && { gettyId }),
  };
}

/** Mocks setSlot with the real lock+builder semantics so concurrency tests are honest. */
function installLockingSetSlotMock(initial: MediaManifest = {}): {
  manifest: MediaManifest;
  capturedSlots: Array<{ slotName: string; slot: MediaSlot }>;
} {
  const manifest: MediaManifest = { ...initial };
  const capturedSlots: Array<{ slotName: string; slot: MediaSlot }> = [];
  let chain: Promise<void> = Promise.resolve();

  setSlotMock.mockImplementation(
    async (
      _appId: string,
      slotName: string,
      slotOrBuilder: MediaSlot | ((m: MediaManifest) => MediaSlot)
    ) => {
      let builtSlot!: MediaSlot;
      const run = chain.then(async () => {
        const slot = typeof slotOrBuilder === 'function' ? slotOrBuilder(manifest) : slotOrBuilder;
        builtSlot = structuredClone(slot);
        manifest[slotName] = slot;
        capturedSlots.push({ slotName, slot });
      });
      chain = run;
      await run;
      return { success: true, slot: manifest[slotName], builtSlot };
    }
  );

  return { manifest, capturedSlots };
}

describe('MediaSlotTool.dedupAgainstManifest (pure function)', () => {
  it('returns urls unchanged with exhausted=false, noSignal=false when manifest is empty', () => {
    const result = MediaSlotTool.dedupAgainstManifest(
      {},
      'team/jane',
      ['https://cdn/1', 'https://cdn/2'],
      ['1', '2']
    );
    expect(result.urls).toEqual(['https://cdn/1', 'https://cdn/2']);
    expect(result.skippedCount).toBe(0);
    expect(result.exhausted).toBe(false);
    expect(result.noSignal).toBe(false);
  });

  it('promotes the first candidate whose gettyId is not in any other slot', () => {
    const manifest: MediaManifest = { 'team/jane': slotFor('https://cdn/cdn-rewritten-1', '1') };
    const result = MediaSlotTool.dedupAgainstManifest(
      manifest,
      'team/john',
      ['https://getty-preview/1', 'https://getty-preview/2', 'https://getty-preview/3'],
      ['1', '2', '3']
    );
    expect(result.gettyIds).toEqual(['2', '1', '3']);
    expect(result.skippedCount).toBe(1);
    expect(result.exhausted).toBe(false);
    expect(result.noSignal).toBe(false);
  });

  it('does not dedup against itself when updating an existing slot', () => {
    const manifest: MediaManifest = { 'pages/home/hero': slotFor('https://cdn/cdn-rewritten-1', '1') };
    const result = MediaSlotTool.dedupAgainstManifest(
      manifest,
      'pages/home/hero',
      ['https://getty-preview/1', 'https://getty-preview/2'],
      ['1', '2']
    );
    expect(result.gettyIds[0]).toBe('1');
    expect(result.skippedCount).toBe(0);
    expect(result.exhausted).toBe(false);
  });

  it('flags exhausted=true when every gettyId is already used', () => {
    const manifest: MediaManifest = {
      a: slotFor('https://cdn/cdn-1', '1'),
      b: slotFor('https://cdn/cdn-2', '2'),
    };
    const result = MediaSlotTool.dedupAgainstManifest(
      manifest,
      'team/john',
      ['https://getty-preview/1', 'https://getty-preview/2'],
      ['1', '2']
    );
    expect(result.gettyIds[0]).toBe('1');
    expect(result.skippedCount).toBe(0);
    expect(result.exhausted).toBe(true);
    expect(result.noSignal).toBe(false);
  });

  it('flags noSignal=true when top candidate has empty gettyId and manifest has identities', () => {
    const manifest: MediaManifest = { a: slotFor('https://cdn/cdn-1', '1') };
    const result = MediaSlotTool.dedupAgainstManifest(
      manifest,
      'logos/horizontal',
      ['https://uploads/logo-a.png', 'https://uploads/logo-b.png'],
      ['', '']
    );
    expect(result.skippedCount).toBe(0);
    expect(result.exhausted).toBe(false);
    expect(result.noSignal).toBe(true);
  });

  it('does not swap when top candidate has empty gettyId, even if a fresh alternative exists', () => {
    const manifest: MediaManifest = { a: slotFor('https://cdn/cdn-1', '1') };
    const result = MediaSlotTool.dedupAgainstManifest(
      manifest,
      'team/john',
      ['https://getty-preview/x', 'https://getty-preview/2'],
      ['', '2']
    );
    expect(result.gettyIds[0]).toBe('');
    expect(result.skippedCount).toBe(0);
    expect(result.exhausted).toBe(false);
    expect(result.noSignal).toBe(true);
  });

  it('does not flag noSignal when top candidate has a gettyId (verifiable)', () => {
    const manifest: MediaManifest = { a: slotFor('https://cdn/cdn-1', '1') };
    const result = MediaSlotTool.dedupAgainstManifest(
      manifest,
      'team/john',
      ['https://getty-preview/2', 'https://getty-preview/3'],
      ['2', '3']
    );
    expect(result.gettyIds[0]).toBe('2');
    expect(result.skippedCount).toBe(0);
    expect(result.exhausted).toBe(false);
    expect(result.noSignal).toBe(false);
  });

  it('reports exhausted=false (not true) when index 0 is already fresh', () => {
    const manifest: MediaManifest = { 'team/jane': slotFor('https://cdn/cdn-1', '1') };
    const result = MediaSlotTool.dedupAgainstManifest(
      manifest,
      'team/john',
      ['https://getty-preview/2', 'https://getty-preview/3'],
      ['2', '3']
    );
    expect(result.gettyIds[0]).toBe('2');
    expect(result.skippedCount).toBe(0);
    expect(result.exhausted).toBe(false);
  });
});

describe('MediaSlotTool.selectMedia integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getManifestMock.mockResolvedValue({ success: true, manifest: {} });
  });

  it('writes urls[0] when nothing else is in the manifest yet', async () => {
    const { capturedSlots } = installLockingSetSlotMock();
    searchMediaMock.mockResolvedValue({
      success: true,
      urls: ['https://cdn/1', 'https://cdn/2'],
      gettyIds: ['1', '2'],
    });

    const tool = new MediaSlotTool();
    const result = await tool.selectMedia({ slot: 'team/jane', query: 'q', appId: APP_ID });

    expect(result.success).toBe(true);
    expect(result.resolvedUrl).toBe('https://cdn/1');
    expect(capturedSlots).toHaveLength(1);
    expect(capturedSlots[0]!.slot.currentUrl).toBe('https://cdn/1');
  });

  it('avoids duplicating across two parallel selectMedia calls for the same app', async () => {
    const { manifest, capturedSlots } = installLockingSetSlotMock();
    searchMediaMock
      .mockResolvedValueOnce({
        success: true,
        urls: ['https://cdn/dup', 'https://cdn/origin-alt'],
        gettyIds: ['dup', 'origin-alt'],
      })
      .mockResolvedValueOnce({
        success: true,
        urls: ['https://cdn/dup', 'https://cdn/products-alt'],
        gettyIds: ['dup', 'products-alt'],
      });

    const tool = new MediaSlotTool();
    const [first, second] = await Promise.all([
      tool.selectMedia({ slot: 'pages/home/origin-story', query: 'q1', appId: APP_ID }),
      tool.selectMedia({ slot: 'products/ethiopia-yirgacheffe', query: 'q2', appId: APP_ID }),
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const urls = Object.values(manifest).map((s) => s.currentUrl);
    const gettyIds = Object.values(manifest).map((s) => s.gettyId);

    expect(new Set(urls).size).toBe(2);
    expect(new Set(gettyIds).size).toBe(2);
    expect(capturedSlots).toHaveLength(2);
  });

  it('falls back to urls[0] AND emits dedup_exhausted warn when every result is already used', async () => {
    installLockingSetSlotMock({
      a: slotFor('https://cdn/1', '1'),
      b: slotFor('https://cdn/2', '2'),
    });
    searchMediaMock.mockResolvedValue({
      success: true,
      urls: ['https://cdn/1', 'https://cdn/2'],
      gettyIds: ['1', '2'],
    });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const tool = new MediaSlotTool();
    const result = await tool.selectMedia({ slot: 'team/john', query: 'q', appId: APP_ID });

    expect(result.resolvedUrl).toBe('https://cdn/1');
    expect(warnSpy).toHaveBeenCalledWith(
      'media_slot.select.dedup_exhausted',
      expect.objectContaining({ candidateCount: 2, manifestSize: 2 })
    );
    warnSpy.mockRestore();
  });
});
