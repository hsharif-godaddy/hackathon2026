import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMarkInitialBuildComplete = vi.fn();

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () {
    return {
      markInitialBuildComplete: mockMarkInitialBuildComplete,
    };
  }),
}));

import {
  resetInitialBuildFunnelStateForTests,
  persistInitialBuildCompleteAndEmit,
  trackInitialBuildCompletedAsync,
  trackInitialBuildHandoffAsync,
  trackInitialBuildPostInteractionAsync,
  trackInitialBuildQuestionReceivedAsync,
  trackInitialBuildStartedAsync,
} from '../initial-build-funnel.js';
import { INITIAL_BUILD_ASYNC_EVENTS } from '../event-types.js';

const postMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../client.js', () => ({
  postAgentLifecycleEvent: (...args: unknown[]) => postMock(...args),
}));

describe('initial-build-funnel agent tracker', () => {
  beforeEach(() => {
    postMock.mockClear();
    mockMarkInitialBuildComplete.mockReset();
    resetInitialBuildFunnelStateForTests();
  });

  describe('persistInitialBuildCompleteAndEmit', () => {
    it('emits completed_async only when DB persist succeeds', () => {
      mockMarkInitialBuildComplete.mockReturnValue({
        id: 'app-1',
        initialBuildComplete: true,
      });

      expect(persistInitialBuildCompleteAndEmit('app-1')).toBe(true);
      expect(mockMarkInitialBuildComplete).toHaveBeenCalledWith('app-1');
      expect(postMock).toHaveBeenCalledWith('app-1', INITIAL_BUILD_ASYNC_EVENTS.completed);
    });

    it('does not emit when DB persist returns null', () => {
      mockMarkInitialBuildComplete.mockReturnValue(null);

      expect(persistInitialBuildCompleteAndEmit('app-1')).toBe(false);
      expect(postMock).not.toHaveBeenCalled();
    });
  });

  it('emits started once per app', () => {
    trackInitialBuildStartedAsync('app-1');
    trackInitialBuildStartedAsync('app-1');

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('app-1', INITIAL_BUILD_ASYNC_EVENTS.started);
  });

  it('emits question only after funnel is active', () => {
    trackInitialBuildQuestionReceivedAsync('app-1');
    expect(postMock).not.toHaveBeenCalled();

    trackInitialBuildStartedAsync('app-1');
    trackInitialBuildQuestionReceivedAsync('app-1');
    trackInitialBuildQuestionReceivedAsync('app-1');

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock).toHaveBeenNthCalledWith(2, 'app-1', INITIAL_BUILD_ASYNC_EVENTS.questionReceived);
  });

  it('emits handoff once when funnel is active', () => {
    trackInitialBuildStartedAsync('app-1');
    trackInitialBuildHandoffAsync('app-1');
    trackInitialBuildHandoffAsync('app-1');

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock).toHaveBeenNthCalledWith(2, 'app-1', INITIAL_BUILD_ASYNC_EVENTS.handoff);
  });

  it('emits completed and enables post interaction', () => {
    trackInitialBuildCompletedAsync('app-1');
    trackInitialBuildPostInteractionAsync('app-1');
    trackInitialBuildPostInteractionAsync('app-1');

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock).toHaveBeenNthCalledWith(1, 'app-1', INITIAL_BUILD_ASYNC_EVENTS.completed);
    expect(postMock).toHaveBeenNthCalledWith(2, 'app-1', INITIAL_BUILD_ASYNC_EVENTS.postInteraction);
  });

  it('allows post interaction when build was already complete before agent restart', () => {
    trackInitialBuildPostInteractionAsync('app-2', { buildAlreadyComplete: true });
    trackInitialBuildPostInteractionAsync('app-2', { buildAlreadyComplete: true });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('app-2', INITIAL_BUILD_ASYNC_EVENTS.postInteraction);
  });
});
