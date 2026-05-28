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
    getS2STokenV2: vi.fn().mockResolvedValue('mock-s2s-token'),
    refreshS2STokenV2: vi.fn().mockResolvedValue('mock-s2s-token'),
    isS2SAuthV2Enabled: vi.fn().mockReturnValue(false),
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
    delete process.env.USE_S2S_AUTH;
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
    (aiLib.isS2SAuthV2Enabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    delete process.env.SSO_JWT;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    (aiLib.isS2SAuthV2Enabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('surfaces S2S token-fetch failures as success:false + caches failure for subsequent calls', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
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

/**
 * Build a minimal JWT with a given exp (unix seconds) — signature is garbage,
 * only the `exp` claim matters to our decoder.
 */
function makeJwtWithExp(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
}

/**
 * GoDaddy SSO tokens (typ=jomax|idp|cert) often ship with iat + vat but no
 * `exp`. ai-lib's s2s-auth.ts treats these as `iat + 30min`; we mirror that.
 */
function makeJwtWithIatNoExp(iatSeconds: number, extra: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: iatSeconds, ...extra })).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('KnowBDriver.search — S2S token refresh', () => {
  beforeEach(() => {
    (aiLib.isS2SAuthV2Enabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    delete process.env.SSO_JWT;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    (aiLib.isS2SAuthV2Enabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('proactively refetches the S2S token when cached JWT is within 5min of exp', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    const nearExpiry = Math.floor(Date.now() / 1000) + 60;
    const healthy = Math.floor(Date.now() / 1000) + 3600;
    getS2S
      .mockResolvedValueOnce(makeJwtWithExp(nearExpiry))
      .mockResolvedValueOnce(makeJwtWithExp(healthy));

    vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockResolvedValue({ results: [] });

    const driver = new KnowBDriver();
    await driver.search({ query: 'q1' }); // fetches near-expiry token
    await driver.search({ query: 'q2' }); // buffer trips -> refetch
    await driver.search({ query: 'q3' }); // healthy token cached -> no refetch

    expect(getS2S).toHaveBeenCalledTimes(2);
  });

  it('caches a healthy token and does not refetch across calls', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    const healthy = Math.floor(Date.now() / 1000) + 3600;
    getS2S.mockResolvedValue(makeJwtWithExp(healthy));

    vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockResolvedValue({ results: [] });

    const driver = new KnowBDriver();
    await driver.search({ query: 'q1' });
    await driver.search({ query: 'q2' });
    await driver.search({ query: 'q3' });

    expect(getS2S).toHaveBeenCalledTimes(1);
  });

  it('on 401 from GoKnowb: invalidates cache, refetches token, retries once — via refreshS2STokenV2 to bypass upstream cache', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    const refreshS2S = aiLib.refreshS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    refreshS2S.mockReset();
    const healthy = Math.floor(Date.now() / 1000) + 3600;
    getS2S.mockResolvedValue(makeJwtWithExp(healthy));
    refreshS2S.mockResolvedValue(makeJwtWithExp(healthy));

    const clientSearch = vi
      .spyOn(GoKnowbClientImpl.prototype, 'search')
      .mockRejectedValueOnce(new Error('Error performing KB search: Request failed with status code 401'))
      .mockResolvedValueOnce({ results: [] });

    const driver = new KnowBDriver();
    const result = await driver.search({ query: 'q' });

    expect(result.success).toBe(true);
    expect(clientSearch).toHaveBeenCalledTimes(2);
    expect(getS2S).toHaveBeenCalledTimes(1);
    expect(refreshS2S).toHaveBeenCalledTimes(1);
  });

  it('on 401 retry also failing: returns success:false with the 2nd error', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    const healthy = Math.floor(Date.now() / 1000) + 3600;
    getS2S.mockResolvedValue(makeJwtWithExp(healthy));

    vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockRejectedValue(
      new Error('Error performing KB search: Request failed with status code 401'),
    );

    const driver = new KnowBDriver();
    const result = await driver.search({ query: 'q' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
  });

  it('non-401 errors do not trigger a retry', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    const healthy = Math.floor(Date.now() / 1000) + 3600;
    getS2S.mockResolvedValue(makeJwtWithExp(healthy));

    const clientSearch = vi
      .spyOn(GoKnowbClientImpl.prototype, 'search')
      .mockRejectedValue(new Error('network timeout'));

    const driver = new KnowBDriver();
    const result = await driver.search({ query: 'q' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('network timeout');
    expect(clientSearch).toHaveBeenCalledTimes(1);
    expect(getS2S).toHaveBeenCalledTimes(1);
  });
});

describe('KnowBDriver — self-heal after transient S2S outage', () => {
  beforeEach(() => {
    (aiLib.isS2SAuthV2Enabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    delete process.env.SSO_JWT;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    (aiLib.isS2SAuthV2Enabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('does NOT wedge after a transient proactive-refresh failure when a token is still cached', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    const nearExpiry = Math.floor(Date.now() / 1000) + 60;
    const healthy = Math.floor(Date.now() / 1000) + 3600;
    getS2S
      .mockResolvedValueOnce(makeJwtWithExp(nearExpiry))
      .mockRejectedValueOnce(new Error('s2s endpoint 502'))
      .mockResolvedValueOnce(makeJwtWithExp(healthy));

    vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockResolvedValue({ results: [] });

    const driver = new KnowBDriver();
    const r1 = await driver.search({ query: 'q1' }); // good
    const r2 = await driver.search({ query: 'q2' }); // proactive refresh fails (still has old token usable)
    const r3 = await driver.search({ query: 'q3' }); // retries proactive refresh — succeeds

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(false);
    expect(r3.success).toBe(true);
    expect(getS2S).toHaveBeenCalledTimes(3);
  });

  it('DOES fast-fail subsequent calls when there is no cached token (true initial-fetch failure)', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    getS2S.mockRejectedValue(new Error('s2s endpoint 503'));

    const clientSearch = vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockResolvedValue({ results: [] });

    const driver = new KnowBDriver();
    const r1 = await driver.search({ query: 'q1' });
    const r2 = await driver.search({ query: 'q2' });

    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
    expect(getS2S).toHaveBeenCalledTimes(1);
    expect(clientSearch).not.toHaveBeenCalled();
  });
});

describe('BaseDriverV2 token refresh — boundary behavior (via KnowBDriver)', () => {
  beforeEach(() => {
    (aiLib.isS2SAuthV2Enabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    delete process.env.SSO_JWT;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    (aiLib.isS2SAuthV2Enabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('refreshes when cached exp is EXACTLY now + TOKEN_REFRESH_BUFFER_SECONDS (>= boundary)', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    const atBoundary = Math.floor(Date.now() / 1000) + 300;
    const healthy = Math.floor(Date.now() / 1000) + 3600;
    getS2S
      .mockResolvedValueOnce(makeJwtWithExp(atBoundary))
      .mockResolvedValueOnce(makeJwtWithExp(healthy));
    vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockResolvedValue({ results: [] });

    const driver = new KnowBDriver();
    await driver.search({ query: 'q1' });
    await driver.search({ query: 'q2' });

    expect(getS2S).toHaveBeenCalledTimes(2);
  });

  it('falls back to iat + 30min when JWT has no exp claim (GoDaddy SSO tokens)', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    const nowSec = Math.floor(Date.now() / 1000);
    const tokenAtBoundary = makeJwtWithIatNoExp(nowSec - 1500);
    const healthy = makeJwtWithIatNoExp(nowSec);
    getS2S.mockResolvedValueOnce(tokenAtBoundary).mockResolvedValueOnce(healthy);
    vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockResolvedValue({ results: [] });

    const driver = new KnowBDriver();
    await driver.search({ query: 'q1' }); // fetches at-boundary token
    await driver.search({ query: 'q2' }); // refresh triggered (no exp → iat+1800 fallback)
    await driver.search({ query: 'q3' }); // healthy (iat=now → exp=now+1800) → no refresh

    expect(getS2S).toHaveBeenCalledTimes(2);
  });

  it('does NOT refresh when cached exp is now + TOKEN_REFRESH_BUFFER_SECONDS + 1 (outside buffer)', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    const justOutside = Math.floor(Date.now() / 1000) + 301;
    getS2S.mockResolvedValue(makeJwtWithExp(justOutside));
    vi.spyOn(GoKnowbClientImpl.prototype, 'search').mockResolvedValue({ results: [] });

    const driver = new KnowBDriver();
    await driver.search({ query: 'q1' });
    await driver.search({ query: 'q2' });

    expect(getS2S).toHaveBeenCalledTimes(1);
  });
});

describe('KnowBDriver — 401 retry applies to write ops', () => {
  beforeEach(() => {
    (aiLib.isS2SAuthV2Enabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    delete process.env.SSO_JWT;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    (aiLib.isS2SAuthV2Enabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('upload retries once on 401 and succeeds', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    const refreshS2S = aiLib.refreshS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    refreshS2S.mockReset();
    const healthy = Math.floor(Date.now() / 1000) + 3600;
    getS2S.mockResolvedValue(makeJwtWithExp(healthy));
    refreshS2S.mockResolvedValue(makeJwtWithExp(healthy));

    const createSpy = vi
      .spyOn(GoKnowbClientImpl.prototype, 'createKbNode')
      .mockRejectedValueOnce(new Error('Request failed with status code 401'))
      .mockResolvedValueOnce({ kbNodeIds: ['/airo_info/doc.md'] });

    const driver = new KnowBDriver();
    const result = await driver.upload({
      kbNodeId: '/airo_info',
      resourceId: 'doc',
      content: 'body',
    });

    expect(result.success).toBe(true);
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(refreshS2S).toHaveBeenCalledTimes(1);
  });

  it('delete retries once on 401 and succeeds', async () => {
    const getS2S = aiLib.getS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    const refreshS2S = aiLib.refreshS2STokenV2 as unknown as ReturnType<typeof vi.fn>;
    getS2S.mockReset();
    refreshS2S.mockReset();
    const healthy = Math.floor(Date.now() / 1000) + 3600;
    getS2S.mockResolvedValue(makeJwtWithExp(healthy));
    refreshS2S.mockResolvedValue(makeJwtWithExp(healthy));

    const deleteSpy = vi
      .spyOn(GoKnowbClientImpl.prototype, 'deleteKbNode')
      .mockRejectedValueOnce(new Error('Request failed with status code 401'))
      .mockResolvedValueOnce(undefined as unknown as never);

    const driver = new KnowBDriver();
    const result = await driver.delete({ kbNodeId: '/airo_info', resourceId: 'doc' });

    expect(result.success).toBe(true);
    expect(deleteSpy).toHaveBeenCalledTimes(2);
    expect(refreshS2S).toHaveBeenCalledTimes(1);
  });
});
