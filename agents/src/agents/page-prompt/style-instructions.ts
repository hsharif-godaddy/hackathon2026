/**
 * Color- and design-direction blocks for the user prompt. Each is selected
 * by the user's intake-form choice and surfaces guidance the LLM should
 * follow when generating the rebuild prompt.
 *
 * "Let Airo Decide" branches inline a redesign template; explicit choices
 * (suggest-new, simplify, modernize, bold, custom) emit a focused directive.
 */
import type { SiteMetadata, StylePreferences, TypographyScaleEntry } from '../../types/rebuild.js';

export function buildColorInstructions(prefs: StylePreferences, metadata: SiteMetadata): string {
  if (prefs.colorPreference === 'keep-original') {
    return `COLOR DIRECTION (Airo's Choice - YOU must pick specific colors):
Since the user chose "Let Airo Decide" for colors, YOU must select an appropriate color scheme.
Based on the site purpose "${metadata.sitePurpose}" and brand voice "${metadata.brandVoice}",
choose colors that create the right emotional impact. Do NOT tell the develop agent to "choose colors" -
instead, specify exact hex codes in your prompt.

Consider:
- The existing colors: ${metadata.colorPalette.primary.join(', ') || 'none detected'} (you may keep, modernize, or change these)
- The target audience: ${metadata.targetAudience}
- The brand voice: ${metadata.brandVoice}

Pick specific colors and include them in your prompt like:
"Use [color name] (#hexcode) as the primary color with [accent color] (#hexcode) for buttons and highlights."`;
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

export function buildDesignInstructions(prefs: StylePreferences, metadata: SiteMetadata): string {
  if (prefs.designDirection === 'keep-similar') {
    return `DESIGN DIRECTION (Airo's Choice - Full Redesign Guidance):
Since the user chose "Let Airo Decide" for design, YOU must create a distinctive, high-quality design direction.

**CRITICAL: Include this full design guidance in your output prompt:**

FRONTEND AESTHETICS DIRECTION:
Create a distinctive design that avoids generic "AI slop" aesthetics.

Typography Direction:
- Use fonts appropriate for "${metadata.brandVoice}" brand voice
- Specify the typography mood (e.g., "friendly but professional", "bold and confident", "elegant and refined")${metadata.typography.headingFonts.length > 0 || metadata.typography.bodyFonts.length > 0 ? '\n- See TYPOGRAPHY DIRECTION section for specific font guidance' : ''}

Color Application:
- Commit to a cohesive aesthetic with dominant colors and sharp accents
- AVOID: Purple gradients on white, generic blue/gray corporate schemes
- Include emotional intent with the colors you specify

Layout Requirements (CRITICAL - these prevent generic AI output):
- DO NOT use standard icon grids for features/services
- DO NOT use empty-right hero compositions (text left, nothing right)
- DO NOT use centered-text-on-colored-band CTAs
- DO use: staggered layouts, bento grids, asymmetric compositions, full-bleed imagery

Section-Specific Guidance:
- Hero: Visual balance required - if text is left, add graphic/product shot right. Include social proof below fold.
- Features: Show, don't list - use inline examples or screenshots, NOT icon cards
- CTA: Asymmetric or integrated approaches, NOT centered-on-band
- Footer: Maintain design quality - not an afterthought

Differentiation Element (include ONE):
- Oversized typography that breaks the grid
- Bento-style layout with varied card sizes
- Diagonal or curved section breaks
- Bold use of asymmetric whitespace
- Unexpected color application

Consistency Requirements:
- Footer and CTA MUST match hero quality
- Don't get safer/more generic as page progresses
- Maintain energy and intentionality throughout`;
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

export function buildTypographyInstructions(prefs: StylePreferences, metadata: SiteMetadata): string {
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
The source site uses these typefaces. Preserve them:
${fontBullets.join('\n')}
${scaleBlock}
Use these exact fonts in the rebuild. Do NOT substitute with different fonts.
If Google Fonts provides them, import them. If not, use the closest available match and note the substitution.`;
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
