'use client'

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/lib/shadcn/sheet'
import { OptionsSheetTab } from '@/stores/useDevelopPageStore'
import VersionHistory from './VersionHistory'

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
          <VersionHistory
            appId={appId}
            isOpen={true}
          />
        )
      default:
        return <div>Content not found</div>
    }
  }

  const isOpen = isOpenTab !== null

  return (
    <Sheet open={isOpen} onOpenChange={(open) => onOpenChange(open ? isOpenTab : null)}>
      <SheetContent side={side} className="w-[400px]">
        <SheetHeader>
          <SheetTitle>{renderTitle()}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 flex-1 overflow-hidden">
          {renderContent()}
        </div>
      </SheetContent>
    </Sheet>
  )
}