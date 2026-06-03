import '@testing-library/jest-dom';

import { unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';

const require = createRequire(import.meta.url);

const { mockEncodeFeedbackParquet, mockCheckSwitchboardFlag, mockCheckSwitchboardObject, mockFetchCustomerProfile, mockGetToken } = vi.hoisted(() => ({
  mockEncodeFeedbackParquet: vi.fn(),
  mockCheckSwitchboardFlag: vi.fn(),
  mockCheckSwitchboardObject: vi.fn(),
  mockFetchCustomerProfile: vi.fn(),
  mockGetToken: vi.fn(),
}));

vi.mock('@/lib/crm', () => ({
  fetchCustomerProfile: mockFetchCustomerProfile,
  airoCertTokenService: { getToken: mockGetToken },
}));

vi.mock('./feedback-to-parquet', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./feedback-to-parquet')>();
  return {
    ...mod,
    encodeFeedbackParquet: mockEncodeFeedbackParquet as typeof mod.encodeFeedbackParquet,
  };
});

async function readParquetRow(body: unknown): Promise<Record<string, unknown>> {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body as ArrayBuffer);
  const path = join(tmpdir(), `fb-parquet-${Date.now()}-${Math.random().toString(36).slice(2)}.parquet`);
  await writeFile(path, buf);
  try {
    const { ParquetReader } = require('parquetjs') as {
      ParquetReader: { openFile: (p: string) => Promise<{ getCursor: () => { next: () => Promise<unknown> }; close: () => Promise<void> }> };
    };
    const reader = await ParquetReader.openFile(path);
    try {
      const cursor = reader.getCursor();
      const row = await cursor.next();
      expect(await cursor.next()).toBeNull();
      return row as Record<string, unknown>;
    } finally {
      await reader.close();
    }
  } finally {
    await unlink(path).catch(() => {});
  }
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockAuthContext = {
  jwt: 'test-jwt',
  user: {
    customerId: 'customer-uuid-123',
    shopperId: 'shopper-123',
    authType: 'basic',
  },
};

const mockS3Send = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () { return { send: mockS3Send }; }),
  PutObjectCommand: vi.fn(function (args) { return args; }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: NextRequest, ...rest: any[]) => handler(request, mockAuthContext, ...rest);
  },
}));

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
  checkSwitchboardObject: mockCheckSwitchboardObject,
}));

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/feedback/s3-store'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createRawRequest(rawBody: string): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/feedback/s3-store'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  });
}

describe('/api/feedback/s3-store', function s3StoreTests() {
  beforeEach(async function setup() {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.FEEDBACK_BUCKET = 'airo-builder-feedback-dev';
    process.env.AWS_REGION = 'us-west-2';
    const actual = await vi.importActual<typeof import('./feedback-to-parquet')>('./feedback-to-parquet');
    mockEncodeFeedbackParquet.mockImplementation(actual.encodeFeedbackParquet);
    // Default: flag OFF — preserves today's parquet column shape for legacy
    // assertions. Cutover-specific tests override per-call.
    mockCheckSwitchboardFlag.mockResolvedValue(false);
    // Default: no Jira-eligibility config object — Lambda applies its built-in
    // default (issue/support OFF, feedback ON rating<7). Jira-specific tests
    // override per-call.
    mockCheckSwitchboardObject.mockResolvedValue(null);
    // Default: profile fetch succeeds with realistic values
    mockGetToken.mockResolvedValue('sso-token');
    mockFetchCustomerProfile.mockResolvedValue({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@example.com',
      phone: '5551234567',
    });
  });

  afterEach(function cleanup() {
    delete process.env.FEEDBACK_BUCKET;
    delete process.env.AWS_REGION;
  });

  describe('POST - S3 not configured', function notConfiguredTests() {
    it('should return 200 with devSkipped when FEEDBACK_BUCKET is unset (local dev)', async function noBucket() {
      delete process.env.FEEDBACK_BUCKET;
      const { POST } = await import('./route');

      const response = await POST(createRequest({ app_id: 'app-123', feedback_text: 'hello', consent_flag: true, rating: 7 }));
      const data = await response.json();

      // Local dev / pre-deploy: succeed without writing so the UI doesn't
      // surface a noisy error toast. Client decides what to do with the
      // returned devSkipped flag (e.g. log the Slack block JSON locally
      // when isLocalDev()).
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.devSkipped).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith('feedback.store.s3.skipped_not_configured');
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should return 500 with distinct error when S3Client init failed', async function clientInitFailed() {
      vi.mocked(S3Client).mockImplementationOnce(function () { throw new Error('Invalid region'); });
      const { POST } = await import('./route');

      const response = await POST(createRequest({ app_id: 'app-123', feedback_text: 'hello', consent_flag: true, rating: 7 }));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('S3 client init failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'feedback.store.s3.client_unavailable',
        expect.objectContaining({ initError: 'Invalid region' }),
      );
      expect(mockS3Send).not.toHaveBeenCalled();
    });
  });

  describe('POST - Input validation', function validationTests() {
    it('should return 400 and log on invalid JSON', async function invalidJson() {
      // FEEDBACK_BUCKET must be set so the route proceeds past the early-return guard
      process.env.FEEDBACK_BUCKET = 'airo-builder-feedback-dev';
      const { POST } = await import('./route');
      const request = new NextRequest(new URL('http://localhost:3000/api/feedback/s3-store'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json {',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid JSON payload');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'feedback.store.s3.invalid_payload',
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('should return 413 when Content-Length exceeds 100 KB', async function bodyTooLarge() {
      const { POST } = await import('./route');
      const request = new NextRequest(new URL('http://localhost:3000/api/feedback/s3-store'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'content-length': '100001' },
        body: JSON.stringify({ app_id: 'app-123' }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(413);
      expect(data.error).toBe('Request body too large');
      expect(mockS3Send).not.toHaveBeenCalled();
    });
  });

  describe('POST - Successful S3 write', function successTests() {
    it('should write correct record structure to S3', async function correctRecord() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      const response = await POST(createRequest({
        app_id: 'app-abc',
        feedback_text: 'great product',
        consent_flag: true,
        rating: 6,
        plan_type_name: 'ultimate',
        subscription_id: 'sub-xyz',
        subscription_status: 'active',
        total_credit_cnt: 500,
        available_credit_cnt: 320,
      }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      expect(mockS3Send).toHaveBeenCalledOnce();
      const putArgs = mockS3Send.mock.calls[0][0];
      expect(putArgs.Bucket).toBe('airo-builder-feedback-dev');
      expect(putArgs.ContentType).toBe('application/vnd.apache.parquet');
      expect(putArgs.Key).toMatch(/^airo_builder_feedback_cln_laketest\/year=\d{4}\/month=\d{2}\/day=\d{2}\/hour=\d{2}\/appId=app-abc\/\d+\.parquet$/);

      const record = await readParquetRow(putArgs.Body);
      expect(record.feedback_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(record.customer_id).toBe('customer-uuid-123');
      expect(record.app_id).toBe('app-abc');
      expect(record.feedback_text).toBe('great product');
      expect(record.consent_flag).toBe(true);
      expect(record.rating).toBe(6);
      expect(record.plan_type_name).toBe('ultimate');
      expect(record.subscription_id).toBe('sub-xyz');
      expect(record.subscription_status).toBe('active');
      expect(record.total_credit_cnt).toBe(500);
      expect(record.available_credit_cnt).toBe(320);
      expect(record.feedback_utc_ts).toBeInstanceOf(Date);
      expect(record.cln_create_utc_ts).toBeInstanceOf(Date);
      expect((record.feedback_utc_ts as Date).toISOString()).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect((record.cln_create_utc_ts as Date).getTime()).toBe((record.feedback_utc_ts as Date).getTime());
    });

    it('should persist lake enrichment columns when provided', async function lakeEnrichmentColumns() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');
      await POST(createRequest({
        app_id: 'app-abc',
        feedback_text: 't',
        consent_flag: true,
        rating: 5,
        plan_type_name: null,
        subscription_id: null,
        subscription_status: null,
        total_credit_cnt: null,
        available_credit_cnt: null,
        feedback_topic_list: '["AI assistant","Editor & design"]',
        feedback_origin_name: 'develop',
        app_publish_flag: true,
        publish_url: 'https://example.com/app',
      }));
      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.feedback_topic_list).toBe('["AI assistant","Editor & design"]');
      expect(record.feedback_origin_name).toBe('develop');
      expect(record.app_publish_flag).toBe(true);
      expect(record.publish_url).toBe('https://example.com/app');
    });

    it('should null publish_url when app_publish_flag is false', async function publishedUrlGated() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');
      await POST(createRequest({
        app_id: 'app-abc',
        feedback_text: 't',
        consent_flag: null,
        rating: null,
        app_publish_flag: false,
        publish_url: 'https://ignored.example/',
      }));
      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.app_publish_flag).toBe(false);
      expect(record.publish_url == null).toBe(true);
    });

    it('should accept feedback_topic_list as array and normalize JSON', async function topicListFromArray() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');
      await POST(createRequest({
        app_id: 'app-abc',
        feedback_text: 't',
        consent_flag: null,
        rating: null,
        feedback_topic_list: ['b', 'a', 'a'],
      }));
      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.feedback_topic_list).toBe('["a","b"]');
    });

    it('should warn and store null feedback_topic_list for non-JSON string', async function topicListInvalidJsonString() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');
      await POST(createRequest({
        app_id: 'app-abc',
        feedback_text: 't',
        consent_flag: null,
        rating: null,
        feedback_topic_list: 'NOT_JSON_ARRAY',
      }));
      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.feedback_topic_list == null).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'feedback.store.s3.invalid_topic_list',
        expect.objectContaining({ preview: 'NOT_JSON_ARRAY', type: 'string' }),
      );
    });

    it('should store null feedback_topic_list when JSON array has no strings', async function topicListNoStringsInJson() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');
      await POST(createRequest({
        app_id: 'app-abc',
        feedback_text: 't',
        consent_flag: null,
        rating: null,
        feedback_topic_list: '[1,2,3]',
      }));
      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.feedback_topic_list == null).toBe(true);
    });

    it('should store null publish_url and warn when flag true but URL not http(s)', async function publishedUrlNonHttp() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');
      await POST(createRequest({
        app_id: 'app-abc',
        feedback_text: 't',
        consent_flag: null,
        rating: null,
        app_publish_flag: true,
        publish_url: 'ftp://example.com/a',
      }));
      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.app_publish_flag).toBe(true);
      expect(record.publish_url == null).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'feedback.store.s3.missing_publish_url',
        expect.objectContaining({ hadClientUrl: true }),
      );
    });

    it('should store null feedback_origin_name for whitespace-only value', async function originWhitespace() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');
      await POST(createRequest({
        app_id: 'app-abc',
        feedback_text: 't',
        consent_flag: null,
        rating: null,
        feedback_origin_name: '   \t  ',
      }));
      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.feedback_origin_name == null).toBe(true);
    });

    it('should coerce non-boolean app_publish_flag to null', async function coerceAppPublishFlag() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');
      await POST(createRequest({
        app_id: 'app-abc',
        feedback_text: 't',
        consent_flag: null,
        rating: null,
        app_publish_flag: 'true' as unknown as boolean,
        publish_url: 'https://example.com/',
      }));
      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.app_publish_flag == null).toBe(true);
      expect(record.publish_url == null).toBe(true);
    });

    it('should use prod table prefix when prod bucket is set', async function prodPrefix() {
      process.env.FEEDBACK_BUCKET = 'airo-builder-feedback-prod';
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null }));

      const putArgs = mockS3Send.mock.calls[0][0];
      expect(putArgs.Key).toMatch(/^airo_builder_feedback_cln\//);
    });

    it('should use appId=unknown in key when app_id is null', async function unknownAppId() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: null, feedback_text: 'legacy feedback', consent_flag: null, rating: null }));

      const putArgs = mockS3Send.mock.calls[0][0];
      expect(putArgs.Key).toContain('/appId=unknown/');
    });

    it('should store null fields correctly', async function nullFields() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: null, consent_flag: null, rating: null }));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      // Parquet optional nulls are often omitted on read (undefined), not JSON null.
      expect(record.feedback_text == null).toBe(true);
      expect(record.consent_flag == null).toBe(true);
      expect(record.rating == null).toBe(true);
      expect(record.plan_type_name == null).toBe(true);
      expect(record.subscription_id == null).toBe(true);
      expect(record.subscription_status == null).toBe(true);
      expect(record.total_credit_cnt == null).toBe(true);
      expect(record.available_credit_cnt == null).toBe(true);
    });

    it('should coerce wrong-type consent_flag to null', async function coerceConsentFlag() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: 'yes', rating: null }));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.consent_flag == null).toBe(true);
    });

    it('should coerce non-integer rating to null', async function coerceRating() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: 5.5 }));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.rating == null).toBe(true);
    });

    it('should coerce string rating to null', async function coerceStringRating() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: '5' as unknown as number }));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.rating == null).toBe(true);
    });

    it('should truncate float credits to int32 in Parquet for lake int columns', async function floatCreditsTruncated() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null, total_credit_cnt: 500.5, available_credit_cnt: 320.9 }));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.total_credit_cnt).toBe(500);
      expect(record.available_credit_cnt).toBe(320);
    });

    it('should clamp credits and rating to int32 bounds in Parquet', async function clampInt32Fields() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({
        app_id: 'app-123',
        feedback_text: 'test',
        consent_flag: null,
        rating: 3_000_000_000,
        total_credit_cnt: 9_000_000_000,
        available_credit_cnt: -9_000_000_000,
      }));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.total_credit_cnt).toBe(2_147_483_647);
      expect(record.available_credit_cnt).toBe(-2_147_483_648);
      expect(record.rating).toBe(2_147_483_647);
    });

    it('should coerce numeric non-finite credits to null and log warn', async function coerceNumericNonFiniteCredits() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      // JSON.stringify converts Infinity/NaN to null, so inject via raw body string
      // to simulate a non-standard client sending numeric non-finite values
      await POST(createRawRequest('{"app_id":"app-123","feedback_text":"test","consent_flag":null,"rating":null,"total_credit_cnt":1e309,"available_credit_cnt":1e309}'));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.total_credit_cnt == null).toBe(true);
      expect(record.available_credit_cnt == null).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith('feedback.store.s3.invalid_credits', expect.objectContaining({ field: 'total_credit_cnt' }));
      expect(mockLogger.warn).toHaveBeenCalledWith('feedback.store.s3.invalid_credits', expect.objectContaining({ field: 'available_credit_cnt' }));
    });

    it('should coerce non-number credits to null without warn', async function coerceNonNumberCredits() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null, total_credit_cnt: 'bad' as unknown as number, available_credit_cnt: true as unknown as number }));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.total_credit_cnt == null).toBe(true);
      expect(record.available_credit_cnt == null).toBe(true);
      // Non-number types are silently coerced — warn only fires for numeric non-finite values
      expect(mockLogger.warn).not.toHaveBeenCalledWith('feedback.store.s3.invalid_credits', expect.anything());
    });

    it('should not warn when credit fields are null (no subscription)', async function noWarnForNullCredits() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null, total_credit_cnt: null, available_credit_cnt: null }));

      expect(mockLogger.warn).not.toHaveBeenCalledWith('feedback.store.s3.invalid_credits', expect.anything());
    });

    it('should coerce non-string plan_type_name, subscription_id and subscription_status to null', async function coerceNonStringSubscriptionFields() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({
        app_id: 'app-123',
        feedback_text: 'test',
        consent_flag: null,
        rating: null,
        plan_type_name: 123 as unknown as string,
        subscription_id: true as unknown as string,
        subscription_status: 42 as unknown as string,
      }));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.plan_type_name == null).toBe(true);
      expect(record.subscription_id == null).toBe(true);
      expect(record.subscription_status == null).toBe(true);
    });

    it('should coerce numeric app_id to null and use appId=unknown in key', async function coerceNumericAppId() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 42 as unknown as string, feedback_text: 'test', consent_flag: null, rating: null }));

      const putArgs = mockS3Send.mock.calls[0][0];
      const record = await readParquetRow(putArgs.Body);
      expect(record.app_id == null).toBe(true);
      expect(putArgs.Key).toContain('/appId=unknown/');
    });

    it('should log successful write', async function logSuccess() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: false, rating: 4 }));

      expect(mockLogger.info).toHaveBeenCalledWith(
        'feedback.store.s3.success',
        expect.objectContaining({ appId: 'app-123', customerId: 'customer-uuid-123' }),
      );
    });

    it('should return 400 and log when app_id contains invalid characters', async function invalidAppId() {
      const { POST } = await import('./route');

      const response = await POST(createRequest({ app_id: 'app/../../etc', feedback_text: 'test', consent_flag: null, rating: null }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid app_id format');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'feedback.store.s3.invalid_app_id',
        expect.objectContaining({ appId: 'app/../../etc' }),
      );
      expect(mockS3Send).not.toHaveBeenCalled();
    });
  });

  describe('POST - Parquet encode failure', function parquetFailureTests() {
    it('should return 500 and log when encodeFeedbackParquet rejects', async function parquetEncodeFailed() {
      mockEncodeFeedbackParquet.mockRejectedValueOnce(new Error('encode boom'));
      const { POST } = await import('./route');

      const response = await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: true, rating: 5 }));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Parquet encode failed');
      expect(mockS3Send).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'feedback.store.s3.parquet_encode_failed',
        expect.objectContaining({
          appId: 'app-123',
          error: 'encode boom',
          feedbackId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      );
    });
  });

  describe('POST - fanout_via_lambda Switchboard gate', function fanoutFlagTests() {
    it('should stamp fanout_via_lambda=false in parquet when flag is OFF', async function flagOff() {
      mockCheckSwitchboardFlag.mockResolvedValueOnce(false);
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null }));

      expect(mockCheckSwitchboardFlag).toHaveBeenCalledWith('appbuilder-fanout-via-lambda', expect.anything());
      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.fanout_via_lambda).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'feedback.store.s3.fanout_flag',
        expect.objectContaining({ flag: 'appbuilder-fanout-via-lambda', value: false }),
      );
    });

    it('should stamp fanout_via_lambda=true in parquet when flag is ON', async function flagOn() {
      mockCheckSwitchboardFlag.mockResolvedValueOnce(true);
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null }));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.fanout_via_lambda).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'feedback.store.s3.fanout_flag',
        expect.objectContaining({ flag: 'appbuilder-fanout-via-lambda', value: true }),
      );
    });

    it('should fail closed (null + warn) when flag lookup throws', async function flagLookupFailure() {
      // Match the project pattern: a Switchboard system failure must NOT be
      // misread as "flag ON" — Lambda treats anything other than strict
      // `true` as no-op, so null is the safe legacy-path landing.
      mockCheckSwitchboardFlag.mockRejectedValueOnce(new Error('boom'));
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      const response = await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null }));
      expect(response.status).toBe(200);

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.fanout_via_lambda == null).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'feedback.store.s3.fanout_flag_lookup_failed',
        expect.objectContaining({ flag: 'appbuilder-fanout-via-lambda', error: 'boom' }),
      );
    });
  });

  describe('POST - jira_eligibility_config Switchboard value', function jiraEligibilityTests() {
    it('should stamp the JSON setting as a canonical string into the parquet row', async function valuePresent() {
      // Switchboard json-typed setting is surfaced as an object by the gasket
      // plugin; the BFF re-serializes it to a canonical string for the column.
      const cfg = { issue: true, support: false, feedback: { enabled: true, maxRating: 5 } };
      mockCheckSwitchboardObject.mockResolvedValueOnce(cfg);
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null }));

      expect(mockCheckSwitchboardObject).toHaveBeenCalledWith('appbuilder-fanout-jira-eligibility', expect.anything());
      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      // Round-trip (parse + deepEqual) rather than raw string equality so the
      // contract isn't coupled to JSON.stringify key-insertion order.
      expect(JSON.parse(record.jira_eligibility_config as string)).toEqual(cfg);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'feedback.store.s3.jira_eligibility_flag',
        expect.objectContaining({ flag: 'appbuilder-fanout-jira-eligibility', present: true }),
      );
    });

    it('should stamp null when the Switchboard setting is absent/non-object (Lambda uses its default)', async function valueAbsent() {
      mockCheckSwitchboardObject.mockResolvedValueOnce(null);
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null }));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.jira_eligibility_config == null).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'feedback.store.s3.jira_eligibility_flag',
        expect.objectContaining({ flag: 'appbuilder-fanout-jira-eligibility', present: false }),
      );
    });

    it('should soft-default to null + warn when the lookup throws (submission still succeeds)', async function valueLookupFailure() {
      // A Switchboard outage must not fail the submission — the Lambda falls
      // back to its built-in default eligibility when the column is null.
      mockCheckSwitchboardObject.mockRejectedValueOnce(new Error('sb-down'));
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      const response = await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null }));
      expect(response.status).toBe(200);

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.jira_eligibility_config == null).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'feedback.store.s3.jira_eligibility_lookup_failed',
        expect.objectContaining({ flag: 'appbuilder-fanout-jira-eligibility', error: 'sb-down' }),
      );
    });
  });

  describe('POST - S3 failure handling', function failureTests() {
    it('should return 500 when S3 write fails', async function s3Failure() {
      mockS3Send.mockRejectedValueOnce(new Error('S3 connection timeout'));
      const { POST } = await import('./route');

      const response = await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: true, rating: 5 }));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('S3 write failed');
    });

    it('should log error with s3Key when S3 write fails', async function logS3Failure() {
      mockS3Send.mockRejectedValueOnce(new Error('AccessDenied'));
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: true, rating: 5 }));

      expect(mockLogger.error).toHaveBeenCalledWith(
        'feedback.store.s3.failure',
        expect.objectContaining({ appId: 'app-123', error: 'AccessDenied', s3Key: expect.stringContaining('appId=app-123') }),
      );
    });
  });

  describe('POST - customer profile enrichment', function profileEnrichmentTests() {
    it('happy path: profile fields written to parquet row', async function profileHappyPath() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-abc', feedback_text: 'good', consent_flag: true, rating: 5 }));

      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.customer_first_name).toBe('Jane');
      expect(record.customer_last_name).toBe('Doe');
      expect(record.customer_email).toBe('jane.doe@example.com');
      expect(record.customer_phone).toBe('5551234567');
    });

    it('failure path: profile fetch throws → warn logged, parquet written with null contact fields, 200 returned', async function profileFetchFails() {
      mockS3Send.mockResolvedValueOnce({});
      mockFetchCustomerProfile.mockRejectedValueOnce(new Error('Profile API 503'));
      const { POST } = await import('./route');

      const response = await POST(createRequest({ app_id: 'app-abc', feedback_text: 'ok', consent_flag: true, rating: 4 }));

      expect(response.status).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'feedback.store.s3.profile_fetch_failed',
        expect.objectContaining({ customerId: 'customer-uuid-123', error: 'Profile API 503' }),
      );
      const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
      expect(record.customer_email == null).toBe(true);
      expect(record.customer_phone == null).toBe(true);
      expect(record.customer_first_name == null).toBe(true);
      expect(record.customer_last_name == null).toBe(true);
    });

    it('no-customerId path: profile fetch skipped, contact fields null', async function noCustomerId() {
      mockS3Send.mockResolvedValueOnce({});
      // Clear customerId so the route's `if (authContext.user.customerId)`
      // guard short-circuits the profile fetch.
      const saved = mockAuthContext.user.customerId;
      mockAuthContext.user.customerId = undefined as any;
      try {
        const { POST } = await import('./route');
        await POST(createRequest({ app_id: 'app-abc', feedback_text: 'ok', consent_flag: false, rating: 6 }));

        expect(mockFetchCustomerProfile).not.toHaveBeenCalled();
        const record = await readParquetRow(mockS3Send.mock.calls[0][0].Body);
        expect(record.customer_email == null).toBe(true);
        expect(record.customer_first_name == null).toBe(true);
      } finally {
        mockAuthContext.user.customerId = saved;
      }
    });
  });
});
