import { beforeEach, describe, expect, it } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { act } from '@testing-library/react';

import { ChatTab, SettingsSection } from '@/app/develop/components/types';
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

  describe('WIDE_SETTINGS_SECTIONS chat pane width behavior', function widePanelTests() {
    const DEFAULT_CHAT_PANE_WIDTH = 415;
    const WIDE_CHAT_PANE_WIDTH = 616; // 640 - 24

    // Wide sections: BACKUPS, DATABASE, DOMAIN, MARKETING, SECRETS (ANALYTICS is now a ChatTab)
    const wideSections = [
      SettingsSection.BACKUPS,
      SettingsSection.DATABASE,
      SettingsSection.DOMAIN,
      SettingsSection.MARKETING,
      SettingsSection.SECRETS,
    ];

    // Wide chat tabs
    const wideChatTabs = [
      ChatTab.ANALYTICS,
    ];

    // Non-wide sections
    const nonWideSections = [
      SettingsSection.PROJECT,
      SettingsSection.SECURITY,
      SettingsSection.SHARE,
      SettingsSection.TEAM,
    ];

    beforeEach(function resetState() {
      act(function reset() {
        useDevelopPageStore.setState({
          activeChatTab: ChatTab.CHAT,
          activeSettingsSection: SettingsSection.DOMAIN,
          chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
          originalChatPaneWidth: null,
        });
      });
    });

    describe('entering settings tab', function enteringSettingsTests() {
      it('should widen chat pane when entering settings with a wide section', function widenOnEnterWide() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.CHAT,
            activeSettingsSection: SettingsSection.DATABASE, // wide section
            chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
            originalChatPaneWidth: null,
          });
        });

        act(function enterSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.SETTINGS);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
      });

      it('should preserve original width when widening', function preserveOriginal() {
        const customWidth = 500;

        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.CHAT,
            activeSettingsSection: SettingsSection.SECRETS, // wide section
            chatPaneWidth: customWidth,
            originalChatPaneWidth: null,
          });
        });

        act(function enterSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.SETTINGS);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(customWidth);
      });

      it('should not change width when entering settings with non-wide section', function noChangeNonWide() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.CHAT,
            activeSettingsSection: SettingsSection.PROJECT, // non-wide section
            chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
            originalChatPaneWidth: null,
          });
        });

        act(function enterSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.SETTINGS);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(null);
      });

      wideSections.forEach(function testWideSection(section) {
        it(`should widen chat pane for ${section} section`, function widenForSection() {
          act(function setup() {
            useDevelopPageStore.setState({
              activeChatTab: ChatTab.CHAT,
              activeSettingsSection: section,
              chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
              originalChatPaneWidth: null,
            });
          });

          act(function enterSettings() {
            useDevelopPageStore.getState().setActiveChatTab(ChatTab.SETTINGS);
          });

          const state = useDevelopPageStore.getState();
          expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
          expect(state.originalChatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
        });
      });

      nonWideSections.forEach(function testNonWideSection(section) {
        it(`should not widen chat pane for ${section} section`, function noWidenForSection() {
          act(function setup() {
            useDevelopPageStore.setState({
              activeChatTab: ChatTab.CHAT,
              activeSettingsSection: section,
              chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
              originalChatPaneWidth: null,
            });
          });

          act(function enterSettings() {
            useDevelopPageStore.getState().setActiveChatTab(ChatTab.SETTINGS);
          });

          const state = useDevelopPageStore.getState();
          expect(state.chatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
          expect(state.originalChatPaneWidth).toBe(null);
        });
      });
    });

    describe('leaving settings tab', function leavingSettingsTests() {
      it('should restore original width when leaving wide section', function restoreWidth() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.SETTINGS,
            activeSettingsSection: SettingsSection.DATABASE,
            chatPaneWidth: WIDE_CHAT_PANE_WIDTH,
            originalChatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
          });
        });

        act(function leaveSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.CHAT);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(null);
      });

      it('should restore custom width when leaving wide section', function restoreCustom() {
        const customWidth = 500;

        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.SETTINGS,
            activeSettingsSection: SettingsSection.SECRETS,
            chatPaneWidth: WIDE_CHAT_PANE_WIDTH,
            originalChatPaneWidth: customWidth,
          });
        });

        act(function leaveSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.CHAT);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(customWidth);
        expect(state.originalChatPaneWidth).toBe(null);
      });

      it('should not change width when leaving non-wide section', function noChangeNonWide() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.SETTINGS,
            activeSettingsSection: SettingsSection.PROJECT,
            chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
            originalChatPaneWidth: null,
          });
        });

        act(function leaveSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.CHAT);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(null);
      });

      it('should not restore width when originalChatPaneWidth is null', function noRestoreNull() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.SETTINGS,
            activeSettingsSection: SettingsSection.DATABASE,
            chatPaneWidth: WIDE_CHAT_PANE_WIDTH,
            originalChatPaneWidth: null,
          });
        });

        act(function leaveSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.CHAT);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(null);
      });
    });

    describe('switching settings sections', function switchingSectionsTests() {
      it('should widen when switching from non-wide to wide section', function widenOnSwitch() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.SETTINGS,
            activeSettingsSection: SettingsSection.PROJECT, // non-wide
            chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
            originalChatPaneWidth: null,
          });
        });

        act(function switchToWide() {
          useDevelopPageStore.getState().setActiveSettingsSection(SettingsSection.DATABASE); // wide
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
      });

      it('should restore width when switching from wide to non-wide section', function restoreOnSwitch() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.SETTINGS,
            activeSettingsSection: SettingsSection.DATABASE, // wide
            chatPaneWidth: WIDE_CHAT_PANE_WIDTH,
            originalChatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
          });
        });

        act(function switchToNonWide() {
          useDevelopPageStore.getState().setActiveSettingsSection(SettingsSection.SECURITY); // non-wide
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(null);
      });

      it('should maintain wide width when switching between wide sections', function maintainWide() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.SETTINGS,
            activeSettingsSection: SettingsSection.DATABASE, // wide
            chatPaneWidth: WIDE_CHAT_PANE_WIDTH,
            originalChatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
          });
        });

        act(function switchWide() {
          useDevelopPageStore.getState().setActiveSettingsSection(SettingsSection.SECRETS); // also wide
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
      });

      it('should maintain narrow width when switching between non-wide sections', function maintainNarrow() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.SETTINGS,
            activeSettingsSection: SettingsSection.PROJECT, // non-wide
            chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
            originalChatPaneWidth: null,
          });
        });

        act(function switchNonWide() {
          useDevelopPageStore.getState().setActiveSettingsSection(SettingsSection.SECURITY); // also non-wide
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(null);
      });

      it('should not change width when switching sections outside settings tab', function noChangeOutsideSettings() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.CHAT,
            activeSettingsSection: SettingsSection.DOMAIN,
            chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
            originalChatPaneWidth: null,
          });
        });

        act(function switchSection() {
          useDevelopPageStore.getState().setActiveSettingsSection(SettingsSection.DATABASE); // wide
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(null);
      });
    });

    describe('edge cases', function edgeCaseTests() {
      it('should handle multiple transitions correctly', function multipleTransitions() {
        // Start in chat tab
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.CHAT,
            activeSettingsSection: SettingsSection.DATABASE,
            chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
            originalChatPaneWidth: null,
          });
        });

        // Enter settings (should widen)
        act(function enterSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.SETTINGS);
        });

        let state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);

        // Switch to non-wide section (should restore)
        act(function switchToNonWide() {
          useDevelopPageStore.getState().setActiveSettingsSection(SettingsSection.PROJECT);
        });

        state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(null);

        // Switch to wide section (should widen again)
        act(function switchToWide() {
          useDevelopPageStore.getState().setActiveSettingsSection(SettingsSection.DATABASE);
        });

        state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);

        // Leave settings (should restore)
        act(function leaveSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.CHAT);
        });

        state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(null);
      });

      it('should handle entering settings when already wide from previous visit', function alreadyWide() {
        // Simulate being in settings with wide section, then leaving without restoring
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.CHAT,
            activeSettingsSection: SettingsSection.DATABASE,
            chatPaneWidth: WIDE_CHAT_PANE_WIDTH,
            originalChatPaneWidth: null, // Already null as if restored
          });
        });

        // Enter settings again (should set new originalChatPaneWidth)
        act(function enterSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.SETTINGS);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH); // Saved the current width
      });

      it('should not overwrite originalChatPaneWidth if already set', function noOverwrite() {
        const customWidth = 500;

        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.SETTINGS,
            activeSettingsSection: SettingsSection.DATABASE,
            chatPaneWidth: WIDE_CHAT_PANE_WIDTH,
            originalChatPaneWidth: customWidth,
          });
        });

        // Switch to another wide section (should keep same originalChatPaneWidth)
        act(function switchWide() {
          useDevelopPageStore.getState().setActiveSettingsSection(SettingsSection.MARKETING);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(customWidth); // Preserved
      });

      it('should handle rapid tab switches correctly', function rapidSwitches() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.CHAT,
            activeSettingsSection: SettingsSection.DATABASE,
            chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
            originalChatPaneWidth: null,
          });
        });

        // Enter settings, leave, enter again
        act(function rapidChanges() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.SETTINGS);
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.CHAT);
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.SETTINGS);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
      });
    });

    describe('wide chat tabs', function wideChatTabTests() {
      wideChatTabs.forEach(function testWideChatTab(tab) {
        it(`should widen chat pane when entering ${tab} tab`, function widenOnEnter() {
          act(function setup() {
            useDevelopPageStore.setState({
              activeChatTab: ChatTab.CHAT,
              chatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
              originalChatPaneWidth: null,
            });
          });

          act(function enterWideTab() {
            useDevelopPageStore.getState().setActiveChatTab(tab);
          });

          const state = useDevelopPageStore.getState();
          expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
          expect(state.originalChatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
        });

        it(`should restore width when leaving ${tab} tab`, function restoreOnLeave() {
          act(function setup() {
            useDevelopPageStore.setState({
              activeChatTab: tab,
              chatPaneWidth: WIDE_CHAT_PANE_WIDTH,
              originalChatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
            });
          });

          act(function leaveWideTab() {
            useDevelopPageStore.getState().setActiveChatTab(ChatTab.CHAT);
          });

          const state = useDevelopPageStore.getState();
          expect(state.chatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
          expect(state.originalChatPaneWidth).toBe(null);
        });
      });

      it('should maintain wide width when switching from Analytics to wide Settings section', function analyticsToWideSettings() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.ANALYTICS,
            activeSettingsSection: SettingsSection.DATABASE,
            chatPaneWidth: WIDE_CHAT_PANE_WIDTH,
            originalChatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
          });
        });

        act(function switchToSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.SETTINGS);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(WIDE_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
      });

      it('should restore width when switching from Analytics to non-wide Settings section', function analyticsToNonWideSettings() {
        act(function setup() {
          useDevelopPageStore.setState({
            activeChatTab: ChatTab.ANALYTICS,
            activeSettingsSection: SettingsSection.PROJECT, // non-wide section
            chatPaneWidth: WIDE_CHAT_PANE_WIDTH,
            originalChatPaneWidth: DEFAULT_CHAT_PANE_WIDTH,
          });
        });

        act(function switchToSettings() {
          useDevelopPageStore.getState().setActiveChatTab(ChatTab.SETTINGS);
        });

        const state = useDevelopPageStore.getState();
        expect(state.chatPaneWidth).toBe(DEFAULT_CHAT_PANE_WIDTH);
        expect(state.originalChatPaneWidth).toBe(null);
      });
    });
  });

  describe('#selectedModel', function selectedModelTests() {
    it('should default to null', function defaultsNull() {
      expect(useDevelopPageStore.getState().selectedModel).toBeNull();
    });

    it('should update via setSelectedModel', function setsModel() {
      act(function select() {
        useDevelopPageStore.getState().setSelectedModel('claude-sonnet-4-5');
      });

      expect(useDevelopPageStore.getState().selectedModel).toBe('claude-sonnet-4-5');
    });

    it('should clear selection via setSelectedModel(null)', function clearsModel() {
      act(function select() {
        useDevelopPageStore.getState().setSelectedModel('claude-sonnet-4-5');
      });
      act(function clear() {
        useDevelopPageStore.getState().setSelectedModel(null);
      });

      expect(useDevelopPageStore.getState().selectedModel).toBeNull();
    });

    it('should reset selectedModel on resetForNewApp', function resetsOnAppSwitch() {
      act(function select() {
        useDevelopPageStore.getState().setSelectedModel('claude-sonnet-4-5');
      });
      act(function reset() {
        useDevelopPageStore.getState().resetForNewApp('new-app-id');
      });

      expect(useDevelopPageStore.getState().selectedModel).toBeNull();
    });
  });
});
