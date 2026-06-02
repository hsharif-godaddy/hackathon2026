import archiver from 'archiver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock loki-client before importing log-streams so streamLokiLogs picks
// up mocked query/transform helpers.
vi.mock('@/lib/loki-client', () => ({
  buildLokiQuery: vi.fn(),
  queryLoki: vi.fn(),
  transformLokiResponse: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { streamConfiguredLogSources, streamLokiLogs } from '@/app/api/support-bundle/log-streams';
import { logger } from '@/lib/logger';
import { buildLokiQuery, queryLoki, transformLokiResponse } from '@/lib/loki-client';
import type { LogSourceConfig } from '@/lib/log-sources';

const mockedBuildLokiQuery = buildLokiQuery as unknown as ReturnType<typeof vi.fn>;
const mockedQueryLoki = queryLoki as unknown as ReturnType<typeof vi.fn>;
const mockedTransformLokiResponse = transformLokiResponse as unknown as ReturnType<typeof vi.fn>;
const mockedLoggerError = logger.error as unknown as ReturnType<typeof vi.fn>;

function makeSource(): LogSourceConfig {
  return {
    id: 'airo-agents',
    name: 'Airo Agents',
    description: 'test',
    backendType: 'loki',
    lokiEndpoint: 'https://loki.test',
    lokiApiKey: 'key',
    lokiLabels: { job: 'airo-agents', env: 'dev' },
    environment: 'dev',
    fieldMapping: {
      appIdField: 'app_id',
      appIdQueryType: 'term',
      timestampField: '@timestamp',
      levelField: 'level',
      levelKeywordField: 'level',
      messageField: 'message',
      messageKeywordField: 'message',
      eventField: 'event',
      eventKeywordField: 'event',
      serviceField: 'service',
      serviceKeywordField: 'service',
      displayFields: [
        { key: 'timestamp', label: 'Timestamp', path: '@timestamp' },
        { key: 'level', label: 'Level', path: 'level' },
        { key: 'message', label: 'Message', path: 'message' },
      ],
    },
  };
}

/**
 * Build an archiver, drive streamLokiLogs against it, and return the bytes
 * written to the log entry along with the result object.
 */
async function runStreamAndCollect(
  source: LogSourceConfig,
): Promise<{ result: { error?: string }; entry: string }> {
  const archive = archiver('tar', { gzip: true });
  const chunks: Buffer[] = [];
  // Capture each `append` call's content so we can inspect the JSON envelope
  // without having to unpack a real tar.gz in the test.
  const originalAppend = archive.append.bind(archive);
  let capturedBody = '';
  archive.append = ((data: string | Buffer | NodeJS.ReadableStream, opts: archiver.EntryData) => {
    if (typeof data === 'string') capturedBody = data;
    else if (Buffer.isBuffer(data)) capturedBody = data.toString('utf8');
    return originalAppend(data as string, opts);
  }) as typeof archive.append;
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));

  const result = await streamLokiLogs(
    source,
    'app-1',
    '2026-04-22T00:00:00Z',
    '2026-04-22T01:00:00Z',
    archive,
  );

  // Close the archive to avoid dangling handles.
  archive.finalize().catch(() => { /* ignore */ });

  return { result, entry: capturedBody };
}

describe('streamLokiLogs', () => {
  beforeEach(() => {
    mockedBuildLokiQuery.mockReset();
    mockedQueryLoki.mockReset();
    mockedTransformLokiResponse.mockReset();
    mockedLoggerError.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a { hits: { hits: [{ _id, _source }] } } envelope on success', async () => {
    mockedBuildLokiQuery.mockResolvedValue({
      query: '{job="airo-agents"}',
      start: '0',
      end: '1',
      limit: 5000,
      direction: 'backward',
    });
    mockedQueryLoki.mockResolvedValue({ status: 'success', data: { resultType: 'streams', result: [] } });
    mockedTransformLokiResponse.mockReturnValue([
      {
        id: 'entry-1',
        timestamp: '2026-04-22T00:10:00Z',
        level: 'info',
        message: 'hello',
        event: 'agent.run.finish',
        raw: { '@timestamp': '2026-04-22T00:10:00Z', event: 'agent.run.finish', message: 'hello' },
      },
      {
        id: 'entry-2',
        timestamp: '2026-04-22T00:11:00Z',
        level: 'error',
        message: 'bad',
        raw: { '@timestamp': '2026-04-22T00:11:00Z', message: 'bad' },
      },
    ]);

    const { result, entry } = await runStreamAndCollect(makeSource());

    expect(result).toEqual({});
    const parsed = JSON.parse(entry);
    expect(parsed).toHaveProperty('hits.hits');
    expect(Array.isArray(parsed.hits.hits)).toBe(true);
    expect(parsed.hits.hits).toHaveLength(2);
    expect(parsed.hits.hits[0]).toMatchObject({
      _id: 'entry-1',
      _source: { '@timestamp': '2026-04-22T00:10:00Z', event: 'agent.run.finish', message: 'hello' },
    });
    expect(parsed.hits.hits[1]._id).toBe('entry-2');
  });

  it('marks the envelope as truncated when the response hits the page limit', async () => {
    mockedBuildLokiQuery.mockResolvedValue({
      query: '{job="airo-agents"}',
      start: '0',
      end: '1',
      limit: 5000,
      direction: 'backward',
    });
    mockedQueryLoki.mockResolvedValue({ status: 'success', data: { resultType: 'streams', result: [] } });
    // Simulate Loki's 5000-entry cap being hit so consumers know the file is partial.
    const logs = Array.from({ length: 5000 }, (_, i) => ({
      id: `entry-${i}`,
      timestamp: 't',
      level: 'info',
      message: 'm',
      raw: { i },
    }));
    mockedTransformLokiResponse.mockReturnValue(logs);

    const { entry } = await runStreamAndCollect(makeSource());
    const parsed = JSON.parse(entry);

    expect(parsed.truncated).toBe(true);
    expect(parsed.hits.hits).toHaveLength(5000);
  });

  it('omits truncated when the response is below the page limit', async () => {
    mockedBuildLokiQuery.mockResolvedValue({
      query: '{job="airo-agents"}',
      start: '0',
      end: '1',
      limit: 5000,
      direction: 'backward',
    });
    mockedQueryLoki.mockResolvedValue({ status: 'success', data: { resultType: 'streams', result: [] } });
    mockedTransformLokiResponse.mockReturnValue([
      { id: 'entry-1', timestamp: 't', level: 'info', message: 'm', raw: {} },
    ]);

    const { entry } = await runStreamAndCollect(makeSource());
    const parsed = JSON.parse(entry);

    expect(parsed.truncated).toBeUndefined();
  });

  it('falls back to a synthesized _id when the log entry has no id', async () => {
    mockedBuildLokiQuery.mockResolvedValue({
      query: '{job="airo-agents"}',
      start: '0',
      end: '1',
      limit: 5000,
      direction: 'backward',
    });
    mockedQueryLoki.mockResolvedValue({ status: 'success', data: { resultType: 'streams', result: [] } });
    mockedTransformLokiResponse.mockReturnValue([
      { id: '', timestamp: 't', level: 'info', message: 'm', raw: {} },
    ]);

    const { entry } = await runStreamAndCollect(makeSource());
    const parsed = JSON.parse(entry);

    expect(parsed.hits.hits[0]._id).toBe('airo-agents-0');
  });

  it('writes an empty hits envelope and returns an error when Loki throws', async () => {
    mockedBuildLokiQuery.mockResolvedValue({
      query: '{job="airo-agents"}',
      start: '0',
      end: '1',
      limit: 5000,
      direction: 'backward',
    });
    mockedQueryLoki.mockRejectedValue(new Error('network down'));

    const { result, entry } = await runStreamAndCollect(makeSource());

    expect(result.error).toBe('network down');
    // Error is embedded in the archive entry so the bundle is self-documenting
    // (operators don't need to cross-reference metadata.json to see what failed).
    expect(JSON.parse(entry)).toEqual({ hits: { hits: [] }, error: 'network down' });
    // Failure is surfaced server-side too via the structured logger so Loki
    // can index by sourceId.
    expect(mockedLoggerError).toHaveBeenCalledWith(
      'supportBundle.loki.streamFailed',
      { sourceId: 'airo-agents' },
      { error: expect.any(Error) },
    );
  });

  it('reports unknown error for non-Error throws', async () => {
    mockedBuildLokiQuery.mockRejectedValue('string-thrown');

    const { result, entry } = await runStreamAndCollect(makeSource());

    expect(result.error).toBe('Unknown Loki fetch error');
    expect(JSON.parse(entry)).toEqual({ hits: { hits: [] }, error: 'Unknown Loki fetch error' });
  });

  it('still returns the Loki error when the fallback archive entry cannot be appended', async () => {
    mockedBuildLokiQuery.mockRejectedValue(new Error('network down'));
    const append = vi.fn(function () {
      throw new Error('append failed');
    });

    const result = await streamLokiLogs(
      makeSource(),
      'app-1',
      '2026-04-22T00:00:00Z',
      '2026-04-22T01:00:00Z',
      { append } as unknown as archiver.Archiver,
    );

    expect(result.error).toBe('network down');
    expect(append).toHaveBeenCalled();
    expect(mockedLoggerError).toHaveBeenCalledWith(
      'supportBundle.archive.appendFailed',
      { name: 'logs/airo-agents.json' },
      { error: expect.any(Error) },
    );
  });
});

describe('streamConfiguredLogSources', () => {
  // Capture every archive.append call so we can prove that Loki-enabled sources
  // are normalized into the bundle while ES sources continue to stream normally.
  function instrumentArchive(): {
    archive: archiver.Archiver;
    appended: Array<{ name: string; body: string }>;
  } {
    const archive = archiver('tar', { gzip: true });
    const appended: Array<{ name: string; body: string }> = [];
    const originalAppend = archive.append.bind(archive);
    archive.append = ((data: string | Buffer | NodeJS.ReadableStream, opts: archiver.EntryData) => {
      const body = typeof data === 'string'
        ? data
        : Buffer.isBuffer(data) ? data.toString('utf8') : '<stream>';
      appended.push({ name: String(opts.name ?? ''), body });
      return originalAppend(data as string, opts);
    }) as typeof archive.append;
    archive.on('data', () => { /* drain */ });
    return { archive, appended };
  }

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LOKI_ENDPOINT = 'https://loki.test';
    process.env.LOKI_API_KEY = 'loki-key';
    process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.test';
    process.env.AIRO_BUILDER_ES_API_KEY = 'airo-key';
    process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.test';
    process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';
    mockedLoggerError.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('streams configured Loki sources while preserving ES sources', async () => {
    mockedBuildLokiQuery.mockResolvedValue({
      query: '{job="airo-agents"}',
      start: '0',
      end: '1',
      limit: 5000,
      direction: 'backward',
    });
    mockedQueryLoki.mockResolvedValue({ status: 'success', data: { resultType: 'streams', result: [] } });
    mockedTransformLokiResponse.mockReturnValue([
      {
        id: 'loki-entry',
        timestamp: '2026-04-22T00:10:00Z',
        level: 'info',
        message: 'hello',
        raw: { '@timestamp': '2026-04-22T00:10:00Z', message: 'hello' },
      },
    ]);
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async function () { return new Response('{"hits":{"hits":[]}}', { status: 200 }) as unknown as Response; },
    );

    const { archive, appended } = instrumentArchive();

    const sourceMeta = await streamConfiguredLogSources(
      archive,
      'app-1',
      '2026-04-22T00:00:00Z',
      '2026-04-22T01:00:00Z',
    );
    archive.finalize().catch(() => { /* ignore */ });

    const lokiEntry = appended.find((a) => a.name === 'logs/airo-agents.json');
    expect(lokiEntry).toBeDefined();
    expect(JSON.parse(lokiEntry?.body ?? '{}')).toMatchObject({
      hits: { hits: [{ _id: 'loki-entry' }] },
    });
    expect(sourceMeta['airo-agents']).toMatchObject({ name: 'Agent App' });
    // airo-agents/preview/publish are Loki-only (no fetch); airo-app +
    // control_plane are ES (one fetch each). Assert on sourceMeta key set
    // rather than a hardcoded count so adding/removing a default source
    // doesn't spuriously break this test.
    const lokiKeys = ['airo-agents', 'airo-preview', 'airo-publish'];
    const esKeys = Object.keys(sourceMeta).filter((k) => !lokiKeys.includes(k));
    expect(fetchSpy).toHaveBeenCalledTimes(esKeys.length);
    expect(sourceMeta['airo-preview']).toMatchObject({ name: 'Preview App' });
    expect(sourceMeta['airo-publish']).toMatchObject({ name: 'Publish App' });
    expect(sourceMeta['airo-app']).toMatchObject({ name: 'UI Client App' });
    expect(sourceMeta['control_plane']).toMatchObject({ name: 'Control Plane' });
  });

  it('records an error for a misconfigured Loki source but still emits ES entries', async () => {
    delete process.env.LOKI_ENDPOINT;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async function () { return new Response('{"hits":{"hits":[]}}', { status: 200 }) as unknown as Response; },
    );
    vi.spyOn(console, 'warn').mockImplementation(function () { /* silence */ });

    const { archive, appended } = instrumentArchive();

    const sourceMeta = await streamConfiguredLogSources(
      archive,
      'app-1',
      '2026-04-22T00:00:00Z',
      '2026-04-22T01:00:00Z',
    );
    archive.finalize().catch(() => { /* ignore */ });

    const lokiEntry = appended.find((a) => a.name === 'logs/airo-agents.json');
    expect(lokiEntry).toBeDefined();
    expect(lokiEntry?.body).toBe('{"hits":{"hits":[]}}');
    // requireLokiEndpoint throws with a fail-fast message when LOKI_ENDPOINT
    // is missing — matches what production operators will see in the bundle
    // metadata when they ship a deploy without Loki configured.
    expect(sourceMeta['airo-agents']).toMatchObject({
      error: expect.stringContaining('LOKI_ENDPOINT is required'),
    });
    const lokiKeys = ['airo-agents', 'airo-preview', 'airo-publish'];
    const esKeys = Object.keys(sourceMeta).filter((k) => !lokiKeys.includes(k));
    expect(fetchSpy).toHaveBeenCalledTimes(esKeys.length);
    expect(sourceMeta['airo-app']).toMatchObject({ name: 'UI Client App' });
    expect(sourceMeta['control_plane']).toMatchObject({ name: 'Control Plane' });
  });

  it('keeps metadata when fallback archive appends fail', async () => {
    delete process.env.LOKI_ENDPOINT;
    vi.spyOn(global, 'fetch').mockImplementation(async function () { return new Response('{"hits":{"hits":[]}}', { status: 200 }) as unknown as Response; },
    );
    vi.spyOn(console, 'warn').mockImplementation(function () { /* silence */ });
    mockedLoggerError.mockReset();
    const append = vi.fn(function () {
      throw new Error('append failed');
    });

    const sourceMeta = await streamConfiguredLogSources(
      { append } as unknown as archiver.Archiver,
      'app-1',
      '2026-04-22T00:00:00Z',
      '2026-04-22T01:00:00Z',
    );

    expect(sourceMeta['airo-agents']).toMatchObject({
      error: expect.stringContaining('LOKI_ENDPOINT is required'),
    });
    expect(sourceMeta['airo-preview']).toMatchObject({
      error: expect.stringContaining('LOKI_ENDPOINT is required'),
    });
    expect(mockedLoggerError).toHaveBeenCalledWith(
      'supportBundle.archive.appendFailed',
      { name: expect.any(String) },
      { error: expect.any(Error) },
    );
  });
});
