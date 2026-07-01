'use client'

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { PromptBox, type PromptBoxHandle } from '@airo-ux/pattern-library/input/prompt-box'
import { FloatingFooter } from '@airo-ux/pattern-library/surfaces/floating-footer'
import Button from '@ux/button'
import Chip from '@ux/chip'
import AsyncIcon from '@ux/icon/async-icon.js'
import CodeIcon from '@ux/icon/code'
import MicIcon from '@ux/icon/mic'
import StopIcon from '@ux/icon/stop'
import text from '@ux/text'
import TextLockup from '@ux/text-lockup'

import { useCommanderLayout } from '@/app/[market]/commander/components/CommanderLayoutContext'
import AssetInline, { AssetMode } from '@/app/[market]/develop/components/chat/AssetInline'
import { AssetManagerItem, MediaType } from '@/app/[market]/develop/components/chat/AssetTypes'
import ChatAttachmentMenu from '@/app/[market]/develop/components/chat/ChatAttachmentMenu'
import type { SendMessageOptions } from '@/app/[market]/develop/components/chat/ChatContext'
import { DebugStatsToggleButton } from '@/app/[market]/develop/components/chat/DebugStatsDrawer'
import InputActionsPanel from '@/app/[market]/develop/components/chat/InputActionsPanel'
import RebuildQueueProgress from '@/app/[market]/develop/components/chat/RebuildQueueProgress'
import { useSecretsComposerTakeover } from '@/app/[market]/develop/components/chat/secrets/useSecretsComposerTakeover'
import UsageGauge from '@/app/[market]/develop/components/chat/usage-gauge/UsageGauge'
import { useChatHistoryNavigation } from '@/app/[market]/develop/components/chat/useChatHistoryNavigation'
import { useInputActionsPanelEnabled } from '@/app/[market]/develop/components/chat/useInputActionsPanelEnabled'
import type { AiEditContext } from '@/app/[market]/develop/components/types'
import type { ActiveColorSchemeSuggest } from '@/app/[market]/develop/components/utils/findLatestColorSchemeSuggest'
import type { ActiveFontThemeSuggest } from '@/app/[market]/develop/components/utils/findLatestFontThemeSuggest'
import { useRebuildBuildQueueDriver } from '@/app/[market]/develop/hooks/useRebuildBuildQueueDriver'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { cn } from '@/lib/utils'
import { hasComposerAttachments, hasComposerSendPayload } from '@/services/transport/composerAttachments'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logActionEvent, logClickEvent } from '@/utils/instrumentation'

const PROMPT_BOX_EDITOR_SELECTOR = '.airo-input-prompt-box__entry'
const PROMPT_BOX_ACTION_BUTTON_SELECTOR = '.airo-input-prompt-box__action button'
const STOP_BUTTON_ARIA_DISABLED_CLASSES = ['opacity-25', 'cursor-not-allowed'] as const

/**
 * Locate the PromptBox inner contenteditable inside the composer card.
 * Returns null if either the card or the editor is missing; logs a one-shot
 * warn the first time the editor is missing so a class-name rename in
 * @airo-ux/pattern-library is visible in production logs without spamming.
 */
function findPromptBoxEditor(card: HTMLElement | null): HTMLElement | null {
  if (!card) return null
  const editor = card.querySelector<HTMLElement>(PROMPT_BOX_EDITOR_SELECTOR)
  if (!editor) {
    warnOnce(
      'chat-input.prompt-box-editor.not-found',
      'PromptBox inner editor (.airo-input-prompt-box__entry) not found — class name may have changed upstream.',
    )
  }
  return editor
}

function findPromptBoxActionButton(card: HTMLElement | null): HTMLButtonElement | null {
  if (!card) return null
  const btn = card.querySelector<HTMLButtonElement>(PROMPT_BOX_ACTION_BUTTON_SELECTOR)
  if (!btn) {
    warnOnce(
      'chat-input.prompt-box-action.not-found',
      'PromptBox action button (.airo-input-prompt-box__action button) not found — class name may have changed upstream.',
    )
  }
  return btn
}

const warnedSelectors = new Set<string>()
function warnOnce(event: string, message: string): void {
  if (warnedSelectors.has(event)) return
  warnedSelectors.add(event)
  logger.warn(event, { message })
}

export interface StagedChatFile {
  id: string
  file: File
  /** Set for image/* so AssetInline can show a thumbnail; revoked when removed or after send */
  previewUrl: string
}

function fileToMediaType(file: File): MediaType {
  if (file.type.startsWith('image/')) return MediaType.IMAGE
  if (file.type.startsWith('video/')) return MediaType.VIDEO
  if (file.type === 'application/pdf') return MediaType.PDF
  return MediaType.FILE
}

interface ChatInputProps {
  appId?: string | null
  inputValue?: string
  isDisabled?: boolean
  isStreaming?: boolean
  /**
   * Show the stop button (disabled) while a generation has been requested but
   * the WebSocket stream has not yet started. Lets the user see a stop button
   * during the early "creating" phase even though there's nothing to stop yet.
   */
  isAwaitingStream?: boolean
  isBudgetExceeded?: boolean
  loadingMessage?: string | null
  onInputChange: (value: string) => void
  onSendMessage: (content?: string, options?: SendMessageOptions) => void | Promise<void>
  onStopGeneration?: () => void
  selectedAssets?: AssetManagerItem[]
  maxAssets?: number
  onClearSelectedAsset?: (index: number) => void
  stagedFiles?: StagedChatFile[]
  onStageFiles?: (files: File[]) => void
  onRemoveStagedFile?: (id: string) => void
  onScreenshotCaptured?: (dataUrl: string) => void | Promise<void>
  onFileReferencesSelected?: (filePaths: string[]) => void
  onUploadError?: (errorMessage?: string) => void
  /** Staged file ids currently uploading — shows overlay spinner on each matching thumbnail */
  uploadingStagedFileIds?: readonly string[]
  referencedFiles?: Array<{ path: string; content: string }>
  onClearReferencedFile?: (index: number) => void
  aiEditContext?: AiEditContext | null
  onClearAiEditContext?: () => void
  // Multi-element selection (flag: appbuilder-multi-element-select)
  aiEditContexts?: AiEditContext[]
  onRemoveAiEditContext?: (number: number) => void
  isMultiElementSelect?: boolean
  isAnnotationModeEnabled?: boolean
  onLargePasteDetected?: (content: string) => void
  mediaLimitError?: string | null
  userMessages?: string[]
  activeColorSchemeSuggest?: ActiveColorSchemeSuggest | null
  activeFontThemeSuggest?: ActiveFontThemeSuggest | null
  /** Flag: appbuilder-queue. When true, the send button stays enabled while
   *  the agent is busy so the user can stage follow-ups in the queue. */
  isQueueEnabled?: boolean
  /** Queue is at QUEUE_MAX; gate submit while busy. */
  isQueueFull?: boolean
  composerSlots?: {
    toolbarStart?: ReactNode
    toolbarEnd?: ReactNode
  }
}

export default function ChatInput({
  appId = null,
  inputValue = '',
  isDisabled,
  isStreaming,
  isAwaitingStream = false,
  isBudgetExceeded,
  loadingMessage = null,
  onInputChange,
  onSendMessage,
  onStopGeneration,
  selectedAssets = [],
  maxAssets = 1,
  onClearSelectedAsset,
  stagedFiles = [],
  onStageFiles,
  onRemoveStagedFile,
  onScreenshotCaptured,
  onFileReferencesSelected,
  onUploadError,
  uploadingStagedFileIds = [],
  referencedFiles = [],
  onClearReferencedFile,
  aiEditContext,
  onClearAiEditContext,
  aiEditContexts = [],
  onRemoveAiEditContext,
  isMultiElementSelect = false,
  isAnnotationModeEnabled = false,
  onLargePasteDetected,
  mediaLimitError = null,
  userMessages = [],
  activeColorSchemeSuggest = null,
  activeFontThemeSuggest = null,
  isQueueEnabled = false,
  isQueueFull = false,
  composerSlots,
}: ChatInputProps) {
  const t = useTranslations();
  // Drives the sequential multi-page rebuild queue. Mounted here — not in
  // InputActionsPanel — because that panel only renders when airo-builder-chat-plans
  // is on, whereas the selector card enqueues regardless of the flag. ChatInput
  // always renders (mobile XOR desktop, inside ChatContext), so the queue is always
  // driven; the selector card only enqueues, never sends.
  useRebuildBuildQueueDriver();
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);
  const { locale } = useIntl();
  const showInputActionsPanel = useInputActionsPanelEnabled();
  const secretsComposerTakeover = useSecretsComposerTakeover();
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const isCommanderMobileSheet = useCommanderLayout() !== null && isMobile;
  const isChatGaugeEnabled = useSwitchboard('appbuilder-chat-gauge');
  const isMultilineCollapseEnabled = useSwitchboard('airo-builder-chat-collapse-multiline-input');
  const attachmentSlotsUsed = selectedAssets.length + stagedFiles.length
  const canAddAsset = attachmentSlotsUsed < maxAssets;

  const textBeforeListeningRef = useRef('')
  const promptBoxRef = useRef<PromptBoxHandle>(null)
  const composerCardRef = useRef<HTMLDivElement>(null)

  const [hideComposerPrompt, setHideComposerPrompt] = useState(false)
  const handleHideComposerPromptChange = useCallback((hidden: boolean) => {
    setHideComposerPrompt(hidden)
  }, [])
  const prevHideComposerPromptRef = useRef(hideComposerPrompt)
  useEffect(() => {
    if (prevHideComposerPromptRef.current && !hideComposerPrompt) promptBoxRef.current?.focus()
    prevHideComposerPromptRef.current = hideComposerPrompt
  }, [hideComposerPrompt])

  const [isFileDragOver, setIsFileDragOver] = useState(false)
  const [shouldCollapseUI, setShouldCollapseUI] = useState(false)
  const previousLinesRef = useRef(0)
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // True for the synchronous duration of PromptBox.handleStop, which fires
  // onStop → onChange(""). We swallow that "" so the parent's inputValue and
  // the editor's mentions stay intact (Lexical only commits an explicit-clear
  // when ExternalSyncPlugin sees a value change). Cleared via queueMicrotask
  // — onChange("") fires synchronously inside the same event handler, before
  // any microtask runs. See [[chat-input-stop-flow]].
  const isStopFlowRef = useRef(false)
  const stopDisabledEnteredAtRef = useRef<number | null>(null)

  const { handleArrowUp, handleArrowDown, resetNavigation, exitNavigationMode, navRevision } =
    useChatHistoryNavigation({
      userMessages,
      inputValue,
      onInputChange,
      appId,
      isDisabled: Boolean(isDisabled && !isStreaming),
    })

  // Drives the collapse-on-multiline UI by observing the inner editable. The
  // editable is retagged with id="chat-input-textarea" by syncEditableAttrs
  // below, so the same element-id contract from the textarea era still works.
  useEffect(function watchInputLineCountForCollapse() {
    if (!isMultilineCollapseEnabled) return

    const editorElement = document.getElementById('chat-input-textarea')
    if (!editorElement) return

    const checkLines = () => {
      const lineHeight = parseFloat(getComputedStyle(editorElement).lineHeight)
      const paddingTop = parseFloat(getComputedStyle(editorElement).paddingTop)
      const paddingBottom = parseFloat(getComputedStyle(editorElement).paddingBottom)
      const scrollHeight = editorElement.scrollHeight || editorElement.clientHeight
      const contentHeight = scrollHeight - paddingTop - paddingBottom
      const numberOfLines = Math.max(1, Math.round(contentHeight / lineHeight))

      const previousLines = previousLinesRef.current

      if (previousLines <= 3 && numberOfLines > 3) {
        setShouldCollapseUI(true)
      } else if (numberOfLines <= 3 && previousLines > 3) {
        setShouldCollapseUI(false)
      }

      previousLinesRef.current = numberOfLines
    }

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = setTimeout(checkLines, 100)
    })

    resizeObserver.observe(editorElement)

    checkLines()

    return () => {
      resizeObserver.disconnect()
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
    }
  }, [isMultilineCollapseEnabled])

  const {
    isListening,
    isSupported: isSpeechSupported,
    toggle: toggleSpeech,
    transcript: speechTranscript,
    stop: stopSpeech,
    resetTranscript,
  } = useSpeechRecognition({ language: locale })

  useEffect(function ensureMicrophoneOffOnMount() {
    if (isSpeechSupported) {
      stopSpeech()
    }
  }, [isSpeechSupported, stopSpeech])

  useEffect(function syncSpeechTranscript() {
    if (isListening && speechTranscript) {
      const baseText = textBeforeListeningRef.current
      const separator = baseText && !baseText.endsWith(' ') ? ' ' : ''
      const newText = baseText + separator + speechTranscript
      onInputChange(newText)
    }
  }, [isListening, speechTranscript, onInputChange])

  useEffect(function captureTextOnListeningStart() {
    if (isListening) {
      textBeforeListeningRef.current = inputValue
    }
  }, [isListening])

  const canStageFiles = Boolean(
    appId &&
    onStageFiles &&
    canAddAsset &&
    !((isDisabled && !isStreaming) || isBudgetExceeded || isListening)
  )

  function handleSend() {
    logClickEvent('develop.prompt.send', clickContext)();
    if (isListening) {
      textBeforeListeningRef.current = ''
      stopSpeech()
      resetTranscript()
    }
    void onSendMessage()
    resetNavigation()
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!canStageFiles || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    setIsFileDragOver(true)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!canStageFiles || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Do not gate on dataTransfer.types — it is often empty in dragleave (e.g. Firefox protected mode),
    // which would skip clearing and leave the drag ring stuck.
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsFileDragOver(false)
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!canStageFiles || !onStageFiles) return
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    setIsFileDragOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length === 0) return
    onStageFiles(files)
  }

  // PromptBox passes an image-only data URL (JPEG, ≤1024px longer edge) — no
  // extra resizing/canvas work needed here. We coerce the void-or-Promise
  // return so we can surface paste-time upload errors via the same channel as
  // the attachment-menu flow without leaking a floating Promise.
  const handleScreenshotPaste = useCallback((dataUrl: string) => {
    const result = onScreenshotCaptured?.(dataUrl)
    if (result instanceof Promise) {
      void result.catch((err: unknown) => {
        logger.error('chat-input.screenshot-paste.unexpected', {
          message: err instanceof Error ? err.message : String(err),
        })
        onUploadError?.()
      })
    }
  }, [onScreenshotCaptured, onUploadError])

  const composerAttachments = { stagedFiles, selectedAssets, referencedFiles }
  const hasAttachments = hasComposerAttachments(composerAttachments)
  const canSubmit = hasComposerSendPayload(inputValue, composerAttachments)

  function getPlaceholder() {
    if (isBudgetExceeded) return t('builder_chatinput_budget_exceeded');
    if (isDisabled && !isStreaming) return loadingMessage ?? t('builder_chatinput_processing');
    if (isQueueEnabled && (isStreaming || isAwaitingStream) && !isQueueFull) {
      return t('builder_chatinput_queue_placeholder');
    }
    return t('builder_chatinput_ask_airo');
  }

  // Drives PromptBox's `disabled` prop. `isListening` and `isBudgetExceeded`
  // are now native PromptBox props and excluded here so that PromptBox can
  // render the appropriate read-only state without conflicting with `disabled`.
  // `uploadingStagedFileIds` blocks submit only (not typing); enforced via the
  // action-button DOM toggle in syncActionButtonAttrs.
  // Keep PromptBox enabled while the stop button is in the awaiting-stream
  // disabled state so clicks reach handlePromptStop for telemetry; visual
  // disabled styling is applied in syncActionButtonAttrs via aria-disabled.
  const isAwaitingStopNotYetStreaming = Boolean(isAwaitingStream && !isStreaming && onStopGeneration)
  const isPromptDisabled =
    Boolean(isDisabled) && !isStreaming && !isAwaitingStopNotYetStreaming

  // While the agent is busy, swap the action button to Send only once the
  // user has typed something — empty input keeps the Stop button accessible.
  const isQueueModeActive =
    isQueueEnabled && (isStreaming || isAwaitingStream) && canSubmit

  const submitGated =
    !canSubmit ||
    uploadingStagedFileIds.length > 0 ||
    (isAwaitingStream && !isStreaming && !onStopGeneration) ||
    (isQueueModeActive && isQueueFull)

  function handlePromptSubmit(_value: string) {
    if (uploadingStagedFileIds.length > 0) return
    if (!isQueueModeActive && (isStreaming || isAwaitingStream) && onStopGeneration) return
    if (isQueueModeActive && isQueueFull) return
    handleSend()
  }

  // PromptBox's controlled-mode handleStop calls `onChange("")` synchronously
  // right after `onStop`. If we let that "" propagate to the parent, our
  // controlled value flips to "" and ExternalSyncPlugin's explicit-clear runs:
  // editor is wiped, mentions are removed, `onMentionRemoved` cascades, and
  // `handleMentionRemoved` (seeing `aiEditContextsRef` still populated)
  // silently calls `onRemoveAiEditContext` for every chip — wiping the
  // parent's `aiEditContexts`.
  //
  // Fix: set a ref-only flag for the synchronous duration of the stop flow
  // and have the PromptBox `onChange` swallow the "" while it's set. The
  // parent's value never changes, ExternalSyncPlugin sees no diff, and the
  // editor (text + mentions) stays intact. The flag is cleared in a
  // microtask — `onChange("")` runs synchronously inside the same event
  // handler, before any microtask fires.
  function handlePromptStop() {
    if (!isStreaming) {
      if (isAwaitingStream && onStopGeneration) {
        logActionEvent({ eid: 'develop.prompt.stop', action: 'disabled', customProperties: clickContext })()
      }
      return
    }
    logClickEvent('develop.prompt.stop', clickContext)()
    isStopFlowRef.current = true
    onStopGeneration?.()
    queueMicrotask(() => { isStopFlowRef.current = false })
  }

  // History-nav callbacks — return true to consume the keypress. The hook
  // already supports the Lexical path (pass null; caller pre-checks position).
  const handlePromptArrowUp = useCallback((cursorAtStart: boolean) => {
    if (!cursorAtStart) return false
    return handleArrowUp(null)
  }, [handleArrowUp])

  const handlePromptArrowDown = useCallback((cursorAtEnd: boolean) => {
    if (!cursorAtEnd) return false
    return handleArrowDown(null)
  }, [handleArrowDown])

  // Mention chip sync: keeps the editor's element-mention nodes in lockstep
  // with `aiEditContexts`. We hold a ref of which numbers we've inserted so
  // we can diff each render: insert new ones, remove obsolete ones. The
  // `onMentionRemoved` callback distinguishes user-driven removals (chip ✕,
  // backspace) from programmatic ones by checking whether the number is still
  // in the parent's state.
  const editedMentionNumbersRef = useRef<Set<number>>(new Set())
  // Inline-hydrated so render-vs-effect ordering can't desync the chip-removed
  // discriminator: a chip ✕ click that fires onMentionRemoved during the same
  // commit must see the latest aiEditContexts, not a stale ref from an effect
  // that hasn't run yet.
  const aiEditContextsRef = useRef(aiEditContexts)
  aiEditContextsRef.current = aiEditContexts

  useEffect(function syncMentionChips() {
    const handle = promptBoxRef.current
    if (!handle) return

    const desired = (isMultiElementSelect || isAnnotationModeEnabled)
      ? aiEditContexts.filter((c): c is AiEditContext & { number: number } => c.number != null)
      : []
    const desiredNumbers = new Set(desired.map(c => c.number))
    const tracked = editedMentionNumbersRef.current

    // Each insert/remove is wrapped in try/catch: a single Lexical-side
    // failure (e.g. the editor was unmounted mid-effect) shouldn't permanently
    // desync the diff for the remaining chips.
    for (const ctx of desired) {
      if (!tracked.has(ctx.number)) {
        try {
          handle.insertElementMention(ctx.number, ctx.elementInfo.tagName)
          tracked.add(ctx.number)
        } catch (err: unknown) {
          logger.error('chat-input.mention-chip.insert-failed', {
            number: ctx.number,
            tagName: ctx.elementInfo.tagName,
            message: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    for (const num of Array.from(tracked)) {
      if (!desiredNumbers.has(num)) {
        try {
          handle.removeElementMention(num)
          tracked.delete(num)
        } catch (err: unknown) {
          logger.error('chat-input.mention-chip.remove-failed', {
            number: num,
            message: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
  }, [aiEditContexts, isMultiElementSelect, isAnnotationModeEnabled])

  const handleMentionRemoved = useCallback((num: number) => {
    // Programmatic removal — parent's state already reflects it. No-op.
    if (!aiEditContextsRef.current.some(c => c.number === num)) return
    editedMentionNumbersRef.current.delete(num)
    onRemoveAiEditContext?.(num)
  }, [onRemoveAiEditContext])

  // Restore id/data-testid on the inner Lexical contenteditable so test
  // selectors and shortcutFocus's `#chat-input-textarea` lookup keep working,
  // and bind the Modifier+Enter newline listener. We share a single
  // MutationObserver so both side-effects survive any future remount of the
  // contenteditable (e.g. PromptBox swapping its inner Lexical instance):
  // every time the matching node appears under the composer card, retag and
  // re-bind. PromptBox owns the editor's `id` (auto-generated via useId), so
  // overriding is safe — the auto-id is not used for label association in
  // PromptBox 6.0.
  //
  // Refs so the keydown listener sees fresh values without re-binding
  // (inputValue / onInputChange change frequently).
  const inputValueRef = useRef(inputValue)
  inputValueRef.current = inputValue
  const onInputChangeRef = useRef(onInputChange)
  onInputChangeRef.current = onInputChange

  useLayoutEffect(function tagAndBindInnerEditor() {
    const card = composerCardRef.current
    if (!card) return

    let currentEditor: HTMLElement | null = null

    // Modifier+Enter (Alt/Meta/Ctrl) → insert newline. PromptBox 6.0's
    // KeyboardPlugin only treats Shift+Enter as newline; every other modifier
    // submits. We capture-phase intercept and splice "\n" into `inputValue`
    // at the caret position derived from window.getSelection(), then let
    // ExternalSyncPlugin rebuild the editor with the new content. Tracked
    // for upstream removal in DF-4879.
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Enter') return
      if (!(e.altKey || e.metaKey || e.ctrlKey)) return
      if (e.shiftKey) return // Shift+Enter is already a newline; don't double-handle.
      e.preventDefault()
      e.stopPropagation()
      // WARNING: silences future same-element listeners (PromptBox's submit
      // listener registers later via Lexical's KeyboardPlugin and would also
      // see this Enter). Remove together with this whole shim under DF-4879.
      e.stopImmediatePropagation()

      const editor = currentEditor
      const current = inputValueRef.current
      const sel = window.getSelection()
      let offset = current.length
      let usedSelection = false
      if (sel && sel.rangeCount > 0 && editor) {
        const range = sel.getRangeAt(0)
        if (editor.contains(range.startContainer)) {
          const preRange = document.createRange()
          preRange.selectNodeContents(editor)
          preRange.setEnd(range.startContainer, range.startOffset)
          offset = preRange.toString().length
          usedSelection = true
        }
      }
      if (!usedSelection) {
        // Selection isn't inside the editor (focus moved during the keydown,
        // or window.getSelection() is empty). Falling back to end-of-buffer
        // is correct for the focused-but-empty case but worth a breadcrumb if
        // it shows up unexpectedly.
        logger.warn('chat-input.modifier-enter.selection-out-of-editor', {
          hasSelection: Boolean(sel && sel.rangeCount > 0),
        })
      }

      const next = current.slice(0, offset) + '\n' + current.slice(offset)
      onInputChangeRef.current(next)
    }

    function attach(editor: HTMLElement): void {
      if (currentEditor === editor) return
      detach()
      currentEditor = editor
      editor.id = 'chat-input-textarea'
      editor.setAttribute('data-testid', 'chat-input-textarea')
      editor.addEventListener('keydown', onKeyDown, { capture: true })
    }

    function detach(): void {
      if (!currentEditor) return
      currentEditor.removeEventListener('keydown', onKeyDown, { capture: true })
      currentEditor = null
    }

    function syncFromDOM(): void {
      const editor = findPromptBoxEditor(card)
      if (!editor) {
        detach()
        return
      }
      attach(editor)
    }

    syncFromDOM()
    const observer = new MutationObserver(syncFromDOM)
    observer.observe(card, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      detach()
    }
  }, [])

  // After history navigation, ExternalSyncPlugin rebuilds the editor with the
  // recalled message but doesn't move the caret to the end. Without this, a
  // 2nd ArrowUp would report cursorAtStart=true and continue navigating
  // instead of being gated. We collapse the DOM Selection to the end of the
  // editable on every navRevision tick. Tracked for upstream removal in DF-4880.
  useLayoutEffect(function moveCursorToEndAfterHistoryNav() {
    if (navRevision === 0) return
    const editor = findPromptBoxEditor(composerCardRef.current)
    if (!editor) return
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(range)
  }, [navRevision])

  // Restore id/data-testid on PromptBox's action button + handle the
  // awaiting-stream "stop visible but disabled" case + uploads-pending submit
  // gate. PromptBox has no API for either; we reach into its action wrapper
  // by class name. We OR `isPromptDisabled` so the action button stays
  // disabled in the isDisabled / isBudgetExceeded cases too.
  //
  // Uses a MutationObserver (like tagAndBindInnerEditor) so attributes are
  // re-applied when React reconciliation replaces or updates the button DOM
  // element — the layout effect alone missed re-renders where its deps were
  // unchanged but the button lost imperative attributes.
  const actionButtonStateRef = useRef({ isStreaming, isAwaitingStream, onStopGeneration, submitGated, isPromptDisabled, isBudgetExceeded, isQueueModeActive })
  actionButtonStateRef.current = { isStreaming, isAwaitingStream, onStopGeneration, submitGated, isPromptDisabled, isBudgetExceeded, isQueueModeActive }

  useLayoutEffect(function syncActionButtonAttrs() {
    const card = composerCardRef.current
    if (!card) return

    function applyAttrs(btn: HTMLButtonElement): void {
      const { isStreaming: streaming, isAwaitingStream: awaiting, onStopGeneration: onStop, submitGated: gated, isPromptDisabled: promptDisabled, isBudgetExceeded: budgetExceeded, isQueueModeActive: queueActive } = actionButtonStateRef.current
      const isPending = !queueActive && Boolean((streaming || awaiting) && onStop)
      const isAwaitingNotStreaming = Boolean(awaiting && !streaming && onStop)
      if (isPending) {
        btn.setAttribute('data-testid', 'chat-stop-button')
        btn.removeAttribute('id')
        if (isAwaitingNotStreaming) {
          btn.removeAttribute('disabled')
          btn.setAttribute('aria-disabled', 'true')
          btn.setAttribute('tabindex', '-1')
          btn.classList.add(...STOP_BUTTON_ARIA_DISABLED_CLASSES)
        } else {
          btn.removeAttribute('aria-disabled')
          btn.removeAttribute('tabindex')
          btn.classList.remove(...STOP_BUTTON_ARIA_DISABLED_CLASSES)
          btn.toggleAttribute('disabled', false)
        }
      } else {
        btn.setAttribute('data-testid', 'chat-send-button')
        btn.id = 'chat-send-button'
        btn.removeAttribute('aria-disabled')
        btn.removeAttribute('tabindex')
        btn.classList.remove(...STOP_BUTTON_ARIA_DISABLED_CLASSES)
        btn.toggleAttribute('disabled', gated || promptDisabled || Boolean(budgetExceeded))
      }
    }

    const observerOptions: MutationObserverInit = { childList: true, subtree: true }

    const btn = findPromptBoxActionButton(card)
    if (btn) applyAttrs(btn)

    const observer = new MutationObserver(() => {
      const current = findPromptBoxActionButton(card)
      if (!current) return
      observer.disconnect()
      applyAttrs(current)
      observer.observe(card, observerOptions)
    })
    observer.observe(card, observerOptions)
    return () => { observer.disconnect() }
  }, [isStreaming, isAwaitingStream, onStopGeneration, submitGated, isPromptDisabled, isBudgetExceeded, isQueueModeActive])

  useEffect(function trackStopButtonDisabledTransitions() {
    const isStopVisible = !isQueueModeActive && Boolean((isStreaming || isAwaitingStream) && onStopGeneration)
    const isStopDisabled = isStopVisible && Boolean(isAwaitingStream && !isStreaming)

    if (isStopDisabled) {
      if (stopDisabledEnteredAtRef.current == null) {
        const disabledAt = Date.now()
        stopDisabledEnteredAtRef.current = disabledAt
        logActionEvent({
          eid: 'develop.prompt.stop',
          action: 'load',
          customProperties: { ...clickContext, disabledAt },
        })()
      }
      return
    }

    if (stopDisabledEnteredAtRef.current != null && isStreaming && isStopVisible) {
      const enabledAt = Date.now()
      logActionEvent({
        eid: 'develop.prompt.stop',
        action: 'focus',
        customProperties: {
          ...clickContext,
          enabledAt,
          disabledDurationMs: enabledAt - stopDisabledEnteredAtRef.current,
        },
      })()
      stopDisabledEnteredAtRef.current = null
      return
    }

    if (!isStopVisible) {
      stopDisabledEnteredAtRef.current = null
    }
  }, [isAwaitingStream, isStreaming, onStopGeneration, clickContext, isQueueModeActive])

  const actionsPanel =
    showInputActionsPanel && secretsComposerTakeover == null ? (
      <InputActionsPanel
        activeColorSchemeSuggest={activeColorSchemeSuggest}
        activeFontThemeSuggest={activeFontThemeSuggest}
        shouldCollapse={isMultilineCollapseEnabled ? shouldCollapseUI : false}
        onHideComposerPromptChange={handleHideComposerPromptChange}
      />
    ) : null

  return (
    <div className={cn(isCommanderMobileSheet ? 'px-0' : 'px-2 sm:px-3 md:px-0', 'mt-1 mt-auto pb-1')}>
      <div id="tour-chat-input" className="relative flex flex-col gap-1.5" data-chat-composer-card>
        {actionsPanel && isCommanderMobileSheet ? (
          <div className="max-h-[40vh] overflow-y-auto px-2 -mx-2 min-h-0">{actionsPanel}</div>
        ) : (
          actionsPanel
        )}

        <FloatingFooter
          ref={composerCardRef}
          data-testid="chat-input-card"
          orientation="vertical"
          className={cn(
            'mb-px focus-within:ring-1 focus-within:ring-ai-light',
            isFileDragOver && 'ring-2 ring-ai-light ring-offset-1',
          )}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Multi-page rebuild progress/Stop. Mounted here — not in InputActionsPanel —
              so it survives across the build AND shows regardless of chat-plans (the
              driver runs flag-independently, so the chat-plans-off cohort can start a
              batch and must be able to see/stop it). Renders nothing when idle. */}
          <RebuildQueueProgress />

          {/* AI Edit Context - shows screenshot (works for both Edit with AI and Replace Image) */}
          {aiEditContext && aiEditContext.screenshot && (
            <div className="mb-1">
              <AssetInline
                customAsset={{
                  imageUrl: aiEditContext.screenshot,
                  imageAlt: t('builder_chatpane_edit_selected'),
                  mediaType: MediaType.IMAGE}
                }
                onClear={onClearAiEditContext}
                mode={AssetMode.EDIT}
              />
            </div>
          )}

          {/* AI Edit Context - element-only (no screenshot) — single-select mode only.
              Multi-element-select renders mentions inline inside PromptBox via
              insertElementMention(); see syncMentionChips above. */}
          {!isMultiElementSelect && aiEditContext && !aiEditContext.screenshot && (
            <div className="mb-1">
              <Chip
                size="sm"
                icon={<CodeIcon className="size-2.5" />}
                label={`<${aiEditContext.elementInfo.tagName}>`}
                onRemove={onClearAiEditContext}
              />
            </div>
          )}

          {/* Referenced files */}
          {referencedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {referencedFiles.map((file, index) => (
                <div
                  key={file.path}
                  className="flex items-center gap-1 px-2 py-1 bg-intents-ux-box-backgroundColor border border-intents-ux-boxHighContrast-borderColor rounded text-xs"
                >
                  <span className="text-intents-ux-box-foregroundColor">{file.path.split('/').pop()}</span>
                  <button
                    onClick={() => onClearReferencedFile?.(index)}
                    className="text-intents-ux-box-foregroundColor/50 hover:text-intents-ux-box-foregroundColor"
                    aria-label="Remove referenced file"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Selected assets and staged local files (upload overlay on staged items) */}
          {(selectedAssets.length > 0 || stagedFiles.length > 0) && (
            <div className="flex flex-wrap gap-1 mb-1">
              {selectedAssets.map((asset, index) => (
                <AssetInline
                  key={asset.imageUrl ?? `asset-${index}`}
                  asset={asset}
                  onClear={() => onClearSelectedAsset?.(index)}
                  mode={AssetMode.EDIT}
                />
              ))}

              {stagedFiles.map((s) => (
                <AssetInline
                  key={s.id}
                  customAsset={{
                    mediaType: fileToMediaType(s.file),
                    imageUrl: s.previewUrl || undefined,
                    filename: s.file.name,
                    imageAlt: s.file.name,
                  }}
                  onClear={() => onRemoveStagedFile?.(s.id)}
                  mode={AssetMode.EDIT}
                  isLoading={uploadingStagedFileIds.includes(s.id)}
                />
              ))}
            </div>
          )}

          {mediaLimitError && (
            <div className="mb-1 px-1" role="alert" data-testid="chat-attachment-limit-error">
              <TextLockup size="sm" emphasis="critical" icon={<AsyncIcon icon="alert" />}>
                <text.span as="caption" size={-1} emphasis="critical">
                  {mediaLimitError}
                </text.span>
              </TextLockup>
            </div>
          )}

          {!hideComposerPrompt && (
          <PromptBox
            ref={promptBoxRef}
            appearance="borderless"
            value={inputValue}
            onChange={(v) => {
              // PromptBox.handleStop synchronously fires onChange(""). Swallow
              // it during the stop-flow window so the typed buffer and mention
              // chips survive — see handlePromptStop comment for details.
              if (isStopFlowRef.current && v === '') return
              if (isListening) return
              exitNavigationMode()
              onInputChange(v)
            }}
            onSubmit={handlePromptSubmit}
            onStop={handlePromptStop}
            allowEmptySubmit={hasAttachments}
            pending={!isQueueModeActive && Boolean((isStreaming || isAwaitingStream) && onStopGeneration)}
            disabled={isPromptDisabled}
            isListening={isListening}
            isBudgetExceeded={Boolean(isBudgetExceeded)}
            placeholder={getPlaceholder()}
            submitLabel={t('builder_chatinput_send')}
            stopLabel={t('builder_chatinput_stop')}
            canStageFiles={canStageFiles}
            onStageFiles={onStageFiles}
            canAddAsset={canAddAsset && Boolean(onScreenshotCaptured)}
            onScreenshotCaptured={handleScreenshotPaste}
            onLargePasteDetected={onLargePasteDetected}
            onArrowUp={handlePromptArrowUp}
            onArrowDown={handlePromptArrowDown}
            onMentionRemoved={handleMentionRemoved}
            toolbarStart={
              composerSlots?.toolbarStart ?? (
                <div className="flex items-center">
                  {appId && onStageFiles && (
                    <ChatAttachmentMenu
                      appId={appId}
                      onStageFiles={onStageFiles}
                      onScreenshotCaptured={onScreenshotCaptured}
                      onFileReferencesSelected={onFileReferencesSelected}
                      onUploadError={onUploadError}
                      disabled={(Boolean(isDisabled) && !isStreaming) || Boolean(isBudgetExceeded) || !canAddAsset}
                    />
                  )}
                  <DebugStatsToggleButton />
                  {isChatGaugeEnabled && <UsageGauge appId={appId} />}
                </div>
              )
            }
            beforeSubmit={(() => {
              const micButton = isSpeechSupported ? (
                <Button
                  onClick={() => {
                    logClickEvent('develop.prompt.speech', clickContext)()
                    toggleSpeech()
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  disabled={(Boolean(isDisabled) && !isStreaming) || Boolean(isBudgetExceeded)}
                  design={isListening ? 'critical' : 'tertiary'}
                  active={isListening}
                  icon={isListening ? <StopIcon /> : <MicIcon />}
                  size="sm"
                  aria-label={isListening ? t('builder_homepage_hero_stop_listening', undefined, 'Stop listening') : t('builder_chatinput_start_listening', undefined, 'Start listening')}
                  aria-pressed={isListening}
                />
              ) : null
              if (composerSlots?.toolbarEnd) {
                return (
                  <div className="flex items-center gap-0.5 me-1">
                    {composerSlots.toolbarEnd}
                    {micButton}
                  </div>
                )
              }
              return micButton
            })()}
          />
          )}
        </FloatingFooter>
      </div>
    </div>
  )
}
