import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GoKnowbClientImpl,
  SearchType,
  RerankingStrategy,
} from '@godaddy/goknowb-client';

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@airo/ai-lib');
  return {
    ...actual,
    getS2SToken: vi.fn().mockResolvedValue('mock-s2s-token'),
    isS2SAuthEnabled: vi.fn().mockReturnValue(false),
  };
});

import * as aiLib from '@airo/ai-lib';
import {
  KnowBDriver,
  dedupByKbNodeId,
  type KnowBResultItem,
} from '../knowb-driver.js';

describe('dedupByKbNodeId', () => {
  it('returns empty array when input is empty', () => {
    expect(dedupByKbNodeId([])).toEqual([]);
  });

  it('keeps single result unchanged', () => {
    const input: KnowBResultItem[] = [
      { kbNodeId: '/airo_info/deployment', text: 'a', score: 0.5 },
    ];
    expect(dedupByKbNodeId(input)).toEqual(input);
  });

  it('removes duplicate kbNodeIds, keeping first occurrence (highest score)', () => {
    const input: KnowBResultItem[] = [
      { kbNodeId: '/airo_info/deployment', text: 'chunk-a', score: 0.57 },
      { kbNodeId: '/airo_info/deployment', text: 'chunk-b', score: 0.37 },
      { kbNodeId: '/airo_info/media_manager', text: 'media-a', score: 0.06 },
    ];

    const result = dedupByKbNodeId(input);

    expect(result).toEqual([
      { kbNodeId: '/airo_info/deployment', text: 'chunk-a', score: 0.57 },
      { kbNodeId: '/airo_info/media_manager', text: 'media-a', score: 0.06 },
    ]);
  });

  it('outputs results in score-descending order after dedup', () => {
    const input: KnowBResultItem[] = [
      { kbNodeId: '/doc-b', text: 'b1', score: 0.9 },
      { kbNodeId: '/doc-a', text: 'a1', score: 0.8 },
      { kbNodeId: '/doc-b', text: 'b2', score: 0.7 },
      { kbNodeId: '/doc-a', text: 'a2', score: 0.6 },
    ];

    const result = dedupByKbNodeId(input);

    expect(result.map((r) => r.kbNodeId)).toEqual(['/doc-b', '/doc-a']);
  });

  it('keeps highest-scoring chunk even when it appears after a lower-scoring duplicate', () => {
    // Guarantee the sort-inside-helper contract: caller does not need to
    // pre-sort. If the internal sort is removed, first-occurrence would
    // retain 'low' instead of 'high'.
    const input: KnowBResultItem[] = [
      { kbNodeId: '/doc-a', text: 'low', score: 0.2 },
      { kbNodeId: '/doc-a', text: 'high', score: 0.9 },
      { kbNodeId: '/doc-b', text: 'mid', score: 0.5 },
    ];

    const result = dedupByKbNodeId(input);

    expect(result).toHaveLength(2);
    expect(result[0]!.kbNodeId).toBe('/doc-a');
    expect(result[0]!.text).toBe('high');
    expect(result[0]!.score).toBe(0.9);
    expect(result[1]!.kbNodeId).toBe('/doc-b');
  });
});

describe('KnowBDriver.search', () => {
  beforeEach(() => {
    process.env.SSO_JWT = 'fake-jwt';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SSO_JWT;
  });

  it('sends LEXICAL_AND_SEMANTIC + COHERE rerank + over-fetch + scoreThreshold 0.0', async () => {
    const searchSpy = vi
      .spyOn(GoKnowbClientImpl.prototype, 'search')
      .mockResolvedValue({
        results: [
          {
            location: { kbNodeId: '/airo_info/deployment' },
            content: { text: 'a', type: 'TEXT' },
            score: 0.5,
          },
        ],
      });

    const driver = new KnowBDriver();
    await driver.search({ query: 'publish my changes' });

    expect(searchSpy).toHaveBeenCalledTimes(1);
    const req = searchSpy.mock.calls[0]![0];
    expect(req.searchType).toBe(SearchType.LEXICAL_AND_SEMANTIC);
    expect(req.rerankingConfig?.type).toBe(RerankingStrategy.COHERE);
    expect(req.rerankingConfig?.results).toBe(15);
    expect(req.filter.maxNumberOfResult).toBe(15);
    expect(req.filter.scoreThreshold).toBe(0.0);
    expect(req.filter.kbNodeIds).toEqual(['/airo_info']);
  });

  it('deduplicates results and trims to top 2 (default)', async () => {
    vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockResolvedValue({
      results: [
        { location: { kbNodeId: '/airo_info/deployment' }, content: { text: 'chunk-a', type: 'TEXT' }, score: 0.57 },
        { location: { kbNodeId: '/airo_info/deployment' }, content: { text: 'chunk-b', type: 'TEXT' }, score: 0.37 },
        { location: { kbNodeId: '/airo_info/media_manager' }, content: { text: 'm', type: 'TEXT' }, score: 0.06 },
        { location: { kbNodeId: '/airo_info/llm_models' }, content: { text: 'l', type: 'TEXT' }, score: 0.04 },
        { location: { kbNodeId: '/airo_info/email' }, content: { text: 'e', type: 'TEXT' }, score: 0.03 },
      ],
    });

    const driver = new KnowBDriver();
    const result = await driver.search({ query: 'publish my changes' });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results![0]!.kbNodeId).toBe('/airo_info/deployment');
    expect(result.results![0]!.text).toBe('chunk-a');
    expect(result.results![1]!.kbNodeId).toBe('/airo_info/media_manager');
  });

  it('respects caller-supplied maxResults override', async () => {
    vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockResolvedValue({
      results: [
        { location: { kbNodeId: '/airo_info/a' }, content: { text: 'a', type: 'TEXT' }, score: 0.9 },
        { location: { kbNodeId: '/airo_info/b' }, content: { text: 'b', type: 'TEXT' }, score: 0.5 },
        { location: { kbNodeId: '/airo_info/c' }, content: { text: 'c', type: 'TEXT' }, score: 0.2 },
      ],
    });

    const driver = new KnowBDriver();
    const result = await driver.search({ query: 'x', maxResults: 3 });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(3);
  });

  it('returns success:false with error message when client rejects', async () => {
    vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockRejectedValue(
      new Error('network timeout'),
    );

    const driver = new KnowBDriver();
    const result = await driver.search({ query: 'anything' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('network timeout');
    expect(result.results).toBeUndefined();
  });

  it('treats null response.results as empty (no throw)', async () => {
    vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockResolvedValue({
      // simulate unexpected API shape
      results: null as unknown as never,
    });

    const driver = new KnowBDriver();
    const result = await driver.search({ query: 'anything' });

    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.totalResults).toBe(0);
  });

  it('returns success:false when no auth configured (SSO_JWT + S2S both absent)', async () => {
    delete process.env.SSO_JWT;
    delete process.env.GOCODE_USE_S2S_AUTH;
    const searchSpy = vi.spyOn(GoKnowbClientImpl.prototype, 'search');

    const driver = new KnowBDriver();
    const result = await driver.search({ query: 'publish my changes' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No authentication configured');
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('returns success:false on empty / whitespace-only query', async () => {
    const searchSpy = vi.spyOn(GoKnowbClientImpl.prototype, 'search');
    const driver = new KnowBDriver();

    const empty = await driver.search({ query: '' });
    const whitespace = await driver.search({ query: '   \n\t  ' });

    expect(empty.success).toBe(false);
    expect(empty.error).toContain('valid search query');
    expect(whitespace.success).toBe(false);
    expect(whitespace.error).toContain('valid search query');
    expect(searchSpy).not.toHaveBeenCalled();
  });
});

describe('KnowBDriver.ensureInitialized (S2S path)', () => {
  beforeEach(() => {
    // simulate hosted S2S mode
    (aiLib.isS2SAuthEnabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    delete process.env.SSO_JWT;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    (aiLib.isS2SAuthEnabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('surfaces S2S token-fetch failures as success:false + caches failure for subsequent calls', async () => {
    const getS2S = aiLib.getS2SToken as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    getS2S.mockRejectedValue(new Error('s2s endpoint 503'));
    const clientSearch = vi
      .spyOn(GoKnowbClientImpl.prototype, 'search')
      .mockResolvedValue({ results: [] });

    const driver = new KnowBDriver();

    const first = await driver.search({ query: 'q1' });
    const second = await driver.search({ query: 'q2' });

    expect(first.success).toBe(false);
    expect(first.error).toContain('s2s endpoint 503');
    expect(second.success).toBe(false);
    // Second call re-throws the cached failure without hitting S2S again.
    expect(getS2S).toHaveBeenCalledTimes(1);
    expect(clientSearch).not.toHaveBeenCalled();
  });
});

describe('KnowBDriver.formatResultsAsMarkdown', () => {
  beforeEach(() => {
    process.env.SSO_JWT = 'fake-jwt';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SSO_JWT;
  });

  it('returns empty string for empty input', () => {
    const driver = new KnowBDriver();
    expect(driver.formatResultsAsMarkdown([])).toBe('');
  });

  it('formats a single result with heading, score (3 decimals), and text', () => {
    const driver = new KnowBDriver();
    const md = driver.formatResultsAsMarkdown([
      { kbNodeId: '/airo_info/deployment', text: 'deploy body', score: 0.571837 },
    ]);
    expect(md).toContain('## Document 1: /airo_info/deployment');
    expect(md).toContain('**Relevance Score:** 0.572');
    expect(md).toContain('deploy body');
  });

  it('joins multiple results with --- separator and sequential numbering', () => {
    const driver = new KnowBDriver();
    const md = driver.formatResultsAsMarkdown([
      { kbNodeId: '/airo_info/a', text: 'A', score: 0.9 },
      { kbNodeId: '/airo_info/b', text: 'B', score: 0.5 },
      { kbNodeId: '/airo_info/c', text: 'C', score: 0.1 },
    ]);
    expect(md).toContain('## Document 1: /airo_info/a');
    expect(md).toContain('## Document 2: /airo_info/b');
    expect(md).toContain('## Document 3: /airo_info/c');
    expect(md.match(/\n---\n/g)).toHaveLength(2);
  });
});
