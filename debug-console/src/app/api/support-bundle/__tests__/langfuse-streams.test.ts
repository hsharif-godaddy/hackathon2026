import archiver from 'archiver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { findAnchorTimestamp, streamTraces } from '@/app/api/support-bundle/langfuse-streams';

const lf = { baseUrl: 'https://lf.test', authHeader: 'Basic test' };

describe('findAnchorTimestamp', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the first trace timestamp on a JSON 200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ timestamp: '2026-04-22T00:00:00Z' }] }),
        { status: 200 },
      ) as unknown as Response,
    );

    const result = await findAnchorTimestamp(lf, 'app-1');

    expect(result).toEqual({ timestamp: '2026-04-22T00:00:00Z' });
  });

  it('records a warning instead of throwing when the proxy returns a non-JSON 200', async () => {
    // Simulates an upstream proxy that returns an HTML error page with a 200
    // status. Without the guard, res.json() throws SyntaxError up to
    // buildArchive's catch and aborts the entire bundle.
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('<html>error</html>', { status: 200 }) as unknown as Response,
    );

    const result = await findAnchorTimestamp(lf, 'app-1');

    expect(result.timestamp).toBeNull();
    expect(result.warning).toMatch(/non-JSON 200/);
  });

  it('records a warning when no traces match', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }) as unknown as Response,
    );

    const result = await findAnchorTimestamp(lf, 'app-1');

    expect(result.timestamp).toBeNull();
    expect(result.warning).toMatch(/No Langfuse traces/);
  });

  it('records a warning when the upstream returns non-2xx', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('boom', { status: 502 }) as unknown as Response,
    );

    const result = await findAnchorTimestamp(lf, 'app-1');

    expect(result.timestamp).toBeNull();
    expect(result.warning).toMatch(/HTTP 502/);
  });
});

describe('streamTraces', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeArchive(): archiver.Archiver {
    const a = archiver('tar', { gzip: true });
    a.on('data', () => { /* drain */ });
    return a;
  }

  it('records a warning instead of aborting when a trace listing returns a non-JSON 200', async () => {
    // Same guard as findAnchorTimestamp; ensures a proxy HTML page surfaces
    // as a recorded warning rather than aborting the bundle.
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('<html>error</html>', { status: 200 }) as unknown as Response,
    );

    const archive = makeArchive();
    const result = await streamTraces(lf, 'app-1', '2026-04-22T00:00:00Z', '2026-04-22T01:00:00Z', archive);
    archive.finalize().catch(() => { /* ignore */ });

    expect(result.traceCount).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/non-JSON 200/);
  });

  it('appends each trace detail body and counts traces', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      // listing
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: 't1' }, { id: 't2' }], meta: { totalPages: 1 } }),
          { status: 200 },
        ) as unknown as Response,
      )
      // detail t1
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 't1' }), { status: 200 }) as unknown as Response,
      )
      // detail t2
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 't2' }), { status: 200 }) as unknown as Response,
      );

    const archive = makeArchive();
    const result = await streamTraces(lf, 'app-1', '2026-04-22T00:00:00Z', '2026-04-22T01:00:00Z', archive);
    archive.finalize().catch(() => { /* ignore */ });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.traceCount).toBe(2);
    expect(result.warnings).toHaveLength(0);
  });

  it('records a warning when a trace listing returns non-2xx', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('boom', { status: 503 }) as unknown as Response,
    );

    const archive = makeArchive();
    const result = await streamTraces(lf, 'app-1', '2026-04-22T00:00:00Z', '2026-04-22T01:00:00Z', archive);
    archive.finalize().catch(() => { /* ignore */ });

    expect(result.traceCount).toBe(0);
    expect(result.warnings[0]).toMatch(/HTTP 503/);
  });
});
