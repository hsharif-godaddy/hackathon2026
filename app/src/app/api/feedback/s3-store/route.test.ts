import '@testing-library/jest-dom';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';

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
  S3Client: vi.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: vi.fn((args) => args),
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: NextRequest, ...rest: any[]) => handler(request, mockAuthContext, ...rest);
  },
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
  beforeEach(function setup() {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.FEEDBACK_BUCKET = 'airo-builder-feedback-dev';
    process.env.AWS_REGION = 'us-west-2';
  });

  afterEach(function cleanup() {
    delete process.env.FEEDBACK_BUCKET;
    delete process.env.AWS_REGION;
  });

  describe('POST - S3 not configured', function notConfiguredTests() {
    it('should return 503 and log when FEEDBACK_BUCKET is unset', async function noBucket() {
      delete process.env.FEEDBACK_BUCKET;
      const { POST } = await import('./route');

      const response = await POST(createRequest({ app_id: 'app-123', feedback_text: 'hello', consent_flag: true, rating: 7 }));
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe('S3 not configured');
      expect(mockLogger.warn).toHaveBeenCalledWith('feedback.store.s3.skipped_not_configured');
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('should return 500 with distinct error when S3Client init failed', async function clientInitFailed() {
      vi.mocked(S3Client).mockImplementationOnce(() => { throw new Error('Invalid region'); });
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
      expect(putArgs.ContentType).toBe('application/json');
      expect(putArgs.Key).toMatch(/^airo_builder_feedback_cln_laketest\/year=\d{4}\/month=\d{2}\/day=\d{2}\/hour=\d{2}\/appId=app-abc\/\d+\.json$/);

      const record = JSON.parse(putArgs.Body);
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
      expect(record.feedback_utc_ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
      expect(record.cln_create_utc_ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
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

      const record = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(record.feedback_text).toBeNull();
      expect(record.consent_flag).toBeNull();
      expect(record.rating).toBeNull();
      expect(record.plan_type_name).toBeNull();
      expect(record.subscription_id).toBeNull();
      expect(record.subscription_status).toBeNull();
      expect(record.total_credit_cnt).toBeNull();
      expect(record.available_credit_cnt).toBeNull();
    });

    it('should coerce wrong-type consent_flag to null', async function coerceConsentFlag() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: 'yes', rating: null }));

      const record = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(record.consent_flag).toBeNull();
    });

    it('should coerce non-integer rating to null', async function coerceRating() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: 5.5 }));

      const record = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(record.rating).toBeNull();
    });

    it('should coerce string rating to null', async function coerceStringRating() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: '5' as unknown as number }));

      const record = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(record.rating).toBeNull();
    });

    it('should pass through float total_credit_cnt and available_credit_cnt', async function floatCreditsPassThrough() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null, total_credit_cnt: 500.5, available_credit_cnt: 320.9 }));

      const record = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(record.total_credit_cnt).toBe(500.5);
      expect(record.available_credit_cnt).toBe(320.9);
    });

    it('should coerce numeric non-finite credits to null and log warn', async function coerceNumericNonFiniteCredits() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      // JSON.stringify converts Infinity/NaN to null, so inject via raw body string
      // to simulate a non-standard client sending numeric non-finite values
      await POST(createRawRequest('{"app_id":"app-123","feedback_text":"test","consent_flag":null,"rating":null,"total_credit_cnt":1e309,"available_credit_cnt":1e309}'));

      const record = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(record.total_credit_cnt).toBeNull();
      expect(record.available_credit_cnt).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith('feedback.store.s3.invalid_credits', expect.objectContaining({ field: 'total_credit_cnt' }));
      expect(mockLogger.warn).toHaveBeenCalledWith('feedback.store.s3.invalid_credits', expect.objectContaining({ field: 'available_credit_cnt' }));
    });

    it('should coerce non-number credits to null without warn', async function coerceNonNumberCredits() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 'app-123', feedback_text: 'test', consent_flag: null, rating: null, total_credit_cnt: 'bad' as unknown as number, available_credit_cnt: true as unknown as number }));

      const record = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(record.total_credit_cnt).toBeNull();
      expect(record.available_credit_cnt).toBeNull();
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

      const record = JSON.parse(mockS3Send.mock.calls[0][0].Body);
      expect(record.plan_type_name).toBeNull();
      expect(record.subscription_id).toBeNull();
      expect(record.subscription_status).toBeNull();
    });

    it('should coerce numeric app_id to null and use appId=unknown in key', async function coerceNumericAppId() {
      mockS3Send.mockResolvedValueOnce({});
      const { POST } = await import('./route');

      await POST(createRequest({ app_id: 42 as unknown as string, feedback_text: 'test', consent_flag: null, rating: null }));

      const putArgs = mockS3Send.mock.calls[0][0];
      const record = JSON.parse(putArgs.Body);
      expect(record.app_id).toBeNull();
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
});
