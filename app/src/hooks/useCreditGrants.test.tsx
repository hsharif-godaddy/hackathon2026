/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useCreditGrants } from '@/hooks/useCreditGrants';
import { HttpError } from '@/lib/errors';
import { GrantType } from '@/types/credits';

const mockLoggerWarn = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    debug: vi.fn(),
  },
}));

// The hook delegates to appFetch (with handle401), which owns the 401 →
// resolveAuth → recover/retry flow. That flow is integration-tested in
// appFetchHandle401.test.ts / resolveAuth.test.ts; here we mock appFetch so
// these stay focused unit tests of the hook's request shape + response
// handling. A resolved error Response simulates "appFetch exhausted recovery
// and surfaced the final response."
const mockAppFetch = vi.fn();
vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
}));

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function mockGrantsResponse(grants: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: grants }),
  } as Response;
}

describe('useCreditGrants', function useCreditGrantsTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  it('requests grants through appFetch with handle401 enabled', async function usesAppFetchHandle401() {
    mockAppFetch.mockResolvedValue(mockGrantsResponse([
      { id: 'g1', type: GrantType.PlanMonthly, creditsSpent: 0, creditsMax: 100, isAvailable: true },
    ]));

    const { result } = renderHook(
      () => useCreditGrants({ subscriptionId: 'sub-1' }),
      { wrapper: makeWrapper(createTestQueryClient()) }
    );

    await waitFor(function waitForData() {
      expect(result.current.data).toHaveLength(1);
    });

    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/credits/grants?subscriptionId=sub-1&syncSpend=true',
      undefined,
      { handle401: true },
    );
  });

  it('logs a warning once per fetch when a grant has null creditsMax', async function warnOnInvalidGrant() {
    // Emitting the warn here (instead of inside getTotalCreditsFromGrants)
    // keeps it to one log per response rather than one per render of each
    // gauge/popover consumer.
    mockAppFetch.mockResolvedValue(mockGrantsResponse([
      { id: 'broken-1', type: GrantType.PlanMonthly, creditsSpent: 10, creditsMax: null, isAvailable: true },
      { id: 'good-1', type: GrantType.CreditPack, creditsSpent: 20, creditsMax: 100, isAvailable: true },
    ]));

    const { result } = renderHook(
      () => useCreditGrants({ subscriptionId: 'sub-1' }),
      { wrapper: makeWrapper(createTestQueryClient()) }
    );

    await waitFor(function waitForData() {
      expect(result.current.data).toHaveLength(2);
    });

    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith('credit-grants.query.invalidGrant', {
      subscriptionId: 'sub-1',
      grantIds: ['broken-1'],
      invalidCount: 1,
    });
  });

  it('does not log a warning when all grants have valid creditsMax', async function noWarnWhenValid() {
    mockAppFetch.mockResolvedValue(mockGrantsResponse([
      { id: 'g1', type: GrantType.PlanMonthly, creditsSpent: 10, creditsMax: 500, isAvailable: true },
    ]));

    const { result } = renderHook(
      () => useCreditGrants({ subscriptionId: 'sub-1' }),
      { wrapper: makeWrapper(createTestQueryClient()) }
    );

    await waitFor(function waitForData() {
      expect(result.current.data).toHaveLength(1);
    });

    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('throws HttpError with status when error response body is non-JSON', async function nonJsonErrorBody() {
    // Load balancers / auth proxies / CDN error pages return HTML or plain
    // text. response.json() throws SyntaxError on those bodies; the hook must
    // swallow it via .catch() so HttpError still surfaces with the correct
    // status (otherwise retry policy can't short-circuit on 4xx). A persistent
    // 401 here means appFetch already exhausted recovery and surfaced it.
    const jsonError = new SyntaxError('Unexpected token < in JSON at position 0');
    mockAppFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockRejectedValue(jsonError),
    } as unknown as Response);

    const { result } = renderHook(
      () => useCreditGrants({ subscriptionId: 'sub-1' }),
      { wrapper: makeWrapper(createTestQueryClient()) }
    );

    await waitFor(function waitForError() {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(HttpError);
    expect((result.current.error as HttpError).status).toBe(401);
    expect((result.current.error as HttpError).message).toBe('Failed to fetch credit grants: 401');
    expect(mockLoggerError).toHaveBeenCalledWith('credit-grants.query.error', {
      subscriptionId: 'sub-1',
      statusCode: 401,
      error: 'Failed to fetch credit grants: 401',
    });
  });

  it('uses error message from JSON error body when present', async function jsonErrorBody() {
    mockAppFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden: missing entitlement' }),
    } as unknown as Response);

    const { result } = renderHook(
      () => useCreditGrants({ subscriptionId: 'sub-1' }),
      { wrapper: makeWrapper(createTestQueryClient()) }
    );

    await waitFor(function waitForError() {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(HttpError);
    expect((result.current.error as HttpError).status).toBe(403);
    expect((result.current.error as HttpError).message).toBe('Forbidden: missing entitlement');
  });

  it('does not retry 4xx error responses', async function noRetryOn4xx() {
    // The retry policy keys off `error instanceof HttpError && status < 500`.
    // If response.json() throws before HttpError is constructed (the bug this
    // test guards against), the SyntaxError would be retried 3 times. With
    // the defensive .catch() in place, appFetch should be called exactly once.
    mockAppFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected end of JSON input')),
    } as unknown as Response);

    // Use the default retry policy (not the test client's retry: false) so
    // we're actually exercising retryOnError.
    const client = new QueryClient({
      defaultOptions: {
        queries: { gcTime: Infinity },
        mutations: { retry: false },
      },
    });

    const { result } = renderHook(
      () => useCreditGrants({ subscriptionId: 'sub-1' }),
      { wrapper: makeWrapper(client) }
    );

    await waitFor(function waitForError() {
      expect(result.current.isError).toBe(true);
    });

    expect(mockAppFetch).toHaveBeenCalledTimes(1);
    expect((result.current.error as HttpError).status).toBe(404);
  });
});
