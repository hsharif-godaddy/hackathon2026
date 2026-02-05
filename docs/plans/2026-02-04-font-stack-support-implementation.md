# Font Stack Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable separate header and body fonts in the font tool, allowing font pairings like "Playfair Display for headers + Inter for body text."

**Architecture:** Additive data model change with backwards compatibility. Add `headerFont` and `bodyFont` fields while preserving legacy `font` field. A `normalizeFontTheme()` helper converts any format to the new shape.

**Tech Stack:** TypeScript, Zod schemas, React components, CSS variables, Google Fonts API

---

## Task 1: Add FontInfo and FontTheme Types with Normalization Helper

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/font-theme.ts:264-278`

**Step 1: Write the failing test**

Add to `agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts`:

```typescript
describe("#normalizeFontTheme", function normalizeTests() {
  it("should return headerFont and bodyFont when both are present", async function bothPresent() {
    const { normalizeFontTheme } = await import("../font-theme.js");

    const theme = {
      id: "test",
      name: "Test Theme",
      description: "Test",
      headerFont: {
        name: "Playfair Display",
        weights: ["600", "700"],
        category: "serif" as const,
      },
      bodyFont: {
        name: "Inter",
        weights: ["400", "500"],
        category: "sans-serif" as const,
      },
    };

    const result = normalizeFontTheme(theme);

    expect(result.headerFont.name).toBe("Playfair Display");
    expect(result.bodyFont.name).toBe("Inter");
  });

  it("should use legacy font field for both when headerFont/bodyFont missing", async function legacyFallback() {
    const { normalizeFontTheme } = await import("../font-theme.js");

    const theme = {
      id: "test",
      name: "Test Theme",
      description: "Test",
      font: {
        name: "Inter",
        weights: ["400", "700"],
        category: "sans-serif" as const,
      },
    };

    const result = normalizeFontTheme(theme);

    expect(result.headerFont.name).toBe("Inter");
    expect(result.bodyFont.name).toBe("Inter");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit -- --testNamePattern="normalizeFontTheme"`
Expected: FAIL with "normalizeFontTheme is not exported"

**Step 3: Add types and normalization helper**

In `agents/src/tools/ai-lib-tools/font-theme.ts`, replace the `FontThemeGridWidget` interface (lines 264-278) with:

```typescript
interface FontInfo {
  name: string;
  weights: string[];
  category: FontCategory;
}

interface FontTheme {
  id: string;
  name: string;
  description: string;
  headerFont?: FontInfo;
  bodyFont?: FontInfo;
  font?: FontInfo; // Legacy field for backwards compatibility
}

interface FontThemeGridWidget {
  widgetType: "font-theme-grid";
  widgetData: {
    themes: FontTheme[];
  };
}

/**
 * Normalize a FontTheme to always have headerFont and bodyFont.
 * Handles backwards compatibility with legacy single-font themes.
 */
export function normalizeFontTheme(theme: FontTheme): {
  headerFont: FontInfo;
  bodyFont: FontInfo;
} {
  if (theme.headerFont && theme.bodyFont) {
    return { headerFont: theme.headerFont, bodyFont: theme.bodyFont };
  }
  // Legacy fallback: use single font for both
  const fallbackFont = theme.font!;
  return { headerFont: fallbackFont, bodyFont: fallbackFont };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit -- --testNamePattern="normalizeFontTheme"`
Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/font-theme.ts agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts
git commit -m "$(cat <<'EOF'
feat(font-theme): add FontTheme types with headerFont/bodyFont support

- Add FontInfo and FontTheme interfaces with optional headerFont/bodyFont
- Keep legacy font field for backwards compatibility
- Add normalizeFontTheme() helper to convert any format to new shape

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Update FONT_THEMES Curated Themes to Use Pairings

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/font-theme.ts:283-338`

**Step 1: Write the failing test**

Add to `agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts`:

```typescript
describe("FONT_THEMES curated themes", function curatedTests() {
  it("should have headerFont and bodyFont for all curated themes", async function allThemesHavePairings() {
    const { FONT_THEMES } = await import("../font-theme.js");

    for (const [themeId, theme] of Object.entries(FONT_THEMES)) {
      expect(theme.headerFont, `${themeId} missing headerFont`).toBeDefined();
      expect(theme.bodyFont, `${themeId} missing bodyFont`).toBeDefined();
      expect(
        theme.headerFont.name,
        `${themeId} headerFont missing name`,
      ).toBeTruthy();
      expect(
        theme.bodyFont.name,
        `${themeId} bodyFont missing name`,
      ).toBeTruthy();
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit -- --testNamePattern="FONT_THEMES curated"`
Expected: FAIL with "headerFont" is undefined

**Step 3: Update FONT_THEMES to use pairings**

Replace the `FONT_THEMES` export (lines 283-338) with:

```typescript
/**
 * Professional font theme presets for websites with header/body pairings
 */
export const FONT_THEMES: Record<
  string,
  {
    name: string;
    description: string;
    headerFont: {
      name: string;
      weights: string[];
      category: FontCategory;
    };
    bodyFont: {
      name: string;
      weights: string[];
      category: FontCategory;
    };
    // Legacy field for backwards compatibility
    font?: {
      name: string;
      weights: string[];
      category: FontCategory;
      fallback: string;
      googleFontsUrl: string;
    };
  }
> = {
  "modern-professional": {
    name: "Modern Professional",
    description:
      "Clean sans-serif pairing. Perfect for tech, SaaS, and corporate sites.",
    headerFont: {
      name: "Montserrat",
      weights: ["600", "700"],
      category: "sans-serif",
    },
    bodyFont: {
      name: "Inter",
      weights: ["400", "500", "600"],
      category: "sans-serif",
    },
  },
  "elegant-serif": {
    name: "Elegant Serif",
    description:
      "Sophisticated serif pairing. Ideal for publishing, blogs, and editorial.",
    headerFont: {
      name: "Playfair Display",
      weights: ["600", "700"],
      category: "serif",
    },
    bodyFont: {
      name: "Lora",
      weights: ["400", "500", "600"],
      category: "serif",
    },
  },
  "bold-modern": {
    name: "Bold Modern",
    description:
      "Strong geometric headers with readable body. Great for agencies and portfolios.",
    headerFont: {
      name: "Bebas Neue",
      weights: ["400"],
      category: "sans-serif",
    },
    bodyFont: {
      name: "Work Sans",
      weights: ["400", "500", "600"],
      category: "sans-serif",
    },
  },
  "classic-formal": {
    name: "Classic Formal",
    description:
      "Traditional serif headers with clean body. Excellent for law, finance, luxury.",
    headerFont: {
      name: "Merriweather",
      weights: ["700", "900"],
      category: "serif",
    },
    bodyFont: {
      name: "Source Sans 3",
      weights: ["400", "500", "600"],
      category: "sans-serif",
    },
  },
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit -- --testNamePattern="FONT_THEMES curated"`
Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/font-theme.ts agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts
git commit -m "$(cat <<'EOF'
feat(font-theme): update FONT_THEMES with header/body font pairings

- modern-professional: Montserrat headers + Inter body
- elegant-serif: Playfair Display headers + Lora body
- bold-modern: Bebas Neue headers + Work Sans body
- classic-formal: Merriweather headers + Source Sans 3 body

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Update buildGoogleFontsUrl to Handle Multiple Fonts

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/font-theme.ts:40-42`

**Step 1: Write the failing test**

Add to `agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts`:

```typescript
describe("#buildGoogleFontsUrl", function urlTests() {
  it("should build URL with multiple font families", async function multipleFonts() {
    const { buildGoogleFontsUrl } = await import("../font-theme.js");

    const fonts = [
      { name: "Playfair Display", weights: ["600", "700"] },
      { name: "Inter", weights: ["400", "500"] },
    ];

    const url = buildGoogleFontsUrl(fonts);

    expect(url).toContain("family=Playfair+Display:wght@600;700");
    expect(url).toContain("family=Inter:wght@400;500");
    expect(url).toContain("&display=swap");
  });

  it("should deduplicate when header and body fonts are the same", async function deduplicateSame() {
    const { buildGoogleFontsUrl } = await import("../font-theme.js");

    const fonts = [
      { name: "Inter", weights: ["400", "700"] },
      { name: "Inter", weights: ["400", "700"] },
    ];

    const url = buildGoogleFontsUrl(fonts);

    // Should only have one family parameter
    const familyMatches = url.match(/family=/g);
    expect(familyMatches).toHaveLength(1);
  });

  it("should merge weights when same font has different weights", async function mergeWeights() {
    const { buildGoogleFontsUrl } = await import("../font-theme.js");

    const fonts = [
      { name: "Inter", weights: ["600", "700"] },
      { name: "Inter", weights: ["400", "500"] },
    ];

    const url = buildGoogleFontsUrl(fonts);

    // Should merge all weights into one family
    expect(url).toContain("Inter:wght@400;500;600;700");
    const familyMatches = url.match(/family=/g);
    expect(familyMatches).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit -- --testNamePattern="buildGoogleFontsUrl"`
Expected: FAIL with argument mismatch (current function takes string, not array)

**Step 3: Update buildGoogleFontsUrl to accept array of fonts**

Replace the function (lines 38-42):

```typescript
/**
 * Build Google Fonts URL for one or more fonts with their weights.
 * Deduplicates fonts by name and merges weights.
 */
export function buildGoogleFontsUrl(
  fonts: Array<{ name: string; weights: string[] }>,
): string {
  // Deduplicate and merge weights by font name
  const fontMap = new Map<string, Set<string>>();

  for (const font of fonts) {
    const existing = fontMap.get(font.name);
    if (existing) {
      // Merge weights
      font.weights.forEach((w) => existing.add(w));
    } else {
      fontMap.set(font.name, new Set(font.weights));
    }
  }

  // Build URL with all fonts
  const familyParams = Array.from(fontMap.entries()).map(([name, weights]) => {
    const sortedWeights = Array.from(weights).sort();
    return `${name.replace(/\s+/g, "+")}:wght@${sortedWeights.join(";")}`;
  });

  return `https://fonts.googleapis.com/css2?family=${familyParams.join("&family=")}&display=swap`;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit -- --testNamePattern="buildGoogleFontsUrl"`
Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/font-theme.ts agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts
git commit -m "$(cat <<'EOF'
feat(font-theme): update buildGoogleFontsUrl for multiple fonts

- Accept array of fonts instead of single font
- Deduplicate fonts by name
- Merge weights when same font appears multiple times
- Sort weights for consistent URLs

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update updateCssFontVariables to Accept Header and Body Fonts

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/font-theme.ts:340-478`

**Step 1: Write the failing test**

Add to `agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts`:

```typescript
describe("#updateCssFontVariables with font pairings", function pairingTests() {
  const mockAppPath = "/test/app";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should set different fonts for heading and body", async function differentFonts() {
    const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }

  body {
    font-family: var(--font-sans);
  }
}`;

    vi.mocked(readFile).mockResolvedValue(mockCss);
    vi.mocked(writeFile).mockResolvedValue();

    const { updateCssFontVariables } = await import("../font-theme.js");

    const headerFont = {
      name: "Playfair Display",
      weights: ["600", "700"],
      category: "serif" as const,
    };
    const bodyFont = {
      name: "Inter",
      weights: ["400", "500"],
      category: "sans-serif" as const,
    };

    const result = await updateCssFontVariables(
      mockAppPath,
      headerFont,
      bodyFont,
    );

    expect(result.success).toBe(true);

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    expect(writtenContent).toContain('--font-heading: "Playfair Display"');
    expect(writtenContent).toContain('--font-sans: "Inter"');
  });

  it("should import both fonts from Google Fonts", async function importBothFonts() {
    const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }
}`;

    vi.mocked(readFile).mockResolvedValue(mockCss);
    vi.mocked(writeFile).mockResolvedValue();

    const { updateCssFontVariables } = await import("../font-theme.js");

    const headerFont = {
      name: "Playfair Display",
      weights: ["600", "700"],
      category: "serif" as const,
    };
    const bodyFont = {
      name: "Inter",
      weights: ["400", "500"],
      category: "sans-serif" as const,
    };

    await updateCssFontVariables(mockAppPath, headerFont, bodyFont);

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    expect(writtenContent).toContain("Playfair+Display");
    expect(writtenContent).toContain("Inter");
  });

  it("should deduplicate Google Fonts import when same font for header and body", async function deduplicateImport() {
    const mockCss = `@layer base {
  :root {
    --font-sans: -apple-system, sans-serif;
    --font-heading: -apple-system, sans-serif;
  }
}`;

    vi.mocked(readFile).mockResolvedValue(mockCss);
    vi.mocked(writeFile).mockResolvedValue();

    const { updateCssFontVariables } = await import("../font-theme.js");

    const font = {
      name: "Inter",
      weights: ["400", "700"],
      category: "sans-serif" as const,
    };

    await updateCssFontVariables(mockAppPath, font, font);

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    // Should only have one family parameter
    const familyMatches = writtenContent.match(/family=Inter/g);
    expect(familyMatches).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit -- --testNamePattern="updateCssFontVariables with font pairings"`
Expected: FAIL with argument mismatch

**Step 3: Update updateCssFontVariables function signature and implementation**

Update the function (starting at line 340) to accept headerFont and bodyFont:

```typescript
export async function updateCssFontVariables(
  appPath: string,
  headerFont: { name: string; weights: string[]; category: FontCategory },
  bodyFont: { name: string; weights: string[]; category: FontCategory },
): Promise<{ success: boolean; message: string }> {
  const cssPath = `${appPath}/src/styles/globals.css`;

  try {
    let cssContent = await readFile(cssPath, "utf8");

    // Remove ALL existing Google Fonts imports to avoid stacking
    cssContent = cssContent.replace(
      /@import url\('https:\/\/fonts\.googleapis\.com\/css2\?[^']+'\);\s*/g,
      "",
    );

    // Build Google Fonts URL for both fonts (deduplicates if same)
    const googleFontsUrl = buildGoogleFontsUrl([
      { name: headerFont.name, weights: headerFont.weights },
      { name: bodyFont.name, weights: bodyFont.weights },
    ]);

    // Add the new Google Fonts import at the top
    const googleFontsImport = `@import url('${googleFontsUrl}');\n\n`;
    cssContent = googleFontsImport + cssContent;

    // Get fallbacks for each font
    const headerFallback = getFallback(headerFont.category);
    const bodyFallback = getFallback(bodyFont.category);

    // Update or add --font-sans variable (body font)
    const fontSansRegex = /--font-sans:\s*[^;]+;/;
    const newFontSans = `--font-sans: "${bodyFont.name}", ${bodyFallback};`;

    if (fontSansRegex.test(cssContent)) {
      cssContent = cssContent.replace(fontSansRegex, newFontSans);
    } else {
      // Add --font-sans to :root in @layer base
      const rootBlockRegex = /(:root\s*\{)/;
      if (rootBlockRegex.test(cssContent)) {
        const insertAfterRootRegex =
          /(:root\s*\{)(\s*(?:\/\*.*?\*\/)?\s*(?:--[^;]+;)?)/;
        cssContent = cssContent.replace(
          insertAfterRootRegex,
          `$1$2\n    ${newFontSans}`,
        );
      } else {
        const baseLayerRegex = /(@layer base\s*\{)/;
        if (baseLayerRegex.test(cssContent)) {
          cssContent = cssContent.replace(
            baseLayerRegex,
            `$1\n  :root {\n    ${newFontSans}\n  }\n`,
          );
        } else {
          throw new Error(
            "Could not find suitable location to add font variables",
          );
        }
      }
    }

    // Update or add --font-heading variable (header font)
    const fontHeadingRegex = /--font-heading:\s*[^;]+;/;
    const newFontHeading = `--font-heading: "${headerFont.name}", ${headerFallback};`;

    if (fontHeadingRegex.test(cssContent)) {
      cssContent = cssContent.replace(fontHeadingRegex, newFontHeading);
    } else {
      // Add --font-heading after --font-sans
      const fontSansLocationRegex = /(--font-sans:\s*[^;]+;)/;
      if (fontSansLocationRegex.test(cssContent)) {
        cssContent = cssContent.replace(
          fontSansLocationRegex,
          `$1\n    ${newFontHeading}`,
        );
      } else {
        const rootBlockRegex = /(:root\s*\{)/;
        if (rootBlockRegex.test(cssContent)) {
          const insertAfterRootRegex =
            /(:root\s*\{)(\s*(?:\/\*.*?\*\/)?\s*(?:--[^;]+;)?)/;
          cssContent = cssContent.replace(
            insertAfterRootRegex,
            `$1$2\n    ${newFontHeading}`,
          );
        }
      }
    }

    // Ensure body uses --font-sans variable
    const bodyRuleRegex = /body \{([^}]*)\}/;
    const bodyMatch = cssContent.match(bodyRuleRegex);

    if (bodyMatch && bodyMatch[1] !== undefined) {
      const bodyContent = bodyMatch[1];

      if (/font-family:/.test(bodyContent)) {
        cssContent = cssContent.replace(
          /body \{([^}]*?)font-family:[^;]+;([^}]*)\}/,
          "body {$1font-family: var(--font-sans);$2}",
        );
      } else {
        cssContent = cssContent.replace(
          bodyRuleRegex,
          `body {$1\n    font-family: var(--font-sans);
  }`,
        );
      }
    } else {
      const bodyRule = `\n  body {
    @apply bg-background text-foreground;
    font-family: var(--font-sans);
  }`;
      const baseLayerRegex = /(@layer base \{[\s\S]*?:root \{[\s\S]*?\})/;
      if (baseLayerRegex.test(cssContent)) {
        cssContent = cssContent.replace(baseLayerRegex, `$1${bodyRule}`);
      }
    }

    // Ensure heading elements use --font-heading with !important
    const headingRule = `h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-heading) !important;
  }`;

    const existingHeadingRuleRegex =
      /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*font-family[^}]*\}/;

    if (existingHeadingRuleRegex.test(cssContent)) {
      cssContent = cssContent.replace(
        /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*font-family:[^;]+;[^}]*\}/,
        headingRule,
      );
    } else {
      const bodyRuleRegex2 = /(body \{[^}]*\})/;
      if (bodyRuleRegex2.test(cssContent)) {
        cssContent = cssContent.replace(
          bodyRuleRegex2,
          `$1\n\n  ${headingRule}`,
        );
      } else if (cssContent.includes("@layer base")) {
        const baseLayerRegex2 = /(@layer base\s*\{)/;
        cssContent = cssContent.replace(
          baseLayerRegex2,
          `$1\n\n  ${headingRule}\n`,
        );
      }
    }

    await writeFile(cssPath, cssContent, "utf8");

    const fontDescription =
      headerFont.name === bodyFont.name
        ? headerFont.name
        : `${headerFont.name} (headers) + ${bodyFont.name} (body)`;

    logger.info("fontTheme.apply.success", {
      headerFont: headerFont.name,
      bodyFont: bodyFont.name,
    });

    return {
      success: true,
      message: `Font theme applied: ${fontDescription}`,
    };
  } catch (error) {
    logger.error("fontTheme.apply.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: `Failed to update fonts: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit -- --testNamePattern="updateCssFontVariables with font pairings"`
Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/font-theme.ts agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts
git commit -m "$(cat <<'EOF'
feat(font-theme): update updateCssFontVariables for header/body fonts

- Accept separate headerFont and bodyFont parameters
- Set --font-heading to headerFont and --font-sans to bodyFont
- Build Google Fonts URL with both fonts (deduplicated)
- Use appropriate fallbacks for each font's category

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update Tool Mode Handlers to Use New Font Structure

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/font-theme.ts` (set mode ~574-651, suggest mode ~653-740, apply mode ~742-895)

**Step 1: Update set mode handler**

Find the set mode section (~line 574) and update to use `normalizeFontTheme`:

```typescript
if (input.mode === "set") {
  if (!appId) {
    throw new Error("App ID is required for set mode");
  }

  if (!input.description) {
    throw new Error("Description is required for set mode");
  }

  logger.info("fontTheme.set.begin", {
    appId,
    description: input.description,
  });

  // Generate ONE font recommendation (with pairing)
  const agentId = context?.metadata?.agentId as string | undefined;
  const customTags = context?.metadata?.tags as string[] | undefined;
  const llmFonts = await generateFontsWithLLM(
    input.description,
    1,
    appId,
    sessionId,
    agentId,
    socketId,
    customTags,
    subscriptionId,
    customerId,
  );

  if (llmFonts.length === 0) {
    throw new Error("Failed to generate font recommendation");
  }

  const selectedFont = llmFonts[0]!;
  const { headerFont, bodyFont } = normalizeFontTheme(selectedFont as any);

  const app = await appRepo.findById(appId);
  if (!app) {
    throw new Error(`App not found: ${appId}`);
  }

  const result = await updateCssFontVariables(app.path, headerFont, bodyFont);

  if (!result.success) {
    throw new Error(result.message);
  }

  logger.info("fontTheme.set.complete", {
    appId,
    headerFont: headerFont.name,
    bodyFont: bodyFont.name,
    themeName: selectedFont.name,
  });

  return {
    success: true,
    message: `Applied font theme: ${selectedFont.name}`,
    appliedFont: {
      name: selectedFont.name,
      headerFont,
      bodyFont,
    },
    suggestedResponse:
      headerFont.name === bodyFont.name
        ? `Font theme "${selectedFont.name}" (${headerFont.name}) has been applied.`
        : `Font theme "${selectedFont.name}" (${headerFont.name} for headers, ${bodyFont.name} for body) has been applied.`,
  };
}
```

**Step 2: Update suggest mode handler**

Update the suggest mode to return themes with headerFont/bodyFont structure.

**Step 3: Update apply mode handler**

Update the apply mode to use `normalizeFontTheme` when applying themes.

**Step 4: Run existing tests to ensure no regressions**

Run: `pnpm --filter @airo/agents test:unit -- font-theme`
Expected: PASS (some tests may need updating due to signature change)

**Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/font-theme.ts
git commit -m "$(cat <<'EOF'
feat(font-theme): update tool mode handlers for font pairings

- Set mode: normalize LLM response and apply header/body fonts
- Suggest mode: return themes with headerFont/bodyFont structure
- Apply mode: use normalizeFontTheme when applying selected theme
- Update return values to include both fonts

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update LLM Prompt for Font Pairings

**Files:**

- Modify: `agents/src/prompts/font-tool/font-generation.md`

**Step 1: Update the prompt to request header/body pairings**

Replace the entire prompt file content:

````markdown
# Font Generation Prompt

You are an expert typography designer with deep knowledge of Google Fonts and font pairing principles. Generate professional font recommendations with header and body font pairings based on the user's request.

IMPORTANT: Return ONLY valid JSON. Do not include any markdown formatting, code blocks, or explanatory text.

Your response must be a JSON object with this exact structure:

```json
{
  "fonts": [
    {
      "id": "kebab-case-id",
      "name": "Theme Display Name",
      "description": "Brief description of the pairing and its use case",
      "headerFont": {
        "name": "Exact Google Font Name for Headers",
        "weights": ["600", "700"],
        "category": "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy"
      },
      "bodyFont": {
        "name": "Exact Google Font Name for Body",
        "weights": ["400", "500"],
        "category": "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy"
      }
    }
  ]
}
```
````

## Font Pairing Principles

### 1. CONTRAST VS HARMONY

**Contrasting Pairings** (different categories):

- Serif headers + Sans-serif body: Classic, editorial feel (Playfair Display + Inter)
- Sans-serif headers + Serif body: Modern with readable text (Montserrat + Lora)
- Display headers + Clean body: Eye-catching with readability (Bebas Neue + Work Sans)

**Harmonious Pairings** (same category):

- Two sans-serifs: Modern, cohesive (Montserrat headers + Inter body)
- Two serifs: Traditional, elegant (Playfair Display headers + Lora body)

### 2. WEIGHT DISTRIBUTION

**Headers**: Use bolder weights (600, 700, 900) for impact
**Body**: Use regular weights (400, 500) for readability

### 3. GOOGLE FONTS AVAILABILITY

**Sans-serif (good for body)**: Inter, Roboto, Open Sans, Lato, Work Sans, Source Sans 3, DM Sans
**Sans-serif (good for headers)**: Montserrat, Poppins, Raleway, Oswald
**Serif (good for body)**: Lora, Merriweather, Crimson Text, Libre Baskerville, Source Serif 4
**Serif (good for headers)**: Playfair Display, Cormorant Garamond, Abril Fatface
**Display/Fantasy**: Bebas Neue, Lobster, Permanent Marker, Righteous

### 4. USE CASE MATCHING

- **Tech/SaaS**: Sans + Sans (Inter headers + Work Sans body, or Montserrat + Inter)
- **Editorial/Blog**: Serif headers + Serif body (Playfair Display + Lora)
- **Corporate**: Sans + Sans with contrast (Montserrat + Source Sans 3)
- **Luxury/Premium**: Serif headers + Sans body (Cormorant Garamond + Inter)
- **Creative/Agency**: Display headers + Clean body (Bebas Neue + Work Sans)
- **Playful/Fun**: Script headers + Friendly body (Pacifico + Nunito)

### 5. DESCRIPTIONS

- One sentence explaining the pairing's personality
- Mention why the fonts work together
- Keep under 120 characters

## Example Output

```json
{
  "fonts": [
    {
      "id": "elegant-editorial",
      "name": "Elegant Editorial",
      "description": "Playfair Display brings sophistication to headers while Lora ensures comfortable long-form reading.",
      "headerFont": {
        "name": "Playfair Display",
        "weights": ["600", "700"],
        "category": "serif"
      },
      "bodyFont": {
        "name": "Lora",
        "weights": ["400", "500"],
        "category": "serif"
      }
    },
    {
      "id": "modern-tech",
      "name": "Modern Tech",
      "description": "Montserrat geometric headers paired with Inter's excellent screen readability.",
      "headerFont": {
        "name": "Montserrat",
        "weights": ["600", "700"],
        "category": "sans-serif"
      },
      "bodyFont": {
        "name": "Inter",
        "weights": ["400", "500"],
        "category": "sans-serif"
      }
    },
    {
      "id": "bold-creative",
      "name": "Bold Creative",
      "description": "Bebas Neue makes impactful headers while Work Sans keeps body text clean and readable.",
      "headerFont": {
        "name": "Bebas Neue",
        "weights": ["400"],
        "category": "sans-serif"
      },
      "bodyFont": {
        "name": "Work Sans",
        "weights": ["400", "500", "600"],
        "category": "sans-serif"
      }
    }
  ]
}
```

Remember: Return ONLY the JSON object, no other text.

````

**Step 2: Commit**

```bash
git add agents/src/prompts/font-tool/font-generation.md
git commit -m "$(cat <<'EOF'
feat(font-theme): update LLM prompt for header/body font pairings

- Request headerFont and bodyFont in response format
- Add font pairing principles (contrast vs harmony)
- Include weight distribution guidance
- Update use case matching with pairing examples
- Provide example output with full pairings

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
````

---

## Task 7: Update generateFontsWithLLM Response Parsing

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/font-theme.ts:229-262`

**Step 1: Write the failing test**

Add to test file:

```typescript
describe("#generateFontsWithLLM response parsing", function parsingTests() {
  // Note: This requires mocking the LLM call, which is complex.
  // Instead, we'll add a unit test for the parsing logic directly.

  it("should handle LLM response with headerFont/bodyFont", async function parseNewFormat() {
    // This test validates the parsing logic handles the new format
    const mockResponse = {
      fonts: [
        {
          id: "test-theme",
          name: "Test Theme",
          description: "Test description",
          headerFont: {
            name: "Playfair Display",
            weights: ["600", "700"],
            category: "serif",
          },
          bodyFont: {
            name: "Inter",
            weights: ["400", "500"],
            category: "sans-serif",
          },
        },
      ],
    };

    // Validate structure
    expect(mockResponse.fonts[0].headerFont).toBeDefined();
    expect(mockResponse.fonts[0].bodyFont).toBeDefined();
  });
});
```

**Step 2: Update the response validation in generateFontsWithLLM**

Update the validation section (~lines 229-262) to accept new format:

```typescript
try {
  const parsed = JSON.parse(cleanedText);

  if (!parsed.fonts || !Array.isArray(parsed.fonts)) {
    throw new Error("Invalid response format: missing fonts array");
  }

  const validFonts = parsed.fonts.filter((font: any) => {
    // Check for new format (headerFont + bodyFont)
    const hasNewFormat =
      font.headerFont?.name &&
      font.bodyFont?.name &&
      Array.isArray(font.headerFont.weights) &&
      Array.isArray(font.bodyFont.weights);

    // Check for legacy format (single fontName)
    const hasLegacyFormat = font.fontName && Array.isArray(font.weights);

    return font.id && font.name && (hasNewFormat || hasLegacyFormat);
  });

  if (validFonts.length === 0) {
    throw new Error("No valid fonts in LLM response");
  }

  // Normalize to consistent structure
  const normalizedFonts = validFonts.map((font: any) => {
    if (font.headerFont && font.bodyFont) {
      // New format - return as-is
      return {
        id: font.id,
        name: font.name,
        description: font.description,
        headerFont: {
          name: font.headerFont.name,
          weights: font.headerFont.weights,
          category:
            font.headerFont.category ||
            detectFontCategory(font.headerFont.name),
        },
        bodyFont: {
          name: font.bodyFont.name,
          weights: font.bodyFont.weights,
          category:
            font.bodyFont.category || detectFontCategory(font.bodyFont.name),
        },
      };
    } else {
      // Legacy format - use same font for both
      const category = font.category || detectFontCategory(font.fontName);
      return {
        id: font.id,
        name: font.name,
        description: font.description,
        headerFont: {
          name: font.fontName,
          weights: font.weights,
          category,
        },
        bodyFont: {
          name: font.fontName,
          weights: font.weights,
          category,
        },
      };
    }
  });

  logger.info("fontTheme.llm.success", {
    requestedCount: count,
    receivedCount: normalizedFonts.length,
    fonts: normalizedFonts.map(
      (f: any) => `${f.headerFont.name}/${f.bodyFont.name}`,
    ),
  });

  return normalizedFonts;
} catch (error) {
  // ... existing error handling
}
```

**Step 3: Run tests**

Run: `pnpm --filter @airo/agents test:unit -- font-theme`
Expected: PASS

**Step 4: Commit**

```bash
git add agents/src/tools/ai-lib-tools/font-theme.ts agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts
git commit -m "$(cat <<'EOF'
feat(font-theme): update LLM response parsing for font pairings

- Accept new headerFont/bodyFont format from LLM
- Maintain backwards compatibility with legacy fontName format
- Normalize all responses to consistent structure
- Auto-detect font category when not provided

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update Frontend Types (FontThemeGridWidget)

**Files:**

- Modify: `app/src/app/develop/components/widgets/FontThemeGridWidget.tsx:10-27`

**Step 1: Update the TypeScript interfaces**

```typescript
interface FontInfo {
  name: string;
  weights: string[];
  category: string;
}

interface FontTheme {
  id: string;
  name: string;
  description: string;
  headerFont?: FontInfo;
  bodyFont?: FontInfo;
  font?: FontInfo; // Legacy field for backwards compatibility
}

// Helper to normalize theme to header/body fonts
function normalizeFontTheme(theme: FontTheme): {
  headerFont: FontInfo;
  bodyFont: FontInfo;
} {
  if (theme.headerFont && theme.bodyFont) {
    return { headerFont: theme.headerFont, bodyFont: theme.bodyFont };
  }
  // Legacy fallback
  const fallbackFont = theme.font!;
  return { headerFont: fallbackFont, bodyFont: fallbackFont };
}
```

**Step 2: Commit**

```bash
git add app/src/app/develop/components/widgets/FontThemeGridWidget.tsx
git commit -m "$(cat <<'EOF'
feat(font-theme-widget): add headerFont/bodyFont types

- Update FontTheme interface with optional headerFont/bodyFont
- Keep legacy font field for backwards compatibility
- Add normalizeFontTheme helper for consistent access

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Update FontThemeGridWidget UI to Show Font Pairings

**Files:**

- Modify: `app/src/app/develop/components/widgets/FontThemeGridWidget.tsx:41-194`

**Step 1: Update the Google Fonts loading effect**

```typescript
useEffect(
  function loadGoogleFonts() {
    if (!hasThemes) return;

    const newFontFamilies: string[] = [];
    safeThemes.forEach((theme) => {
      const { headerFont, bodyFont } = normalizeFontTheme(theme);

      // Add header font
      if (headerFont?.name) {
        const fontName = headerFont.name.replace(/\s+/g, "+");
        const weights = headerFont.weights.join(";");
        newFontFamilies.push(`${fontName}:wght@${weights}`);
      }

      // Add body font (if different)
      if (bodyFont?.name && bodyFont.name !== headerFont?.name) {
        const fontName = bodyFont.name.replace(/\s+/g, "+");
        const weights = bodyFont.weights.join(";");
        newFontFamilies.push(`${fontName}:wght@${weights}`);
      }
    });

    // ... rest of effect unchanged
  },
  [hasThemes, safeThemes],
);
```

**Step 2: Update the theme card rendering**

```typescript
{safeThemes.map((theme) => {
  const { headerFont, bodyFont } = normalizeFontTheme(theme)
  const isSelected = selectedTheme?.id === theme.id
  const isSameFont = headerFont.name === bodyFont.name

  if (!headerFont || !bodyFont) return null

  const headerBoldWeight = headerFont.weights[headerFont.weights.length - 1] || '700'
  const bodyRegularWeight = bodyFont.weights[0] || '400'

  // Display name: "Playfair + Inter" or just "Inter" if same
  const fontPairingName = isSameFont
    ? headerFont.name
    : `${headerFont.name} + ${bodyFont.name}`

  return (
    <button
      key={theme.id}
      type="button"
      onClick={() => handleSelect(theme)}
      style={{
        borderColor: isSelected ? '#000' : '#d1d5db',
        backgroundColor: isSelected ? '#f3f4f6' : '#fff',
        borderWidth: '2px'
      }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 cursor-pointer hover:!border-black hover:!bg-gray-100 hover:shadow-sm"
    >
      {/* Left: Theme info */}
      <div className="flex flex-col min-w-[110px] text-left">
        <div className="text-xs font-semibold text-gray-900 leading-tight">{theme.name}</div>
        <div className="text-[11px] text-gray-500 leading-tight">{fontPairingName}</div>
      </div>

      {/* Right: Font previews - header and body */}
      <div className="flex-1 flex flex-col gap-1 justify-center min-w-0">
        <div
          className="text-[15px] font-bold text-gray-900 leading-tight"
          style={{
            fontFamily: `"${headerFont.name}", -apple-system, BlinkMacSystemFont, sans-serif`,
            fontWeight: headerBoldWeight
          }}
        >
          {t('builder_font_theme_preview_heading', undefined, 'Heading')}
        </div>

        <div
          className="text-xs text-gray-600 leading-tight"
          style={{
            fontFamily: `"${bodyFont.name}", -apple-system, BlinkMacSystemFont, sans-serif`,
            fontWeight: bodyRegularWeight
          }}
        >
          {t('builder_font_theme_preview_sample', undefined, 'The quick brown fox jumps over the lazy dog')}
        </div>
      </div>
    </button>
  )
})}
```

**Step 3: Run typecheck and lint**

Run: `pnpm --filter website typecheck && pnpm --filter website lint`
Expected: PASS

**Step 4: Commit**

```bash
git add app/src/app/develop/components/widgets/FontThemeGridWidget.tsx
git commit -m "$(cat <<'EOF'
feat(font-theme-widget): display header/body font pairings

- Load both header and body fonts from Google Fonts
- Show pairing name (e.g., "Playfair + Inter")
- Preview heading in headerFont, body text in bodyFont
- Handle same-font case gracefully

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Update FontThemeToolRenderer for Font Pairings

**Files:**

- Modify: `app/src/app/develop/components/tool-renderers/FontThemeToolRenderer.tsx`

**Step 1: Update to extract and display both fonts**

```typescript
// Extract font information for preview
const appliedFont = resultObj.appliedFont as
  | {
      name?: string;
      headerFont?: { name: string; weights: string[] };
      bodyFont?: { name: string; weights: string[] };
      // Legacy fields
      fontName?: string;
      weights?: string[];
    }
  | undefined;

// Normalize to header/body fonts
const headerFont =
  appliedFont?.headerFont ||
  (appliedFont?.fontName
    ? {
        name: appliedFont.fontName,
        weights: appliedFont.weights || ["400", "700"],
      }
    : undefined);

const bodyFont = appliedFont?.bodyFont || headerFont;

const headerFontName = headerFont?.name;
const bodyFontName = bodyFont?.name;
const isSameFont = headerFontName === bodyFontName;

// Font families for styling
const headerFontFamily = headerFontName
  ? `"${headerFontName}", -apple-system, BlinkMacSystemFont, sans-serif`
  : undefined;
const bodyFontFamily = bodyFontName
  ? `"${bodyFontName}", -apple-system, BlinkMacSystemFont, sans-serif`
  : undefined;
```

**Step 2: Update the font loading effect**

```typescript
useEffect(
  function loadGoogleFont() {
    if (!headerFontName || toolStatus !== "completed") return;

    const linkId = "font-theme-renderer-font";
    let link = document.getElementById(linkId) as HTMLLinkElement;

    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }

    // Build URL for both fonts
    const fonts: string[] = [];

    if (headerFont) {
      const encodedHeader = encodeURIComponent(headerFont.name).replace(
        /%20/g,
        "+",
      );
      const headerWeights = headerFont.weights?.join(";") || "600;700";
      fonts.push(`${encodedHeader}:wght@${headerWeights}`);
    }

    if (bodyFont && bodyFontName !== headerFontName) {
      const encodedBody = encodeURIComponent(bodyFont.name).replace(
        /%20/g,
        "+",
      );
      const bodyWeights = bodyFont.weights?.join(";") || "400;500";
      fonts.push(`${encodedBody}:wght@${bodyWeights}`);
    }

    const fontUrl = `https://fonts.googleapis.com/css2?family=${fonts.join("&family=")}&display=swap`;

    if (link.href !== fontUrl) {
      link.href = fontUrl;
    }
  },
  [headerFontName, bodyFontName, headerFont, bodyFont, toolStatus],
);
```

**Step 3: Update the preview card JSX**

Update the apply mode and set mode cards to show both fonts:

```typescript
{/* APPLY MODE: Show card with font preview */}
{toolStatus === 'completed' && isApplyMode && headerFontName && (
  <div className="mt-2 mb-2">
    <button
      type="button"
      onClick={() => setIsModalOpen(true)}
      className="w-full rounded-md border-2 border-border bg-intents-ux-success-backgroundColor p-2 transition-all duration-300 hover:shadow-md hover:cursor-pointer hover:border-intents-ux-boxHighContrast-borderColor text-left"
    >
      <div className="flex flex-row gap-1 justify-between items-center w-full">
        <div className="flex flex-col items-start">
          <span
            className="text-base font-semibold leading-none text-intents-ux-success-textColor"
            style={{ fontFamily: headerFontFamily }}
          >
            {isSameFont ? headerFontName : `${headerFontName} + ${bodyFontName}`}
          </span>
          <span
            className="text-xs font-thin leading-none text-intents-ux-textSubtle-textColor mt-1"
            style={{ fontFamily: bodyFontFamily }}
          >
            The quick brown fox jumps over the lazy dog
          </span>
        </div>
        <div
          className="size-6 rounded-sm flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: '#1a1a1a' }}
          aria-hidden="true"
        >
          <span
            className="text-sm font-bold"
            style={{ fontFamily: headerFontFamily, color: '#ffffff' }}
          >
            Aa
          </span>
        </div>
      </div>
    </button>
  </div>
)}
```

**Step 4: Update FontThemeModal props**

Pass both fonts to modal:

```typescript
{headerFontName && (
  <FontThemeModal
    isOpen={isModalOpen}
    onClose={() => setIsModalOpen(false)}
    headerFontName={headerFontName}
    bodyFontName={bodyFontName || headerFontName}
  />
)}
```

**Step 5: Commit**

```bash
git add app/src/app/develop/components/tool-renderers/FontThemeToolRenderer.tsx
git commit -m "$(cat <<'EOF'
feat(font-theme-renderer): display header/body font pairings

- Extract headerFont and bodyFont from result
- Load both fonts from Google Fonts
- Show pairing name in preview card
- Preview body sample in bodyFont
- Pass both fonts to modal

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Update FontThemeModal for Header/Body Fonts

**Files:**

- Modify: `app/src/app/develop/components/tool-renderers/FontThemeModal.tsx`

**Step 1: Update props interface**

```typescript
export interface FontThemeModalProps {
  isOpen: boolean;
  onClose: () => void;
  headerFontName: string;
  bodyFontName: string;
}
```

**Step 2: Update fontSamples to use appropriate fonts**

```typescript
const fontSamples = [
  {
    size: "2.5rem",
    weight: "700",
    label: "Heading 1",
    sampleText: "The quick brown fox",
    isHeader: true,
  },
  {
    size: "2rem",
    weight: "700",
    label: "Heading 2",
    sampleText: "The quick brown fox jumps",
    isHeader: true,
  },
  {
    size: "1.5rem",
    weight: "600",
    label: "Heading 3",
    sampleText: "The quick brown fox jumps over",
    isHeader: true,
  },
  {
    size: "1.25rem",
    weight: "600",
    label: "Heading 4",
    sampleText: "The quick brown fox jumps over the lazy dog",
    isHeader: true,
  },
  {
    size: "1rem",
    weight: "400",
    label: "Body",
    sampleText:
      "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.",
    isHeader: false,
  },
  {
    size: "0.875rem",
    weight: "400",
    label: "Small",
    sampleText:
      "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump!",
    isHeader: false,
  },
];
```

**Step 3: Update component to use both fonts**

```typescript
export default function FontThemeModal({
  isOpen,
  onClose,
  headerFontName,
  bodyFontName
}: FontThemeModalProps) {
  const t = useTranslations()
  const isSameFont = headerFontName === bodyFontName

  // ... existing useEffect

  const headerFontFamily = `"${headerFontName}", -apple-system, BlinkMacSystemFont, sans-serif`
  const bodyFontFamily = `"${bodyFontName}", -apple-system, BlinkMacSystemFont, sans-serif`

  // ... in render:

  {/* Title */}
  <h2
    className="text-xl font-bold mb-3"
    style={{ fontFamily: headerFontFamily }}
  >
    {isSameFont ? headerFontName : `${headerFontName} + ${bodyFontName}`}
  </h2>

  {/* Type Scale Section */}
  <div className="space-y-3 border rounded-lg p-3 bg-intents-ux-boxLowContrast-backgroundColor">
    {fontSamples.map((sample, index) => (
      <div key={index} className="border-b border-border last:border-b-0 pb-2 last:pb-0">
        <div className="text-xs text-intents-ux-textSubtle-textColor mb-1">
          {sample.label} ({sample.size})
        </div>
        <div
          style={{
            fontFamily: sample.isHeader ? headerFontFamily : bodyFontFamily,
            fontSize: sample.size,
            fontWeight: sample.weight,
            lineHeight: 1.3
          }}
        >
          {sample.sampleText}
        </div>
      </div>
    ))}
  </div>
}
```

**Step 4: Run typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add app/src/app/develop/components/tool-renderers/FontThemeModal.tsx
git commit -m "$(cat <<'EOF'
feat(font-theme-modal): display header/body fonts separately

- Accept headerFontName and bodyFontName props
- Show pairing name in modal title
- Render H1-H4 samples in headerFont
- Render Body/Small samples in bodyFont

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Fix Existing Tests for New Function Signatures

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts`

**Step 1: Update existing tests to use new function signatures**

Update all tests that call `updateCssFontVariables` to pass two font objects:

```typescript
it("should successfully update CSS with font variables", async function updateVariables() {
  const mockCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --font-sans: -apple-system, BlinkMacSystemFont, sans-serif;
    --font-heading: -apple-system, BlinkMacSystemFont, sans-serif;
  }

  body {
    font-family: var(--font-sans);
  }
}`;

  vi.mocked(readFile).mockResolvedValue(mockCss);
  vi.mocked(writeFile).mockResolvedValue();

  const headerFont = {
    name: "Inter",
    weights: ["400", "700"],
    category: "sans-serif" as const,
  };
  const bodyFont = {
    name: "Inter",
    weights: ["400", "700"],
    category: "sans-serif" as const,
  };

  const result = await updateCssFontVariables(
    mockAppPath,
    headerFont,
    bodyFont,
  );

  expect(result.success).toBe(true);
  expect(result.message).toContain("Inter");
  expect(writeFile).toHaveBeenCalledOnce();
});
```

**Step 2: Run all tests**

Run: `pnpm --filter @airo/agents test:unit -- font-theme`
Expected: PASS

**Step 3: Commit**

```bash
git add agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts
git commit -m "$(cat <<'EOF'
test(font-theme): update tests for new function signatures

- Update updateCssFontVariables calls to pass headerFont and bodyFont
- All existing tests adapted to new API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Final Integration Testing and Cleanup

**Step 1: Run full test suite**

```bash
pnpm --filter @airo/agents test:unit
pnpm --filter website typecheck
pnpm --filter website lint
```

**Step 2: Run build to ensure no compilation errors**

```bash
pnpm --filter @airo/agents build
pnpm --filter website build
```

**Step 3: Fix any remaining issues**

Address any type errors or test failures discovered.

**Step 4: Final commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(font-theme): final cleanup and integration fixes

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary of Files Modified

| File                                                                      | Changes                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `agents/src/tools/ai-lib-tools/font-theme.ts`                             | Types, normalizeFontTheme, buildGoogleFontsUrl, updateCssFontVariables, mode handlers |
| `agents/src/tools/ai-lib-tools/__tests__/font-theme.test.ts`              | New tests + updated existing tests                                                    |
| `agents/src/prompts/font-tool/font-generation.md`                         | Updated LLM prompt for pairings                                                       |
| `app/src/app/develop/components/widgets/FontThemeGridWidget.tsx`          | Types, Google Fonts loading, UI rendering                                             |
| `app/src/app/develop/components/tool-renderers/FontThemeToolRenderer.tsx` | Extract both fonts, updated preview                                                   |
| `app/src/app/develop/components/tool-renderers/FontThemeModal.tsx`        | Accept both fonts, render appropriately                                               |
