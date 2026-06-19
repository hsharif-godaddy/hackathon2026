import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RebuildOrchestrationService } from '../../../services/RebuildOrchestrationService.js';
import type { RebuildWorkflowState } from '../../../types/rebuild.js';
import { waitForIntake } from '../wait-for-intake.js';

function awaitingState(): RebuildWorkflowState {
  return {
    appId: 'app-123',
    sourceUrl: 'https://example.com',
    rootPath: '/',
    status: 'awaiting_intake',
    scrapingProgress: { total: 0, completed: 0 },
    pagesBuilt: [],
    currentPage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function mockService(overrides: {
  getStatus?: ReturnType<typeof vi.fn>;
  submitDefaultIntake?: ReturnType<typeof vi.fn>;
} = {}): RebuildOrchestrationService {
  return {
    getStatus: overrides.getStatus ?? vi.fn(),
    submitDefaultIntake: overrides.submitDefaultIntake ?? vi.fn(),
  } as unknown as RebuildOrchestrationService;
}

describe('waitForIntake', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early when intake already completed', async function completed() {
    const completedState = { ...awaitingState(), intakeCompleted: true, status: 'scraping' as const };
    const getStatus = vi.fn().mockResolvedValue(completedState);
    const submitDefaultIntake = vi.fn();
    const service = mockService({ getStatus, submitDefaultIntake });

    const result = await waitForIntake(service, 'app-123', { maxWaitMs: 5_000 });

    expect(result.intakeTimedOut).toBe(false);
    expect(result.state).toEqual(completedState);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(submitDefaultIntake).not.toHaveBeenCalled();
  });

  it('returns early when workflow left awaiting_intake', async function notAwaiting() {
    const scrapingState = { ...awaitingState(), status: 'scraping' as const };
    const getStatus = vi.fn().mockResolvedValue(scrapingState);
    const service = mockService({ getStatus });

    const result = await waitForIntake(service, 'app-123', { maxWaitMs: 5_000 });

    expect(result.intakeTimedOut).toBe(false);
    expect(result.state.status).toBe('scraping');
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('calls submitDefaultIntake on timeout', async function timeout() {
    const getStatus = vi.fn().mockResolvedValue(awaitingState());
    const defaultState = {
      ...awaitingState(),
      intakeCompleted: true,
      rebuildScope: 'homepage_only' as const,
      status: 'scraping' as const,
    };
    const submitDefaultIntake = vi.fn().mockResolvedValue(defaultState);
    const service = mockService({ getStatus, submitDefaultIntake });

    const pending = waitForIntake(service, 'app-123', { maxWaitMs: 1_000 });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.intakeTimedOut).toBe(true);
    expect(submitDefaultIntake).toHaveBeenCalledWith('app-123', undefined, undefined);
    expect(result.state).toEqual(defaultState);
  });

  it('forwards the homepage design direction to submitDefaultIntake on timeout', async function timeoutDirection() {
    const getStatus = vi.fn().mockResolvedValue(awaitingState());
    const submitDefaultIntake = vi.fn().mockResolvedValue({
      ...awaitingState(),
      intakeCompleted: true,
      status: 'scraping' as const,
    });
    const service = mockService({ getStatus, submitDefaultIntake });

    const pending = waitForIntake(service, 'app-123', { designDirection: 'modernize', maxWaitMs: 1_000 });
    await vi.runAllTimersAsync();
    await pending;

    expect(submitDefaultIntake).toHaveBeenCalledWith('app-123', 'modernize', undefined);
  });

  it('forwards the customer designIntent to submitDefaultIntake on timeout', async function timeoutIntent() {
    const getStatus = vi.fn().mockResolvedValue(awaitingState());
    const submitDefaultIntake = vi.fn().mockResolvedValue({
      ...awaitingState(),
      intakeCompleted: true,
      status: 'scraping' as const,
    });
    const service = mockService({ getStatus, submitDefaultIntake });

    const pending = waitForIntake(service, 'app-123', {
      designDirection: 'modernize',
      designIntent: 'reimagine from scratch, ignore the existing layout',
      maxWaitMs: 1_000,
    });
    await vi.runAllTimersAsync();
    await pending;

    expect(submitDefaultIntake).toHaveBeenCalledWith('app-123', 'modernize', 'reimagine from scratch, ignore the existing layout');
  });

  it('re-reads state on timeout when user submitted during final sleep window', async function timeoutRace() {
    const awaiting = awaitingState();
    const userSubmitted = {
      ...awaiting,
      intakeCompleted: true,
      rebuildScope: 'small' as const,
      status: 'scraping' as const,
    };
    const getStatus = vi.fn().mockImplementation(async function pollStatus() {
      if (getStatus.mock.calls.length >= 4) return userSubmitted;
      return awaiting;
    });
    const submitDefaultIntake = vi.fn();
    const service = mockService({ getStatus, submitDefaultIntake });

    const pending = waitForIntake(service, 'app-123', { maxWaitMs: 1_000 });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.intakeTimedOut).toBe(false);
    expect(result.state).toEqual(userSubmitted);
    expect(submitDefaultIntake).not.toHaveBeenCalled();
  });

  it('recovers when submitDefaultIntake races with user submit', async function submitRace() {
    const awaiting = awaitingState();
    const userSubmitted = {
      ...awaiting,
      intakeCompleted: true,
      status: 'scraping' as const,
    };
    const submitDefaultIntake = vi.fn().mockRejectedValue(
      new Error('Cannot submit intake while status is scraping'),
    );
    const getStatus = vi.fn().mockImplementation(async function pollStatus() {
      if (submitDefaultIntake.mock.calls.length > 0) return userSubmitted;
      return awaiting;
    });
    const service = mockService({ getStatus, submitDefaultIntake });

    const pending = waitForIntake(service, 'app-123', { maxWaitMs: 1_000 });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.intakeTimedOut).toBe(false);
    expect(result.state).toEqual(userSubmitted);
    expect(submitDefaultIntake).toHaveBeenCalledWith('app-123', undefined, undefined);
  });

  it('uses 400ms poll cadence for the first 18 iterations', async function pollCadence() {
    const getStatus = vi.fn().mockResolvedValue(awaitingState());
    const submitDefaultIntake = vi.fn().mockResolvedValue({
      ...awaitingState(),
      intakeCompleted: true,
      status: 'scraping' as const,
    });
    const service = mockService({ getStatus, submitDefaultIntake });

    const pending = waitForIntake(service, 'app-123', { maxWaitMs: 10_000 });
    await vi.advanceTimersByTimeAsync(400);
    expect(getStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(400 * 17);
    expect(getStatus).toHaveBeenCalledTimes(19);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(submitDefaultIntake).toHaveBeenCalled();
  });
});
