'use client'

import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  type EditorState,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
} from 'lexical'
import {
  BeautifulMentionNode,
  BeautifulMentionsPlugin,
  createBeautifulMentionNode,
  useBeautifulMentions,
} from 'lexical-beautiful-mentions'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'


const MAX_INLINE_PASTE_LENGTH = 4_000

export interface LexicalChatEditorHandle {
  insertElementMention: (number: number, tagName: string) => void
  removeElementMention: (number: number) => void
  clearAllElementMentions: () => void
  focus: () => void
}

interface LexicalChatEditorProps {
  inputValue: string
  onInputChange: (value: string) => void
  onSubmit: () => void
  canSubmit: boolean
  isDisabled: boolean
  isStreaming: boolean
  isBudgetExceeded: boolean
  isListening: boolean
  uploadingStagedFileIds: readonly string[]
  onStopGeneration?: () => void
  onLargePasteDetected?: (content: string) => void
  onStageFiles?: (files: File[]) => void
  onScreenshotCaptured?: (dataUrl: string) => void
  canStageFiles: boolean
  canAddAsset: boolean
  placeholder: string
  // History navigation
  onArrowUp: (cursorAtStart: boolean) => boolean
  onArrowDown: (cursorAtEnd: boolean) => boolean
  exitNavigationMode: () => void
  // Mention deletion callback
  onMentionRemoved?: (number: number) => void
}

const TAG_LABELS: Record<string, string> = {
  h1: 'Title', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
  p: 'Text', span: 'Text', blockquote: 'Quote', figcaption: 'Caption',
  img: 'Image', picture: 'Image', video: 'Video', svg: 'Icon',
  a: 'Link', button: 'Button',
  ul: 'List', ol: 'List', li: 'List item',
  code: 'Code', pre: 'Code',
  section: 'Section', nav: 'Nav', header: 'Header', footer: 'Footer',
}

/** Custom mention component rendered inline in the editor */
function ElementMentionComponent({ value, 'data-beautiful-mention': mentionAttr }: { trigger: string; value: string; data?: Record<string, string>; 'data-beautiful-mention': string }) {
  const match = value.match(/^(\d+)\s*<([^>]+)>/)
  const num = match?.[1] ?? value
  const tag = match?.[2] ?? ''
  const label = TAG_LABELS[tag] ?? tag

  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 mx-0.5 bg-[#f5f3ff] border border-[#c4b5fd] rounded-sm text-xs font-medium text-[#5b21b6] align-baseline cursor-pointer hover:bg-[#ede9fe] transition-colors"
      contentEditable={false}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        document.dispatchEvent(new CustomEvent('scroll-to-mention', { detail: { number: Number(num) } }))
      }}
    >
      <span className="text-[#8B5CF6] font-bold">#{num}</span>
      &nbsp;{label}
      <button
        type="button"
        className="ml-0.5 text-[10px] text-[#7c3aed] hover:text-[#5b21b6] hover:bg-[#ede9fe] rounded-sm px-0.5 leading-none transition-colors cursor-pointer"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          document.dispatchEvent(new CustomEvent('remove-mention', { detail: { value, mentionAttr } }))
        }}
        onClick={(e) => e.stopPropagation()}
        aria-label="Remove"
      >
        ✕
      </button>
    </span>
  )
}

const MENTION_ITEMS: Record<string, string[]> = {
  '#': [],
}

const [CustomMentionNode, CustomMentionNodeReplacement] = createBeautifulMentionNode(ElementMentionComponent)

const MENTION_THEME = {
  '#': 'lexical-element-mention',
}

/** Plugin: Enter to send, Shift+Enter for newline */
function KeyboardPlugin({
  onSubmit,
  canSubmit,
  isStreaming,
  onStopGeneration,
  uploadingStagedFileIds,
  onArrowUp,
  onArrowDown,
  exitNavigationMode,
}: Pick<
  LexicalChatEditorProps,
  'onSubmit' | 'canSubmit' | 'isStreaming' | 'onStopGeneration' | 'uploadingStagedFileIds' | 'onArrowUp' | 'onArrowDown' | 'exitNavigationMode'
>) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const removeEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event?.shiftKey) return false // Let Lexical handle Shift+Enter (newline)
        event?.preventDefault()
        if (
          canSubmit &&
          uploadingStagedFileIds.length === 0 &&
          !(isStreaming && onStopGeneration)
        ) {
          onSubmit()
        }
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    const removeArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false
        const anchorOffset = selection.anchor.offset
        const isAtStart = anchorOffset === 0 && selection.anchor.key === $getRoot().getFirstChild()?.getKey()
        if (onArrowUp(isAtStart)) {
          event?.preventDefault()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH,
    )

    const removeArrowDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false
        const root = $getRoot()
        const lastChild = root.getLastChild()
        const isAtEnd = selection.anchor.key === lastChild?.getKey() &&
          selection.anchor.offset === (lastChild?.getTextContentSize() ?? 0)
        if (onArrowDown(isAtEnd)) {
          event?.preventDefault()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH,
    )

    return () => {
      removeEnter()
      removeArrowUp()
      removeArrowDown()
    }
  }, [editor, onSubmit, canSubmit, isStreaming, onStopGeneration, uploadingStagedFileIds, onArrowUp, onArrowDown])

  // Sync text changes to exit navigation mode
  useEffect(() => {
    return editor.registerTextContentListener(() => {
      exitNavigationMode()
    })
  }, [editor, exitNavigationMode])

  return null
}

/** Plugin: Intercept paste for large text detection and file handling */
function PastePlugin({
  onLargePasteDetected,
  onStageFiles,
  onScreenshotCaptured,
  canStageFiles,
  canAddAsset,
  isDisabled,
  isBudgetExceeded,
  isListening,
}: Pick<
  LexicalChatEditorProps,
  'onLargePasteDetected' | 'onStageFiles' | 'onScreenshotCaptured' | 'canStageFiles' | 'canAddAsset' | 'isDisabled' | 'isBudgetExceeded' | 'isListening'
>) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardEvent = event as ClipboardEvent
        if (!clipboardEvent.clipboardData) return false

        // Large text paste detection
        if (onLargePasteDetected) {
          const text = clipboardEvent.clipboardData.getData('text/plain')
          if (text.length > MAX_INLINE_PASTE_LENGTH) {
            clipboardEvent.preventDefault()
            onLargePasteDetected(text)
            return true
          }
        }

        if (isDisabled || isBudgetExceeded || isListening) return false

        // File paste
        const items = clipboardEvent.clipboardData.items
        if (items) {
          const files: File[] = []
          for (const item of Array.from(items)) {
            if (item.kind === 'file') {
              const f = item.getAsFile()
              if (f) files.push(f)
            }
          }
          if (files.length > 0 && canStageFiles && onStageFiles) {
            clipboardEvent.preventDefault()
            onStageFiles(files)
            return true
          }

          // Image paste for screenshot
          const imageItem = Array.from(items).find(item => item.type.startsWith('image/'))
          if (imageItem && canAddAsset && onScreenshotCaptured) {
            const file = imageItem.getAsFile()
            if (file) {
              clipboardEvent.preventDefault()
              const objectUrl = URL.createObjectURL(file)
              const img = new Image()
              img.onload = () => {
                try {
                  const maxDimension = 1024
                  const scale = Math.min(1, maxDimension / img.width, maxDimension / img.height)
                  const canvas = document.createElement('canvas')
                  canvas.width = Math.round(img.width * scale)
                  canvas.height = Math.round(img.height * scale)
                  const ctx = canvas.getContext('2d')
                  if (!ctx) return
                  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
                  onScreenshotCaptured(canvas.toDataURL('image/jpeg', 0.75))
                } finally {
                  URL.revokeObjectURL(objectUrl)
                }
              }
              img.onerror = () => URL.revokeObjectURL(objectUrl)
              img.src = objectUrl
              return true
            }
          }
        }

        return false // Let Lexical handle normal text paste
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, onLargePasteDetected, onStageFiles, onScreenshotCaptured, canStageFiles, canAddAsset, isDisabled, isBudgetExceeded, isListening])

  return null
}

/** Plugin: Sync external inputValue changes into editor (for speech recognition & history nav).
 *  Skips syncing when the change originated from inside the editor (typing). */
function ExternalSyncPlugin({
  inputValue,
  isListening,
  internalChangeRef,
  isSyncingExternallyRef,
}: {
  inputValue: string
  isListening: boolean
  internalChangeRef: React.RefObject<boolean>
  isSyncingExternallyRef: React.MutableRefObject<boolean>
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    // Skip if the change came from the editor's own onChange,
    // but always honor an explicit clear (inputValue === '') so that
    // programmatic clears (e.g. startNewStream after auto-send) still apply.
    if (internalChangeRef.current) {
      internalChangeRef.current = false
      if (inputValue !== '') return
    }

    isSyncingExternallyRef.current = true
    editor.update(
      () => {
        const root = $getRoot()
        // Strip mention text from current content for comparison, since
        // inputValue (from speech/history) won't contain mention markup
        let plainText = ''
        const mentionNodes: InstanceType<typeof BeautifulMentionNode>[] = []
        root.getChildren().forEach(child => {
          if ($isElementNode(child)) {
            child.getChildren().forEach(node => {
              if (node instanceof BeautifulMentionNode) {
                mentionNodes.push(node)
              } else {
                plainText += node.getTextContent()
              }
            })
          }
        })
        if (plainText.trim() === inputValue.trim() && mentionNodes.length > 0) return
        if (root.getTextContent() === inputValue) return

        // Preserve existing mention nodes — only replace text content
        root.clear()
        const paragraph = $createParagraphNode()
        if (inputValue) {
          paragraph.append($createTextNode(inputValue))
        }
        // Re-append mention nodes
        for (const mention of mentionNodes) {
          paragraph.append($createTextNode(' '))
          paragraph.append(mention)
        }
        root.append(paragraph)
      },
      {
        onUpdate: () => {
          isSyncingExternallyRef.current = false
        },
      },
    )
  }, [editor, inputValue, isListening, internalChangeRef, isSyncingExternallyRef])

  return null
}

/** Inner component that has access to editor context */
const LexicalChatEditorInner = forwardRef<LexicalChatEditorHandle, LexicalChatEditorProps>(
  function LexicalChatEditorInner(props, ref) {
    const [editor] = useLexicalComposerContext()
    const { insertMention } = useBeautifulMentions()
    const internalChangeRef = useRef(false)
    const isSyncingExternallyRef = useRef(false)

    useImperativeHandle(ref, () => ({
      insertElementMention(number: number, tagName: string) {
        prevMentionNumbersRef.current.add(number)
        insertMention({
          trigger: '#',
          value: `${number} <${tagName}>`,
        })
      },
      removeElementMention(number: number) {
        editor.update(() => {
          const root = $getRoot()
          root.getChildren().forEach(child => {
            if ($isElementNode(child)) {
              child.getChildren().forEach(node => {
                if (node instanceof BeautifulMentionNode) {
                  const value = node.getValue()
                  if (value.startsWith(`${number} `)) {
                    node.remove()
                  }
                }
              })
            }
          })
        })
      },
      clearAllElementMentions() {
        editor.update(() => {
          const root = $getRoot()
          root.getChildren().forEach(child => {
            if ($isElementNode(child)) {
              child.getChildren().forEach(node => {
                if (node instanceof BeautifulMentionNode) {
                  node.remove()
                }
              })
            }
          })
        })
      },
      focus() {
        editor.focus()
      },
    }), [editor, insertMention])

    const prevMentionNumbersRef = useRef(new Set<number>())

    const handleChange = useCallback(
      (editorState: EditorState) => {
        editorState.read(() => {
          const text = $getRoot().getTextContent()
          if (!isSyncingExternallyRef.current) {
            internalChangeRef.current = true
          }
          props.onInputChange(text)

          // Detect removed mentions
          if (props.onMentionRemoved) {
            const currentNumbers = new Set<number>()
            const root = $getRoot()
            root.getChildren().forEach(child => {
              if ($isElementNode(child)) {
                child.getChildren().forEach(node => {
                  if (node instanceof BeautifulMentionNode) {
                    const value = node.getValue()
                    const match = value.match(/^(\d+)\s/)
                    if (match) currentNumbers.add(Number(match[1]))
                  }
                })
              }
            })
            // Check for removed numbers
            for (const num of prevMentionNumbersRef.current) {
              if (!currentNumbers.has(num)) {
                props.onMentionRemoved(num)
              }
            }
            prevMentionNumbersRef.current = currentNumbers
          }
        })
      },
      [props.onInputChange, props.onMentionRemoved],
    )

    // Listen for remove-mention custom events from the X button in mention chips
    useEffect(() => {
      const handler = (e: Event) => {
        const { value } = (e as CustomEvent).detail
        editor.update(() => {
          const root = $getRoot()
          root.getChildren().forEach(child => {
            if ($isElementNode(child)) {
              child.getChildren().forEach(node => {
                if (node instanceof BeautifulMentionNode && node.getValue() === value) {
                  node.remove()
                }
              })
            }
          })
        })
      }
      document.addEventListener('remove-mention', handler)
      return () => document.removeEventListener('remove-mention', handler)
    }, [editor])

    const disabled = (props.isDisabled && !props.isStreaming) || props.isListening || props.isBudgetExceeded

    useEffect(() => {
      editor.setEditable(!disabled)
    }, [editor, disabled])

    return (
      <>
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              id="chat-input-textarea"
              data-testid="chat-input-textarea"
              className="w-full h-full resize-none border-0 focus:ring-0 focus:outline-none text-base md:text-sm chat-input-text min-h-[4.5rem] outline-none"
              aria-disabled={disabled}
              aria-placeholder={props.placeholder}
              placeholder={
                <div className="pointer-events-none absolute top-0 left-0 text-intents-ux-controlVoid-foregroundColor text-base md:text-sm p-0">
                  {props.placeholder}
                </div>
              }
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <BeautifulMentionsPlugin
          items={MENTION_ITEMS}
          menuComponent={() => null}
        />
        <OnChangePlugin onChange={handleChange} />
        <KeyboardPlugin
          onSubmit={props.onSubmit}
          canSubmit={props.canSubmit}
          isStreaming={props.isStreaming}
          onStopGeneration={props.onStopGeneration}
          uploadingStagedFileIds={props.uploadingStagedFileIds}
          onArrowUp={props.onArrowUp}
          onArrowDown={props.onArrowDown}
          exitNavigationMode={props.exitNavigationMode}
        />
        <PastePlugin
          onLargePasteDetected={props.onLargePasteDetected}
          onStageFiles={props.onStageFiles}
          onScreenshotCaptured={props.onScreenshotCaptured}
          canStageFiles={props.canStageFiles}
          canAddAsset={props.canAddAsset}
          isDisabled={props.isDisabled}
          isBudgetExceeded={props.isBudgetExceeded}
          isListening={props.isListening}
        />
        <ExternalSyncPlugin
          inputValue={props.inputValue}
          isListening={props.isListening}
          internalChangeRef={internalChangeRef}
          isSyncingExternallyRef={isSyncingExternallyRef}
        />
      </>
    )
  },
)

const LexicalChatEditor = forwardRef<LexicalChatEditorHandle, LexicalChatEditorProps>(
  function LexicalChatEditor(props, ref) {
    const initialConfig = {
      namespace: 'ChatEditor',
      theme: {
        beautifulMentions: MENTION_THEME,
      },
      nodes: [CustomMentionNode, CustomMentionNodeReplacement],
      onError: (error: Error) => {
        console.error('Lexical error:', error)
      },
    }

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <div className="relative flex-1">
          <LexicalChatEditorInner ref={ref} {...props} />
        </div>
      </LexicalComposer>
    )
  },
)

export default LexicalChatEditor
