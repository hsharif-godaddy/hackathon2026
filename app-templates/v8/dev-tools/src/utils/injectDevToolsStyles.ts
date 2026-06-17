const STYLE_ID = 'airo-dev-tools-styles';
const SYSTEM_FONT = 'system-ui, sans-serif';

/**
 * Injects a scoped <style> tag that provides CSS variables and font isolation for dev-tools UI.
 */
export function injectDevToolsStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [data-airo-dev-tools] {
      /* Fonts */
      --font-heading: ${SYSTEM_FONT} !important;
      font-family: ${SYSTEM_FONT};

      /* Brand/Primary Colors */
      --color-primary: #6b46c1;
      --color-primary-hover: #5a32b0;
      --color-primary-light: #f5f3ff;

      /* Interactive/Action Colors */
      --color-interactive: #8b5cf6;
      --color-interactive-hover: #2563eb;
      --color-interactive-bg: #eff6ff;
      --color-interactive-bg-hover: #dbeafe;
      --color-interactive-border: #bfdbfe;
      --color-interactive-border-hover: #93c5fd;

      /* Status Colors */
      --color-success: #059669;
      --color-success-bg: #ecfdf5;
      --color-success-bg-hover: #d1fae5;
      --color-success-border: #a7f3d0;
      --color-success-border-hover: #6ee7b7;
      --color-error: #dc2626;
      --color-error-gradient-start: #ef4444;
      --color-error-gradient-end: #dc2626;
      --color-warning: #d97706;

      /* Neutral/Surface Colors */
      --color-surface: #ffffff;
      --color-surface-hover: #f9fafb;
      --color-surface-overlay: rgba(0, 0, 0, 0.15);
      --color-border: #d1d5db;
      --color-border-light: #e5e7eb;

      /* Text Colors */
      --color-text-primary: #111111;
      --color-text-secondary: #374151;
      --color-text-tertiary: #6b7280;
      --color-text-muted: #9ca3af;

      /* Special Purpose */
      --color-accent-purple: #8b5cf6;
      --color-accent-purple-bg: #f5f3ff;
      --color-accent-purple-bg-hover: #ede9fe;
      --color-accent-purple-border: #ddd6fe;
      --color-accent-purple-border-hover: #c4b5fd;
      --color-accent-pink: #db2777;
      --color-selection-outline: #10b981;

      /* Color Palette (for ElementEditor presets) */
      --color-black: #111827;
      --color-gray-600: #4b5563;
      --color-blue-600: #2563eb;
      --color-purple-600: #9333ea;
      --color-green-600: #16a34a;
      --color-red-600: #dc2626;
      --color-orange-600: #d97706;
      --color-pink-600: #db2777;
      --color-gray-100: #f3f4f6;
      --color-blue-100: #dbeafe;
      --color-purple-100: #e9d5ff;
      --color-green-100: #dcfce7;
      --color-red-100: #fee2e2;
      --color-yellow-100: #fef3c7;
      --color-pink-100: #fce7f3;
    }

    /* Editable compliance field spans (preview-only; never shipped to publish).
       Templates vary (dark, light, colored backgrounds), so the highlight is
       derived from currentColor — the page's own text color — rather than a
       fixed palette. The page's text already contrasts with its background, so
       a faint tint of that same color and a currentColor underline are
       guaranteed to contrast too. The text color itself is NEVER overridden, so
       the value stays as legible as the surrounding copy. */
    .airo-editable-field {
      background-color: color-mix(in srgb, currentColor 14%, transparent);
      border-bottom: 1px dashed currentColor;
      border-radius: 2px;
      padding: 0 2px;
      cursor: text;
      transition: background-color 120ms ease;
    }
    .airo-editable-field:hover {
      background-color: color-mix(in srgb, currentColor 24%, transparent);
    }
    .airo-editable-field::after {
      content: "\\270E";
      font-size: 0.75em;
      margin-left: 3px;
      color: currentColor;
      opacity: 0.65;
      user-select: none;
    }
    .airo-editable-field:focus {
      outline: 2px solid currentColor;
      outline-offset: 1px;
      background-color: color-mix(in srgb, currentColor 24%, transparent);
    }
    .airo-editable-field:focus::after { content: ""; }

    /* Rejected input (failed data-type validation) — brief red flash. */
    .airo-editable-field-invalid {
      background-color: color-mix(in srgb, #dc2626 28%, transparent) !important;
      border-bottom-color: #dc2626 !important;
    }

    /* us_states dropdown. Transparent chrome + currentColor so it inherits the
       template's text color and stays legible on any background. The pencil
       glyph is suppressed for select-backed fields. */
    .airo-editable-field-select { padding: 0; }
    .airo-editable-field-select::after { content: ""; }
    .airo-state-select {
      font: inherit;
      color: currentColor;
      background-color: transparent;
      border: none;
      border-bottom: 1px dashed currentColor;
      padding: 0 18px 0 2px;
      margin: 0;
      cursor: pointer;
      -webkit-appearance: none;
      appearance: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='currentColor' stroke-width='1.5'/></svg>");
      background-repeat: no-repeat;
      background-position: right 2px center;
    }
    .airo-state-select:focus {
      outline: 2px solid currentColor;
      outline-offset: 1px;
    }
    /* Option list renders in the OS popup; force readable colors there. */
    .airo-state-select option {
      color: #111111;
      background-color: #ffffff;
    }

    /* Per-section boolean toggle control. */
    .airo-section-toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin: 0 6px;
      padding: 1px 8px;
      font-family: ${SYSTEM_FONT};
      font-size: 0.7rem;
      line-height: 1.4;
      color: #5a32b0;
      background-color: #f5f3ff;
      border: 1px solid #ddd6fe;
      border-radius: 9999px;
      cursor: pointer;
    }
    .airo-section-toggle[aria-pressed="true"] {
      color: #ffffff;
      background-color: #8b5cf6;
      border-color: #8b5cf6;
    }
    .airo-section-toggle:hover {
      border-color: #c4b5fd;
    }
  `;
  document.head.appendChild(style);
}
