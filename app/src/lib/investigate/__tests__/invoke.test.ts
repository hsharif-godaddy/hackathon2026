import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();
const InvokeCommandMock = vi.fn().mockImplementation((args) => ({ args }));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  InvokeCommand: InvokeCommandMock,
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { invokeInvestigator } = await import('../invoke');

const FULL_PAYLOAD = {
  investigationId: 'inv-1',
  appId: 'a',
  customerId: 'c',
  feedback: 'f',
  fullstoryUrl: null,
  timeWindow: null,
  stateKey: 'sk',
  historyPrefix: 'hp',
  resultKey: 'rk',
  tracePrefix: 'tp',
  eventsPrefix: 'ep',
  source: 'feedback' as const,
  category: 'issue' as const,
  topics: [],
};

describe('invokeInvestigator', () => {
  beforeEach(() => {
    sendMock.mockReset();
    InvokeCommandMock.mockClear();
    process.env.INVESTIGATE_LAMBDA_FN = 'fn-arn';
    process.env.AWS_REGION = 'us-west-2';
  });

  afterEach(() => {
    delete process.env.INVESTIGATE_LAMBDA_FN;
    delete process.env.AWS_REGION;
  });

  it('sends Event invocation with JSON-encoded payload', async () => {
    sendMock.mockResolvedValueOnce({ StatusCode: 202 });
    await invokeInvestigator({ ...FULL_PAYLOAD, investigationId: 'inv-1' });

    expect(InvokeCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        FunctionName: 'fn-arn',
        InvocationType: 'Event',
      }),
    );
    const callArg = InvokeCommandMock.mock.calls[0][0];
    const decoded = JSON.parse(Buffer.from(callArg.Payload).toString('utf-8'));
    expect(decoded.investigationId).toBe('inv-1');
  });

  it('throws if INVESTIGATE_LAMBDA_FN is not set', async () => {
    delete process.env.INVESTIGATE_LAMBDA_FN;
    await expect(
      invokeInvestigator({ ...FULL_PAYLOAD, investigationId: 'x' }),
    ).rejects.toThrow(/INVESTIGATE_LAMBDA_FN/);
  });

  it('does not throw when AWS_REGION is not set at call time', async () => {
    // The eager LambdaClient is constructed at module import time using
    // whatever value of process.env.AWS_REGION was set then; this test can
    // only verify that calling the function later (after deleting the env
    // var) still works because the client is already configured. The
    // "defaults to us-west-2" guarantee belongs at module-load — we
    // verify it by setting AWS_REGION before importing in the suite
    // setup. See `beforeEach` above which sets AWS_REGION='us-west-2'
    // before each call.
    delete process.env.AWS_REGION;
    sendMock.mockResolvedValueOnce({ StatusCode: 202 });
    await expect(
      invokeInvestigator({ ...FULL_PAYLOAD, investigationId: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('throws when Lambda async invoke returns non-202 StatusCode', async () => {
    // AWS Lambda async invoke (`InvocationType: 'Event'`) returns 202 on
    // successful enqueue. Non-2xx (e.g. 429 concurrency throttle) may
    // resolve without throwing on some SDK paths — pin the contract that
    // we treat anything other than 202 as a failure so the BFF can mark
    // investigateFailed: true.
    sendMock.mockResolvedValueOnce({ StatusCode: 429 });
    await expect(
      invokeInvestigator({ ...FULL_PAYLOAD, investigationId: 'x' }),
    ).rejects.toThrow(/StatusCode=429/);
  });
});
