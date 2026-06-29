import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindById = vi.fn();
const mockHasAgentMessageWithCommitHash = vi.fn();
const mockPersistInitialBuildCompleteAndEmit = vi.fn();
const mockTrackInitialBuildPostInteractionAsync = vi.fn();
const mockIsInitialBuildCompleteInFunnel = vi.fn();
const mockIsPostInteractionEmittedInFunnel = vi.fn();

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () {
    return {
      findById: mockFindById,
    };
  }),
}));

vi.mock('../../../database/repositories/ConversationRepository.js', () => ({
  ConversationRepository: vi.fn().mockImplementation(function () {
    return {
      hasAgentMessageWithCommitHash: mockHasAgentMessageWithCommitHash,
    };
  }),
}));

vi.mock('../initial-build-funnel.js', () => ({
  isInitialBuildCompleteInFunnel: (...args: unknown[]) => mockIsInitialBuildCompleteInFunnel(...args),
  isPostInteractionEmittedInFunnel: (...args: unknown[]) => mockIsPostInteractionEmittedInFunnel(...args),
  persistInitialBuildCompleteAndEmit: (...args: unknown[]) => mockPersistInitialBuildCompleteAndEmit(...args),
  trackInitialBuildPostInteractionAsync: (...args: unknown[]) => mockTrackInitialBuildPostInteractionAsync(...args),
}));

import {
  healMissedInitialBuildComplete,
  trackPostInteractionIfEligible,
} from '../initial-build-post-interaction.js';

describe('initial-build-post-interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsInitialBuildCompleteInFunnel.mockReturnValue(false);
    mockIsPostInteractionEmittedInFunnel.mockReturnValue(false);
    mockPersistInitialBuildCompleteAndEmit.mockReturnValue(true);
  });

  describe('healMissedInitialBuildComplete', () => {
    it('returns true when app is already marked complete', async () => {
      mockFindById.mockReturnValue({ id: 'app-1', initialBuildComplete: true });

      const result = await healMissedInitialBuildComplete('app-1', 'conv-1');

      expect(result).toBe(true);
      expect(mockHasAgentMessageWithCommitHash).not.toHaveBeenCalled();
    });

    it('uses in-funnel completion when app row is missing (PaaS heal path)', async () => {
      mockFindById.mockReturnValue(null);
      mockIsInitialBuildCompleteInFunnel.mockReturnValue(true);

      const result = await healMissedInitialBuildComplete('app-1', 'conv-1');

      expect(result).toBe(true);
      expect(mockHasAgentMessageWithCommitHash).not.toHaveBeenCalled();
    });

    it('backfills DB and completed_async when prior agent message has commitHash', async () => {
      mockFindById.mockReturnValue({ id: 'app-1', initialBuildComplete: false });
      mockHasAgentMessageWithCommitHash.mockResolvedValue(true);

      const result = await healMissedInitialBuildComplete('app-1', 'conv-1');

      expect(result).toBe(true);
      expect(mockHasAgentMessageWithCommitHash).toHaveBeenCalledWith('conv-1');
      expect(mockPersistInitialBuildCompleteAndEmit).toHaveBeenCalledWith('app-1');
    });

    it('returns false when DB persist fails even with commitHash', async () => {
      mockFindById.mockReturnValue({ id: 'app-1', initialBuildComplete: false });
      mockHasAgentMessageWithCommitHash.mockResolvedValue(true);
      mockPersistInitialBuildCompleteAndEmit.mockReturnValue(false);

      const result = await healMissedInitialBuildComplete('app-1', 'conv-1');

      expect(result).toBe(false);
    });

    it('returns false when no prior commitHash exists', async () => {
      mockFindById.mockReturnValue({ id: 'app-1', initialBuildComplete: false });
      mockHasAgentMessageWithCommitHash.mockResolvedValue(false);

      const result = await healMissedInitialBuildComplete('app-1', 'conv-1');

      expect(result).toBe(false);
      expect(mockPersistInitialBuildCompleteAndEmit).not.toHaveBeenCalled();
    });
  });

  describe('trackPostInteractionIfEligible', () => {
    it('emits post_interaction when build is already marked complete', async () => {
      mockFindById.mockReturnValue({ id: 'app-1', initialBuildComplete: true });

      await trackPostInteractionIfEligible('app-1', 'conv-1');

      expect(mockTrackInitialBuildPostInteractionAsync).toHaveBeenCalledWith('app-1', {
        buildAlreadyComplete: true,
      });
      expect(mockHasAgentMessageWithCommitHash).not.toHaveBeenCalled();
    });

    it('heals missed completion then emits post_interaction', async () => {
      mockFindById.mockReturnValue({ id: 'app-1', initialBuildComplete: false });
      mockHasAgentMessageWithCommitHash.mockResolvedValue(true);

      await trackPostInteractionIfEligible('app-1', 'conv-1');

      expect(mockPersistInitialBuildCompleteAndEmit).toHaveBeenCalledWith('app-1');
      expect(mockTrackInitialBuildPostInteractionAsync).toHaveBeenCalledWith('app-1', {
        buildAlreadyComplete: true,
      });
    });

    it('does not emit when build is not complete', async () => {
      mockFindById.mockReturnValue({ id: 'app-1', initialBuildComplete: false });
      mockHasAgentMessageWithCommitHash.mockResolvedValue(false);

      await trackPostInteractionIfEligible('app-1', 'conv-1');

      expect(mockTrackInitialBuildPostInteractionAsync).not.toHaveBeenCalled();
    });

    it('skips DB and heal when post_interaction was already emitted in funnel', async () => {
      mockIsPostInteractionEmittedInFunnel.mockReturnValue(true);

      await trackPostInteractionIfEligible('app-1', 'conv-1');

      expect(mockFindById).not.toHaveBeenCalled();
      expect(mockHasAgentMessageWithCommitHash).not.toHaveBeenCalled();
      expect(mockTrackInitialBuildPostInteractionAsync).not.toHaveBeenCalled();
    });
  });
});
