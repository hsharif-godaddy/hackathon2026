/**
 * Internal Lexical-backed editor surface for `PromptBox`. Replaces the
 * previous `<TextEntry multiline>` (a styled `<textarea>`) with a Lexical
 * `ContentEditable` so the composer can host:
 *   • inline element-mention badges (`#3 Image`, `#7 Title`),
 *   • paste interception (large text → caller, files → `onStageFiles`,
 *     images → `onScreenshotCaptured`),
 *   • history-navigation `ArrowUp` / `ArrowDown` callbacks,
 *   • read-only mode for active speech-to-text recognizers,
 *   • Shift+Enter inserting a literal newline.
 *
 * The component is internal — it is not exported from `index.ts`. `tsup`
 * bundles it into the `PromptBox` subpath via the import graph. All public
 * API lives on `PromptBox`; LexicalInput's prop shape is shaped only to
 * keep the wiring in `PromptBox.tsx` legible.
 *
 * Mention contract: the badge's ✕ button dispatches a `remove-mention`
 * `CustomEvent` on `document`; LexicalInput listens for it and removes any
 * mention whose stored value matches the event's `detail.value`. Each
 * editor stamps a per-instance ID into every dispatched event and filters
 * incoming events by the same ID, so two PromptBoxes mounted on the same
 * page never see each other's removals. Click on the badge body
 * dispatches `scroll-to-mention` (also instance-stamped) with the
 * mention's number so the host page can scroll its document tree into
 * view. This is a known wart documented in `README.md` — refactor to a
 * Lexical-scoped command/prop is a follow-up.
 */

import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import classnames from 'classnames';
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
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
} from 'lexical';
import {
  BeautifulMentionNode,
  BeautifulMentionsPlugin,
  createBeautifulMentionNode,
  useBeautifulMentions,
} from 'lexical-beautiful-mentions';
import {
  type HTMLAttributes,
  type MutableRefObject,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { MentionChip } from '../../primitives/mention-chip';
import type { PromptBoxHandle, PromptSuggestion } from './PromptBox';

const DEFAULT_MAX_INLINE_PASTE_LENGTH = 4_000;

// HTML-tag → human-readable label for the element-mention badge body
// (e.g. `h2` → `Heading`, `pre` → `Code`). The mention value stores the
// raw tag (`<h2>`); this map renders the friendly label next to `#<n>`.
const TAG_LABELS: Record<string, string> = {
  h1: 'Title',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  p: 'Text',
  span: 'Text',
  blockquote: 'Quote',
  figcaption: 'Caption',
  img: 'Image',
  picture: 'Image',
  video: 'Video',
  svg: 'Icon',
  a: 'Link',
  button: 'Button',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  code: 'Code',
  pre: 'Code',
  section: 'Section',
  nav: 'Nav',
  header: 'Header',
  footer: 'Footer',
};

interface ElementMentionProps {
  trigger: string;
  value: string;
  data?: Record<string, string>;
  'data-beautiful-mention': string;
}

/**
 * Per-editor scoping ID for the global `remove-mention` /
 * `scroll-to-mention` CustomEvent contract. `BeautifulMentionsPlugin`
 * renders the badge component without letting us thread props through, so
 * the parent editor publishes its instance ID via context and the badge
 * stamps that ID into every event it dispatches. The listener in the
 * parent filters incoming events by the same ID, so two PromptBoxes
 * mounted on the same page never see each other's mention removals.
 */
const MentionScopeContext = createContext<string | null>(null);

/**
 * Inline mention badge component rendered for each element-mention. Wraps
 * the `MentionChip` primitive to translate `lexical-beautiful-mentions`
 * props into the chip's API and to dispatch the editor-scoped
 * `scroll-to-mention` / `remove-mention` `CustomEvent`s the host page
 * listens for.
 *
 * `MentionChip` is `contentEditable={false}` internally, so Lexical treats
 * it as an opaque inline atom — selection, copy, and delete all operate
 * on the whole chip, not its inner text.
 */
function ElementMentionComponent({
  value,
  'data-beautiful-mention': mentionAttr,
}: ElementMentionProps) {
  const editorInstanceId = useContext(MentionScopeContext);
  const match = value.match(/^(\d+)\s*<([^>]+)>/);
  const num = match?.[1] ?? value;
  const tag = match?.[2] ?? '';
  const label = TAG_LABELS[tag] ?? tag;

  return (
    <MentionChip
      prefix={num}
      label={label}
      onActivate={() =>
        document.dispatchEvent(
          new CustomEvent('scroll-to-mention', {
            detail: { number: Number(num), editorInstanceId },
          }),
        )
      }
      onRemove={() =>
        document.dispatchEvent(
          new CustomEvent('remove-mention', {
            detail: { value, mentionAttr, editorInstanceId },
          }),
        )
      }
    />
  );
}

// `lexical-beautiful-mentions` requires at least one trigger entry even
// when the menu is hidden (it gates which characters open the picker).
// We never want the typeahead picker to open from typing — mentions are
// inserted programmatically via the `insertElementMention` handle method
// — so the trigger array is empty. `menuComponent={() => null}` belt-and-
// braces.
const MENTION_ITEMS: Record<string, string[]> = { '#': [] };

const [CustomMentionNode, CustomMentionNodeReplacement] =
  createBeautifulMentionNode(ElementMentionComponent);

const MENTION_THEME = { '#': 'airo-input-prompt-box__mention-node' };

/**
 * State and callbacks the suggestions popover (owned by `PromptBox.tsx`)
 * exposes to the editor's keyboard plugin so Enter / Tab / Arrow keys can
 * drive the popover from inside Lexical.
 */
export interface LexicalInputPopover {
  showFlyout: boolean;
  activeIndex: number;
  suggestions: readonly PromptSuggestion[];
  acceptSuggestion: (suggestion: PromptSuggestion, mode: 'accept' | 'edit') => void;
  setActiveIndex: (updater: (prev: number) => number) => void;
  closeSuggestions: () => void;
}

interface KeyboardPluginProps {
  popover?: LexicalInputPopover;
  onSubmit: () => void;
  onArrowUp?: (cursorAtStart: boolean) => boolean;
  onArrowDown?: (cursorAtEnd: boolean) => boolean;
}

/**
 * Registers Enter / Tab / Arrow / Escape commands at
 * `COMMAND_PRIORITY_HIGH` so the editor cooperates with the suggestions
 * popover and the parent's submit handler. Shift+Enter explicitly returns
 * `false` so Lexical inserts its own newline — that is the migration's
 * fix for the consumer-side regression.
 */
function KeyboardPlugin({ popover, onSubmit, onArrowUp, onArrowDown }: KeyboardPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const removeEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event?.shiftKey) return false;
        event?.preventDefault();
        if (popover?.showFlyout && popover.activeIndex >= 0) {
          const target = popover.suggestions[popover.activeIndex];
          if (target) popover.acceptSuggestion(target, 'accept');
          return true;
        }
        onSubmit();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const removeArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        if (popover?.showFlyout) {
          event?.preventDefault();
          popover.setActiveIndex((prev) => Math.max(prev - 1, -1));
          return true;
        }
        if (!onArrowUp) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        const root = $getRoot();
        const firstChild = root.getFirstChild();
        // Lexical anchors land on text-node descendants, not the paragraph
        // itself, so comparing against `root.getFirstChild()` produced a
        // false negative for any non-empty document. Walk to the first
        // descendant the same way `GhostTextPlugin` walks to the last.
        const firstDescendant =
          firstChild && $isElementNode(firstChild) ? firstChild.getFirstDescendant() : firstChild;
        const isAtStart = firstDescendant
          ? selection.anchor.key === firstDescendant.getKey() && selection.anchor.offset === 0
          : selection.anchor.key === firstChild?.getKey();
        if (onArrowUp(isAtStart)) {
          event?.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const removeArrowDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        if (popover?.showFlyout) {
          event?.preventDefault();
          popover.setActiveIndex((prev) => Math.min(prev + 1, popover.suggestions.length - 1));
          return true;
        }
        if (!onArrowDown) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        const root = $getRoot();
        const lastChild = root.getLastChild();
        const lastDescendant =
          lastChild && $isElementNode(lastChild) ? lastChild.getLastDescendant() : lastChild;
        const isAtEnd = lastDescendant
          ? selection.anchor.key === lastDescendant.getKey() &&
            selection.anchor.offset === lastDescendant.getTextContentSize()
          : selection.anchor.key === lastChild?.getKey();
        if (onArrowDown(isAtEnd)) {
          event?.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const removeTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        if (event?.shiftKey) return false;
        if (!popover?.showFlyout) return false;
        event?.preventDefault();
        const target =
          popover.activeIndex >= 0
            ? popover.suggestions[popover.activeIndex]
            : popover.suggestions[0];
        if (target) popover.acceptSuggestion(target, 'edit');
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const removeEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        if (!popover?.showFlyout) return false;
        event?.preventDefault();
        event?.stopPropagation();
        popover.closeSuggestions();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      removeEnter();
      removeArrowUp();
      removeArrowDown();
      removeTab();
      removeEscape();
    };
  }, [editor, popover, onSubmit, onArrowUp, onArrowDown]);

  return null;
}

interface PastePluginProps {
  isDisabled: boolean;
  isListening: boolean;
  isBudgetExceeded: boolean;
  canStageFiles: boolean;
  canAddAsset: boolean;
  maxInlinePasteLength: number;
  onLargePasteDetected?: (content: string) => void;
  onStageFiles?: (files: File[]) => void;
  onScreenshotCaptured?: (dataUrl: string) => void;
}

/**
 * Registers a `PASTE_COMMAND` listener that intercepts three paste shapes
 * before Lexical's default text-paste runs:
 *   1. Plain text longer than `maxInlinePasteLength` → `onLargePasteDetected`.
 *   2. Files with `canStageFiles` → `onStageFiles`.
 *   3. Image clipboard items with `canAddAsset` → `onScreenshotCaptured`
 *      (the image is downscaled to ≤ 1024 px on its longer edge and
 *      re-encoded as JPEG quality 0.75 before the callback fires).
 * All other pastes fall through to Lexical's default plain-text path.
 */
function PastePlugin({
  isDisabled,
  isListening,
  isBudgetExceeded,
  canStageFiles,
  canAddAsset,
  maxInlinePasteLength,
  onLargePasteDetected,
  onStageFiles,
  onScreenshotCaptured,
}: PastePluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardEvent = event as ClipboardEvent;
        if (!clipboardEvent.clipboardData) return false;

        // Suppress all paste interception when the editor is non-writable.
        // Read-only / listening / budget-exceeded surfaces must not fire
        // host-side paste callbacks — the user has no way to reach the
        // editor's content, so a paste here is either accidental focus
        // bleed-through or a paste targeted at the surrounding chrome.
        if (isDisabled || isBudgetExceeded || isListening) {
          clipboardEvent.preventDefault();
          return true;
        }

        if (onLargePasteDetected) {
          const text = clipboardEvent.clipboardData.getData('text/plain');
          if (text.length > maxInlinePasteLength) {
            clipboardEvent.preventDefault();
            onLargePasteDetected(text);
            return true;
          }
        }

        const items = clipboardEvent.clipboardData.items;
        if (!items) return false;

        // Image-paste routing: when the screenshot handler is wired AND the
        // clipboard carries an image, route the image to `onScreenshotCaptured`
        // FIRST. Without this the image would fall through to the generic
        // file-staging branch below (since image items have `kind === 'file'`),
        // and `onScreenshotCaptured` would be unreachable for any consumer
        // that also wires `onStageFiles` — contradicting the prop docs that
        // describe these as independent handlers.
        const itemList = Array.from(items);
        const imageItem =
          canAddAsset && onScreenshotCaptured
            ? itemList.find((item) => item.kind === 'file' && item.type.startsWith('image/'))
            : undefined;

        if (imageItem && canAddAsset && onScreenshotCaptured) {
          const file = imageItem.getAsFile();
          if (file) {
            clipboardEvent.preventDefault();
            const objectUrl = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
              try {
                const maxDimension = 1024;
                const scale = Math.min(1, maxDimension / img.width, maxDimension / img.height);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                onScreenshotCaptured(canvas.toDataURL('image/jpeg', 0.75));
              } finally {
                URL.revokeObjectURL(objectUrl);
              }
            };
            img.onerror = () => URL.revokeObjectURL(objectUrl);
            img.src = objectUrl;
            return true;
          }
        }

        // Stage any remaining (non-image, or all-files when screenshot
        // capture isn't wired) clipboard files. Filter out the image we
        // just routed to the screenshot path so the same paste doesn't
        // double-fire both handlers for the same image.
        const files: File[] = [];
        for (const item of itemList) {
          if (item.kind === 'file' && item !== imageItem) {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }

        if (files.length > 0 && canStageFiles && onStageFiles) {
          clipboardEvent.preventDefault();
          onStageFiles(files);
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [
    editor,
    isDisabled,
    isListening,
    isBudgetExceeded,
    canStageFiles,
    canAddAsset,
    maxInlinePasteLength,
    onLargePasteDetected,
    onStageFiles,
    onScreenshotCaptured,
  ]);

  return null;
}

interface ExternalSyncPluginProps {
  value: string;
  internalChangeRef: MutableRefObject<boolean>;
  isSyncingExternallyRef: MutableRefObject<boolean>;
}

/**
 * Mirrors the controlled `value` prop into the editor when the change
 * originated outside the editor (history navigation, speech-to-text,
 * post-submit clear). Mention nodes are preserved across the sync — the
 * external value only owns the plain-text portion of the document.
 *
 * Why both `internalChangeRef` and `isSyncingExternallyRef`:
 * `internalChangeRef` is set during the editor's own `OnChangePlugin`
 * callback so this effect knows to skip the round-trip; it's cleared on
 * the next external `value` arrival. `isSyncingExternallyRef` is set
 * around the `editor.update` call so the OnChangePlugin doesn't flag the
 * resulting content change as internal — without it, the next genuine
 * keystroke would be ignored.
 */
function ExternalSyncPlugin({
  value,
  internalChangeRef,
  isSyncingExternallyRef,
}: ExternalSyncPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (internalChangeRef.current) {
      internalChangeRef.current = false;
      // Always honor an explicit clear (`value === ''`) so post-submit
      // resets still apply, even when the prior change was internal.
      if (value !== '') return;
    }

    const isExplicitClear = value === '';

    isSyncingExternallyRef.current = true;
    editor.update(
      () => {
        const root = $getRoot();

        if (isExplicitClear) {
          // Explicit clear (`value === ''`) is a full reset — including any
          // chips. Without this, post-submit clears would leave previously
          // inserted element mentions stranded in the editor while the
          // submitted text disappeared.
          if (root.getTextContent() === '' && root.getChildrenSize() <= 1) return;
          root.clear();
          root.append($createParagraphNode());
          return;
        }

        let plainText = '';
        const mentionNodes: InstanceType<typeof BeautifulMentionNode>[] = [];
        for (const child of root.getChildren()) {
          if ($isElementNode(child)) {
            for (const node of child.getChildren()) {
              if (node instanceof BeautifulMentionNode) {
                mentionNodes.push(node);
              } else {
                plainText += node.getTextContent();
              }
            }
          }
        }
        if (plainText.trim() === value.trim() && mentionNodes.length > 0) return;
        if (root.getTextContent() === value) return;

        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(value));
        for (const mention of mentionNodes) {
          paragraph.append($createTextNode(' '));
          paragraph.append(mention);
        }
        root.append(paragraph);
      },
      {
        onUpdate: () => {
          isSyncingExternallyRef.current = false;
        },
      },
    );
  }, [editor, value, internalChangeRef, isSyncingExternallyRef]);

  return null;
}

/** Toggles `editor.setEditable` from `disabled` / `isListening` / `isBudgetExceeded`. */
function EditableStatePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  return null;
}

interface GhostTextPluginProps {
  value: string;
  suggestion?: string;
}

/**
 * Renders an inline-suggestion overlay behind the editor's text. The
 * "typed" span is fully transparent and occupies the same space as the
 * user's input; the "rest" span trails it at half opacity. CSS in
 * `styles.css` mirrors the editor's `font`, `padding`, and `line-height`
 * so the rest-of-suggestion appears at exactly the position the editor
 * caret sits.
 *
 * The overlay is hidden (a) when the input contains a newline (rest
 * would render on the wrong line), (b) when the cursor is not at the end
 * of content (rest would visually drift), or (c) when no suggestion is
 * provided or the user's input doesn't prefix-match it. The hide is
 * driven by a `data-ghost-visible` attribute the plugin sets on the
 * wrapper; CSS toggles `display` on that attribute.
 *
 * The overlay is render-only — it never participates in selection,
 * undo/redo, or serialisation, so a Lexical `DecoratorNode` would be
 * overkill. The CSS-overlay pattern is also what shell autocompletes
 * (fish, zsh, GitHub Copilot's web suggestions) use.
 */
function GhostTextPlugin({ value, suggestion }: GhostTextPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [cursorAtEnd, setCursorAtEnd] = useState(true);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          setCursorAtEnd(false);
          return;
        }
        const root = $getRoot();
        const lastChild = root.getLastChild();
        if (!lastChild) {
          setCursorAtEnd(true);
          return;
        }
        const lastDescendant = $isElementNode(lastChild)
          ? lastChild.getLastDescendant()
          : lastChild;
        if (!lastDescendant) {
          // Empty paragraph — cursor at the end if anchor is on the
          // paragraph itself.
          setCursorAtEnd(selection.anchor.key === lastChild.getKey());
          return;
        }
        setCursorAtEnd(
          selection.anchor.key === lastDescendant.getKey() &&
            selection.anchor.offset === lastDescendant.getTextContentSize(),
        );
      });
    });
  }, [editor]);

  const hasNewline = value.includes('\n');
  const visible =
    !hasNewline &&
    cursorAtEnd &&
    !!suggestion &&
    suggestion.length > value.length &&
    suggestion.startsWith(value);
  const rest = visible ? (suggestion as string).slice(value.length) : '';

  return (
    <div
      className="airo-input-prompt-box__ghost"
      aria-hidden="true"
      data-ghost-visible={visible ? 'true' : 'false'}
    >
      <span className="airo-input-prompt-box__ghost-typed">{value}</span>
      <span className="airo-input-prompt-box__ghost-rest">{rest}</span>
    </div>
  );
}

/**
 * Subset of `HTMLAttributes<HTMLDivElement>` that PromptBox passes through
 * to the editor surface for combobox / aria semantics. Kept narrow so the
 * internal API doesn't accidentally grow into a generic spread sink.
 */
type EditorAriaProps = Pick<
  HTMLAttributes<HTMLDivElement>,
  | 'role'
  | 'aria-expanded'
  | 'aria-controls'
  | 'aria-autocomplete'
  | 'aria-activedescendant'
  | 'aria-label'
  | 'aria-labelledby'
>;

export interface LexicalInputProps extends EditorAriaProps {
  /** Current value of the editor. The component is always controlled by
   *  PromptBox — uncontrolled state lives in PromptBox itself. */
  value: string;
  /** Called on every editor content change with the plain-text content
   *  (mention nodes are concatenated into the text via their value). */
  onChange: (value: string) => void;
  /** Called when the user presses Enter without Shift (and not on a
   *  highlighted suggestion). The editor consumes the keystroke either
   *  way — the parent decides whether to actually submit, queue, or
   *  no-op based on `pending` / `disabled`. */
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  isListening?: boolean;
  isBudgetExceeded?: boolean;
  canStageFiles?: boolean;
  canAddAsset?: boolean;
  maxInlinePasteLength?: number;
  onLargePasteDetected?: (content: string) => void;
  onStageFiles?: (files: File[]) => void;
  onScreenshotCaptured?: (dataUrl: string) => void;
  onArrowUp?: (cursorAtStart: boolean) => boolean;
  onArrowDown?: (cursorAtEnd: boolean) => boolean;
  onMentionRemoved?: (number: number) => void;
  /** Inline suggestion to show as ghost text behind the editor when the
   *  cursor is at the end of single-line content. The plugin shows
   *  `suggestion.slice(value.length)` at half opacity. */
  ghostSuggestion?: string;
  /** Suggestions popover state owned by PromptBox; the keyboard plugin
   *  reads from it and calls back into its setters. Omit when there is
   *  no popover (single-source: the parent passes `undefined`). */
  popover?: LexicalInputPopover;
  /** DOM `id` for the contenteditable, so parent labels / FieldFrame
   *  click-to-focus continue to work. */
  inputId?: string;
  /** Extra className appended to the contenteditable. */
  className?: string;
}

/**
 * Inner component that runs inside the LexicalComposer context. Splitting
 * the component in two is required by Lexical's API: hooks like
 * `useLexicalComposerContext` and `useBeautifulMentions` only resolve
 * inside the composer's children.
 */
const LexicalInputInner = forwardRef<PromptBoxHandle, LexicalInputProps>(
  function LexicalInputInner(props, ref) {
    const {
      value,
      onChange,
      onSubmit,
      placeholder,
      disabled = false,
      isListening = false,
      isBudgetExceeded = false,
      canStageFiles = false,
      canAddAsset = false,
      maxInlinePasteLength = DEFAULT_MAX_INLINE_PASTE_LENGTH,
      onLargePasteDetected,
      onStageFiles,
      onScreenshotCaptured,
      onArrowUp,
      onArrowDown,
      onMentionRemoved,
      ghostSuggestion,
      popover,
      inputId,
      className,
      role,
      'aria-expanded': ariaExpanded,
      'aria-controls': ariaControls,
      'aria-autocomplete': ariaAutocomplete,
      'aria-activedescendant': ariaActiveDescendant,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
    } = props;

    const [editor] = useLexicalComposerContext();
    const { insertMention } = useBeautifulMentions();
    const internalChangeRef = useRef(false);
    const isSyncingExternallyRef = useRef(false);
    const prevMentionNumbersRef = useRef(new Set<number>());
    // Stable per-editor ID stamped into every mention CustomEvent so the
    // listener below can ignore events fired by other PromptBox instances
    // (otherwise a removal in one editor would erase matching mentions in
    // every other PromptBox on the page).
    const editorInstanceId = useId();

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          // editor.focus() updates Lexical's selection state but does not
          // call .focus() on the root contenteditable. Do both so the
          // DOM focus matches the editor's logical focus.
          editor.focus();
          editor.getRootElement()?.focus({ preventScroll: true });
        },
        blur() {
          // Lexical's editor has no blur(); blur the contenteditable DOM
          // node directly. `getRootElement()` returns null only between
          // mount and the first effect, which is not a window callers can
          // reach via the imperative handle.
          editor.getRootElement()?.blur();
        },
        insertElementMention(number, tagName) {
          prevMentionNumbersRef.current.add(number);
          insertMention({ trigger: '#', value: `${number} <${tagName}>` });
        },
        removeElementMention(number) {
          editor.update(() => {
            const root = $getRoot();
            for (const child of root.getChildren()) {
              if (!$isElementNode(child)) continue;
              for (const node of child.getChildren()) {
                if (
                  node instanceof BeautifulMentionNode &&
                  node.getValue().startsWith(`${number} `)
                ) {
                  node.remove();
                }
              }
            }
          });
        },
        clearAllElementMentions() {
          editor.update(() => {
            const root = $getRoot();
            for (const child of root.getChildren()) {
              if (!$isElementNode(child)) continue;
              for (const node of child.getChildren()) {
                if (node instanceof BeautifulMentionNode) node.remove();
              }
            }
          });
        },
      }),
      [editor, insertMention],
    );

    const handleChange = useCallback(
      (editorState: EditorState) => {
        editorState.read(() => {
          const text = $getRoot().getTextContent();
          if (!isSyncingExternallyRef.current) {
            internalChangeRef.current = true;
          }
          onChange(text);

          if (onMentionRemoved) {
            const currentNumbers = new Set<number>();
            const root = $getRoot();
            for (const child of root.getChildren()) {
              if (!$isElementNode(child)) continue;
              for (const node of child.getChildren()) {
                if (node instanceof BeautifulMentionNode) {
                  const match = node.getValue().match(/^(\d+)\s/);
                  if (match) currentNumbers.add(Number(match[1]));
                }
              }
            }
            for (const num of prevMentionNumbersRef.current) {
              if (!currentNumbers.has(num)) {
                onMentionRemoved(num);
              }
            }
            prevMentionNumbersRef.current = currentNumbers;
          }
        });
      },
      [onChange, onMentionRemoved],
    );

    // Listen for the document-level `remove-mention` event dispatched by
    // the ✕ button on a mention badge, but only act on events that were
    // dispatched from this editor instance — every mounted PromptBox
    // listens on the same `document`, so without the ID filter a removal
    // in one editor would also clear matching mentions in every other
    // PromptBox on the page.
    useEffect(() => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail as
          | { value: string; editorInstanceId?: string | null }
          | undefined;
        if (!detail || detail.editorInstanceId !== editorInstanceId) return;
        const { value: mentionValue } = detail;
        editor.update(() => {
          const root = $getRoot();
          for (const child of root.getChildren()) {
            if (!$isElementNode(child)) continue;
            for (const node of child.getChildren()) {
              if (node instanceof BeautifulMentionNode && node.getValue() === mentionValue) {
                node.remove();
              }
            }
          }
        });
      };
      document.addEventListener('remove-mention', handler);
      return () => document.removeEventListener('remove-mention', handler);
    }, [editor, editorInstanceId]);

    const editorDisabled = disabled || isListening || isBudgetExceeded;

    return (
      <MentionScopeContext.Provider value={editorInstanceId}>
        <div className="airo-input-prompt-box__editor-wrap">
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                id={inputId}
                className={classnames(
                  'airo-input-prompt-box__entry',
                  'airo-input-prompt-box__entry--lexical',
                  className,
                )}
                aria-disabled={editorDisabled}
                aria-placeholder={placeholder ?? ''}
                role={role}
                aria-expanded={ariaExpanded}
                aria-controls={ariaControls}
                aria-autocomplete={ariaAutocomplete}
                aria-activedescendant={ariaActiveDescendant}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                placeholder={() =>
                  placeholder ? (
                    <div className="airo-input-prompt-box__entry-placeholder">{placeholder}</div>
                  ) : null
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <GhostTextPlugin value={value} suggestion={ghostSuggestion} />
        </div>
        <HistoryPlugin />
        <BeautifulMentionsPlugin items={MENTION_ITEMS} menuComponent={() => null} />
        <OnChangePlugin onChange={handleChange} />
        <KeyboardPlugin
          popover={popover}
          onSubmit={onSubmit}
          onArrowUp={onArrowUp}
          onArrowDown={onArrowDown}
        />
        <PastePlugin
          isDisabled={disabled}
          isListening={isListening}
          isBudgetExceeded={isBudgetExceeded}
          canStageFiles={canStageFiles}
          canAddAsset={canAddAsset}
          maxInlinePasteLength={maxInlinePasteLength}
          onLargePasteDetected={onLargePasteDetected}
          onStageFiles={onStageFiles}
          onScreenshotCaptured={onScreenshotCaptured}
        />
        <ExternalSyncPlugin
          value={value}
          internalChangeRef={internalChangeRef}
          isSyncingExternallyRef={isSyncingExternallyRef}
        />
        <EditableStatePlugin disabled={editorDisabled} />
      </MentionScopeContext.Provider>
    );
  },
);

const INITIAL_CONFIG = {
  namespace: 'AiroPromptBox',
  theme: { beautifulMentions: MENTION_THEME },
  nodes: [CustomMentionNode, CustomMentionNodeReplacement],
  onError: (error: Error) => {
    // Match the consumer's behavior: log rather than throw so a Lexical
    // schema mismatch degrades the editor surface gracefully instead of
    // unmounting the whole composer (which would lose user input).
    console.error('LexicalInput error:', error);
  },
};

/**
 * Internal Lexical editor sub-component. See module docstring for scope.
 */
export const LexicalInput = forwardRef<PromptBoxHandle, LexicalInputProps>(
  function LexicalInput(props, ref) {
    return (
      <LexicalComposer initialConfig={INITIAL_CONFIG}>
        <LexicalInputInner ref={ref} {...props} />
      </LexicalComposer>
    );
  },
);
