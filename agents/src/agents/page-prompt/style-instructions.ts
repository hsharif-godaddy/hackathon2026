/**
 * Color- and design-direction blocks for the user prompt. Each is selected
 * by the user's intake-form choice and surfaces guidance the LLM should
 * follow when generating the rebuild prompt.
 *
 * Two independent axes:
 *   - designDirection (structure/layout): `keep-similar` preserves the source
 *     faithfully (clone); `modernize` / `simplify` / `bold` emit a focused
 *     redesign directive.
 *   - colorPreference (palette): `keep-original` preserves the detected
 *     palette; `suggest-new` picks a fresh scheme; `custom` uses user hexes.
 *
 * The axes move independently — e.g. "bold layout, keep colors" is valid — so
 * each block keys off its own preference. `shouldPreserveDesign` exposes the
 * structure-axis predicate that also gates the system-prompt fragment
 * (design-preserve.md vs design-redesign.md) in page-prompt-agent.ts.
 */
import type { SiteMetadata, StylePreferences, TypographyScaleEntry } from '../../types/rebuild.js';

/**
 * The structure-axis "is this a faithful clone?" predicate. Single source of
 * truth for both the system-prompt fragment selection (page-prompt-agent.ts)
 * and the user-prompt design block below, so the two can't silently diverge.
 * Keyed on designDirection only — color preservation is a separate axis.
 */
export function shouldPreserveDesign(prefs: StylePreferences): boolean {
  return prefs.designDirection === 'keep-similar';
}

export function buildColorInstructions(prefs: StylePreferences, metadata: SiteMetadata, hasScreenshot: boolean): string {
  if (prefs.colorPreference === 'keep-original') {
    const { primary, secondary, accent } = metadata.colorPalette;
    const detected = [...primary, ...secondary, ...accent];
    // No palette detected — let the agent derive one from brand/purpose rather
    // than emit empty "Primary: none" bullets the develop agent can't act on.
    if (detected.length === 0) {
      const anchor = hasScreenshot
        ? 'Stay close to what the homepage screenshot shows — do NOT introduce a bold new scheme.'
        : 'Keep the palette restrained and consistent with the source — do NOT introduce a bold new scheme.';
      return `COLOR DIRECTION (Preserve Source Colors):
The user wants to keep the original color scheme, but no palette was reliably detected from the source.
Derive a restrained palette that fits the site purpose "${metadata.sitePurpose}" and brand voice "${metadata.brandVoice}",
and specify exact hex codes in your prompt. ${anchor}`;
    }
    const crossCheck = hasScreenshot
      ? ' Cross-check against the homepage screenshot so the rebuilt colors match what the source actually shows.'
      : '';
    return `COLOR DIRECTION (Preserve Source Colors):
The user wants to KEEP the source site's color scheme. Reuse the detected palette — do NOT substitute a new scheme.
- Primary: ${primary.join(', ') || '(none detected)'}
- Secondary: ${secondary.join(', ') || '(none detected)'}
- Accent: ${accent.join(', ') || '(none detected)'}
Specify these exact hex codes in your prompt. If a role wasn't detected, derive it from the colors above (e.g. a darker/lighter shade) rather than inventing an unrelated color.${crossCheck}`;
  }

  if (prefs.colorPreference === 'suggest-new') {
    return `COLOR DIRECTION (Fresh Color Scheme):
The user wants a new color scheme. Choose colors that differ from the original but still fit the brand.
Original colors were: ${metadata.colorPalette.primary.join(', ') || 'not detected'}
Pick fresh, distinctive colors that match the ${metadata.brandVoice} brand voice.`;
  }

  if (prefs.colorPreference === 'custom' && prefs.customColors) {
    return `COLOR DIRECTION (Custom Colors):
Use the user's specified colors:
- Primary: ${prefs.customColors.primary || 'not specified'}
- Secondary: ${prefs.customColors.secondary || 'not specified'}
- Accent: ${prefs.customColors.accent || 'not specified'}`;
  }

  return '';
}

export function buildDesignInstructions(prefs: StylePreferences, metadata: SiteMetadata, hasScreenshot: boolean): string {
  if (shouldPreserveDesign(prefs)) {
    // Reference line + the trailing "as seen in…" clause both depend on
    // whether a screenshot was actually attached (loadHomepageScreenshot
    // returns undefined on a miss), so we don't tell the model to consult an
    // image that isn't there. The structural-fidelity bullets work off the
    // extracted content either way.
    const primaryReference = hasScreenshot
      ? '**Use the attached homepage screenshot as the PRIMARY reference** for layout, section order, and composition.'
      : '**Use the extracted page content and structure (above) as your reference** for layout, section order, and composition.';
    const heroSource = hasScreenshot ? 'as seen in the screenshot' : 'as reflected in the extracted content';
    return `DESIGN DIRECTION (Preserve Source Design):
The user wants to keep the design SIMILAR to the source. This is a clone, not a redesign — reproduce the source site's look, feel, and structure faithfully.

${primaryReference}

Structural fidelity (CRITICAL — this is what "keep similar" means):
- Build ONLY the sections that exist in the source. Do NOT add sections the source doesn't have (no invented project galleries, testimonials, "about" blocks, stats/feature grids, or extra CTA bands).
- Match the source's section order and count. If the source homepage is just a header, a hero, and a footer, build exactly that — nothing more.
- Preserve the source's hero composition, navigation style, and footer structure ${heroSource}.

Aesthetic fidelity:
- Stay consistent with the source's visual style${metadata.designStyle ? ` (it reads as "${metadata.designStyle}")` : ''} — its spacing, density, and imagery treatment.
- Keep production quality and polish — clean and intentional, not generic "AI slop" — but do NOT introduce distinctive "redesign" flourishes (oversized grid-breaking type, bento mosaics, diagonal section breaks, etc.) unless the source itself uses them.${metadata.typography.headingFonts.length > 0 || metadata.typography.bodyFonts.length > 0 ? '\n- See TYPOGRAPHY DIRECTION section for specific font guidance' : ''}`;
  }

  if (prefs.designDirection === 'modernize') {
    return `DESIGN DIRECTION (Modernize):
Update the design with contemporary patterns while maintaining brand recognition.
- Use modern typography trends
- Update spacing and whitespace
- Contemporary UI patterns and interactions
- Fresher visual hierarchy`;
  }

  if (prefs.designDirection === 'simplify') {
    return `DESIGN DIRECTION (Simplify):
Create a cleaner, more minimal design.
- Reduce visual clutter
- Increase whitespace
- Simpler color palette
- Focus on essential content
- Improved readability`;
  }

  if (prefs.designDirection === 'bold') {
    return `DESIGN DIRECTION (Bold):
Create a striking, attention-grabbing design.
- Strong visual hierarchy
- Bold typography choices
- Vibrant colors
- Dramatic layouts
- High contrast elements`;
  }

  return '';
}

export function buildTypographyInstructions(
  prefs: StylePreferences,
  metadata: SiteMetadata,
): string {
  const { headingFonts, bodyFonts, scale } = metadata.typography;

  if (headingFonts.length === 0 && bodyFonts.length === 0) return '';

  if (prefs.typographyStyle === 'keep-original') {
    const fontBullets: string[] = [];
    if (headingFonts.length > 0) fontBullets.push(`- Heading font: ${headingFonts.join(', ')}`);
    if (bodyFonts.length > 0) fontBullets.push(`- Body font: ${bodyFonts.join(', ')}`);

    const renderedScale = scale && scale.length > 0 ? renderScale(scale) : '';
    const scaleBlock = renderedScale
      ? `\nSource typography scale (preserve these proportions):\n${renderedScale}`
      : '';

    return `TYPOGRAPHY DIRECTION (Preserve Source Fonts):
The source site uses these typefaces:
${fontBullets.join('\n')}
${scaleBlock}
Fonts are already applied to globals.css as --font-heading and --font-sans (set on the homepage rebuild).
Instruct the develop agent to use var(--font-heading) / var(--font-sans) only — do NOT call fontTheme, import Google Fonts, or hardcode fontFamily.`;
  }

  const headingList = headingFonts.join(', ') || 'not detected';
  const bodyList = bodyFonts.join(', ') || 'not detected';

  const styleLabel = prefs.typographyStyle === 'modern' ? 'modern, clean'
    : prefs.typographyStyle === 'classic' ? 'classic, refined'
    : 'playful, expressive';

  return `TYPOGRAPHY DIRECTION (${prefs.typographyStyle}):
The source site used: Headings: ${headingList}, Body: ${bodyList}.
You may choose different fonts that feel ${styleLabel}, but use the source as a reference for the proportional scale (heading-to-body size ratio, weight contrast).`;
}

// Only heading/body roles reach the prompt — nav/button/input sizing is handled by component defaults
function renderScale(scale: TypographyScaleEntry[]): string {
  const headings = scale.filter(s => s.role === 'heading');
  const body = scale.filter(s => s.role === 'body');

  const lines: string[] = [];
  for (const entry of headings.slice(0, 3)) {
    lines.push(`  Heading: ${entry.fontFamily} ${entry.fontSize} / weight ${entry.fontWeight} / line-height ${entry.lineHeight}`);
  }
  for (const entry of body.slice(0, 2)) {
    lines.push(`  Body: ${entry.fontFamily} ${entry.fontSize} / weight ${entry.fontWeight} / line-height ${entry.lineHeight}`);
  }
  return lines.join('\n');
}
