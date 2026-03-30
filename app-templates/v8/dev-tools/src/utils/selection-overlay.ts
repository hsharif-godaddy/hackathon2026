const OVERLAY_ID = "ai-select-overlay";

/** Position (or reposition) the overlay to match the element's current rect */
function positionOverlay(overlay: HTMLElement, el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const inset = Math.min(2, rect.width / 4, rect.height / 4);
  overlay.style.top = `${rect.top + inset}px`;
  overlay.style.left = `${rect.left + inset}px`;
  overlay.style.width = `${rect.width - inset * 2}px`;
  overlay.style.height = `${rect.height - inset * 2}px`;
}

/** Remove the selection overlay and clear data-ai-selected from any element */
export function clearSelectionOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.remove();
  const prev = document.querySelector("[data-ai-selected]") as HTMLElement | null;
  if (prev) prev.removeAttribute("data-ai-selected");
}

/** Create a fixed-position overlay that highlights the element.
 *  Not affected by parent overflow:hidden or z-index stacking. */
export function showSelectionOverlay(el: HTMLElement): void {
  clearSelectionOverlay();
  el.setAttribute("data-ai-selected", "true");

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = `
    position: fixed;
    border: 3px solid var(--color-interactive);
    border-radius: 6px;
    box-shadow: 0 0 12px rgba(59,130,246,0.5), inset 0 0 12px rgba(59,130,246,0.15);
    pointer-events: none;
    z-index: 10001;
  `;
  positionOverlay(overlay, el);
  document.body.appendChild(overlay);
}

/** Update overlay position to track the selected element on scroll/resize.
 *  Clears the overlay if the selected element is no longer in the DOM
 *  (e.g. after page navigation). */
export function updateSelectionOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;
  const el = document.querySelector("[data-ai-selected]") as HTMLElement | null;
  if (!el || !document.body.contains(el)) {
    clearSelectionOverlay();
    return;
  }
  positionOverlay(overlay, el);
}
