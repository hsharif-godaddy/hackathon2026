/**
 * POST /api/analytics/insights-feedback — insights carousel vote ingestion.
 *
 * Covers: Content-Length required / invalid / >200k (413), invalid JSON (400), invalid vote or
 * insightKind (400), ClickHouse skipped (200 + persisted false), deferred insert success,
 * deferred insert failure (logs error, still 200 + persisted false — must never become 5xx).
 */

import { Buffer } from 'node:buffer';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after(task: () => void | Promise<void>) {
      void Promise.resolve(task());
    },
  };
});

const FIXED_FEEDBACK_ID = '11111111-1111-4111-8111-111111111111';

const { mockGetConfig, mockInsert, mockLogger } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockInsert: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(function () { return FIXED_FEEDBACK_ID; }),
}));

vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/customer-auth')>('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn(function (handler: (req: NextRequest, ctx: unknown) => Promise<Response>) {
      return async function wrapped(request: NextRequest) {
        return handler(request, {
          isAuthenticated: true,
          jwt: 'test-jwt',
          user: { customerId: 'cust-test', shopperId: 'shop-test' },
        });
      };
    }),
  };
});

vi.mock('@/lib/clickhouse/insights-feedback-insert', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/clickhouse/insights-feedback-insert')>();
  return {
    ...actual,
    getClickHouseInsightsFeedbackConfig: mockGetConfig,
    insertInsightsFeedbackRow: mockInsert,
  };
});

import { POST } from '../route';

const URL = 'https://airo.test/api/analytics/insights-feedback';

function jsonPost(body: unknown, headers?: Record<string, string>): NextRequest {
  const serialized = JSON.stringify(body);
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  return new NextRequest(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'content-length': String(byteLength),
      ...headers,
    },
    body: serialized,
  });
}

const validBody = {
  vote: 'up' as const,
  appId: 'app-1',
  pageHostId: 'example.com',
  insightKind: 'insight' as const,
  insightTitle: 'Title',
  insightBody: 'Body',
  partitionSnapDate: '2025-04-08',
  insightRaw: { snapshot: true },
};

describe('insights-feedback route', function suite() {
  beforeEach(function reset() {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue(null);
    mockInsert.mockResolvedValue(undefined);
  });

  describe('#POST', function postTests() {
    it('returns 200 persisted false when ClickHouse is not configured', async function notConfigured() {
      mockGetConfig.mockReturnValue(null);

      const res = await POST(jsonPost(validBody));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ success: true, feedbackId: FIXED_FEEDBACK_ID, persisted: false });
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'analytics.insightsFeedback.clickhouse.skipped_not_configured',
        { feedbackId: FIXED_FEEDBACK_ID },
      );
    });

    it('returns 200 persisted false when insert throws', async function insertFailure() {
      const chConfig = {
        baseUrl: 'https://ch.test',
        user: 'u',
        password: 'p',
        database: 'db',
        table: 't',
      };
      mockGetConfig.mockReturnValue(chConfig);
      mockInsert.mockRejectedValue(new Error('insert failed'));

      const res = await POST(jsonPost(validBody));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ success: true, feedbackId: FIXED_FEEDBACK_ID, persisted: false });
      await vi.waitFor(() => {
        expect(mockInsert).toHaveBeenCalledTimes(1);
      });
      expect(mockInsert.mock.calls[0][1]).toEqual(chConfig);
      await vi.waitFor(() => {
        expect(mockLogger.error).toHaveBeenCalledWith(
          'analytics.insightsFeedback.clickhouse.insert_failed',
          expect.objectContaining({
            feedbackId: FIXED_FEEDBACK_ID,
            error: 'insert failed',
          }),
        );
      });
    });

    it('runs ClickHouse insert after responding with persisted false', async function insertOk() {
      const chConfig = {
        baseUrl: 'https://ch.test',
        user: 'u',
        password: 'p',
        database: 'db',
        table: 't',
      };
      mockGetConfig.mockReturnValue(chConfig);
      mockInsert.mockResolvedValue(undefined);

      const res = await POST(jsonPost(validBody));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ success: true, feedbackId: FIXED_FEEDBACK_ID, persisted: false });
      await vi.waitFor(() => {
        expect(mockInsert).toHaveBeenCalledTimes(1);
      });
      expect(mockInsert.mock.calls[0][1]).toEqual(chConfig);
      expect(mockInsert.mock.calls[0][0]).toMatchObject({
        feedback_id: FIXED_FEEDBACK_ID,
        vote: 'up',
        app_id: 'app-1',
        page_host_id: 'example.com',
        insight_kind: 'insight',
        insight_title: 'Title',
        insight_body: 'Body',
        partition_snap_date: '2025-04-08',
        customer_id: 'cust-test',
      });
    });

    it('accepts vote none and insightKind prediction with deferred insert', async function noneAndPrediction() {
      const chConfig = {
        baseUrl: 'https://ch.test',
        user: 'u',
        password: 'p',
        database: 'db',
        table: 't',
      };
      mockGetConfig.mockReturnValue(chConfig);

      const res = await POST(jsonPost({ ...validBody, vote: 'none', insightKind: 'prediction' }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ success: true, feedbackId: FIXED_FEEDBACK_ID, persisted: false });
      await vi.waitFor(() => {
        expect(mockInsert).toHaveBeenCalledTimes(1);
      });
      expect(mockInsert.mock.calls[0][0]).toMatchObject({
        vote: 'none',
        insight_kind: 'prediction',
      });
    });

    it('returns 400 for invalid vote', async function invalidVote() {
      const res = await POST(jsonPost({ ...validBody, vote: 'maybe' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid vote or insightKind' });
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid insightKind', async function invalidInsightKind() {
      const res = await POST(jsonPost({ ...validBody, insightKind: 'not-a-kind' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid vote or insightKind' });
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('returns 413 when Content-Length header exceeds limit', async function tooLarge() {
      const serialized = JSON.stringify(validBody);
      const req = new NextRequest(URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'content-length': '200001',
        },
        body: serialized,
      });

      const res = await POST(req);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'Request body too large' });
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('returns 400 when Content-Length header is missing', async function missingContentLength() {
      const serialized = JSON.stringify(validBody);
      const req = new NextRequest(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Content-Length header is required');
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('returns 400 when Content-Length is not a non-negative decimal integer', async function invalidContentLength() {
      const res = await POST(jsonPost(validBody, { 'content-length': '12ab' }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid Content-Length');
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('returns 400 when JSON body is invalid', async function invalidJson() {
      const body = '{not-json';
      const req = new NextRequest(URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'content-length': String(Buffer.byteLength(body, 'utf8')),
        },
        body,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid JSON payload' });
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'analytics.insightsFeedback.invalid_payload',
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });
});
