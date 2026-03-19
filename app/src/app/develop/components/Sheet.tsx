import { Sheet as ShadcnSheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/lib/shadcn/sheet'

interface SheetProps {
  buttons?: React.ReactNode
  children?: React.ReactNode
  isOpen: boolean
  onClose: () => void
  onTouchEnd?: (event: React.TouchEvent) => void
  onTouchStart?: (event: React.TouchEvent) => void
  title: string
}

export function Sheet({
  buttons,
  children,
  isOpen,
  onClose,
  onTouchEnd,
  onTouchStart,
  title,
}: SheetProps) {
  return (
    <ShadcnSheet open={isOpen} onOpenChange={(open) => { if (!open) {onClose()} }}>
      <SheetContent
        side="left"
        className="w-full !max-w-[425px] overflow-y-auto"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <SheetHeader className="space-y-3">
          <div className="flex items-center justify-between">
            <SheetTitle>{title}</SheetTitle>
          </div>
        </SheetHeader>

        {/* Content */}
        <div className="flex-1 px-2">
          {children}
        </div>

        {/* Footer */}
        {buttons && (
          <SheetFooter className="pt-2">
            <div className="flex gap-2 w-full">
              {buttons}
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </ShadcnSheet>
  )
}
