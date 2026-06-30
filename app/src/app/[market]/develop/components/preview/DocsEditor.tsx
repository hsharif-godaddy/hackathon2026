'use client'

import { type EditorState, type LexicalEditor } from 'lexical'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
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

const DOCS_TRANSFORMERS: Transformer[] = [
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

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/

function extractFrontmatter(content: string): { frontmatter: string; body: string } {
  const match: RegExpMatchArray | null = content.match(FRONTMATTER_RE)
  if (!match) return { frontmatter: '', body: content }
  return { frontmatter: match[0], body: content.slice(match[0].length) }
}

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
  const save = useCallback(() => {
    const editor: LexicalEditor | null = editorRef.current
    if (!editor) return
    editor.update(() => {
      const body: string = $convertToMarkdownString(DOCS_TRANSFORMERS)
      const fullContent: string = frontmatter + body
      appService.writeFile(appId, filePath, fullContent)
        .then(() => {
          useDevelopPageStore.getState().setDocsDirty(false)
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
        save()
      }
    }
    const handleSaveEvent = (): void => { save() }
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('docs-save', handleSaveEvent)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('docs-save', handleSaveEvent)
    }
  }, [save])

  return null
}

export default function DocsEditor({ appId, filePath, initialContent, onSaved }: DocsEditorProps) {
  const editorRef = useRef<LexicalEditor | null>(null)
  const { frontmatter, body: initialBody } = useMemo(() => extractFrontmatter(initialContent), [initialContent])

  const initialConfig = {
    namespace: 'docs-editor',
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode],
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
