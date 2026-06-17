/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { ChatTab, MobileMode } from '@/app/[market]/develop/components/types'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'

function resetStores() {
  useMediaSlotDialogStore.setState({
    panelSlotName: null,
    mediaReturnTab: null,
    mediaReturnMobileMode: null,
    openEditorForSlot: null,
  })
  useDevelopPageStore.setState({
    activeChatTab: ChatTab.CHAT,
    mobileMode: MobileMode.TOOLS,
  })
}

describe('useMediaSlotDialogStore', () => {
  beforeEach(() => {
    resetStores()
  })

  describe('navigateToSlot', () => {
    it('captures return tab + mobileMode when navigating to a real slot', () => {
      useDevelopPageStore.setState({
        activeChatTab: ChatTab.CHAT,
        mobileMode: MobileMode.TOOLS,
      })

      useMediaSlotDialogStore.getState().navigateToSlot('hero-image')

      const state = useMediaSlotDialogStore.getState()
      expect(state.panelSlotName).toBe('hero-image')
      expect(state.mediaReturnTab).toBe(ChatTab.CHAT)
      expect(state.mediaReturnMobileMode).toBe(MobileMode.TOOLS)
    })

    it('captures return tab + mobileMode when navigating to __GRID__', () => {
      useDevelopPageStore.setState({
        activeChatTab: ChatTab.CHAT,
        mobileMode: MobileMode.TOOLS,
      })

      useMediaSlotDialogStore.getState().navigateToSlot('__GRID__')

      const state = useMediaSlotDialogStore.getState()
      expect(state.panelSlotName).toBe('__GRID__')
      expect(state.mediaReturnTab).toBe(ChatTab.CHAT)
      expect(state.mediaReturnMobileMode).toBe(MobileMode.TOOLS)
    })

    it('does not set openEditorForSlot for __GRID__ even if openEditor is requested', () => {
      useMediaSlotDialogStore
        .getState()
        .navigateToSlot('__GRID__', { openEditor: true })

      expect(useMediaSlotDialogStore.getState().openEditorForSlot).toBeNull()
    })

    it('resets scroll state when navigating to a new slot', () => {
      useMediaSlotDialogStore.setState({
        mediaScrollTotalMatches: 5,
        mediaScrollCurrentIndex: 2,
      })

      useMediaSlotDialogStore.getState().navigateToSlot('new-slot')

      const state = useMediaSlotDialogStore.getState()
      expect(state.mediaScrollTotalMatches).toBe(0)
      expect(state.mediaScrollCurrentIndex).toBe(0)
    })
  })

  describe('clearPanelSlot', () => {
    it('clears panel slot name but preserves fork context until explicitly cleared', () => {
      const forkContext = {
        selector: 'img',
        devContext: { fileName: 'src/pages/home.tsx', componentName: 'Home', lineNumber: 1 },
        elementInfo: {
          tagName: 'img',
          className: '',
          selector: 'img',
          devContext: { fileName: 'src/pages/home.tsx', componentName: 'Home', lineNumber: 1 },
        },
        imageInfo: { type: 'img' as const, currentUrl: '/airo-assets/images/pages/home/hero' },
      }

      useMediaSlotDialogStore.setState({
        panelSlotName: 'some-slot',
        panelSlotForkContext: forkContext,
        mediaScrollTotalMatches: 3,
        mediaScrollCurrentIndex: 1,
      })

      useMediaSlotDialogStore.getState().clearPanelSlot()

      const state = useMediaSlotDialogStore.getState()
      expect(state.panelSlotName).toBeNull()
      expect(state.panelSlotForkContext).toEqual(forkContext)
      expect(state.mediaScrollTotalMatches).toBe(0)
      expect(state.mediaScrollCurrentIndex).toBe(0)
    })
  })

  describe('clearPanelSlotForkContext', () => {
    it('clears preview fork context', () => {
      useMediaSlotDialogStore.setState({
        panelSlotForkContext: {
          selector: 'img',
          devContext: { fileName: 'src/pages/home.tsx', componentName: 'Home', lineNumber: 1 },
          elementInfo: {
            tagName: 'img',
            className: '',
            selector: 'img',
            devContext: { fileName: 'src/pages/home.tsx', componentName: 'Home', lineNumber: 1 },
          },
          imageInfo: { type: 'img', currentUrl: null },
        },
      })

      useMediaSlotDialogStore.getState().clearPanelSlotForkContext()

      expect(useMediaSlotDialogStore.getState().panelSlotForkContext).toBeNull()
    })
  })
})
