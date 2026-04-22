/** Returns black or white depending on which has better contrast against `hex`. */
export function getContrastColor(hex: string): string {
  // Normalize shorthand #RGB → #RRGGBB
  const normalized =
    /^#[\da-f]{3}$/i.test(hex)
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;

  // Only process valid #RRGGBB (with optional alpha suffix)
  if (!/^#[\da-f]{6}/i.test(normalized)) return '#000000';

  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

/** Builds a CSS font-family value from a brand font family name. */
export function fontFamily(family: string | undefined): string | undefined {
  return family ? `"${family}", sans-serif` : undefined;
}

/** Extract CSS custom property name from an intent string like "var(--ux-abc123, fallback)". */
export function extractVarName(intentValue: string): string | null {
  const match = intentValue.match(/var\((--[^,)]+)/);
  return match ? match[1] : null;
}
