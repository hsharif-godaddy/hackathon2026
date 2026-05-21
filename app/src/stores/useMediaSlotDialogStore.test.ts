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
  })
})
