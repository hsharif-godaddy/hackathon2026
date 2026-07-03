'use client'

import clsx from 'clsx'
import text from '@ux/text'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/lib/shadcn/sheet'

export interface ProjectCardAction {
  id: string
  label: string
  icon: React.ReactNode
  trailingIcon?: React.ReactNode
  onClick: () => void
  emphasis?: 'critical'
  showSeparatorBefore?: boolean
}

interface ProjectCardActionsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  actions: ProjectCardAction[]
}

/** Matches `.ux-text.ux-text-feedback-critical` without altering font-size (icon stays 1.5em). */
const CRITICAL_ACTION_COLOR_CLASS =
  '[color:var(--ux-1k8kcmw,var(--ux-1fhc073,red))]'

export default function ProjectCardActionsSheet({
  open,
  onOpenChange,
  title,
  actions,
}: ProjectCardActionsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="gap-0 rounded-t-[16px] border-intents-ux-borderColor bg-intents-ux-box-backgroundColor px-0 pb-[max(12px,env(safe-area-inset-bottom))] pt-0 [&>button]:top-[16px] [&>button]:right-[16px]"
      >
        <SheetHeader className="gap-0 border-b border-intents-ux-borderColor p-0 px-[16px] py-[16px] pr-[40px] text-left">
          <SheetTitle className="truncate text-base font-semibold text-intents-ux-box-foregroundColor">
            {title}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col">
          {actions.map((action) => (
            <div key={action.id}>
              {action.showSeparatorBefore && (
                <div className="border-t border-intents-ux-borderColor" />
              )}
              <button
                type="button"
                onClick={action.onClick}
                data-testid={`project-card-sheet-action-${action.id}`}
                className="flex w-full items-center gap-[12px] px-[16px] py-[12px] text-left transition-colors hover:bg-intents-ux-boxLowContrast-backgroundColor active:bg-intents-ux-boxLowContrastOverlay-backgroundColor"
              >
                <span
                  className={clsx(
                    'flex size-5 shrink-0 items-center justify-center',
                    action.emphasis === 'critical' && CRITICAL_ACTION_COLOR_CLASS
                  )}
                >
                  {action.icon}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <text.span emphasis={action.emphasis} className="min-w-0 flex-1">
                    {action.label}
                  </text.span>
                  {action.trailingIcon}
                </span>
              </button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
