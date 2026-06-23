import { useEffect, useState, useCallback, useRef } from "react";
import { createRoot, Root } from "react-dom/client";
import { safePostMessage, isOriginAllowed } from "../utils/postMessage";
import { type BusTextUpdatePayload, send, TextEditErrorCode } from "../utils/eventBus";
import { t } from "../utils/translations";
import {
  generatePreciseSelector,
  extractDevContext,
} from "../utils/element-helpers";
import {
  isDevToolsElement,
  generateSelector,
  isBodyTextElement,
  resolveContentKey,
  isInsideNavSurface,
} from "../utils/element-detection";
import InlineLexicalEditor from "../components/InlineLexicalEditor";
import { htmlToJsxStructured } from "../utils/html-to-jsx";
import { insertPlainTextOnPaste } from "../utils/contenteditable-paste";
import { createElement } from "react";
import {
  INDICATOR_MS,
  findEditableContainer,
  findBrSegment,
  unwrapAiroSpans,
  unwrapAiroSegments,
  unwrapOrReveal,
  wrapBareChildTextNodes,
  normalizeHtml,
  safeSetInnerHtml,
  getComputedStyleMap,
  isSingleLine,
  showIndicator,
  createFixedOverlay,
  watchTextReflected,
  mergeRootAttrsOntoOverlay,
  mergeOriginalClasses,
  injectEditorCss,
  ensureBoldFontLoaded,
} from "../utils/text-editing-helpers";

interface TextEditingState {
  editingElement: HTMLElement | null;
  originalText: string | null;
  saveStatus: "idle" | "saving" | "saved";
}

interface PendingSave {
  element: HTMLElement;
  originalText: string;
}

export function useTextEditing(isEditModeActive: boolean, cmsInlineEditEnabled: boolean) {
  const [state, setState] = useState<TextEditingState>({
    editingElement: null,
    originalText: null,
    saveStatus: "idle",
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const updateState = useCallback((patch: Partial<TextEditingState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState((prev) => ({ ...prev, ...patch }));
  }, []);
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lexical overlay management
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const editorRootRef = useRef<Root | null>(null);
  const lexicalCommitRef = useRef<(() => void) | null>(null);

  // Optimistic preview overlay — shows new content without mutating React DOM
  const overlayRef = useRef<HTMLElement | null>(null);
  // Disconnects the MutationObserver that retires the overlay once the real
  // element reflects the saved value (see watchTextReflected).
  const overlayWatcherRef = useRef<(() => void) | null>(null);

  // ── Cleanup Lexical overlay ──

  const cleanupEditor = useCallback(() => {
    if (editorRootRef.current) {
      editorRootRef.current.unmount();
      editorRootRef.current = null;
    }
    if (editorContainerRef.current) {
      editorContainerRef.current.remove();
      editorContainerRef.current = null;
    }
    document
      .querySelectorAll("#__airo-lexical-editor")
      .forEach((el) => el.remove());
  }, []);

  const cleanupOverlay = useCallback((element?: HTMLElement) => {
    if (overlayWatcherRef.current) {
      overlayWatcherRef.current();
      overlayWatcherRef.current = null;
    }
    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }
    if (element) element.style.visibility = "";
  }, []);

  const commitCleanup = useCallback(
    (onReveal?: () => void) => {
      cleanupEditor();
      onReveal?.();
      updateState({ editingElement: null, originalText: null });
    },
    [cleanupEditor, updateState],
  );

  const beginSave = useCallback(
    (element: HTMLElement, originalText: string) => {
      pendingSaveRef.current = { element, originalText };
      updateState({ saveStatus: "saving" });
      showIndicator(element, "saving");
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        if (pendingSaveRef.current) {
          cleanupOverlay(pendingSaveRef.current.element);
          showIndicator(pendingSaveRef.current.element, "error");
          pendingSaveRef.current = null;
          updateState({ saveStatus: "idle" });
        }
      }, 30_000);
    },
    [cleanupOverlay, updateState],
  );

  const silentCleanup = useCallback(
    (element: HTMLElement) => {
      cleanupOverlay(element);
      cleanupEditor();
      updateState({ editingElement: null, originalText: null });
    },
    [cleanupEditor, cleanupOverlay, updateState],
  );

  const handleCommit = useCallback(
    (
      element: HTMLElement,
      originalText: string,
      newText: string,
      newHtml: string | null,
    ) => {
      if (newText === originalText && !newHtml) {
        silentCleanup(element);
        return;
      }

      const devContext = extractDevContext(element);
      const selector = generateSelector(element);
      const preciseSelector = generatePreciseSelector(element);

      beginSave(element, originalText);

      // Prefer the content-layer path when the element is attributed to a
      // CMS field. Falls back to the JSX-literal AST-edit path otherwise.
      const contentTarget = resolveContentKey(element);
      if (contentTarget) {
        safePostMessage(window.parent, {
          type: "CONTENT_UPDATED",
          data: {
            contentKey: contentTarget.key,
            kind: contentTarget.kind,
            oldText: originalText,
            newText,
          },
        });

        cleanupOverlay();
        // The content edit triggers an HMR re-render that updates this element
        // to newText, usually before the save-success ACK. Only show the
        // optimistic overlay if the element doesn't already reflect newText,
        // and retire it the moment the re-render lands — otherwise the overlay
        // and the re-rendered element both paint, slightly offset (a ghost).
        if ((element.textContent ?? "").trim() !== newText.trim()) {
          const overlay = createFixedOverlay(element);
          if (overlay) {
            overlay.textContent = newText;
            overlayRef.current = overlay;
            overlayWatcherRef.current = watchTextReflected(element, newText, () =>
              cleanupOverlay(element),
            );
          }
        }
        commitCleanup();
        return;
      }

      const payload: BusTextUpdatePayload = {
        selector,
        preciseSelector,
        oldText: originalText,
        newText,
        devContext,
      };
      if (newHtml) {
        const mergedHtml = mergeOriginalClasses(newHtml, element.getAttribute("class") || "");
        const structured = htmlToJsxStructured(mergedHtml);
        payload.newHtml = structured.childrenJsx;
        const elementTag = element.tagName.toLowerCase();
        const outputTag = structured.rootTag || "p";
        if (outputTag !== elementTag) {
          payload.newTag = outputTag;
        }
        if (structured.rootAttributes) payload.newAttributes = structured.rootAttributes;
      }

      send({
        type: "TEXT_UPDATED",
        data: payload,
      });

      // Overlay with new content — avoids mutating React-managed DOM which
      // causes removeChild crashes when HMR reconciles the fiber tree.
      cleanupOverlay();

      if (payload.newTag) {
        // Tag change: visually morph the old element toward the target tag's
        // appearance so the brief flash (~100ms until HMR) is nearly invisible.
        const targetTag = payload.newTag as string;
        const isList = targetTag === "ul" || targetTag === "ol";
        if (isList) {
          // p → list: make old element look like a list item
          element.style.display = "list-item";
          element.style.listStyleType = targetTag === "ol" ? "decimal" : "disc";
          element.style.marginLeft = "1.5rem";
        } else {
          // list → p: strip markers from old list
          element.style.listStyle = "none";
          element.style.paddingLeft = "0";
          element.style.marginLeft = "0";
        }
        element.style.visibility = "";
        commitCleanup();
      } else {
        const parsed = newHtml
          ? new DOMParser().parseFromString(newHtml, "text/html")
          : null;
        const source = parsed?.body.firstElementChild as HTMLElement | null;
        const overlay = createFixedOverlay(element);
        if (overlay) {
          if (source) {
            safeSetInnerHtml(overlay, normalizeHtml(source.innerHTML));
            mergeRootAttrsOntoOverlay(overlay, source);
          } else {
            overlay.textContent = newText;
          }
          overlayRef.current = overlay;
        }
        commitCleanup();
      }
    },
    [silentCleanup, beginSave, cleanupOverlay, commitCleanup],
  );

  // ── Segment commit (text segment inside element with <br>) ──

  const handleSegmentCommit = useCallback(
    (
      segment: HTMLElement,
      parent: HTMLElement,
      parentOriginalText: string,
      newSegmentText: string,
      newSegmentHtml: string | null,
    ) => {
      // Clone parent to compute new HTML without mutating React-managed DOM
      const clone = parent.cloneNode(true) as HTMLElement;
      const segmentIdx = Array.from(parent.childNodes).indexOf(segment);
      if (segmentIdx === -1) {
        showIndicator(parent, "error");
        unwrapOrReveal(segment);
        silentCleanup(parent);
        return;
      }
      const clonedSegment = clone.childNodes[segmentIdx] as HTMLElement;

      if (newSegmentHtml) {
        const parsed = new DOMParser().parseFromString(newSegmentHtml, "text/html");
        // ILE passes outerHTML which includes Lexical's <p> wrapper — unwrap it
        const source = parsed.body.firstElementChild?.tagName === "P"
          ? parsed.body.firstElementChild
          : parsed.body;
        const ref = clonedSegment.parentNode!;
        while (source.firstChild) ref.insertBefore(source.firstChild, clonedSegment);
        clonedSegment.remove();
      } else if (segment.hasAttribute("data-airo-wrapped")) {
        const text = clone.ownerDocument.createTextNode(newSegmentText);
        clonedSegment.parentNode!.replaceChild(text, clonedSegment);
      } else {
        clonedSegment.textContent = newSegmentText;
      }

      unwrapAiroSpans(clone);
      unwrapAiroSegments(clone);
      wrapBareChildTextNodes(clone);

      const newParentText = clone.textContent?.trim() || "";

      if (newParentText === parentOriginalText && !newSegmentHtml) {
        unwrapOrReveal(segment);
        silentCleanup(parent);
        return;
      }

      const parentInnerHtml = normalizeHtml(clone.innerHTML);
      const structured = htmlToJsxStructured("<p>" + parentInnerHtml + "</p>", !!newSegmentHtml);

      const devContext = extractDevContext(parent);
      const selector = generateSelector(parent);
      const preciseSelector = generatePreciseSelector(parent);

      beginSave(parent, parentOriginalText);

      send({
        type: "TEXT_UPDATED",
        data: {
          selector,
          preciseSelector,
          oldText: parentOriginalText,
          newText: newParentText,
          newHtml: structured.childrenJsx,
          devContext,
        },
      });

      unwrapOrReveal(segment);

      cleanupOverlay();
      const overlay = createFixedOverlay(parent);
      if (overlay) {
        safeSetInnerHtml(overlay, parentInnerHtml);
        overlayRef.current = overlay;
        parent.style.visibility = "hidden";
      }

      commitCleanup();
    },
    [silentCleanup, beginSave, cleanupOverlay, commitCleanup],
  );

  // ── Cancel handler ──

  const handleCancel = useCallback(
    (element: HTMLElement) => {
      cleanupOverlay();
      unwrapOrReveal(element);
      cleanupEditor();
      updateState({ editingElement: null, originalText: null });
    },
    [cleanupEditor, cleanupOverlay, updateState],
  );

  // ── Stop editing (public API, used by useHoverHint via stateRef) ──

  const stopEditing = useCallback(
    (save: boolean) => {
      const { editingElement } = stateRef.current;
      if (!editingElement) return;

      if (save) {
        if (lexicalCommitRef.current) {
          lexicalCommitRef.current();
        } else if (blurHandlerRef.current) {
          editingElement.blur();
        } else {
          showIndicator(editingElement, "error");
          handleCancel(editingElement);
        }
      } else {
        if (blurHandlerRef.current) {
          editingElement.removeEventListener("blur", blurHandlerRef.current);
          editingElement.removeEventListener("paste", insertPlainTextOnPaste);
          blurHandlerRef.current = null;
          editingElement.contentEditable = "false";
        }
        handleCancel(editingElement);
      }
    },
    [handleCancel],
  );

  // ── Start editing (legacy contentEditable fallback) ──

  const blurHandlerRef = useRef<(() => void) | null>(null);

  const startEditingLegacy = useCallback(
    (element: HTMLElement, brParent?: HTMLElement) => {
      if (stateRef.current.editingElement && stateRef.current.editingElement !== element) {
        stopEditing(true);
      }

      const originalText = element.textContent?.trim() || "";
      const originalInnerHtml = element.innerHTML;
      const originalHasStructure = element.querySelector("a, span, em, strong, b, i, code, br") !== null;
      const parentOriginalText = brParent?.textContent?.trim() || "";
      element.contentEditable = "true";
      element.style.outline = "none";
      element.addEventListener("paste", insertPlainTextOnPaste);
      element.focus();

      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }

      const onBlur = () => {
        // removeAttribute (not = "false") so outerHTML below doesn't carry contenteditable="false".
        element.removeAttribute("contenteditable");
        element.style.outline = "";
        element.removeEventListener("blur", onBlur);
        element.removeEventListener("paste", insertPlainTextOnPaste);
        blurHandlerRef.current = null;
        const newText = element.textContent?.trim() || "";
        const hasStructureNow = element.querySelector("a, span, em, strong, b, i, code, br") !== null;
        const htmlChanged = element.innerHTML !== originalInnerHtml;
        const newHtml = (originalHasStructure || hasStructureNow) && htmlChanged ? element.outerHTML : null;
        if (brParent) {
          handleSegmentCommit(element, brParent, parentOriginalText, newText, newHtml);
        } else {
          handleCommit(element, originalText, newText, newHtml);
        }
      };
      blurHandlerRef.current = onBlur;
      element.addEventListener("blur", onBlur);

      updateState({ editingElement: element, originalText });
    },
    [stopEditing, handleCommit, handleSegmentCommit, updateState],
  );

  // ── Start editing (Lexical) ──

  const startEditing = useCallback(
    (element: HTMLElement, brParent?: HTMLElement) => {
      if (!import.meta.env.VITE_ENABLE_LEXICAL_EDITOR) {
        startEditingLegacy(element, brParent);
        return;
      }

      if (
        stateRef.current.editingElement &&
        stateRef.current.editingElement !== element
      ) {
        stopEditing(!!lexicalCommitRef.current);
      }

      injectEditorCss();
      ensureBoldFontLoaded(element);

      const parentOriginalText = brParent?.textContent?.trim() || "";
      const originalText = element.textContent?.trim() || "";
      const elementTag = element.tagName.toLowerCase();
      const isListRoot = elementTag === "ul" || elementTag === "ol";
      const initialHtml = isListRoot
        ? normalizeHtml(element.outerHTML)
        : normalizeHtml(element.innerHTML);
      const computedStyles = getComputedStyleMap(element);

      element.style.visibility = "hidden";

      const container = document.createElement("div");
      container.id = "__airo-lexical-editor";
      container.setAttribute("data-dev-tools", "true");
      document.body.appendChild(container);
      editorContainerRef.current = container;

      const root = createRoot(container);
      editorRootRef.current = root;

      const allowBlockFormatting = !brParent && isBodyTextElement(element);

      root.render(
        createElement(InlineLexicalEditor, {
          initialHtml,
          computedStyles,
          singleLine: isSingleLine(element),
          allowBlockFormatting,
          targetElement: element,
          onCommit: (newText: string, newHtml: string | null) => {
            if (brParent) {
              handleSegmentCommit(element, brParent, parentOriginalText, newText, newHtml);
            } else {
              handleCommit(element, originalText, newText, newHtml);
            }
          },
          onCancel: () => {
            handleCancel(element);
          },
          externalCommitRef: lexicalCommitRef,
        }),
      );

      updateState({ editingElement: element, originalText });
    },
    [stopEditing, startEditingLegacy, handleCommit, handleSegmentCommit, handleCancel, updateState],
  );

  // ── Click handler ──

  useEffect(() => {
    if (!isEditModeActive) return;

    const handleClick = (e: MouseEvent) => {
      if (!e.isTrusted) return;
      const rawTarget = e.target as HTMLElement;
      if (!rawTarget || isDevToolsElement(rawTarget)) return;

      // Nav links pass through to native navigation in Edit mode. Bail out
      // before we preventDefault or open the inline editor so the SPA router
      // handles the click cleanly.
      if (isInsideNavSurface(rawTarget)) return;

      // Always block navigation on clickable elements (links, buttons) in edit mode
      if (rawTarget.closest("a, button, [role='button']")) {
        e.preventDefault();
      }

      if (stateRef.current.editingElement) return;
      if (stateRef.current.saveStatus === "saving") return;

      let target: HTMLElement | null = null;
      let brParent: HTMLElement | undefined;

      // Check for br-segment first — inline children of br-containing blocks
      // must be handled as segments, not standalone editable containers
      const brResult = findBrSegment(rawTarget, e.clientX, e.clientY, cmsInlineEditEnabled);
      if (brResult) {
        target = brResult.segment;
        brParent = brResult.parent;
      } else {
        target = findEditableContainer(rawTarget, cmsInlineEditEnabled);
      }
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();
      startEditing(target, brParent);
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [isEditModeActive, cmsInlineEditEnabled, startEditing]);

  // ── Listen for save result from parent ──

  useEffect(() => {
    const handleEditResult = (event: MessageEvent) => {
      if (!isOriginAllowed(event)) return;
      if (!event.data?.type) return;

      const pending = pendingSaveRef.current;
      if (!pending) return;

      if (event.data.type === "TEXT_EDIT_SUCCEEDED" || event.data.type === "CONTENT_EDIT_SUCCEEDED") {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        if (event.data.formattingDropped) {
          console.warn("[useTextEditing] formatting was dropped during save — plain text committed");
        }
        // Wait for HMR to update the element before removing overlay, otherwise
        // the stale React DOM shows old content briefly (burn-in effect).
        const el = pending.element;
        const indicator = event.data.formattingDropped ? "error" : "success";

        const reveal = overlayRef.current
          ? () => cleanupOverlay(el)
          : () => { el.style.visibility = ""; };

        const observeTarget = el.parentElement || el;
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          reveal();
          showIndicator(el, indicator);
        };
        const observer = new MutationObserver(settle);
        observer.observe(observeTarget, { childList: true, characterData: true, subtree: true });
        setTimeout(settle, 2000);
        updateState({ saveStatus: "saved" });
        pendingSaveRef.current = null;
        setTimeout(() => {
          if (stateRef.current.saveStatus === "saved") {
            updateState({ saveStatus: "idle" });
          }
        }, INDICATOR_MS);
      } else if (event.data.type === "TEXT_EDIT_FAILED" || event.data.type === "CONTENT_EDIT_FAILED") {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        cleanupOverlay(pending.element);
        const message = event.data.code === TextEditErrorCode.UnsupportedDynamicTextContent
          ? t("devtools_unsupported_dynamic_text_edit", "This text is generated by code. Ask Airo to change it instead.")
          : undefined;
        showIndicator(pending.element, "error", message);
        updateState({ saveStatus: "idle", originalText: pending.originalText });
        pendingSaveRef.current = null;
      }
    };

    window.addEventListener("message", handleEditResult);
    return () => window.removeEventListener("message", handleEditResult);
  }, [cleanupOverlay, updateState]);

  // ── Cleanup on deactivation ──

  useEffect(() => {
    if (!isEditModeActive && stateRef.current.editingElement) {
      stopEditing(false);
    }
  }, [isEditModeActive, stopEditing]);

  // ── Cleanup orphaned editors on mount (HMR can leave them behind) ──

  useEffect(() => {
    document
      .querySelectorAll("#__airo-lexical-editor, [data-airo-overlay]")
      .forEach((el) => el.remove());
    // Unwrap any leftover wrapped/segment spans from previous editing sessions
    for (const span of document.querySelectorAll("[data-airo-wrapped], [data-airo-segment]")) {
      const p = span.parentNode!;
      while (span.firstChild) p.insertBefore(span.firstChild, span);
      span.remove();
    }
  }, []);

  // ── Cleanup on unmount ──

  useEffect(() => {
    return () => {
      cleanupEditor();
      cleanupOverlay();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [cleanupEditor, cleanupOverlay]);

  return {
    editingElement: state.editingElement,
    saveStatus: state.saveStatus,
    /** Ref to current state for use in other hooks' effects */
    stateRef,
    stopEditing,
  };
}
