import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'

import { ChatTab, SettingsSection } from '@/app/[market]/develop/components/types'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

const VALID_CHAT_TABS = new Set(Object.values(ChatTab))
const VALID_SETTINGS_SECTIONS = new Set(Object.values(SettingsSection))

const DEFAULT_CHAT_TAB = ChatTab.CHAT
const DEFAULT_SETTINGS_SECTION = SettingsSection.DOMAIN

const buildUrl = (pathname: string, params: URLSearchParams) => {
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

const parseChatTab = (value: string | null): ChatTab => {
  if (value && VALID_CHAT_TABS.has(value as ChatTab)) {
    return value as ChatTab
  }
  return DEFAULT_CHAT_TAB
}

const parseSettingsSection = (value: string | null): SettingsSection => {
  if (value && VALID_SETTINGS_SECTIONS.has(value as SettingsSection)) {
    return value as SettingsSection
  }
  return DEFAULT_SETTINGS_SECTION
}

/**
 * Custom hook for managing tab state with URL synchronization
 *
 * Uses Zustand store for tab state and window.history for URL sync to avoid
 * Next.js App Router navigation that causes full page remounts.
 *
 * Features:
 * - Deep linking: Reads initial state from URL on mount
 * - Browser history: Handles back/forward with popstate events
 * - No navigation: Uses window.history.replaceState() to update URL without remounting
 */
export function useChatTabs() {
  const pathname = usePathname()

  // Get tab state from store
  const activeChatTab = useDevelopPageStore((state) => state.activeChatTab)
  const activeSettingsSection = useDevelopPageStore((state) => state.activeSettingsSection)
  const chatTabsInitializedForPathname = useDevelopPageStore((state) => state.chatTabsInitializedForPathname)
  const setActiveChatTabStore = useDevelopPageStore((state) => state.setActiveChatTab)
  const setActiveSettingsSectionStore = useDevelopPageStore((state) => state.setActiveSettingsSection)
  const markChatTabsInitialized = useDevelopPageStore((state) => state.markChatTabsInitialized)

  // Track URL sync state
  const skipNextSyncRef = useRef(false)
  const pendingUrlSyncRef = useRef<string | null>(null)
  const firstSyncRef = useRef(true)

  // Initialize from URL on first mount (for deep linking) or pathname change
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Check if we've already initialized for this pathname
    const isInitialized = chatTabsInitializedForPathname === pathname
    if (isInitialized) return

    const params = new URLSearchParams(window.location.search)
    const urlTab = parseChatTab(params.get('tab'))
    const urlSection = parseSettingsSection(params.get('settings'))

    // Skip the immediate sync effect for this render to avoid clobbering deep links
    skipNextSyncRef.current = true
    pendingUrlSyncRef.current = null

    const normalizedParams = new URLSearchParams(window.location.search)

    if (urlTab === DEFAULT_CHAT_TAB) {
      normalizedParams.delete('tab')
    } else {
      normalizedParams.set('tab', urlTab)
    }

    if (urlTab === ChatTab.SETTINGS) {
      if (urlSection !== DEFAULT_SETTINGS_SECTION) {
        normalizedParams.set('settings', urlSection)
      } else {
        normalizedParams.delete('settings')
      }
    } else {
      normalizedParams.delete('settings')
    }

    const normalizedUrl = buildUrl(pathname, normalizedParams)
    const currentUrl = window.location.pathname + window.location.search

    if (normalizedUrl !== currentUrl) {
      pendingUrlSyncRef.current = normalizedUrl
    }

    // Only update store if URL has different values
    if (urlTab !== activeChatTab) {
      setActiveChatTabStore(urlTab)
    }
    if (urlSection !== activeSettingsSection) {
      setActiveSettingsSectionStore(urlSection)
    }

    // Mark as initialized for this pathname
    markChatTabsInitialized(pathname)
    firstSyncRef.current = true
  }, [pathname, activeChatTab, activeSettingsSection, chatTabsInitializedForPathname, setActiveChatTabStore, setActiveSettingsSectionStore, markChatTabsInitialized])

  // Sync store changes to URL (but don't trigger navigation)
  useEffect(() => {
    if (typeof window === 'undefined' || chatTabsInitializedForPathname !== pathname) {
      return
    }
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false
      if (pendingUrlSyncRef.current) {
        const currentUrl = window.location.pathname + window.location.search
        if (pendingUrlSyncRef.current !== currentUrl) {
          window.history.replaceState(null, '', pendingUrlSyncRef.current)
        }
        pendingUrlSyncRef.current = null
      }
      firstSyncRef.current = false
      return
    }

    const params = new URLSearchParams(window.location.search)

    // Update tab param
    if (activeChatTab === DEFAULT_CHAT_TAB) {
      params.delete('tab')
    } else {
      params.set('tab', activeChatTab)
    }

    // Update settings param
    if (activeChatTab === ChatTab.SETTINGS) {
      if (activeSettingsSection !== DEFAULT_SETTINGS_SECTION) {
        params.set('settings', activeSettingsSection)
      } else {
        params.delete('settings')
      }
    } else {
      params.delete('settings')
    }

    const newUrl = buildUrl(pathname, params)
    const currentUrl = window.location.pathname + window.location.search
    const urlChanged = newUrl !== currentUrl

    // Handle first sync separately - always flip flag even if URL didn't change
    if (firstSyncRef.current) {
      firstSyncRef.current = false
      if (urlChanged) {
        window.history.replaceState(null, '', newUrl)
      }
      return
    }

    // Subsequent changes use pushState for back/forward support
    if (urlChanged) {
      window.history.pushState(null, '', newUrl)
    }
  }, [activeChatTab, activeSettingsSection, pathname, chatTabsInitializedForPathname])

  // Handle browser back/forward with stable callback
  const handlePopState = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    const urlTab = parseChatTab(params.get('tab'))
    const urlSection = parseSettingsSection(params.get('settings'))

    // Always update store to match URL (from back/forward navigation)
    // Don't check current values - popstate means URL changed externally
    setActiveChatTabStore(urlTab)
    setActiveSettingsSectionStore(urlSection)
  }, [setActiveChatTabStore, setActiveSettingsSectionStore])

  useEffect(() => {
    if (typeof window === 'undefined') return

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [handlePopState])

  // Setters that update store (which triggers URL sync)
  const setActiveChatTab = useCallback(
    (tab: ChatTab) => {
      setActiveChatTabStore(tab)
    },
    [setActiveChatTabStore]
  )

  const setActiveSettingsSection = useCallback(
    (section: SettingsSection) => {
      setActiveSettingsSectionStore(section)
    },
    [setActiveSettingsSectionStore]
  )

  return {
    activeChatTab,
    setActiveChatTab,
    activeSettingsSection,
    setActiveSettingsSection,
  }
}
