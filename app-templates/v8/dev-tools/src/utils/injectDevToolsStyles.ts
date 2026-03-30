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
  `;
  document.head.appendChild(style);
}
