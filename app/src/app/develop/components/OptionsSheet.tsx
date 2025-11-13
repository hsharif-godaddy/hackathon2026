'use client'

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/lib/shadcn/sheet'
import { OptionsSheetTab, useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useRestoreCommitMutation } from '@/hooks/useRestoreCommitMutation'
import { useGitHistoryQuery } from '@/hooks/useGitHistory'
import VersionHistory from './VersionHistory'
import Button from '@ux/button'

interface OptionsSheetProps {
  isOpenTab: OptionsSheetTab | null
  onOpenChange: (tab: OptionsSheetTab | null) => void
  side?: 'left' | 'right' | 'top' | 'bottom'
  appId?: string
}

export default function OptionsSheet({
  isOpenTab,
  onOpenChange,
  side = 'right',
  appId = ''
}: OptionsSheetProps) {
  const { selectedCommit } = useDevelopPageStore()
  const restoreMutation = useRestoreCommitMutation()

  const { data: commits = [] } = useGitHistoryQuery({
    appId: appId || '',
    enabled: !!appId
  })

  const latestCommit = commits.length > 0 ? commits[0] : null
  const isViewingHistoricalCommit = selectedCommit && latestCommit && selectedCommit.hash !== latestCommit.hash

  function handleRestoreConfirm() {
    if (!selectedCommit) return

    restoreMutation.mutate({ appId, commitHash: selectedCommit.hash })
  }
  const renderTitle = () => {
    switch (isOpenTab) {
      case OptionsSheetTab.HISTORY:
        return 'Version History'
      default:
        return 'Options'
    }
  }
  const renderContent = () => {
    switch (isOpenTab) {
      case OptionsSheetTab.HISTORY:
        return (
          <VersionHistory />
        )
      default:
        return <div>Content not found</div>
    }
  }

  const isOpen = isOpenTab !== null

  return (
    <Sheet open={isOpen} onOpenChange={(open) => onOpenChange(open ? isOpenTab : null)}>
      <SheetContent side={side} className="w-[400px] flex flex-col">
        <SheetHeader>
          <SheetTitle>{renderTitle()}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex-1 overflow-hidden">
          {renderContent()}
        </div>

        {isOpenTab === OptionsSheetTab.HISTORY && isViewingHistoricalCommit && (
          <div className="border-t border-gray-200 p-4 mt-auto">
            <Button
              design="primary"
              size="sm"
              onClick={handleRestoreConfirm}
              disabled={restoreMutation.isPending}
              title="Restore files from this commit"
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium bg-purple-100 hover:bg-purple-200 text-purple-700 border border-purple-200 hover:border-purple-300 rounded-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {restoreMutation.isPending ? 'Restoring...' : `Restore to ${selectedCommit.hash.substring(0, 7)}`}
            </Button>
          </div>
        )}

      </SheetContent>
    </Sheet>
  )
}
