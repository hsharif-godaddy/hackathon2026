'use client'

import ChevronLeftIcon from '@ux/icon/chevron-left'

import { ChatTab } from '@/app/[market]/develop/components/types'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useTranslations } from '@/hooks/useTranslations'
import { logClickEvent } from '@/utils/instrumentation'

interface CommanderTabBackButtonProps {
  appId: string | null
  fromTab: ChatTab
}

export default function CommanderTabBackButton({ appId, fromTab }: CommanderTabBackButtonProps) {
  const t = useTranslations()
  const { setActiveChatTab } = useChatTabs()

  const handleClick = () => {
    logClickEvent(`commander.tab_back.${fromTab}`, appId ? { appId } : undefined)()
    setActiveChatTab(ChatTab.CHAT)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="commander-tab-back"
      data-eid={`commander.tab_back.${fromTab}`}
      className="shrink-0 flex items-center gap-1 text-sm text-intents-ux-textSubtle-textColor hover:text-intents-ux-text-textColor transition-colors hover:cursor-pointer pb-2"
    >
      <ChevronLeftIcon className="size-2 rtl:scale-x-[-1]" />
      <span>{t('builder_common_back')}</span>
    </button>
  )
}
