import { useEffect, useRef } from "react";
import { safePostMessage, isOriginAllowed } from "../utils/postMessage";
import { generatePreciseSelector, extractDevContext } from "../utils/element-helpers";
import { showSelectionOverlay, clearSelectionOverlay, updateSelectionOverlay } from "../utils/selection-overlay";
import { isClickable, isTextEditable, isContentElement, isDevToolsElement, detectImage } from "../utils/element-detection";
import { t } from "../utils/translations";

/**
 * Hook for the AI sparkle button on hovered elements, selection overlay,
 * scroll/resize tracking, and SPA navigation cleanup.
 *
 * Shows a sparkle button on content elements. Clicking it selects the
 * element, shows a floating overlay, and sends EDIT_WITH_AI to the parent.
 */
export function useHoverHint(
  isEditModeActive: boolean,
  editingStateRef: React.RefObject<{ editingElement: HTMLElement | null }>,
) {
  // Inject keyframe animation once
  useEffect(() => {
    const id = "edit-mode-keyframes";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `@keyframes editBarFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`;
      document.head.appendChild(style);
    }
  }, []);

  const editingStateRefStable = useRef(editingStateRef);
  editingStateRefStable.current = editingStateRef;

  useEffect(() => {
    if (!isEditModeActive) return;

    let hoveredEl: HTMLElement | null = null;
    let aiBtn: HTMLButtonElement | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let selectedEl: HTMLElement | null = null;

    const removeBtn = () => {
      if (aiBtn) { aiBtn.remove(); aiBtn = null; }
    };

    const clearSelection = () => {
      const hadSelection = !!selectedEl || !!document.querySelector("[data-ai-selected]");
      clearSelectionOverlay();
      selectedEl = null;
      if (hadSelection) {
        safePostMessage(window.parent, { type: "CLEAR_AI_EDIT_CONTEXT" });
      }
    };

    const selectElement = (el: HTMLElement) => {
      clearSelection();
      selectedEl = el;
      showSelectionOverlay(el);
    };

    const clearHover = () => {
      if (hoveredEl && hoveredEl !== selectedEl && !hoveredEl.hasAttribute("data-ai-selected")) {
        hoveredEl.style.outline = "";
        hoveredEl.style.outlineOffset = "";
      }
      hoveredEl = null;
      removeBtn();
    };

    const showAiBtn = (target: HTMLElement) => {
      removeBtn();
      const rect = target.getBoundingClientRect();
      const btn = document.createElement("button");
      btn.className = "edit-mode-hover-bar";
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method, godaddy.js.jquery.security.frameworks.dom-text-interpreted-as-html
      // Safe: static SVG literal, not user-controlled input
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>`;
      btn.title = t("devtools_edit_with_ai", "Edit with AI");
      btn.setAttribute("data-airo-dev-tools", "");
      btn.style.cssText = `
        position: fixed;
        top: ${rect.bottom - 13}px;
        left: ${rect.right - 13}px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        background: rgba(255,255,255,0.9);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: none;
        border-radius: 7px;
        box-shadow: 0 1px 6px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.2);
        color: var(--color-interactive);
        cursor: pointer;
        z-index: 10000;
        pointer-events: auto;
        animation: editBarFadeIn 0.15s ease-out;
      `;

      btn.addEventListener("mouseenter", () => {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        btn.style.background = "rgba(239,246,255,0.95)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "rgba(255,255,255,0.9)";
        hideTimer = setTimeout(clearHover, 300);
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const el = hoveredEl;
        if (!el) return;
        clearHover();

        selectElement(el);

        const devContext = extractDevContext(el);
        const preciseSelector = generatePreciseSelector(el);
        const elRect = el.getBoundingClientRect();
        safePostMessage(window.parent, {
          type: "EDIT_WITH_AI",
          data: {
            elementInfo: {
              tagName: el.tagName.toLowerCase(),
              className: el.className,
              id: el.id,
              textContent: (el.textContent || "").substring(0, 500),
              computedStyles: {},
              rect: { top: elRect.top, left: elRect.left, width: elRect.width, height: elRect.height },
              selector: preciseSelector,
              preciseSelector,
              devContext,
            },
            selector: preciseSelector,
            devContext,
          },
        });
      });

      document.body.appendChild(btn);
      aiBtn = btn;
    };

    const handleMouseOver = (e: MouseEvent) => {
      if (editingStateRefStable.current.current?.editingElement) return;

      const target = e.target as HTMLElement;
      if (!target || isDevToolsElement(target)) return;
      if (target === hoveredEl) return;
      if (target === selectedEl || target.hasAttribute("data-ai-selected")) return;

      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

      const tag = target.tagName.toLowerCase();
      if (tag === "body" || tag === "html") return;

      const imageInfo = detectImage(target);
      if (imageInfo.isImage) { clearHover(); return; }

      if (!isContentElement(target)) { clearHover(); return; }

      if (hoveredEl && hoveredEl !== target) clearHover();

      hoveredEl = target;

      if (isTextEditable(target)) {
        if (isClickable(target)) {
          target.style.outline = "1px dotted rgba(59,130,246,0.3)";
        } else {
          target.style.outline = "1px dashed rgba(59,130,246,0.4)";
        }
        target.style.outlineOffset = "2px";
      }

      showAiBtn(target);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (related?.closest(".edit-mode-hover-bar")) return;
      if (hoveredEl && e.target === hoveredEl) {
        hideTimer = setTimeout(clearHover, 300);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (!isOriginAllowed(event)) return;
      if (event.data?.type === "CLEAR_SELECTION") {
        clearSelection();
      }
    };

    const handleScrollOrResize = () => updateSelectionOverlay();
    const handleNavigation = () => clearSelection();
    const origPushState = history.pushState.bind(history);
    const origReplaceState = history.replaceState.bind(history);
    history.pushState = (...args) => { origPushState(...args); handleNavigation(); };
    history.replaceState = (...args) => { origReplaceState(...args); handleNavigation(); };

    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseout", handleMouseOut);
    window.addEventListener("message", handleMessage);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("popstate", handleNavigation);
    return () => {
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("popstate", handleNavigation);
      history.pushState = origPushState;
      history.replaceState = origReplaceState;
      if (hideTimer) clearTimeout(hideTimer);
      clearHover();
      clearSelection();
    };
  }, [isEditModeActive]);
}
