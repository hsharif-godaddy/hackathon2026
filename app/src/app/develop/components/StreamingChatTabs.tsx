'use client'

import ChevronRightIcon from '@ux/icon/chevron-right'
import HistoryIcon from '@ux/icon/history'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/lib/shadcn/tabs'
import { useDevelopPageStore, OptionsSheetTab } from '@/stores/useDevelopPageStore'
import StreamingMessageList from './StreamingMessageList'
import OptionsSheet from './OptionsSheet'
import type { ChatMessage, StreamingMessage } from '@/stores/useStreamingConversationStore'

interface StreamingChatTabsProps {
  messages: (ChatMessage | StreamingMessage)[]
  appId: string
}

export default function StreamingChatTabs({
  appId
}: StreamingChatTabsProps) {
  const { openOptionsSheet, setOpenOptionsSheet } = useDevelopPageStore()

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tabs */}
      <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-4 pt-4 bg-intents-ux-boxLowContrastOverlay-backgroundColor">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="chat" className="text-sm">Chat</TabsTrigger>
            <TabsTrigger value="options" className="text-sm">Options</TabsTrigger>
          </TabsList>
        </div>

        {/* Chat Tab Content */}
        <TabsContent value="chat" className="flex-1 mt-0 flex flex-col min-h-0">
          <StreamingMessageList />
        </TabsContent>

        {/* Options Tab Content */}
        <TabsContent value="options" className="flex-1 mt-0 overflow-y-auto">
          <div className="p-4 space-y-3">
            <div>
              <div className="space-y-2">
                <button
                  className="group flex items-center justify-start w-full gap-2 p-4 transition-all duration-200 shadow-sm hover:shadow-lg hover:scale-101 rounded-sm hover:cursor-pointer"
                  onClick={() => setOpenOptionsSheet(OptionsSheetTab.HISTORY)}
                >
                  <HistoryIcon className="w-5 h-5" />
                  Version History
                  <ChevronRightIcon className="w-5 h-5 ml-auto" />
                </button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Options Sheet */}
      <OptionsSheet
        isOpenTab={openOptionsSheet}
        onOpenChange={setOpenOptionsSheet}
        side="left"
        appId={appId}
      />
    </div>
  )
}
