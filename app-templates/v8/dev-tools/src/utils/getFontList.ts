/**
 * getFontList — Font list provider for the font family picker.
 *
 * The picker displays three sections:
 *
 *   1. **Theme Fonts** — Read from CSS custom properties on :root
 *      (--font-heading, --font-sans, --font-serif, --font-mono).
 *      These reflect the template's configured typography and are
 *      deduplicated when multiple vars resolve to the same stack.
 *
 *   2. **Recent** — Last 4 fonts the user selected this session,
 *      stored in sessionStorage. Provides quick re-access.
 *
 *   3. **Custom Fonts** — 15 curated web-safe font stacks (sans-serif,
 *      serif, monospace, display). Filtered to only fonts installed on the
 *      user's OS (canvas measurement check), and sorted so fonts matching
 *      the theme's dominant category (e.g. serif) appear first.
 *
 * Consumers call `getFontList()` on picker open and `recordRecentFont()`
 * after a successful commit.
 */

// ── Types ──

export interface FontOption {
  /** Display label shown in the picker */
  label: string;
  /** CSS font-family value to apply */
  value: string;
  /** Generic family category for relevance sorting */
  category?: "sans-serif" | "serif" | "monospace" | "display";
}

export interface FontList {
  theme: FontOption[];
  recent: FontOption[];
  custom: FontOption[];
}

// ── Theme font reading ──

const THEME_FONT_VARS: { variable: string; label: string }[] = [
  { variable: "--font-heading", label: "Heading" },
  { variable: "--font-sans", label: "Body" },
  { variable: "--font-serif", label: "Serif" },
  { variable: "--font-mono", label: "Mono" },
];

/** Web-safe font stacks available as custom options, grouped by style. */
const CUSTOM_FONTS: FontOption[] = [
  // Sans-serif
  { label: "Arial", value: "Arial, Helvetica, sans-serif", category: "sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif", category: "sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', Helvetica, sans-serif", category: "sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif", category: "sans-serif" },
  { label: "Gill Sans", value: "'Gill Sans', 'Gill Sans MT', sans-serif", category: "sans-serif" },
  { label: "Futura", value: "Futura, 'Trebuchet MS', sans-serif", category: "sans-serif" },
  // Serif
  { label: "Georgia", value: "Georgia, serif", category: "serif" },
  { label: "Palatino", value: "'Palatino Linotype', 'Book Antiqua', Palatino, serif", category: "serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif", category: "serif" },
  { label: "Garamond", value: "Garamond, 'EB Garamond', serif", category: "serif" },
  { label: "Baskerville", value: "Baskerville, 'Baskerville Old Face', serif", category: "serif" },
  // Monospace
  { label: "Courier New", value: "'Courier New', Courier, monospace", category: "monospace" },
  { label: "Lucida Console", value: "'Lucida Console', Monaco, monospace", category: "monospace" },
  // Display
  { label: "Impact", value: "Impact, 'Arial Narrow Bold', sans-serif", category: "display" },
  { label: "Copperplate", value: "Copperplate, 'Copperplate Gothic Light', fantasy", category: "display" },
];

const GENERIC_FAMILIES = new Set([
  "sans-serif", "serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded",
]);

// ── Recent fonts (sessionStorage) ──

const RECENT_FONTS_KEY = "airo-dev-tools-recent-fonts";
const MAX_RECENT = 4;

/** Retrieve recently used fonts from sessionStorage. */
function getRecentFonts(): FontOption[] {
  try {
    const raw = sessionStorage.getItem(RECENT_FONTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FontOption[];
  } catch (e) {
    console.warn("[dev-tools] Failed to parse recent fonts from sessionStorage; resetting.", e);
    return [];
  }
}

/** Record a font selection to sessionStorage recent list. */
export function recordRecentFont(font: FontOption): void {
  try {
    const recent = getRecentFonts().filter((f) => f.value !== font.value);
    recent.unshift({ label: font.label, value: font.value });
    sessionStorage.setItem(RECENT_FONTS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // sessionStorage unavailable (e.g. sandboxed iframe) — silently skip.
  }
}

// ── Font availability check ──

/**
 * Lightweight check if a font is likely available on the system.
 * Uses canvas text measurement: if the font renders at a different width
 * than the generic fallback, it's installed.
 */
const availabilityCache = new Map<string, boolean>();

function isFontAvailable(fontFamily: string): boolean {
  const primary = primaryFontName(fontFamily);
  if (availabilityCache.has(primary)) return availabilityCache.get(primary)!;

  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return true; // Can't check — assume available.

    const testStr = "mmmmmmmmmmlli";
    const fallback = "monospace";
    ctx.font = `72px ${fallback}`;
    const fallbackWidth = ctx.measureText(testStr).width;
    ctx.font = `72px '${primary}', ${fallback}`;
    const testWidth = ctx.measureText(testStr).width;

    const available = testWidth !== fallbackWidth;
    availabilityCache.set(primary, available);
    return available;
  } catch (e) {
    console.warn("[dev-tools] Font availability check failed; assuming available.", { fontFamily, error: e });
    return true;
  }
}

// ── Relevance sorting ──

/**
 * Detect the dominant generic family of the theme (based on --font-sans / --font-heading).
 * Returns "sans-serif" | "serif" | "monospace" or null.
 */
function detectThemeCategory(style: CSSStyleDeclaration): string | null {
  for (const varName of ["--font-sans", "--font-heading"]) {
    const value = style.getPropertyValue(varName).trim().toLowerCase();
    if (!value) continue;
    if (value.includes("serif") && !value.includes("sans-serif")) return "serif";
    if (value.includes("sans-serif") || value.includes("sans")) return "sans-serif";
    if (value.includes("monospace") || value.includes("mono")) return "monospace";
  }
  return null;
}

/**
 * Sort fonts by relevance: fonts matching the theme's category come first,
 * then others in their original order.
 */
function sortByRelevance(fonts: FontOption[], themeCategory: string | null): FontOption[] {
  if (!themeCategory) return fonts;
  // Stable partition: matching category first, rest after.
  const matching: FontOption[] = [];
  const rest: FontOption[] = [];
  for (const f of fonts) {
    if (f.category === themeCategory) {
      matching.push(f);
    } else {
      rest.push(f);
    }
  }
  return [...matching, ...rest];
}

/** Extract the first real font name from a CSS font-family stack. */
export function primaryFontName(stack: string): string {
  const families = stack.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
  for (const f of families) {
    const lower = f.toLowerCase();
    if (lower.startsWith("-") || lower.startsWith("ui-") || GENERIC_FAMILIES.has(lower)) continue;
    return f;
  }
  return families[0]?.replace(/^["']|["']$/g, "") || stack;
}

// ── Public API ──

/**
 * Returns theme fonts, recent fonts, and custom fonts for the picker.
 * Theme fonts read from CSS custom properties on :root. Deduplicates by value.
 * Custom fonts filtered to available system fonts and sorted by theme relevance.
 */
export function getFontList(): FontList {
  const style = getComputedStyle(document.documentElement);
  const theme: FontOption[] = [];
  const seen = new Set<string>();

  for (const { variable, label } of THEME_FONT_VARS) {
    const value = style.getPropertyValue(variable).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);

    const name = primaryFontName(value);
    theme.push({
      label: name !== label ? `${label} — ${name}` : label,
      value,
    });
  }

  // Filter custom fonts: remove theme duplicates, check availability, sort by relevance.
  const themeCategory = detectThemeCategory(style);
  const available = CUSTOM_FONTS
    .filter((f) => !seen.has(f.value))
    .filter((f) => isFontAvailable(f.value));
  const custom = sortByRelevance(available, themeCategory);

  // Recent fonts (exclude any that are already in theme section).
  const recent = getRecentFonts().filter((f) => !seen.has(f.value));

  return { theme, recent, custom };
}
