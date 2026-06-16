import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { act } from '@testing-library/react';

import { ChatTab, MobileMode, SettingsSection, ViewMode } from '@/app/[market]/develop/components/types';
import * as postMessageModule from '@/utils/postMessage';
import { useDevelopPageStore } from './useDevelopPageStore';

describe('useDevelopPageStore', function useDevelopPageStoreTests() {
  beforeEach(function setup() {
    act(function reset() {
      useDevelopPageStore.getState().dismissResponseFeedbackThanksBanner();
      useDevelopPageStore.setState({
        showResponseFeedbackThanksBanner: false,
      });
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

  describe('#setIsMobile', function setIsMobileTests() {
    beforeEach(function resetMobileLayout() {
      act(function reset() {
        useDevelopPageStore.setState({
          isMobile: false,
          mobileMode: MobileMode.TOOLS,
          viewMode: ViewMode.PREVIEW,
          isEditModeEnabled: false,
        });
      });
    });

    it('should coerce edit to preview when crossing to mobile breakpoint', function resizeToMobileFromEdit() {
      act(function setup() {
        useDevelopPageStore.setState({
          isMobile: false,
          mobileMode: MobileMode.TOOLS,
          viewMode: ViewMode.EDIT,
          isEditModeEnabled: true,
        });
      });

      act(function resizeToMobile() {
        useDevelopPageStore.getState().setIsMobile(true);
      });

      const state = useDevelopPageStore.getState();
      expect(state.isMobile).toBe(true);
      expect(state.mobileMode).toBe(MobileMode.TOOLS);
      expect(state.viewMode).toBe(ViewMode.PREVIEW);
      expect(state.isEditModeEnabled).toBe(false);
    });

    it('should keep code when crossing to mobile breakpoint', function resizeToMobileFromCode() {
      act(function setup() {
        useDevelopPageStore.setState({
          isMobile: false,
          mobileMode: MobileMode.TOOLS,
          viewMode: ViewMode.CODE,
          isEditModeEnabled: false,
        });
      });

      act(function resizeToMobile() {
        useDevelopPageStore.getState().setIsMobile(true);
      });

      const state = useDevelopPageStore.getState();
      expect(state.isMobile).toBe(true);
      expect(state.viewMode).toBe(ViewMode.CODE);
      expect(state.mobileMode).toBe(MobileMode.TOOLS);
    });

    it('should keep preview when crossing to mobile breakpoint', function resizeToMobileFromPreview() {
      act(function setup() {
        useDevelopPageStore.setState({
          isMobile: false,
          mobileMode: MobileMode.TOOLS,
          viewMode: ViewMode.PREVIEW,
          isEditModeEnabled: false,
        });
      });

      act(function resizeToMobile() {
        useDevelopPageStore.getState().setIsMobile(true);
      });

      const state = useDevelopPageStore.getState();
      expect(state.isMobile).toBe(true);
      expect(state.viewMode).toBe(ViewMode.PREVIEW);
      expect(state.mobileMode).toBe(MobileMode.TOOLS);
    });

    it('should not coerce view when setIsMobile(true) if already mobile', function noCoerceWhenAlreadyMobile() {
      act(function setup() {
        useDevelopPageStore.setState({
          isMobile: true,
          mobileMode: MobileMode.TOOLS,
          viewMode: ViewMode.PREVIEW,
          isEditModeEnabled: false,
        });
      });

      act(function noop() {
        useDevelopPageStore.getState().setIsMobile(true);
      });

      const state = useDevelopPageStore.getState();
      expect(state.isMobile).toBe(true);
      expect(state.viewMode).toBe(ViewMode.PREVIEW);
      expect(state.mobileMode).toBe(MobileMode.TOOLS);
    });

    it('should set chat pane width to 400 when leaving mobile for desktop', function resizeToDesktop() {
      act(function setup() {
        useDevelopPageStore.setState({
          isMobile: true,
          chatPaneWidth: 500,
        });
      });

      act(function resizeToDesktopWidth() {
        useDevelopPageStore.getState().setIsMobile(false);
      });

      const state = useDevelopPageStore.getState();
      expect(state.isMobile).toBe(false);
      expect(state.chatPaneWidth).toBe(400);
    });
  });

  describe('#handleMobileModeChange', function handleMobileModeChangeTests() {
    beforeEach(function resetHandleMobileLayout() {
      act(function reset() {
        useDevelopPageStore.setState({
          viewMode: ViewMode.PREVIEW,
          mobileMode: MobileMode.TOOLS,
          isEditModeEnabled: false,
        });
      });
    });

    it('should set view to preview and disable edit mode when entering mobile preview from edit', function syncEditToPreview() {
      act(function setup() {
        useDevelopPageStore.setState({
          viewMode: ViewMode.EDIT,
          isEditModeEnabled: true,
          mobileMode: MobileMode.TOOLS,
        });
      });

      act(function enterMobilePreview() {
        useDevelopPageStore.getState().handleMobileModeChange(MobileMode.PREVIEW);
      });

      const state = useDevelopPageStore.getState();
      expect(state.mobileMode).toBe(MobileMode.PREVIEW);
      expect(state.viewMode).toBe(ViewMode.PREVIEW);
      expect(state.isEditModeEnabled).toBe(false);
    });

    it('should not change viewMode when entering mobile preview from code', function keepCodeViewMode() {
      act(function setup() {
        useDevelopPageStore.setState({
          viewMode: ViewMode.CODE,
          isEditModeEnabled: false,
          mobileMode: MobileMode.TOOLS,
        });
      });

      act(function enterMobilePreview() {
        useDevelopPageStore.getState().handleMobileModeChange(MobileMode.PREVIEW);
      });

      const state = useDevelopPageStore.getState();
      expect(state.mobileMode).toBe(MobileMode.PREVIEW);
      expect(state.viewMode).toBe(ViewMode.CODE);
      expect(state.isEditModeEnabled).toBe(false);
    });

    it('should not run view sync when mobile preview from preview', function previewFromPreviewNoPostMessage() {
      const postMessageSpy = vi.spyOn(postMessageModule, 'postMessageToIframe');
      try {
        act(function setup() {
          useDevelopPageStore.setState({
            viewMode: ViewMode.PREVIEW,
            isEditModeEnabled: false,
            mobileMode: MobileMode.TOOLS,
          });
        });

        act(function enterMobilePreview() {
          useDevelopPageStore.getState().handleMobileModeChange(MobileMode.PREVIEW);
        });

        expect(postMessageSpy).not.toHaveBeenCalled();
      } finally {
        postMessageSpy.mockRestore();
      }
    });

    it('should update mobileMode only when switching to tools', function toolsDoesNotChangeViewMode() {
      act(function setup() {
        useDevelopPageStore.setState({
          mobileMode: MobileMode.PREVIEW,
          viewMode: ViewMode.PREVIEW,
        });
      });

      act(function switchToTools() {
        useDevelopPageStore.getState().handleMobileModeChange(MobileMode.TOOLS);
      });

      const state = useDevelopPageStore.getState();
      expect(state.mobileMode).toBe(MobileMode.TOOLS);
      expect(state.viewMode).toBe(ViewMode.PREVIEW);
      expect(state.isEditModeEnabled).toBe(false);
    });
  });

  describe('#setIsVersionHistoryOpen', function setIsVersionHistoryOpenTests() {
    beforeEach(function resetVersionHistoryState() {
      act(function reset() {
        useDevelopPageStore.setState({
          isVersionHistoryOpen: false,
          viewMode: ViewMode.PREVIEW,
          isEditModeEnabled: false,
        });
      });
    });

    it('should force viewMode to PREVIEW and disable edit mode when opening history from edit', function lockToPreviewFromEdit() {
      act(function setup() {
        useDevelopPageStore.setState({
          viewMode: ViewMode.EDIT,
          isEditModeEnabled: true,
        });
      });

      act(function openHistory() {
        useDevelopPageStore.getState().setIsVersionHistoryOpen(true);
      });

      const state = useDevelopPageStore.getState();
      expect(state.isVersionHistoryOpen).toBe(true);
      expect(state.viewMode).toBe(ViewMode.PREVIEW);
      expect(state.isEditModeEnabled).toBe(false);
    });

    it('should not change viewMode when opening history from preview', function keepPreview() {
      act(function openHistory() {
        useDevelopPageStore.getState().setIsVersionHistoryOpen(true);
      });

      const state = useDevelopPageStore.getState();
      expect(state.isVersionHistoryOpen).toBe(true);
      expect(state.viewMode).toBe(ViewMode.PREVIEW);
    });

    it('should not change viewMode when closing history', function closeHistoryNoSwitch() {
      act(function setup() {
        useDevelopPageStore.setState({
          isVersionHistoryOpen: true,
          viewMode: ViewMode.PREVIEW,
        });
      });

      act(function closeHistory() {
        useDevelopPageStore.getState().setIsVersionHistoryOpen(false);
      });

      const state = useDevelopPageStore.getState();
      expect(state.isVersionHistoryOpen).toBe(false);
      expect(state.viewMode).toBe(ViewMode.PREVIEW);
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

    it('should rehydrate selectedModel from the per-app map on resetForNewApp (null when no saved entry)', function rehydratesOnAppSwitch() {
      act(function select() {
        useDevelopPageStore.getState().setSelectedModel('claude-sonnet-4-5');
      });
      act(function reset() {
        useDevelopPageStore.getState().resetForNewApp('new-app-id');
      });

      expect(useDevelopPageStore.getState().selectedModel).toBeNull();
    });
  });

  describe('#model persistence per app', function modelPersistenceTests() {
    beforeEach(function clearPersistedModels() {
      act(function reset() {
        useDevelopPageStore.setState({
          currentAppId: null,
          selectedModel: null,
          modelByAppId: {},
        });
      });
    });

    it('restores the persisted model when the same app is re-initialized', function restoresOnReload() {
      act(function loadApp() {
        useDevelopPageStore.getState().resetForNewApp('app-1');
      });
      act(function select() {
        useDevelopPageStore.getState().setSelectedModel('claude-sonnet-4-5');
      });

      // Simulate a reload: the live selection is cleared, but initializePage
      // re-runs resetForNewApp for the same app.
      act(function clearLive() {
        useDevelopPageStore.setState({ selectedModel: null });
      });
      act(function reinitialize() {
        useDevelopPageStore.getState().resetForNewApp('app-1');
      });

      expect(useDevelopPageStore.getState().selectedModel).toBe('claude-sonnet-4-5');
    });

    it('does not leak the model selection across apps', function noCrossAppLeak() {
      act(function loadApp1() {
        useDevelopPageStore.getState().resetForNewApp('app-1');
      });
      act(function selectForApp1() {
        useDevelopPageStore.getState().setSelectedModel('model-1');
      });

      act(function switchToApp2() {
        useDevelopPageStore.getState().resetForNewApp('app-2');
      });
      expect(useDevelopPageStore.getState().selectedModel).toBeNull();

      act(function selectForApp2() {
        useDevelopPageStore.getState().setSelectedModel('model-2');
      });

      act(function backToApp1() {
        useDevelopPageStore.getState().resetForNewApp('app-1');
      });
      expect(useDevelopPageStore.getState().selectedModel).toBe('model-1');

      act(function backToApp2() {
        useDevelopPageStore.getState().resetForNewApp('app-2');
      });
      expect(useDevelopPageStore.getState().selectedModel).toBe('model-2');
    });

    it('clears the persisted entry when the model is reset to default', function clearPersists() {
      act(function loadApp() {
        useDevelopPageStore.getState().resetForNewApp('app-1');
      });
      act(function select() {
        useDevelopPageStore.getState().setSelectedModel('claude-sonnet-4-5');
      });
      expect(useDevelopPageStore.getState().modelByAppId).toEqual({ 'app-1': 'claude-sonnet-4-5' });

      act(function clear() {
        useDevelopPageStore.getState().setSelectedModel(null);
      });
      expect(useDevelopPageStore.getState().modelByAppId).toEqual({});

      act(function reinitialize() {
        useDevelopPageStore.getState().resetForNewApp('app-1');
      });
      expect(useDevelopPageStore.getState().selectedModel).toBeNull();
    });

    it('does not persist a selection made before an app is loaded', function noOpWithoutApp() {
      // currentAppId is null — no app loaded yet.
      act(function select() {
        useDevelopPageStore.getState().setSelectedModel('claude-sonnet-4-5');
      });

      expect(useDevelopPageStore.getState().modelByAppId).toEqual({});
    });
  });

  describe('#openFeedbackModal', function openFeedbackModalTests() {
    beforeEach(function clearFeedbackState() {
      localStorage.clear();
      act(function reset() {
        useDevelopPageStore.setState({
          openFeedbackId: null,
          feedbackOrigin: null,
          feedbackInitialStep: null,
        });
      });
    });

    it('should set feedback state including initialStep', function setsFeedbackState() {
      act(function open() {
        useDevelopPageStore.getState().openFeedbackModal('airo#app-builder', 'Session feedback', 'feedback');
      });

      const state = useDevelopPageStore.getState();
      expect(state.openFeedbackId).toBe('airo#app-builder');
      expect(state.feedbackOrigin).toBe('Session feedback');
      expect(state.feedbackInitialStep).toBe('feedback');
    });

    it('should default feedbackInitialStep to null when not provided', function defaultsToNull() {
      act(function open() {
        useDevelopPageStore.getState().openFeedbackModal('airo#app-builder', 'Settings');
      });

      expect(useDevelopPageStore.getState().feedbackInitialStep).toBeNull();
    });

    it('should not open if localStorage guard is set', function guardsAgainstReopen() {
      localStorage.setItem('airo-feedback-shown:airo#app-builder', 'true');

      act(function open() {
        useDevelopPageStore.getState().openFeedbackModal('airo#app-builder', 'First publish', 'feedback');
      });

      expect(useDevelopPageStore.getState().openFeedbackId).toBeNull();
    });
  });

  describe('#closeFeedbackModal', function closeFeedbackModalTests() {
    it('should clear all feedback state including initialStep', function clearsFeedbackState() {
      act(function open() {
        useDevelopPageStore.getState().openFeedbackModal('airo#app-builder', 'Session feedback', 'feedback');
      });

      act(function close() {
        useDevelopPageStore.getState().closeFeedbackModal();
      });

      const state = useDevelopPageStore.getState();
      expect(state.openFeedbackId).toBeNull();
      expect(state.feedbackOrigin).toBeNull();
      expect(state.feedbackInitialStep).toBeNull();
    });
  });

  describe('resetForNewApp clears feedback state', function resetFeedbackTests() {
    it('should clear feedbackInitialStep on app switch', function clearsFeedbackOnReset() {
      act(function open() {
        useDevelopPageStore.getState().openFeedbackModal('airo#app-builder', 'Session feedback', 'feedback');
      });

      act(function reset() {
        useDevelopPageStore.getState().resetForNewApp('new-app-id');
      });

      expect(useDevelopPageStore.getState().feedbackInitialStep).toBeNull();
    });
  });

  describe('#requestPublishPopoverOpen', function requestPublishPopoverOpenTests() {
    it('increments publishPopoverRequestNonce for an existing slice', function incrementExistingSlice() {
      act(function setup() {
        useDevelopPageStore.setState({
          publishStates: {
            'app-123': {
              ...useDevelopPageStore.getState().getPublishState('app-123'),
              isPublishing: true,
              publishPopoverRequestNonce: 0,
            },
          },
        });
      });

      act(function firstRequest() {
        useDevelopPageStore.getState().requestPublishPopoverOpen('app-123');
      });
      expect(useDevelopPageStore.getState().publishStates['app-123']?.publishPopoverRequestNonce).toBe(1);

      act(function secondRequest() {
        useDevelopPageStore.getState().requestPublishPopoverOpen('app-123');
      });
      const publishState = useDevelopPageStore.getState().publishStates['app-123'];
      expect(publishState?.publishPopoverRequestNonce).toBe(2);
      expect(publishState?.isPublishing).toBe(true);
    });

    it('creates slice and sets publishPopoverRequestNonce to 1 when missing', function createSliceAndIncrement() {
      act(function setup() {
        useDevelopPageStore.setState({ publishStates: {} });
      });

      act(function request() {
        useDevelopPageStore.getState().requestPublishPopoverOpen('app-999');
      });

      const publishState = useDevelopPageStore.getState().publishStates['app-999'];
      expect(publishState).toBeDefined();
      expect(publishState?.publishPopoverRequestNonce).toBe(1);
    });
  });

  describe('domain job persistence', function domainJobPersistenceTests() {
    const storageKey = 'airo-builder.develop-page-store.v1';
    const persistedStore = useDevelopPageStore as typeof useDevelopPageStore & {
      persist: {
        rehydrate: () => Promise<void>;
      };
    };

    beforeEach(function resetPersistedStore() {
      localStorage.removeItem(storageKey);
      act(function clearDomainJobs() {
        useDevelopPageStore.setState({ domainJobsInProgress: {} });
      });
    });

    it('should not persist domainJobsInProgress across reloads', async function noPersistence() {
      const startedAt = Date.now();
      act(function setJob() {
        useDevelopPageStore.getState().setDomainJobInProgress('app-123', {
          fqdn: 'example.com',
          startedAt,
          jobStatus: 'RUNNING',
        });
      });

      const savedState = localStorage.getItem(storageKey);
      // partialize returns empty object — domainJobsInProgress is not serialized
      if (savedState) {
        expect(savedState).not.toContain('app-123');
      }

      act(function clearRuntimeState() {
        useDevelopPageStore.setState({ domainJobsInProgress: {} });
      });

      await act(async function rehydrate() {
        await persistedStore.persist.rehydrate();
      });

      // Not rehydrated — in-flight state has no value after a reload
      expect(useDevelopPageStore.getState().domainJobsInProgress['app-123']).toBeUndefined();
    });
  });

  describe('#toggleMobileInlineEdit', function toggleMobileInlineEditTests() {
    let postMessageSpy: ReturnType<typeof vi.spyOn>;
    let mockIframe: HTMLIFrameElement;

    beforeEach(function setup() {
      // Reset state
      act(function reset() {
        useDevelopPageStore.setState({
          isMobileInlineEditActive: false,
          isEditModeEnabled: false,
        });
      });

      // Mock iframe
      mockIframe = document.createElement('iframe');
      mockIframe.id = 'preview-iframe';
      document.body.appendChild(mockIframe);

      // Spy on postMessageToIframe
      postMessageSpy = vi.spyOn(postMessageModule, 'postMessageToIframe');
    });

    afterEach(function cleanup() {
      mockIframe.remove();
      postMessageSpy.mockRestore();
    });

    it('should toggle isMobileInlineEditActive from false to true', function toggleOn() {
      act(function toggle() {
        useDevelopPageStore.getState().toggleMobileInlineEdit();
      });

      const state = useDevelopPageStore.getState();
      expect(state.isMobileInlineEditActive).toBe(true);
    });

    it('should toggle isMobileInlineEditActive from true to false', function toggleOff() {
      act(function setup() {
        useDevelopPageStore.setState({
          isMobileInlineEditActive: true,
          isEditModeEnabled: true,
        });
      });

      act(function toggle() {
        useDevelopPageStore.getState().toggleMobileInlineEdit();
      });

      const state = useDevelopPageStore.getState();
      expect(state.isMobileInlineEditActive).toBe(false);
    });

    it('should sync isEditModeEnabled with isMobileInlineEditActive when toggling on', function syncOnToggleOn() {
      act(function toggle() {
        useDevelopPageStore.getState().toggleMobileInlineEdit();
      });

      const state = useDevelopPageStore.getState();
      expect(state.isMobileInlineEditActive).toBe(true);
      expect(state.isEditModeEnabled).toBe(true);
    });

    it('should sync isEditModeEnabled with isMobileInlineEditActive when toggling off', function syncOnToggleOff() {
      act(function setup() {
        useDevelopPageStore.setState({
          isMobileInlineEditActive: true,
          isEditModeEnabled: true,
        });
      });

      act(function toggle() {
        useDevelopPageStore.getState().toggleMobileInlineEdit();
      });

      const state = useDevelopPageStore.getState();
      expect(state.isMobileInlineEditActive).toBe(false);
      expect(state.isEditModeEnabled).toBe(false);
    });

    it('should send EDIT_MODE_ENABLED message to iframe when toggling on', function postMessageOnEnable() {
      act(function toggle() {
        useDevelopPageStore.getState().toggleMobileInlineEdit();
      });

      expect(postMessageSpy).toHaveBeenCalledWith(
        mockIframe,
        { type: 'EDIT_MODE_ENABLED' }
      );
    });

    it('should send CLEAR_SELECTION and EDIT_MODE_DISABLED messages when toggling off', function postMessagesOnDisable() {
      act(function setup() {
        useDevelopPageStore.setState({
          isMobileInlineEditActive: true,
          isEditModeEnabled: true,
        });
      });

      postMessageSpy.mockClear();

      act(function toggle() {
        useDevelopPageStore.getState().toggleMobileInlineEdit();
      });

      expect(postMessageSpy).toHaveBeenCalledWith(
        mockIframe,
        { type: 'CLEAR_SELECTION' }
      );
      expect(postMessageSpy).toHaveBeenCalledWith(
        mockIframe,
        { type: 'EDIT_MODE_DISABLED' }
      );
      expect(postMessageSpy).toHaveBeenCalledTimes(2);
    });

    it('should not throw if iframe does not exist', function noIframeGraceful() {
      mockIframe.remove();

      expect(function toggle() {
        act(function toggleAction() {
          useDevelopPageStore.getState().toggleMobileInlineEdit();
        });
      }).not.toThrow();

      const state = useDevelopPageStore.getState();
      expect(state.isMobileInlineEditActive).toBe(true);
      expect(state.isEditModeEnabled).toBe(true);
    });
  });

  describe('#showResponseFeedbackThanksBannerTemporarily', function thanksBannerTests() {
    beforeEach(function useFakeTimers() {
      vi.useFakeTimers();
    });

    afterEach(function useRealTimers() {
      vi.useRealTimers();
    });

    it('should show the thanks banner immediately', function showBanner() {
      act(function show() {
        useDevelopPageStore.getState().showResponseFeedbackThanksBannerTemporarily();
      });

      expect(useDevelopPageStore.getState().showResponseFeedbackThanksBanner).toBe(true);
    });

    it('should hide the thanks banner after 3 seconds', function autoHideBanner() {
      act(function show() {
        useDevelopPageStore.getState().showResponseFeedbackThanksBannerTemporarily();
      });

      act(function advance() {
        vi.advanceTimersByTime(3000);
      });

      expect(useDevelopPageStore.getState().showResponseFeedbackThanksBanner).toBe(false);
    });

    it('should reset the auto-hide timer when called again', function resetTimer() {
      act(function show() {
        useDevelopPageStore.getState().showResponseFeedbackThanksBannerTemporarily();
      });

      act(function advancePartial() {
        vi.advanceTimersByTime(2000);
      });

      act(function showAgain() {
        useDevelopPageStore.getState().showResponseFeedbackThanksBannerTemporarily();
      });

      act(function advanceBeforeExpiry() {
        vi.advanceTimersByTime(2000);
      });

      expect(useDevelopPageStore.getState().showResponseFeedbackThanksBanner).toBe(true);

      act(function advanceToExpiry() {
        vi.advanceTimersByTime(1000);
      });

      expect(useDevelopPageStore.getState().showResponseFeedbackThanksBanner).toBe(false);
    });

    it('should clear the pending timer when dismissed', function dismissClearsTimer() {
      act(function show() {
        useDevelopPageStore.getState().showResponseFeedbackThanksBannerTemporarily();
      });

      act(function dismiss() {
        useDevelopPageStore.getState().dismissResponseFeedbackThanksBanner();
      });

      expect(useDevelopPageStore.getState().showResponseFeedbackThanksBanner).toBe(false);

      act(function advance() {
        vi.advanceTimersByTime(3000);
      });

      expect(useDevelopPageStore.getState().showResponseFeedbackThanksBanner).toBe(false);
    });
  });

  describe('setSeoRegressionAlert / dismissSeoRegressionAlert', function seoRegressionAlertTests() {
    const appId = 'seoapp0001';
    const alert = {
      scoreDelta: -30,
      currentScore: 50,
      regressions: [{ path: '/home', newIssues: ['missing-h1'] }],
    };

    it('should set the alert for the given appId', function setsAlert() {
      act(function set() {
        useDevelopPageStore.getState().setSeoRegressionAlert(appId, alert);
      });

      const state = useDevelopPageStore.getState();
      expect(state.publishStates[appId]?.seoRegressionAlert).toEqual(alert);
    });

    it('should clear the alert when set to null', function clearsAlert() {
      act(function set() {
        useDevelopPageStore.getState().setSeoRegressionAlert(appId, alert);
      });
      act(function clear() {
        useDevelopPageStore.getState().setSeoRegressionAlert(appId, null);
      });

      const state = useDevelopPageStore.getState();
      expect(state.publishStates[appId]?.seoRegressionAlert).toBeNull();
    });

    it('should dismiss the alert via dismissSeoRegressionAlert', function dismissesAlert() {
      act(function set() {
        useDevelopPageStore.getState().setSeoRegressionAlert(appId, alert);
      });
      act(function dismiss() {
        useDevelopPageStore.getState().dismissSeoRegressionAlert(appId);
      });

      const state = useDevelopPageStore.getState();
      expect(state.publishStates[appId]?.seoRegressionAlert).toBeNull();
    });

    it('should not affect other appIds when setting alert', function isolatedToApp() {
      const otherId = 'otherapp01';
      act(function set() {
        useDevelopPageStore.getState().setSeoRegressionAlert(appId, alert);
      });

      const state = useDevelopPageStore.getState();
      expect(state.publishStates[otherId]?.seoRegressionAlert).toBeUndefined();
    });
  });

  describe('#resetForNewApp', function resetForNewAppTests() {
    afterEach(function clearBrandFirstFlowState() {
      delete (window as unknown as { gasketData?: unknown }).gasketData;
      sessionStorage.clear();
    });

    it('should land in preview with editing disabled so the toggle and iframe agree', function resetSyncsEditMode() {
      // Simulate the default-initialized store (viewMode EDIT, edit enabled)
      // that exists before the first build navigates into the develop page.
      act(function setup() {
        useDevelopPageStore.setState({
          viewMode: ViewMode.EDIT,
          isEditModeEnabled: true,
        });
      });

      act(function reset() {
        useDevelopPageStore.getState().resetForNewApp('app-123');
      });

      const state = useDevelopPageStore.getState();
      expect(state.viewMode).toBe(ViewMode.PREVIEW);
      // The bug: viewMode flips to PREVIEW but isEditModeEnabled stayed true,
      // so the iframe got EDIT_MODE_ENABLED and showed the hover bar.
      expect(state.isEditModeEnabled).toBe(false);
    });

    it('preserves the BRAND tab for the logo-designer template', function preservesLogoDesignerBrand() {
      // The logo-designer flow sets ViewMode.BRAND before resetForNewApp runs;
      // resetting to PREVIEW would flash "Logo & Brand" then yank it to Preview.
      sessionStorage.setItem('initial-job-id-app-logo', 'job-logo');
      sessionStorage.setItem('initial-template-job-logo', 'logo-designer');

      act(function setup() {
        useDevelopPageStore.setState({ viewMode: ViewMode.BRAND });
      });

      act(function reset() {
        useDevelopPageStore.getState().resetForNewApp('app-logo');
      });

      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);
    });

    it('preserves the BRAND tab for the design-kit wizard profile', function preservesDesignKitBrand() {
      // The design-kit wizard lands on BRAND via useView.resolveInitialViewMode,
      // gated on the appbuilder-agent-profile Switchboard value. resetForNewApp
      // must not override it to PREVIEW during the jobId->realAppId re-init, even
      // though the app is NOT a logo-designer template.
      (window as unknown as { gasketData?: unknown }).gasketData = {
        switchboard: { 'appbuilder-agent-profile': 'initial-agent-design-kit' },
      };

      act(function setup() {
        useDevelopPageStore.setState({ viewMode: ViewMode.BRAND });
      });

      act(function reset() {
        useDevelopPageStore.getState().resetForNewApp('app-design-kit');
      });

      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);
    });

    it('still lands a plain app in PREVIEW when the design-kit profile is not active', function plainAppPreview() {
      // A non-design-kit agent-profile value must not trigger BRAND preservation.
      (window as unknown as { gasketData?: unknown }).gasketData = {
        switchboard: { 'appbuilder-agent-profile': 'initial-agent-design-system' },
      };

      act(function setup() {
        useDevelopPageStore.setState({ viewMode: ViewMode.EDIT, isEditModeEnabled: true });
      });

      act(function reset() {
        useDevelopPageStore.getState().resetForNewApp('app-plain');
      });

      const state = useDevelopPageStore.getState();
      expect(state.viewMode).toBe(ViewMode.PREVIEW);
      expect(state.isEditModeEnabled).toBe(false);
    });
  });
});
