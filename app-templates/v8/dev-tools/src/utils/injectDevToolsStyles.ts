const STYLE_ID = 'airo-dev-tools-styles';
const SYSTEM_FONT = 'system-ui, sans-serif';

/**
 * Injects a scoped <style> tag that isolates dev-tools UI from the app's custom fonts.
 */
export function injectDevToolsStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [data-airo-dev-tools] {
      --font-heading: ${SYSTEM_FONT} !important;
      font-family: ${SYSTEM_FONT};
    }
  `;
  document.head.appendChild(style);
}
