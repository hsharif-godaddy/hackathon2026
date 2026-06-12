/**
 * Embedded-text constraint block, appended to PagePromptAgent's generated build
 * prompt AFTER the LLM rewrite (AIROBUILD-2430).
 *
 * buildUserPrompt already annotates each text-bearing asset with a "do NOT
 * overlay" note (see renderAssetList in user-prompt-builder.ts), but
 * PagePromptAgent's summarizing rewrite drops it (confirmed via tracing:
 * directive present in the rewrite's input, absent from its output). Appending
 * this block deterministically — after the rewrite — guarantees the develop
 * agent receives the constraint verbatim, instead of relying on a summarizing
 * LLM to preserve a soft inline note.
 *
 * Note: the same hasEmbeddedText/embeddedText signal also rides the structured
 * PageBuildSpec (buildPageSpec in services/rebuild/prompt-builder.ts), but only
 * on the Atlas path. This text append is the cross-path guarantee — keep both.
 */
import type { AssetInfo } from '../../types/rebuild.js';
import { normalizeAssetPath } from '../../utils/asset-paths.js';

/**
 * Flatten a vision-transcribed string for safe single-line interpolation.
 * Transcriptions can contain newlines (e.g. "COMING\nSOON") or double quotes,
 * either of which would break the `- … "text"` entry format or the constraint
 * block's structure. Collapse whitespace runs to one space, swap double quotes
 * for single, and trim.
 */
export function sanitizeEmbeddedText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
}

/**
 * Build a hard constraint block listing source images that already have text
 * burned into their pixels. Returns '' when no asset has usable embedded text,
 * so the caller can append unconditionally.
 */
export function buildEmbeddedTextConstraint(assets: AssetInfo[]): string {
  const withText = assets.filter(a => a.hasEmbeddedText && a.embeddedText);
  if (withText.length === 0) return '';

  const lines = withText
    .map(a => {
      // The scraped role (hero/logo/content) is the only structural signal we
      // can rely on — Atlas placement is frequently absent. Cite it so the
      // agent reproduces the image where the source used it.
      const role = a.usageContext ? `[${a.usageContext}] ` : '';
      const text = sanitizeEmbeddedText(a.embeddedText as string);
      return `- ${role}${normalizeAssetPath(a.localPath)} — already contains the text: "${text}"`;
    })
    .join('\n');

  return `

=== CRITICAL: IMAGES WITH EMBEDDED TEXT — reproduce as the source did, do NOT overlay ===
Each source image below already has text baked into its pixels. Reproduce it in
the role the source used it (shown in brackets), displayed as-is — the embedded
text IS that image's text. Rules:
- Do NOT render your own heading, title, tagline, or any text on top of these
  images — that produces duplicate, overlapping text.
- Do NOT substitute different images for these, and do NOT fabricate a carousel,
  slideshow, or extra hero imagery to host re-typed text. Match the scraped
  layout: a hero image with baked-in text is a single static hero, used as-is.
- If you need additional copy near one of these images, place it in adjacent
  space (above/below/beside), never as an overlay.
${lines}`;
}
