/**
 * Color- and design-direction blocks for the user prompt. Each is selected
 * by the user's intake-form choice and surfaces guidance the LLM should
 * follow when generating the rebuild prompt.
 *
 * "Let Airo Decide" branches inline a redesign template; explicit choices
 * (suggest-new, simplify, modernize, bold, custom) emit a focused directive.
 */
import type { SiteMetadata, StylePreferences } from '../../types/rebuild.js';

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
- Choose fonts that are distinctive and appropriate for "${metadata.brandVoice}" brand voice
- AVOID: Inter, Roboto, Arial, system fonts
- Specify the typography mood (e.g., "friendly but professional", "bold and confident", "elegant and refined")

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
