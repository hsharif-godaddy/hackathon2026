import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'

import { ChatTab, SettingsSection } from '@/app/develop/components/types'

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

export function useChatTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const activeChatTab = useMemo(
    () => parseChatTab(searchParams.get('tab')),
    [searchParams]
  )

  const activeSettingsSection = useMemo(
    () => parseSettingsSection(searchParams.get('settings')),
    [searchParams]
  )

  const updateParams = useCallback(
    (mutator: (params: URLSearchParams) => void) => {
      const nextParams = new URLSearchParams(searchParams.toString())
      mutator(nextParams)
      router.replace(buildUrl(pathname, nextParams), { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const setActiveChatTab = useCallback(
    (tab: ChatTab) => {
      updateParams((params) => {
        if (tab === DEFAULT_CHAT_TAB) {
          params.delete('tab')
        } else {
          params.set('tab', tab)
        }
        if (tab === ChatTab.SETTINGS) {
          const currentSection = params.get('settings')
          if (!currentSection || !VALID_SETTINGS_SECTIONS.has(currentSection as SettingsSection)) {
            params.set('settings', DEFAULT_SETTINGS_SECTION)
          }
        } else {
          params.delete('settings')
        }
      })
    },
    [updateParams]
  )

  const setActiveSettingsSection = useCallback(
    (section: SettingsSection) => {
      updateParams((params) => {
        params.set('settings', section)
        params.set('tab', ChatTab.SETTINGS)
      })
    },
    [updateParams]
  )

  return {
    activeChatTab,
    setActiveChatTab,
    activeSettingsSection,
    setActiveSettingsSection,
  }
}
