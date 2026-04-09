import { useEffect, useState, useCallback, useRef } from "react";
import { safePostMessage, isOriginAllowed } from "../utils/postMessage";
import { generatePreciseSelector, extractDevContext } from "../utils/element-helpers";
import { isClickable, isTextEditable, hasStyledChildren, isSingleLineElement, isDevToolsElement, generateSelector } from "../utils/element-detection";
import { t } from "../utils/translations";

const DEBOUNCE_SAVE_MS = 8000;
const INDICATOR_MS = 1500;

function showIndicator(element: HTMLElement, type: "success" | "error") {
  const existing = document.getElementById("edit-mode-save-indicator");
  if (existing) existing.remove();

  const rect = element.getBoundingClientRect();
  const indicator = document.createElement("div");
  indicator.id = "edit-mode-save-indicator";

  const isError = type === "error";
  indicator.textContent = isError
    ? t("devtools_edit_failed", "Edit failed")
    : t("devtools_saved", "Saved");

  const color = isError ? "#dc2626" : "var(--color-success)";
  const bg = isError ? "#fef2f2" : "var(--color-success-bg)";
  const border = isError ? "#fecaca" : "var(--color-success-border)";

  indicator.style.cssText = `
    position: fixed;
    top: ${rect.top - 24}px;
    right: ${window.innerWidth - rect.right}px;
    font-size: 11px;
    font-weight: 500;
    color: ${color};
    background: ${bg};
    border: 1px solid ${border};
    padding: 2px 8px;
    border-radius: 4px;
    z-index: 10001;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease-in;
    font-family: system-ui, sans-serif;
  `;
  document.body.appendChild(indicator);

  requestAnimationFrame(() => {
    indicator.style.opacity = "1";
  });

  setTimeout(() => {
    indicator.style.opacity = "0";
    setTimeout(() => indicator.remove(), 200);
  }, INDICATOR_MS);
}

interface TextEditingState {
  editingElement: HTMLElement | null;
  originalContent: string | null;
  originalText: string | null;
  saveStatus: "idle" | "saving" | "saved";
}

interface PendingSave {
  element: HTMLElement;
  originalText: string;
  originalContent: string;
}

/**
 * Hook for inline text editing via contentEditable.
 * Handles click-to-edit, keyboard shortcuts, auto-save on debounce/blur,
 * and styled-children wrapping.
 */
export function useTextEditing(isEditModeActive: boolean) {
  const [state, setState] = useState<TextEditingState>({
    editingElement: null,
    originalContent: null,
    originalText: null,
    saveStatus: "idle",
  });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const blurHandlerRef = useRef<(() => void) | null>(null);
  const pendingSaveRef = useRef<PendingSave | null>(null);

  // ── Save logic ──

  const saveCurrentEdit = useCallback(
    (element: HTMLElement, originalText: string) => {
      const newText = element.textContent?.trim() || "";
      if (newText === originalText) return;

      const devContext = extractDevContext(element);
      const selector = generateSelector(element);
      const preciseSelector = generatePreciseSelector(element);

      // Store element + original content so we can revert on failure
      pendingSaveRef.current = {
        element,
        originalText,
        originalContent: stateRef.current.originalContent ?? element.innerHTML,
      };

      setState((prev) => ({ ...prev, saveStatus: "saving" }));

      safePostMessage(window.parent, {
        type: "TEXT_UPDATED",
        data: { selector, preciseSelector, oldText: originalText, newText, devContext },
      });
    },
    [],
  );

  // ── Stop editing ──

  const stopEditing = useCallback(
    (save: boolean) => {
      const { editingElement, originalText, originalContent } = stateRef.current;
      if (!editingElement) return;

      // Clear any in-flight save so a late TEXT_EDIT_SUCCEEDED/FAILED
      // doesn't fire on an already-ended edit session
      if (!save) {
        pendingSaveRef.current = null;
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      if (save && originalText !== null) {
        saveCurrentEdit(editingElement, originalText);
      } else if (!save && originalContent !== null) {
        // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
        // Safe: originalContent is captured from this element's own innerHTML at edit start (not user input)
        editingElement.innerHTML = originalContent;
      }

      if (blurHandlerRef.current) {
        editingElement.removeEventListener("blur", blurHandlerRef.current);
        blurHandlerRef.current = null;
      }

      editingElement.contentEditable = "false";
      editingElement.style.outline = "";
      editingElement.style.outlineOffset = "";

      if (editingElement.dataset.editWrapper === "true") {
        const parent = editingElement.parentElement;
        if (parent) {
          while (editingElement.firstChild) {
            parent.insertBefore(editingElement.firstChild, editingElement);
          }
          parent.removeChild(editingElement);
        }
      }

      setState((prev) => ({
        ...prev,
        editingElement: null,
        originalContent: null,
        originalText: null,
      }));
    },
    [saveCurrentEdit],
  );

  // ── Start editing ──

  const startEditing = useCallback(
    (element: HTMLElement, clickEvent?: MouseEvent) => {
      if (stateRef.current.editingElement && stateRef.current.editingElement !== element) {
        stopEditing(true);
      }

      let editTarget = element;

      if (hasStyledChildren(element) && clickEvent) {
        const range = document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
        const textNode = range?.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer : null;

        if (textNode && element.contains(textNode)) {
          if (textNode.parentElement === element) {
            const wrapper = document.createElement("span");
            wrapper.dataset.editWrapper = "true";
            textNode.parentNode?.insertBefore(wrapper, textNode);
            wrapper.appendChild(textNode);
            editTarget = wrapper;
          }
        }
      }

      editTarget.contentEditable = "true";
      editTarget.style.outline = "none";
      editTarget.style.outlineOffset = "";
      editTarget.focus();

      const handleBlur = () => stopEditing(true);
      blurHandlerRef.current = handleBlur;
      editTarget.addEventListener("blur", handleBlur);

      const sel = window.getSelection();
      if (clickEvent && document.caretRangeFromPoint) {
        const caretRange = document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
        if (caretRange && editTarget.contains(caretRange.startContainer)) {
          sel?.removeAllRanges();
          sel?.addRange(caretRange);
        }
      }
      if (!sel?.rangeCount) {
        const range = document.createRange();
        range.selectNodeContents(editTarget);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }

      setState((prev) => ({
        ...prev,
        editingElement: editTarget,
        originalContent: editTarget.innerHTML,
        originalText: editTarget.textContent?.trim() || "",
      }));
    },
    [stopEditing],
  );

  // ── Click handler ──

  useEffect(() => {
    if (!isEditModeActive) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || isDevToolsElement(target)) return;

      if (stateRef.current.editingElement) {
        if (!stateRef.current.editingElement.contains(target)) {
          stopEditing(true);
        }
        return;
      }

      if (!isTextEditable(target)) return;

      if (isClickable(target)) {
        if (e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          startEditing(target, e);
        }
      } else {
        e.preventDefault();
        e.stopPropagation();
        startEditing(target, e);
      }
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [isEditModeActive, startEditing, stopEditing]);

  // ── Keyboard handler ──

  useEffect(() => {
    if (!isEditModeActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const { editingElement } = stateRef.current;
      if (!editingElement) return;

      if (e.key === "Escape") {
        e.preventDefault();
        stopEditing(false);
        return;
      }

      if (e.key === "Enter" && isSingleLineElement(editingElement)) {
        e.preventDefault();
        stopEditing(true);
        return;
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        if (stateRef.current.editingElement && stateRef.current.originalText !== null) {
          saveCurrentEdit(stateRef.current.editingElement, stateRef.current.originalText);
          setState((prev) => ({
            ...prev,
            originalText: prev.editingElement?.textContent?.trim() || prev.originalText,
          }));
        }
      }, DEBOUNCE_SAVE_MS);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isEditModeActive, stopEditing, saveCurrentEdit]);

  // ── Listen for save result from parent ──

  useEffect(() => {
    const handleEditResult = (event: MessageEvent) => {
      if (!isOriginAllowed(event)) return;
      if (!event.data?.type) return;

      const pending = pendingSaveRef.current;
      if (!pending) return;

      if (event.data.type === "TEXT_EDIT_SUCCEEDED") {
        showIndicator(pending.element, "success");
        setState((prev) => ({ ...prev, saveStatus: "saved" }));
        pendingSaveRef.current = null;
        setTimeout(() => {
          setState((prev) =>
            prev.saveStatus === "saved" ? { ...prev, saveStatus: "idle" } : prev,
          );
        }, INDICATOR_MS);
      } else if (event.data.type === "TEXT_EDIT_FAILED") {
        // Revert the DOM to what it was before this edit, preserving child HTML structure
        // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
        // Safe: originalContent is captured from this element's own innerHTML at save time (not user input)
        pending.element.innerHTML = pending.originalContent;
        showIndicator(pending.element, "error");
        setState((prev) => ({
          ...prev,
          saveStatus: "idle",
          originalText: pending.originalText,
        }));
        pendingSaveRef.current = null;
      }
    };

    window.addEventListener("message", handleEditResult);
    return () => window.removeEventListener("message", handleEditResult);
  }, []);

  // ── Cleanup on deactivation ──

  useEffect(() => {
    if (!isEditModeActive && stateRef.current.editingElement) {
      stopEditing(true);
    }
  }, [isEditModeActive, stopEditing]);

  return {
    editingElement: state.editingElement,
    saveStatus: state.saveStatus,
    /** Ref to current state for use in other hooks' effects */
    stateRef,
    stopEditing,
  };
}
