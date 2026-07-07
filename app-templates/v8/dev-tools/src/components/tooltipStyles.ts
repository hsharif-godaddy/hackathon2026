/** Above `HOVER_BAR_CONTAINER_STYLES` toolbar container (z-index 10000). */
export const FLOATING_TOOLTIP_Z_INDEX = 10001;

const STYLE_ID = "airo-dev-tools-tooltip-styles";

const TOOLTIP_CSS = `
  .airo-tooltip-root {
    position: relative;
    display: inline-flex;
  }

  .airo-tooltip-bubble {
    position: fixed;
    transform: translateX(-50%) translateY(calc(-100% - 5px));
    z-index: ${FLOATING_TOOLTIP_Z_INDEX};
    padding: 8px 12px;
    background: #1a1a1a;
    color: white;
    font-size: 13px;
    font-weight: 500;
    font-family: system-ui, sans-serif;
    border-radius: 8px;
    white-space: nowrap;
    pointer-events: none;
    animation: airoTooltipFadeInUp 0.15s ease-out;
  }

  .airo-tooltip-bubble[data-exiting] {
    animation: airoTooltipFadeOut var(--tooltip-exit-duration, 0.12s) ease-in forwards;
  }

  .airo-tooltip-arrow {
    position: absolute;
    left: var(--airo-tooltip-arrow-left, 50%);
    bottom: -6px;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 6px solid #1a1a1a;
  }

  @keyframes airoTooltipFadeInUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(calc(-100% + 8px));
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(calc(-100% - 5px));
    }
  }

  @keyframes airoTooltipFadeOut {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
`;

export function injectTooltipStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOOLTIP_CSS;
  document.head.appendChild(style);
}

/** Matches `var(--tooltip-exit-duration, 0.12s)` in injected CSS */
export const TOOLTIP_EXIT_MS = 120;
export const TOOLTIP_EXIT_FALLBACK_BUFFER_MS = 50;
