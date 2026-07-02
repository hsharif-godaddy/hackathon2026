'use client'

import { type EditorState, type LexicalEditor } from 'lexical'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { CodeNode } from '@lexical/code'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CODE,
  HEADING,
  HIGHLIGHT,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  type Transformer,
  UNORDERED_LIST,
} from '@lexical/markdown'
import { type InitialConfigType } from '@lexical/react/LexicalComposer'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'

import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { extractFrontmatter } from './docsFrontmatter'

const DOCS_TRANSFORMERS: Transformer[] = [
  CODE,
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  HIGHLIGHT,
  INLINE_CODE,
  LINK,
]

interface DocsEditorProps {
  appId: string
  filePath: string
  initialContent: string
  onSaved: (content: string) => void
}

function SavePlugin({ appId, filePath, editorRef, frontmatter, onSaved }: {
  appId: string
  filePath: string
  editorRef: React.RefObject<LexicalEditor | null>
  frontmatter: string
  onSaved: (content: string) => void
}): null {
  const save = useCallback((exitOnSuccess: boolean = false) => {
    const editor: LexicalEditor | null = editorRef.current
    if (!editor) return
    editor.update(() => {
      const body: string = $convertToMarkdownString(DOCS_TRANSFORMERS)
      const fullContent: string = frontmatter + body
      appService.writeFile(appId, filePath, fullContent)
        .then(() => {
          useDevelopPageStore.getState().setDocsDirty(false)
          if (exitOnSuccess) useDevelopPageStore.getState().setDocsEditing(false)
          onSaved(fullContent)
        })
        .catch((err: unknown) => {
          logger.error('docs-editor.save.failure', { appId, filePath, error: err instanceof Error ? err.message : String(err) })
        })
    })
  }, [appId, filePath, editorRef, frontmatter, onSaved])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        save(false)
      }
    }
    const handleSaveEvent = (): void => { save(false) }
    const handleSaveAndExitEvent = (): void => { save(true) }
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('docs-save', handleSaveEvent)
    window.addEventListener('docs-save-and-exit', handleSaveAndExitEvent)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('docs-save', handleSaveEvent)
      window.removeEventListener('docs-save-and-exit', handleSaveAndExitEvent)
    }
  }, [save])

  return null
}

export default function DocsEditor({ appId, filePath, initialContent, onSaved }: DocsEditorProps) {
  const editorRef = useRef<LexicalEditor | null>(null)
  const { frontmatter, body: initialBody } = useMemo(() => extractFrontmatter(initialContent), [initialContent])

  const initialConfig: InitialConfigType = {
    namespace: 'docs-editor',
    nodes: [CodeNode, HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode],
    editorState: () => {
      $convertFromMarkdownString(initialBody, DOCS_TRANSFORMERS)
    },
    onError: (error: Error) => {
      logger.error('docs-editor.lexical.error', { error: error.message })
    },
    theme: {
      paragraph: 'docs-editor-paragraph',
      heading: {
        h1: 'docs-editor-h1',
        h2: 'docs-editor-h2',
        h3: 'docs-editor-h3',
      },
      list: {
        ul: 'docs-editor-ul',
        ol: 'docs-editor-ol',
        listitem: 'docs-editor-li',
      },
      quote: 'docs-editor-quote',
      link: 'docs-editor-link',
      text: {
        bold: 'font-bold',
        italic: 'italic',
        strikethrough: 'line-through',
        code: 'docs-editor-code',
      },
    },
  }

  const isFirstChange = useRef(true)
  const handleChange = useCallback((_editorState: EditorState, editor: LexicalEditor) => {
    editorRef.current = editor
    if (isFirstChange.current) {
      isFirstChange.current = false
      return
    }
    useDevelopPageStore.getState().setDocsDirty(true)
  }, [])

  const handleEditorRef = useCallback((editor: LexicalEditor) => {
    editorRef.current = editor
  }, [])

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <EditorRefPlugin onRef={handleEditorRef} />
      <div className="h-full flex flex-col">
        <div className="flex-1 overflow-auto p-4">
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="docs-editor-content outline-none min-h-full" />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <MarkdownShortcutPlugin transformers={DOCS_TRANSFORMERS} />
      <OnChangePlugin onChange={handleChange} />
      <SavePlugin appId={appId} filePath={filePath} editorRef={editorRef} frontmatter={frontmatter} onSaved={onSaved} />
    </LexicalComposer>
  )
}

function EditorRefPlugin({ onRef }: { onRef: (editor: LexicalEditor) => void }): null {
  const [editor] = useLexicalComposerContext()
  useEffect(() => { onRef(editor) }, [editor, onRef])
  return null
}
