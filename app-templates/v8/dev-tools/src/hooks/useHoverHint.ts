import { useEffect, useRef } from "react";
import { isOriginAllowed } from "../utils/postMessage";
import { send } from "../utils/eventBus";
import {
	showSelectionOverlay,
	clearSelectionOverlay,
	updateSelectionOverlay,
	removeNumberedOverlay,
	clearAllNumberedOverlays,
	updateAllNumberedOverlays,
} from "../utils/selection-overlay";
import {
	isContentElement,
	isDevToolsElement,
	detectImage,
} from "../utils/element-detection";

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
	isMultiSelectActive = false,
) {
	// Inject keyframe animation once
	useEffect(() => {
		const id = "edit-mode-keyframes";
		if (!document.getElementById(id)) {
			const style = document.createElement("style");
			style.id = id;
			style.textContent = `@keyframes editBarFadeIn { from { opacity: 0; scale: 0.92; } to { opacity: 1; scale: 1; } }`;
			document.head.appendChild(style);
		}
	}, []);

	const editingStateRefStable = useRef(editingStateRef);
	editingStateRefStable.current = editingStateRef;

	useEffect(() => {
		if (!isEditModeActive) return;
		let hoveredEl: HTMLElement | null = null;
		let hideTimer: ReturnType<typeof setTimeout> | null = null;
		let selectedEl: HTMLElement | null = null;
		const multiSelectElements = new Map<number, HTMLElement>();

		const clearSelection = () => {
			const hadSelection =
				!!selectedEl || !!document.querySelector("[data-ai-selected]");
			clearSelectionOverlay();
			selectedEl = null;
			if (hadSelection && !isMultiSelectActive) {
				send({ type: "CLEAR_AI_EDIT_CONTEXT" });
			}
		};

		const clearHover = () => {
			hoveredEl = null;
		};

		const handleMouseOver = (e: MouseEvent) => {
			if (editingStateRefStable.current.current?.editingElement) return;

			const target = e.target as HTMLElement;
			if (!target || isDevToolsElement(target)) return;
			if (target === hoveredEl) return;
			if (target === selectedEl || target.hasAttribute("data-ai-selected"))
				return;
			if (isMultiSelectActive && target.hasAttribute("data-ai-selected-num"))
				return;

			if (hideTimer) {
				clearTimeout(hideTimer);
				hideTimer = null;
			}

			const tag = target.tagName.toLowerCase();
			if (tag === "body" || tag === "html") return;

			const imageInfo = detectImage(target);
			if (imageInfo.isImage) {
				clearHover();
				return;
			}

			if (!isContentElement(target)) {
				clearHover();
				return;
			}

			// Content elements are handled by ElementHoverBar (React component).
			// Only track hover state here for outline styling; don't show DOM sparkle button.
			if (hoveredEl && hoveredEl !== target) clearHover();

			hoveredEl = target;
		};

		const handleMouseOut = (e: MouseEvent) => {
			const related = e.relatedTarget as HTMLElement | null;
			if (related?.closest(".edit-mode-hover-bar")) return;
			if (related?.closest(".edit-mode-link-follow-bar")) return;
			if (hoveredEl && e.target === hoveredEl) {
				hideTimer = setTimeout(clearHover, 300);
			}
		};

		const handleMessage = (event: MessageEvent) => {
			if (!isOriginAllowed(event)) return;
			const { type, data } = event.data ?? {};
			if (type === "CLEAR_SELECTION") {
				clearSelection();
			}
			// Scroll a selected element into view when user clicks its chip
			if (type === "SCROLL_TO_SELECTION" && data?.number != null) {
				const el = document.querySelector(
					`[data-ai-selected-num="${data.number}"]`
				) as HTMLElement | null;
				if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
			}
			// Multi-select messages
			if (type === "REMOVE_SELECTION" && data?.number != null) {
				const num = data.number as number;
				multiSelectElements.delete(num);
				removeNumberedOverlay(num);
			}
			if (type === "CLEAR_ALL_SELECTIONS") {
				clearAllNumberedOverlays();
				multiSelectElements.clear();
				clearSelection();
			}
		};

		const handleScrollOrResize = () => {
			updateSelectionOverlay();
			updateAllNumberedOverlays();
		};
		const handleNavigation = () => {
			clearSelection();
			clearAllNumberedOverlays();
			multiSelectElements.clear();
			send({ type: "SELECTIONS_CLEARED_BY_NAVIGATION" });
		};
		const origPushState = history.pushState.bind(history);
		const origReplaceState = history.replaceState.bind(history);
		history.pushState = (...args) => {
			origPushState(...args);
			handleNavigation();
		};
		history.replaceState = (...args) => {
			origReplaceState(...args);
			handleNavigation();
		};

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
			clearAllNumberedOverlays();
		};
	}, [isEditModeActive, isMultiSelectActive]);
}
