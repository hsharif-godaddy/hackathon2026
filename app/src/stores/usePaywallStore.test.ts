import { beforeEach, describe, expect, it } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { act } from '@testing-library/react';

import { usePaywallStore } from './usePaywallStore';

describe('usePaywallStore', function usePaywallStoreTests() {
  beforeEach(function setup() {
    act(function reset() {
      usePaywallStore.setState({
        showCreditsModal: false,
        creditsModalSource: null,
        creditsModalItc: null,
        showUpgradeModal: false,
        upgradeModalSource: null,
        upgradeModalItc: null,
        paywallLoading: false,
      });
    });
  });

  describe('#openCreditsModal', function openCreditsModalTests() {
    it('should set showCreditsModal to true', function setShowCreditsModal() {
      act(function open() {
        usePaywallStore.getState().openCreditsModal('test-source');
      });

      const state = usePaywallStore.getState();
      expect(state.showCreditsModal).toBe(true);
    });

    it('should set creditsModalSource to provided source', function setCreditsModalSource() {
      act(function open() {
        usePaywallStore.getState().openCreditsModal('usage_gauge.buy_tokens');
      });

      const state = usePaywallStore.getState();
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
          usePaywallStore.getState().openCreditsModal(source);
        });

        const state = usePaywallStore.getState();
        expect(state.creditsModalSource).toBe(source);
        expect(state.showCreditsModal).toBe(true);

        act(function close() {
          usePaywallStore.getState().closeCreditsModal();
        });
      });
    });

    it('should not affect upgrade modal state', function notAffectUpgradeModal() {
      act(function setup() {
        usePaywallStore.setState({
          showUpgradeModal: false,
          upgradeModalSource: null,
        });
      });

      act(function open() {
        usePaywallStore.getState().openCreditsModal('test-source');
      });

      const state = usePaywallStore.getState();
      expect(state.showUpgradeModal).toBe(false);
      expect(state.upgradeModalSource).toBe(null);
    });

    it('should override existing credits modal state', function overrideExisting() {
      act(function setup() {
        usePaywallStore.setState({
          showCreditsModal: true,
          creditsModalSource: 'old-source',
        });
      });

      act(function open() {
        usePaywallStore.getState().openCreditsModal('new-source');
      });

      const state = usePaywallStore.getState();
      expect(state.showCreditsModal).toBe(true);
      expect(state.creditsModalSource).toBe('new-source');
    });
  });

  describe('#closeCreditsModal', function closeCreditsModalTests() {
    it('should set showCreditsModal to false', function setShowCreditsModalFalse() {
      act(function setup() {
        usePaywallStore.setState({
          showCreditsModal: true,
          creditsModalSource: 'test-source',
        });
      });

      act(function close() {
        usePaywallStore.getState().closeCreditsModal();
      });

      const state = usePaywallStore.getState();
      expect(state.showCreditsModal).toBe(false);
    });

    it('should clear creditsModalSource', function clearCreditsModalSource() {
      act(function setup() {
        usePaywallStore.setState({
          showCreditsModal: true,
          creditsModalSource: 'test-source',
        });
      });

      act(function close() {
        usePaywallStore.getState().closeCreditsModal();
      });

      const state = usePaywallStore.getState();
      expect(state.creditsModalSource).toBe(null);
    });

    it('should handle closing when modal is already closed', function closeWhenAlreadyClosed() {
      act(function setup() {
        usePaywallStore.setState({
          showCreditsModal: false,
          creditsModalSource: null,
        });
      });

      act(function close() {
        usePaywallStore.getState().closeCreditsModal();
      });

      const state = usePaywallStore.getState();
      expect(state.showCreditsModal).toBe(false);
      expect(state.creditsModalSource).toBe(null);
    });

    it('should not affect upgrade modal state', function notAffectUpgradeModal() {
      act(function setup() {
        usePaywallStore.setState({
          showCreditsModal: true,
          creditsModalSource: 'test-source',
          showUpgradeModal: true,
          upgradeModalSource: 'upgrade-source',
        });
      });

      act(function close() {
        usePaywallStore.getState().closeCreditsModal();
      });

      const state = usePaywallStore.getState();
      expect(state.showUpgradeModal).toBe(true);
      expect(state.upgradeModalSource).toBe('upgrade-source');
    });
  });

  describe('credits modal state management', function creditsModalStateTests() {
    it('should initialize with credits modal closed', function initialState() {
      const state = usePaywallStore.getState();
      expect(state.showCreditsModal).toBe(false);
      expect(state.creditsModalSource).toBe(null);
    });

    it('should handle open and close cycle', function openCloseCycle() {
      act(function open() {
        usePaywallStore.getState().openCreditsModal('test-source');
      });

      let state = usePaywallStore.getState();
      expect(state.showCreditsModal).toBe(true);
      expect(state.creditsModalSource).toBe('test-source');

      act(function close() {
        usePaywallStore.getState().closeCreditsModal();
      });

      state = usePaywallStore.getState();
      expect(state.showCreditsModal).toBe(false);
      expect(state.creditsModalSource).toBe(null);
    });

    it('should handle multiple open/close operations', function multipleOperations() {
      const sources = ['source-1', 'source-2', 'source-3'];

      sources.forEach(function testSource(source) {
        act(function open() {
          usePaywallStore.getState().openCreditsModal(source);
        });

        let state = usePaywallStore.getState();
        expect(state.showCreditsModal).toBe(true);
        expect(state.creditsModalSource).toBe(source);

        act(function close() {
          usePaywallStore.getState().closeCreditsModal();
        });

        state = usePaywallStore.getState();
        expect(state.showCreditsModal).toBe(false);
        expect(state.creditsModalSource).toBe(null);
      });
    });

    it('should block credits modal when paywallLoading is true from upgrade', function blockedByUpgrade() {
      act(function setup() {
        usePaywallStore.getState().openUpgradeModal('upgrade-source');
      });

      act(function openCredits() {
        usePaywallStore.getState().openCreditsModal('credits-source');
      });

      const state = usePaywallStore.getState();
      expect(state.showCreditsModal).toBe(false);
      expect(state.creditsModalSource).toBe(null);
      expect(state.showUpgradeModal).toBe(true);
      expect(state.upgradeModalSource).toBe('upgrade-source');
    });
  });

  describe('paywallLoading state', function paywallLoadingTests() {
    it('should set paywallLoading true when openUpgradeModal is called', function openSetsLoading() {
      act(function open() {
        usePaywallStore.getState().openUpgradeModal('test-source');
      });

      const state = usePaywallStore.getState();
      expect(state.paywallLoading).toBe(true);
    });

    it('should set paywallLoading false when closeUpgradeModal is called', function closeClearsLoading() {
      act(function setup() {
        usePaywallStore.setState({ paywallLoading: true, showUpgradeModal: true });
      });

      act(function close() {
        usePaywallStore.getState().closeUpgradeModal();
      });

      const state = usePaywallStore.getState();
      expect(state.paywallLoading).toBe(false);
    });

    it('should allow explicit paywallLoading control via setPaywallLoading', function explicitControl() {
      act(function setTrue() {
        usePaywallStore.getState().setPaywallLoading(true);
      });
      expect(usePaywallStore.getState().paywallLoading).toBe(true);

      act(function setFalse() {
        usePaywallStore.getState().setPaywallLoading(false);
      });
      expect(usePaywallStore.getState().paywallLoading).toBe(false);
    });

    it('should no-op openUpgradeModal when paywallLoading is already true', function guardWhenLoading() {
      act(function setup() {
        usePaywallStore.setState({
          paywallLoading: true,
          showUpgradeModal: true,
          upgradeModalSource: 'original-source',
          upgradeModalItc: 'original-itc',
        });
      });

      act(function tryReopen() {
        usePaywallStore.getState().openUpgradeModal('new-source', 'new-itc');
      });

      const state = usePaywallStore.getState();
      expect(state.upgradeModalSource).toBe('original-source');
      expect(state.upgradeModalItc).toBe('original-itc');
    });
  });

});
