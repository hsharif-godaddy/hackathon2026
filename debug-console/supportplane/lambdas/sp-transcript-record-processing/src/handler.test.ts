import { beforeEach, describe, expect, it, vi } from 'vitest';

// Shared provider stubs, hoisted so the vi.mock factories can close over them.
const { beaconConfigured, beaconEnrich, gocodeConfigured, gocodeEnrich } = vi.hoisted(() => ({
  beaconConfigured: vi.fn<() => boolean>(),
  beaconEnrich: vi.fn(),
  gocodeConfigured: vi.fn<() => boolean>(),
  gocodeEnrich: vi.fn(),
}));

vi.mock('./dynamo.js', () => ({
  getTranscriptById: vi.fn(),
  writeBackEnrichment: vi.fn(),
}));
vi.mock('./beacon-provider.js', () => ({
  BeaconAskProvider: class {
    public readonly name = 'beacon';
    isConfigured(): boolean {
      return beaconConfigured();
    }
    enrich(record: unknown): unknown {
      return beaconEnrich(record);
    }
  },
}));
vi.mock('./gocode-provider.js', () => ({
  GoCodeProvider: class {
    public readonly name = 'gocode';
    isConfigured(): boolean {
      return gocodeConfigured();
    }
    enrich(record: unknown): unknown {
      return gocodeEnrich(record);
    }
  },
}));

import { handler } from './handler.js';
import { getTranscriptById, writeBackEnrichment } from './dynamo.js';

const ENRICH_SOURCE_VERSION: string = 'v2-resolution-ready';

type SqsEventArg = Parameters<typeof handler>[0];

function sqsEvent(bodies: Array<{ body: string; messageId: string }>): SqsEventArg {
  return {
    Records: bodies.map(({ body, messageId }) => ({ body, messageId })),
  } as SqsEventArg;
}

function job(interaction_id: string): SqsEventArg {
  return sqsEvent([{ messageId: 'm1', body: JSON.stringify({ interaction_id }) }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  beaconConfigured.mockReturnValue(false);
  gocodeConfigured.mockReturnValue(false);
  vi.mocked(getTranscriptById).mockResolvedValue({
    interaction_id: 'abc123',
    created_at: '2026-06-01T00:00:00.000Z',
    full_transcript: 'customer could not publish',
  });
  vi.mocked(writeBackEnrichment).mockResolvedValue(undefined);
});

describe('sp-transcript-record-processing handler', () => {
  it('drops (does not fail) a job missing interaction_id', async () => {
    const result = await handler(
      sqsEvent([{ messageId: 'm2', body: JSON.stringify({ upload_id: 'u1' }) }])
    );
    expect(result).toEqual({ batchItemFailures: [] });
    expect(getTranscriptById).not.toHaveBeenCalled();
  });

  it('no-ops when the row is not found', async () => {
    vi.mocked(getTranscriptById).mockResolvedValue(null);
    await handler(job('gone'));
    expect(writeBackEnrichment).not.toHaveBeenCalled();
  });

  it('skips a row already enriched at the current source version (idempotency)', async () => {
    vi.mocked(getTranscriptById).mockResolvedValue({
      interaction_id: 'abc123',
      created_at: '2026-06-01T00:00:00.000Z',
      enriched_at: '2026-06-02T00:00:00.000Z',
      enrich_source_version: ENRICH_SOURCE_VERSION,
    });
    await handler(job('abc123'));
    expect(writeBackEnrichment).not.toHaveBeenCalled();
  });

  it('uses GoCode first (primary) and does not call the Beacon fallback', async () => {
    beaconConfigured.mockReturnValue(true);
    gocodeConfigured.mockReturnValue(true);
    gocodeEnrich.mockResolvedValue({ provider: 'gocode', conversation_summary: 'gocode summary' });

    await handler(job('abc123'));

    expect(beaconEnrich).not.toHaveBeenCalled();
    expect(writeBackEnrichment).toHaveBeenCalledWith(
      'abc123',
      '2026-06-01T00:00:00.000Z',
      expect.objectContaining({
        enrichment_provider: 'gocode',
        enrich_status: 'ok',
        enrich_source_version: ENRICH_SOURCE_VERSION,
      })
    );
  });

  it('falls back to Beacon when GoCode throws but Beacon succeeds', async () => {
    beaconConfigured.mockReturnValue(true);
    gocodeConfigured.mockReturnValue(true);
    gocodeEnrich.mockRejectedValue(new Error('GoCode API error 503: unavailable'));
    beaconEnrich.mockResolvedValue({ provider: 'beacon', tags: ['publish_failure'] });

    const result = await handler(job('abc123'));

    expect(result).toEqual({ batchItemFailures: [] });
    expect(beaconEnrich).toHaveBeenCalled();
    expect(writeBackEnrichment).toHaveBeenCalledWith(
      'abc123',
      '2026-06-01T00:00:00.000Z',
      expect.objectContaining({
        enrichment_provider: 'beacon',
        enrich_status: 'ok',
      })
    );
  });

  it('uses GoCode when Beacon is not configured (captures airo_failure + NPS proxy)', async () => {
    gocodeConfigured.mockReturnValue(true);
    gocodeEnrich.mockResolvedValue({
      provider: 'gocode',
      tags: ['publish_failure'],
      airo_failure: 'publish failed silently',
      customer_sentiment: 'negative',
    });

    await handler(job('abc123'));

    expect(beaconEnrich).not.toHaveBeenCalled();
    expect(writeBackEnrichment).toHaveBeenCalledWith(
      'abc123',
      '2026-06-01T00:00:00.000Z',
      expect.objectContaining({
        enrichment_provider: 'gocode',
        enrich_status: 'ok',
        tags: ['publish_failure'],
        airo_failure: 'publish failed silently',
        nps: 3,
        nps_source: 'proxy',
      })
    );
  });

  it('preserves a CSV-native summary rather than overwriting with the provider summary', async () => {
    vi.mocked(getTranscriptById).mockResolvedValue({
      interaction_id: 'abc123',
      created_at: '2026-06-01T00:00:00.000Z',
      full_transcript: 'angry customer',
      conversation_summary: 'existing CSV summary',
    });
    gocodeConfigured.mockReturnValue(true);
    gocodeEnrich.mockResolvedValue({
      provider: 'gocode',
      conversation_summary: 'llm summary that must NOT override the CSV one',
    });

    await handler(job('abc123'));

    expect(writeBackEnrichment).toHaveBeenCalledWith(
      'abc123',
      '2026-06-01T00:00:00.000Z',
      expect.objectContaining({ conversation_summary: 'existing CSV summary' })
    );
  });

  it('marks enrich_status=error (no DLQ churn) when no provider is configured', async () => {
    const result = await handler(job('abc123'));
    expect(result).toEqual({ batchItemFailures: [] });
    expect(writeBackEnrichment).toHaveBeenCalledWith(
      'abc123',
      '2026-06-01T00:00:00.000Z',
      expect.objectContaining({ enrichment_provider: 'none', enrich_status: 'error' })
    );
  });

  it('redrives when every configured provider throws', async () => {
    beaconConfigured.mockReturnValue(true);
    gocodeConfigured.mockReturnValue(true);
    beaconEnrich.mockRejectedValue(new Error('Beacon /api/ask error 503'));
    gocodeEnrich.mockRejectedValue(new Error('GoCode API error 429'));

    const result = await handler(job('abc123'));

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'm1' }] });
    expect(writeBackEnrichment).not.toHaveBeenCalled();
  });

  it('redrives when the only configured provider throws', async () => {
    gocodeConfigured.mockReturnValue(true);
    gocodeEnrich.mockRejectedValue(new Error('GoCode API error 429'));

    const result = await handler(job('abc123'));

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'm1' }] });
    expect(writeBackEnrichment).not.toHaveBeenCalled();
  });

  it('reports a batch failure when the body is unparseable', async () => {
    await expect(handler(sqsEvent([{ messageId: 'm3', body: 'not json' }]))).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: 'm3' }],
    });
  });

  it('isolates failures per record within a batch', async () => {
    gocodeConfigured.mockReturnValue(true);
    gocodeEnrich.mockResolvedValue({ provider: 'gocode', tags: ['x'] });
    const result = await handler(
      sqsEvent([
        { messageId: 'ok', body: JSON.stringify({ interaction_id: 'abc123' }) },
        { messageId: 'bad', body: '{' },
      ])
    );
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'bad' }] });
  });
});
