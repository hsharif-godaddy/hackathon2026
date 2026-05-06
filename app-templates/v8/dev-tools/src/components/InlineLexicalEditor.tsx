import { Component, useEffect, useState, useCallback, useRef, useMemo, forwardRef } from 'react';
import type { ReactNode } from 'react';
import { AlignLeft, AlignCenter, AlignRight, List, ListOrdered } from 'lucide-react';
import { useTrackElement } from '../hooks/useTrackElement';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from 'lexical';
import type { ElementFormatType } from 'lexical';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import {
  ListNode,
  ListItemNode,
  $isListNode,
  $isListItemNode,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { formattingSignature, showIndicator } from '../utils/text-editing-helpers';
// --- Types ---

export interface InlineLexicalEditorProps {
  initialHtml: string;
  computedStyles: Record<string, string>;
  singleLine?: boolean;
  /** When true, show alignment + list buttons and allow <p> → <ul>/<ol> root changes. */
  allowBlockFormatting?: boolean;
  onCommit: (newText: string, newHtml: string | null) => void;
  onCancel: () => void;
  targetElement: HTMLElement;
  externalCommitRef?: React.MutableRefObject<(() => void) | null>;
}

// --- Error boundary ---

class EditorErrorBoundary extends Component<
  { children: ReactNode; onError: (error: Error) => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.hasError ? null : this.props.children; }
}

// --- Plugins ---

function InitPlugin({ html, onReady }: { html: string; onReady: () => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    let cancelled = false;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const parser = new DOMParser();
      const isBlockHtml = /^\s*<(ul|ol|div|blockquote)\b/i.test(html);
      const doc = parser.parseFromString(isBlockHtml ? html : '<p>' + html + '</p>', 'text/html');

      const styledOffsets: Array<{ start: number; style: string }> = [];
      let charPos = 0;
      function walkDom(node: Node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentElement;
          if (parent?.tagName === 'SPAN' && parent.getAttribute('style')) {
            styledOffsets.push({ start: charPos, style: parent.getAttribute('style')! });
          }
          charPos += (node.textContent || '').length;
        } else {
          for (const child of node.childNodes) walkDom(child);
        }
      }
      for (const el of doc.querySelectorAll('[style]')) {
        const htmlEl = el as HTMLElement;
        htmlEl.style.removeProperty('white-space');
        if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
      }
      const pEl = doc.body.querySelector('p') || doc.body;
      walkDom(pEl);

      const nodes = $generateNodesFromDOM(editor, doc);
      root.append(...nodes);

      let lexCharPos = 0;
      let offsetIdx = 0;
      for (const textNode of root.getAllTextNodes()) {
        const len = textNode.getTextContentSize();
        if (offsetIdx < styledOffsets.length && styledOffsets[offsetIdx].start === lexCharPos && !textNode.getStyle()) {
          textNode.setStyle(styledOffsets[offsetIdx].style);
          offsetIdx++;
        }
        lexCharPos += len;
      }
    });
    const timer = setTimeout(() => { if (!cancelled) onReady(); }, 50);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [editor, html, onReady]);
  return null;
}

function DirtyPlugin({ dirtyRef, readyRef }: {
  dirtyRef: React.MutableRefObject<boolean>;
  readyRef: React.MutableRefObject<boolean>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (readyRef.current && (dirtyElements.size > 0 || dirtyLeaves.size > 0)) {
        dirtyRef.current = true;
      }
    });
  }, [editor, dirtyRef, readyRef]);
  return null;
}

function CommitPlugin({ onCommit, onCancel, commitRef, externalCommitRef }: {
  onCommit: (html: string) => void;
  onCancel: () => void;
  commitRef: React.MutableRefObject<(() => void) | null>;
  externalCommitRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [editor] = useLexicalComposerContext();

  const doCommit = useCallback(() => {
    editor.read(() => {
      const html = $generateHtmlFromNodes(editor);
      onCommit(html);
    });
  }, [editor, onCommit]);

  useEffect(() => {
    commitRef.current = doCommit;
    if (externalCommitRef) externalCommitRef.current = doCommit;
    return () => {
      commitRef.current = null;
      if (externalCommitRef) externalCommitRef.current = null;
    };
  }, [doCommit, commitRef, externalCommitRef]);

  useEffect(() => {
    const removeEnter = editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
      if (event && !event.shiftKey) {
        // Inside a list item, let Lexical's default handler create a new <li>.
        // Empty-item → exit list is Lexical's built-in behavior. The user can
        // blur or click outside to commit.
        let inListItem = false;
        editor.getEditorState().read(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) {
            let node = sel.anchor.getNode();
            while (node) {
              if ($isListItemNode(node)) { inListItem = true; break; }
              const parent = node.getParent();
              if (!parent) break;
              node = parent;
            }
          }
        });
        if (inListItem) return false;

        event.preventDefault();
        doCommit();
        return true;
      }
      return false;
    }, COMMAND_PRIORITY_HIGH);

    const removeEscape = editor.registerCommand(KEY_ESCAPE_COMMAND, () => {
      onCancel();
      return true;
    }, COMMAND_PRIORITY_HIGH);

    return () => { removeEnter(); removeEscape(); };
  }, [editor, doCommit, onCancel]);
  return null;
}

// --- Toolbar ---

const FormatToolbar = forwardRef<HTMLDivElement, { disableBold?: boolean; allowBlockFormatting?: boolean }>(
function FormatToolbar({ disableBold, allowBlockFormatting }, ref) {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [align, setAlign] = useState<ElementFormatType>('');
  const [listType, setListType] = useState<'bullet' | 'number' | null>(null);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          setIsBold(sel.hasFormat('bold'));
          setIsItalic(sel.hasFormat('italic'));

          if (allowBlockFormatting) {
            const anchor = sel.anchor.getNode();
            const top = anchor.getTopLevelElement();
            setAlign(top?.getFormatType() ?? '');

            let found: 'bullet' | 'number' | null = null;
            let node = anchor;
            while (node) {
              if ($isListNode(node)) {
                found = node.getListType() === 'number' ? 'number' : 'bullet';
                break;
              }
              const parent = node.getParent();
              if (!parent) break;
              node = parent;
            }
            setListType(found);
          }
        }
      });
    });
  }, [editor, allowBlockFormatting]);

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 8px',
    border: '1px solid ' + (active ? '#3b82f6' : '#d1d5db'),
    borderRadius: '4px',
    background: active ? '#dbeafe' : '#fff',
    color: active ? '#1d4ed8' : '#374151',
    cursor: 'pointer',
    fontWeight: active ? 700 : 400,
    fontSize: '13px',
    lineHeight: '1',
  });

  return (
    <div ref={ref} style={{
      position: 'fixed',
      display: 'flex',
      gap: '4px',
      padding: '4px',
      background: '#fff',
      borderRadius: '6px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      zIndex: 100001,
      pointerEvents: 'auto',
    }}>
      <button
        aria-label="Bold"
        aria-pressed={isBold}
        disabled={disableBold}
        title={disableBold ? 'Element is already bold' : undefined}
        style={{...btnStyle(isBold), ...(disableBold ? { opacity: 0.4, cursor: 'not-allowed' } : {})}}
        onMouseDown={(e) => { e.preventDefault(); if (!disableBold) editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'); }}
      >B</button>
      <button
        aria-label="Italic"
        aria-pressed={isItalic}
        style={{...btnStyle(isItalic), fontStyle: 'italic'}}
        onMouseDown={(e) => { e.preventDefault(); editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'); }}
      >I</button>
      {allowBlockFormatting && <>
        <div style={{ width: '1px', background: '#e5e7eb', margin: '2px 0' }} />
        <AlignButton label="Align left" value="left" active={align === 'left' || align === 'start' || align === ''} editor={editor} current={align} btnStyle={btnStyle}><AlignLeft size={14} /></AlignButton>
        <AlignButton label="Align center" value="center" active={align === 'center'} editor={editor} current={align} btnStyle={btnStyle}><AlignCenter size={14} /></AlignButton>
        <AlignButton label="Align right" value="right" active={align === 'right' || align === 'end'} editor={editor} current={align} btnStyle={btnStyle}><AlignRight size={14} /></AlignButton>
        <div style={{ width: '1px', background: '#e5e7eb', margin: '2px 0' }} />
        <button
          aria-label="Bulleted list"
          aria-pressed={listType === 'bullet'}
          style={btnStyle(listType === 'bullet')}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.dispatchCommand(
              listType === 'bullet' ? REMOVE_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND,
              undefined,
            );
          }}
        ><List size={14} /></button>
        <button
          aria-label="Numbered list"
          aria-pressed={listType === 'number'}
          style={btnStyle(listType === 'number')}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.dispatchCommand(
              listType === 'number' ? REMOVE_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
              undefined,
            );
          }}
        ><ListOrdered size={14} /></button>
      </>}
    </div>
  );
});

function AlignButton({ label, value, active, editor, current, btnStyle, children }: {
  label: string;
  value: Exclude<ElementFormatType, '' | 'start' | 'end' | 'justify'>;
  active: boolean;
  editor: ReturnType<typeof useLexicalComposerContext>[0];
  current: ElementFormatType;
  btnStyle: (active: boolean) => React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active && current === value}
      style={btnStyle(active && current === value)}
      onMouseDown={(e) => {
        e.preventDefault();
        // Toggle: if already set to this alignment, clear it (back to default).
        editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, current === value ? '' : value);
      }}
    >{children}</button>
  );
}

// --- Helpers ---

function hasRootChange(container: Element, initialRootTag: string | null): boolean {
  const tag = container.tagName.toLowerCase();
  if (tag !== 'p') return true;
  if (initialRootTag && initialRootTag !== 'p') return true;
  return container.attributes.length > 0;
}

// Strip Lexical-specific attributes that leak into exported HTML for lists.
function stripListArtifacts(container: Element): void {
  for (const li of [container, ...container.querySelectorAll('li')]) {
    if (li.tagName.toLowerCase() === 'li' && li.hasAttribute('value')) {
      li.removeAttribute('value');
    }
  }
}

// --- Main component ---

export default function InlineLexicalEditor({
  initialHtml,
  computedStyles,
  singleLine,
  allowBlockFormatting,
  onCommit,
  onCancel,
  targetElement,
  externalCommitRef,
}: InlineLexicalEditorProps) {
  const editorConfig = useMemo(() => ({
    namespace: 'airo-inline-rte',
    theme: {
      paragraph: singleLine ? 'airo-rte-p airo-rte-single-line' : 'airo-rte-p',
      root: 'airo-rte-root',
      text: { italic: 'airo-rte-italic' },
      list: {
        ul: 'airo-rte-ul',
        ol: 'airo-rte-ol',
        listitem: 'airo-rte-li',
      },
    },
    nodes: allowBlockFormatting ? [ListNode, ListItemNode] : [],
    onError: (error: Error) => {
      console.error('[InlineLexicalEditor]', error);
      showIndicator(targetElement, 'error');
      onCancel();
    },
  }), [singleLine, allowBlockFormatting, onCancel]);
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const commitRef = useRef<(() => void) | null>(null);
  const dirtyRef = useRef(false);
  const readyRef = useRef(false);

  const handleOffScreen = useCallback(() => {
    if (commitRef.current) commitRef.current();
    else onCancel();
  }, [onCancel]);

  useTrackElement(targetElement, toolbarRef, editorRef, handleOffScreen);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const root = containerRef.current;
      if (root && !root.contains(e.target as Node)) {
        // Hide editor before Lexical processes blur (prevents re-render flash).
        // Don't show the original element here — the commit callback handles it
        // synchronously (silentCleanup or overlay creation).
        if (editorRef.current) editorRef.current.style.visibility = 'hidden';
        if (commitRef.current) commitRef.current();
        else onCancel();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onCancel, targetElement]);

  const handleCommit = useCallback((html: string) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const container = parsed.body.firstElementChild || parsed.body;
    const plainText = (container.textContent || '').trim();

    if (!dirtyRef.current) {
      onCommit(plainText, null);
      return;
    }

    // Clean Lexical artifacts from all elements including the container itself
    for (const el of [container, ...container.querySelectorAll('[style]')]) {
      const htmlEl = el as HTMLElement;
      htmlEl.style.removeProperty('white-space');
      htmlEl.style.removeProperty('outline');
      htmlEl.style.removeProperty('outline-offset');
      if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
    }
    for (const el of [container, ...container.querySelectorAll('[class]')]) {
      if (!el.getAttribute('class')) continue;
      const keep = Array.from(el.classList).filter(c => !c.startsWith('airo-rte-'));
      if (keep.length === 0) el.removeAttribute('class');
      else el.className = keep.join(' ');
    }
    stripListArtifacts(container);

    // Tailwind resets list-style on ul/ol — inject utility classes so markers render.
    const rootTag = container.tagName?.toLowerCase();
    if (rootTag === 'ul') container.classList.add('list-disc', 'pl-6');
    if (rootTag === 'ol') container.classList.add('list-decimal', 'pl-6');

    // Check rootChanged AFTER cleanup so Lexical classes don't trigger false positives.
    // When block formatting is disabled, the <p> wrapper is Lexical's artifact — skip.
    const initialDoc = new DOMParser().parseFromString(initialHtml, 'text/html');
    const initialRoot = initialDoc.body.firstElementChild;
    const initialRootTag = initialRoot?.tagName.toLowerCase() ?? null;
    const rootChanged = allowBlockFormatting && hasRootChange(container, initialRootTag);

    const outputSig = formattingSignature(container.innerHTML);
    const initialSig = formattingSignature(initialHtml);
    const formattingChanged = outputSig !== initialSig;

    if (formattingChanged || rootChanged) {
      onCommit(plainText, container.outerHTML);
    } else {
      onCommit(plainText, null);
    }
  }, [onCommit, initialHtml, allowBlockFormatting]);

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: '0', zIndex: 99999, pointerEvents: 'none' }}>
      <LexicalComposer initialConfig={editorConfig}>
        <FormatToolbar
          ref={toolbarRef}
          disableBold={parseInt(computedStyles.fontWeight || '400', 10) >= 600}
          allowBlockFormatting={allowBlockFormatting}
        />
        <div ref={editorRef} data-airo-editor-content style={{
          ...computedStyles,
          position: 'fixed',
          boxSizing: 'border-box',
          overflow: 'hidden',
          zIndex: 100000,
          pointerEvents: 'auto',
          outline: '2px solid #3b82f6',
          outlineOffset: '2px',
        }}>
          <RichTextPlugin
            contentEditable={<ContentEditable style={{ width: '100%', outline: 'none' }} />}
            ErrorBoundary={EditorErrorBoundary}
          />
          {allowBlockFormatting && <ListPlugin />}
          <HistoryPlugin />
          <DirtyPlugin dirtyRef={dirtyRef} readyRef={readyRef} />
          <InitPlugin html={initialHtml} onReady={() => { readyRef.current = true; }} />
          <AutoFocusPlugin />
          <CommitPlugin onCommit={handleCommit} onCancel={onCancel} commitRef={commitRef} externalCommitRef={externalCommitRef} />
        </div>
      </LexicalComposer>
    </div>
  );
}
