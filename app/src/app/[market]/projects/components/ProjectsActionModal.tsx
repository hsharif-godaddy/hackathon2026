'use client'

import clsx from 'clsx'
import { useCallback, useEffect, useRef } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Modal from '@ux/modal'
import text from '@ux/text'

import { useIsMobile } from '@/hooks/useIsMobile'
import { useVisualViewportBottomInset } from '@/hooks/useVisualViewportBottomInset'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/lib/shadcn/sheet'

export const PROJECTS_ACTION_MODAL_CLASS =
  'w-full max-w-[calc(100vw-2rem)] sm:max-w-lg !gap-4 !text-left [&_.ux-text-lockup]:!items-start [&_.ux-text-lockup]:!text-left [&_.ux-text-lockup--text]:!w-full [&_.ux-text-lockup--text]:!text-left [&_.ux-text-lockup--title]:!text-left [&_.ux-text-lockup--body]:!mx-0 [&_.ux-text-lockup--body]:!w-full [&_.ux-text-lockup--body]:!text-left [&_.ux-text-lockup--body]:!font-normal'

const SHEET_CONTENT_CLASS =
  'gap-0 rounded-t-[16px] border-intents-ux-borderColor bg-intents-ux-box-backgroundColor px-0 pb-[max(12px,env(safe-area-inset-bottom))] pt-0 max-h-[90dvh] overflow-y-auto [&>button]:top-[16px] [&>button]:right-[16px]'

/** Focus ring / border for @ux TextInput fields inside action modals */
const ACTION_MODAL_INPUT_FOCUS_CLASS =
  '[&_.ux-text-entry-shell:has(:focus)]:!outline [&_.ux-text-entry-shell:has(:focus)]:!outline-2 [&_.ux-text-entry-shell:has(:focus)]:![outline-color:#1976D2] [&_.ux-field-frame:has(:focus)]:!border-[#1976D2]'

export function isTextEntryElement(element: Element): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return true
  }

  return element.closest('.ux-text-input, .ux-text-entry-shell, [contenteditable="true"]') !== null
}

export function resolveTextEntryElement(element: Element): HTMLElement | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element
  }

  const shell = element.closest('.ux-text-entry-shell, .ux-text-input')
  return shell instanceof HTMLElement ? shell : null
}

interface ProjectsActionModalProps {
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
  focusLock?: boolean
  className?: string
  testId?: string
  /** Apply Airo brand theming to the desktop modal. Disable for share link parity with develop popover. */
  applyAiroTheme?: boolean
}

export default function ProjectsActionModal({
  title,
  description,
  children,
  footer,
  onClose,
  focusLock = false,
  className,
  testId,
  applyAiroTheme = true,
}: ProjectsActionModalProps) {
  const isMobile = useIsMobile()
  const { bottomInset, viewportHeight } = useVisualViewportBottomInset()
  const sheetContentRef = useRef<HTMLDivElement>(null)

  const scrollTextEntryIntoView = useCallback((target: Element) => {
    const entry = resolveTextEntryElement(target)
    if (!entry) return

    requestAnimationFrame(() => {
      entry.scrollIntoView({ block: 'center', inline: 'nearest' })
    })
  }, [])

  useEffect(() => {
    if (!isMobile) return

    const sheet = sheetContentRef.current
    if (!sheet) return

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !sheet.contains(target) || !isTextEntryElement(target)) {
        return
      }

      scrollTextEntryIntoView(target)
    }

    sheet.addEventListener('focusin', onFocusIn)
    return () => sheet.removeEventListener('focusin', onFocusIn)
  }, [isMobile, scrollTextEntryIntoView])

  useEffect(() => {
    if (!isMobile || bottomInset === 0) return

    const active = document.activeElement
    if (
      active instanceof Element &&
      sheetContentRef.current?.contains(active) &&
      isTextEntryElement(active)
    ) {
      scrollTextEntryIntoView(active)
    }
  }, [bottomInset, isMobile, scrollTextEntryIntoView])

  if (isMobile) {
    const keyboardOpen = bottomInset > 0

    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <SheetContent
          ref={sheetContentRef}
          side="bottom"
          className={SHEET_CONTENT_CLASS}
          style={{
            bottom: bottomInset,
            ...(keyboardOpen && viewportHeight > 0
              ? { maxHeight: viewportHeight }
              : undefined),
          }}
        >
          <SheetHeader className="gap-0 border-b border-intents-ux-borderColor p-0 px-[16px] py-[16px] pr-[40px] text-left">
            <SheetTitle className="text-sm font-semibold leading-tight text-intents-ux-box-foregroundColor whitespace-normal break-words">
              {title}
            </SheetTitle>
          </SheetHeader>

          <div
            className={clsx(
              'flex flex-col gap-[16px] px-[16px] py-[16px]',
              ACTION_MODAL_INPUT_FOCUS_CLASS
            )}
            data-testid={testId}
          >
            {description && (
              <text.p emphasis="passive" size={-1} className="m-0 text-left">
                {description}
              </text.p>
            )}
            {children}
          </div>

          {footer && (
            <div className="border-t border-intents-ux-borderColor px-[16px] py-[16px]">
              {footer}
            </div>
          )}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Modal
      title={title}
      description={
        description ? (
          <text.p emphasis="passive" size={-1} className="m-0 w-full whitespace-normal break-words text-left">
            {description}
          </text.p>
        ) : undefined
      }
      onClose={onClose}
      focusLock={focusLock}
      portalElem={typeof document !== 'undefined' ? document.body : undefined}
      data-partial={applyAiroTheme ? 'componentAiro' : undefined}
      className={clsx(PROJECTS_ACTION_MODAL_CLASS, ACTION_MODAL_INPUT_FOCUS_CLASS, className)}
    >
      <div data-testid={testId}>{children}</div>
      {footer}
    </Modal>
  )
}

interface ProjectsActionModalFooterProps {
  onCancel: () => void
  cancelText: string
  onConfirm: () => void
  confirmText: string
  confirmDesign?: 'primary' | 'critical' | 'secondary'
  isLoading?: boolean
  confirmDisabled?: boolean
  cancelDisabled?: boolean
  cancelEid?: string
  confirmEid?: string
  confirmTestId?: string
}

export function ProjectsActionModalFooter({
  onCancel,
  cancelText,
  onConfirm,
  confirmText,
  confirmDesign = 'primary',
  isLoading = false,
  confirmDisabled = false,
  cancelDisabled = false,
  cancelEid,
  confirmEid,
  confirmTestId,
}: ProjectsActionModalFooterProps) {
  const cancelButton = (
    <Button
      onClick={onCancel}
      disabled={cancelDisabled || isLoading}
      design="secondary"
      size="sm"
      data-partial="componentAiro"
      className="min-w-0 flex-1 !bg-intents-ux-box-backgroundColor !border !border-intents-ux-boxHighContrast-backgroundColor !text-intents-ux-boxHighContrast-backgroundColor !shadow-none md:flex-none"
      text={cancelText}
      data-eid={cancelEid}
    />
  )

  const confirmButton = (
    <Button
      onClick={onConfirm}
      disabled={confirmDisabled || isLoading}
      design={confirmDesign}
      size="sm"
      data-partial={confirmDesign === 'primary' ? 'componentAiro' : undefined}
      className="min-w-0 flex-1 md:flex-none"
      text={confirmText}
      data-testid={confirmTestId}
      data-eid={confirmEid}
    />
  )

  return (
    <Box orientation="horizontal" gap="sm" className="w-full md:justify-end">
      {cancelButton}
      {confirmButton}
    </Box>
  )
}
