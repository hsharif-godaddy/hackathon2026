'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import ConversationsIcon from '@ux/icon/conversations'
import InlineEditIcon from '@ux/icon/inline-edit'
import MenuIcon from '@ux/icon/menu'
import RefreshIcon from '@ux/icon/refresh'
import text from '@ux/text'

import { ButtonGroup } from '@/app/[market]/develop/components/ButtonGroup'
import { useTranslations } from '@/hooks/useTranslations'
import { Sheet, SheetContent } from '@/lib/shadcn/sheet'

export interface PreviewOverflowSheetRef {
  open: () => void
  close: () => void
  toggle: () => void
}

interface PreviewOverflowSheetProps {
  onEdit?: () => void
  onRefresh?: () => void
  onInbox?: () => void
  showEdit?: boolean
  showInbox?: boolean
}

const PreviewOverflowSheet = forwardRef<PreviewOverflowSheetRef, PreviewOverflowSheetProps>(
  function PreviewOverflowSheet({ onEdit, onRefresh, onInbox, showEdit = true, showInbox = false }, ref) {
    const [open, setOpen] = useState(false)
    const t = useTranslations()
    const triggerRef = useRef<HTMLButtonElement>(null)

    useImperativeHandle(ref, () => ({
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen((prev) => !prev),
    }))

    const handleAction = (action?: () => void) => {
      setOpen(false)
      action?.()
    }

    return (
      <>
        <ButtonGroup.Item
          ref={triggerRef}
          value="preview-actions"
          icon={<MenuIcon className="size-2.5" />}
          label={t('builder_apps_menu_actions')}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid="preview-overflow-menu"
        />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            onInteractOutside={(e) => {
              // Prevent dismiss when clicking the trigger - let toggle handle it
              if (triggerRef.current?.contains(e.target as Node)) {
                e.preventDefault()
              }
            }}
            side="bottom"
            className="gap-0 rounded-t-[16px] border-intents-ux-borderColor bg-intents-ux-box-backgroundColor px-0 pb-[max(12px,env(safe-area-inset-bottom))] pt-[12px] [&>button]:top-[12px] [&>button]:right-[16px]"
          >
            <div className="flex flex-col">
              {showEdit && onEdit && (
                <button
                  type="button"
                  onClick={() => handleAction(onEdit)}
                  data-testid="preview-overflow-edit"
                  className="flex w-full items-center gap-[12px] px-[16px] py-[12px] text-left transition-colors hover:bg-intents-ux-boxLowContrast-backgroundColor active:bg-intents-ux-boxLowContrastOverlay-backgroundColor"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <InlineEditIcon />
                  </span>
                  <text.span>{t('builder_preview_button_edit')}</text.span>
                </button>
              )}

              {onRefresh && (
                <button
                  type="button"
                  onClick={() => handleAction(onRefresh)}
                  data-testid="preview-overflow-refresh"
                  className="flex w-full items-center gap-[12px] px-[16px] py-[12px] text-left transition-colors hover:bg-intents-ux-boxLowContrast-backgroundColor active:bg-intents-ux-boxLowContrastOverlay-backgroundColor"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <RefreshIcon />
                  </span>
                  <text.span>{t('builder_common_refresh')}</text.span>
                </button>
              )}

              {showInbox && onInbox && (
                <button
                  type="button"
                  onClick={() => handleAction(onInbox)}
                  data-testid="preview-overflow-inbox"
                  className="flex w-full items-center gap-[12px] px-[16px] py-[12px] text-left transition-colors hover:bg-intents-ux-boxLowContrast-backgroundColor active:bg-intents-ux-boxLowContrastOverlay-backgroundColor"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <ConversationsIcon />
                  </span>
                  <text.span>{t('builder_preview_button_inbox')}</text.span>
                </button>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </>
    )
  }
)

export default PreviewOverflowSheet
