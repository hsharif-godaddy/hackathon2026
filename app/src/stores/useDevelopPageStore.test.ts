import { beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';

import { useDevelopPageStore } from './useDevelopPageStore';

describe('useDevelopPageStore', function useDevelopPageStoreTests() {
  beforeEach(function setup() {
    act(function reset() {
      useDevelopPageStore.setState({
        showCreditsModal: false,
        creditsModalSource: null,
        showUpgradeModal: false,
        upgradeModalSource: null,
      });
    });
  });

  describe('#openCreditsModal', function openCreditsModalTests() {
    it('should set showCreditsModal to true', function setShowCreditsModal() {
      act(function open() {
        useDevelopPageStore.getState().openCreditsModal('test-source');
      });

      const state = useDevelopPageStore.getState();
      expect(state.showCreditsModal).toBe(true);
    });

    it('should set creditsModalSource to provided source', function setCreditsModalSource() {
      act(function open() {
        useDevelopPageStore.getState().openCreditsModal('usage_gauge.buy_tokens');
      });

      const state = useDevelopPageStore.getState();
      expect(state.creditsModalSource).toBe('usage_gauge.buy_tokens');
    });

    it('should handle different source values', function differentSources() {
      const sources = [
        'usage_gauge.buy_tokens',
        'manage_plan.buy_credits',
        'streaming_response.upgrade',
        'custom-source',
      ];

      sources.forEach(function testSource(source) {
        act(function open() {
          useDevelopPageStore.getState().openCreditsModal(source);
        });

        const state = useDevelopPageStore.getState();
        expect(state.creditsModalSource).toBe(source);
        expect(state.showCreditsModal).toBe(true);

        act(function close() {
          useDevelopPageStore.getState().closeCreditsModal();
        });
      });
    });

    it('should not affect upgrade modal state', function notAffectUpgradeModal() {
      act(function setup() {
        useDevelopPageStore.setState({
          showUpgradeModal: false,
          upgradeModalSource: null,
        });
      });

      act(function open() {
        useDevelopPageStore.getState().openCreditsModal('test-source');
      });

      const state = useDevelopPageStore.getState();
      expect(state.showUpgradeModal).toBe(false);
      expect(state.upgradeModalSource).toBe(null);
    });

    it('should override existing credits modal state', function overrideExisting() {
      act(function setup() {
        useDevelopPageStore.setState({
          showCreditsModal: true,
          creditsModalSource: 'old-source',
        });
      });

      act(function open() {
        useDevelopPageStore.getState().openCreditsModal('new-source');
      });

      const state = useDevelopPageStore.getState();
      expect(state.showCreditsModal).toBe(true);
      expect(state.creditsModalSource).toBe('new-source');
    });
  });

  describe('#closeCreditsModal', function closeCreditsModalTests() {
    it('should set showCreditsModal to false', function setShowCreditsModalFalse() {
      act(function setup() {
        useDevelopPageStore.setState({
          showCreditsModal: true,
          creditsModalSource: 'test-source',
        });
      });

      act(function close() {
        useDevelopPageStore.getState().closeCreditsModal();
      });

      const state = useDevelopPageStore.getState();
      expect(state.showCreditsModal).toBe(false);
    });

    it('should clear creditsModalSource', function clearCreditsModalSource() {
      act(function setup() {
        useDevelopPageStore.setState({
          showCreditsModal: true,
          creditsModalSource: 'test-source',
        });
      });

      act(function close() {
        useDevelopPageStore.getState().closeCreditsModal();
      });

      const state = useDevelopPageStore.getState();
      expect(state.creditsModalSource).toBe(null);
    });

    it('should handle closing when modal is already closed', function closeWhenAlreadyClosed() {
      act(function setup() {
        useDevelopPageStore.setState({
          showCreditsModal: false,
          creditsModalSource: null,
        });
      });

      act(function close() {
        useDevelopPageStore.getState().closeCreditsModal();
      });

      const state = useDevelopPageStore.getState();
      expect(state.showCreditsModal).toBe(false);
      expect(state.creditsModalSource).toBe(null);
    });

    it('should not affect upgrade modal state', function notAffectUpgradeModal() {
      act(function setup() {
        useDevelopPageStore.setState({
          showCreditsModal: true,
          creditsModalSource: 'test-source',
          showUpgradeModal: true,
          upgradeModalSource: 'upgrade-source',
        });
      });

      act(function close() {
        useDevelopPageStore.getState().closeCreditsModal();
      });

      const state = useDevelopPageStore.getState();
      expect(state.showUpgradeModal).toBe(true);
      expect(state.upgradeModalSource).toBe('upgrade-source');
    });
  });

  describe('credits modal state management', function creditsModalStateTests() {
    it('should initialize with credits modal closed', function initialState() {
      const state = useDevelopPageStore.getState();
      expect(state.showCreditsModal).toBe(false);
      expect(state.creditsModalSource).toBe(null);
    });

    it('should handle open and close cycle', function openCloseCycle() {
      act(function open() {
        useDevelopPageStore.getState().openCreditsModal('test-source');
      });

      let state = useDevelopPageStore.getState();
      expect(state.showCreditsModal).toBe(true);
      expect(state.creditsModalSource).toBe('test-source');

      act(function close() {
        useDevelopPageStore.getState().closeCreditsModal();
      });

      state = useDevelopPageStore.getState();
      expect(state.showCreditsModal).toBe(false);
      expect(state.creditsModalSource).toBe(null);
    });

    it('should handle multiple open/close operations', function multipleOperations() {
      const sources = ['source-1', 'source-2', 'source-3'];

      sources.forEach(function testSource(source) {
        act(function open() {
          useDevelopPageStore.getState().openCreditsModal(source);
        });

        let state = useDevelopPageStore.getState();
        expect(state.showCreditsModal).toBe(true);
        expect(state.creditsModalSource).toBe(source);

        act(function close() {
          useDevelopPageStore.getState().closeCreditsModal();
        });

        state = useDevelopPageStore.getState();
        expect(state.showCreditsModal).toBe(false);
        expect(state.creditsModalSource).toBe(null);
      });
    });

    it('should maintain independence from upgrade modal', function independenceFromUpgrade() {
      act(function setup() {
        useDevelopPageStore.getState().openUpgradeModal('upgrade-source');
      });

      act(function openCredits() {
        useDevelopPageStore.getState().openCreditsModal('credits-source');
      });

      let state = useDevelopPageStore.getState();
      expect(state.showCreditsModal).toBe(true);
      expect(state.creditsModalSource).toBe('credits-source');
      expect(state.showUpgradeModal).toBe(true);
      expect(state.upgradeModalSource).toBe('upgrade-source');

      act(function closeCredits() {
        useDevelopPageStore.getState().closeCreditsModal();
      });

      state = useDevelopPageStore.getState();
      expect(state.showCreditsModal).toBe(false);
      expect(state.creditsModalSource).toBe(null);
      expect(state.showUpgradeModal).toBe(true);
      expect(state.upgradeModalSource).toBe('upgrade-source');
    });
  });
});
