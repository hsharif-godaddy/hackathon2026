/**
 * Build the user-message prompt that PagePromptAgent's LLM call consumes.
 *
 * Pure function over an options bundle — no class state, no I/O. The agent
 * class composes this with screenshot processing and feeds the result into
 * `agent.generate(prompt, { files })`.
 *
 * Section structure:
 *   - SITE TYPE + site-type rules
 *   - SITE METADATA (purpose / audience / brand voice / colors / typography)
 *   - STYLE PREFERENCES (intake-form choices)
 *   - colorInstructions + designInstructions (homepage only)
 *   - PAGE CONTENT TO REBUILD (title, URL, detected blocks, navigation, contact)
 *   - EXTRACTED KEY CONTENT (regex-mined headings/CTAs/etc.)
 *   - FULL PAGE CONTENT (4KB cap, reference)
 *   - AVAILABLE ASSETS (categorized + dimensioned list)
 *   - CRITICAL INSTRUCTIONS (numbered, varies for first-page / inner-page)
 */
import type {
  AssetInfo,
  AssetManifest,
  ContentLink,
  ImagePlacement,
  NavigationItem,
  PageContent,
  ResolvedFavicon,
  SiteContactInfo,
  SiteMetadata,
  StylePreferences,
} from '../../types/rebuild.js';
import { normalizeAssetPath, resolveFavicon } from '../../utils/asset-paths.js';
import { sanitizeEmbeddedText } from './embedded-text-constraint.js';
import { buildSiteTypeRules } from '../site-type-helpers.js';
import { extractKeyContent } from './extract-key-content.js';
import { buildColorInstructions, buildDesignInstructions, buildTypographyInstructions, shouldPreserveDesign } from './style-instructions.js';

export interface BuildUserPromptArgs {
  siteMetadata: SiteMetadata;
  pageContent: PageContent;
  stylePreferences: StylePreferences;
  assetManifest: AssetManifest;
  isFirstPage: boolean;
  /** Whether a homepage screenshot was actually attached to the LLM call.
   * Drives whether the color/design blocks reference "the screenshot" or fall
   * back to the extracted content, so we never point the model at an image
   * that isn't there (loadHomepageScreenshot returns undefined on a miss). */
  hasScreenshot: boolean;
}

/**
 * Which source assets the agent is allowed to see, per the bring-over flags.
 * This is the deterministic image/logo lever: the agent cannot reuse an asset
 * that isn't in the prompt. Logo identity uses the isLikelyLogo heuristic.
 */
export function selectPromptAssets(assets: AssetInfo[], prefs: StylePreferences): AssetInfo[] {
  // Default undefined → keep: an in-flight rebuild whose persisted workflow-state
  // predates these fields must still surface its assets (else every asset, logo
  // included, is filtered out → AIROBUILD-2104 fabrication). Only an explicit
  // false drops.
  return assets.filter((asset) => {
    const isLogo = isLikelyLogo(asset);
    if (isLogo) return prefs.keepLogo !== false;
    return prefs.keepSourceImages !== false;
  });
}

export function buildUserPrompt(args: BuildUserPromptArgs): string {
  const { siteMetadata, pageContent, stylePreferences, assetManifest, isFirstPage, hasScreenshot } = args;

  const preserveDesign = shouldPreserveDesign(stylePreferences);

  // Sort once by placement so both the dimensioned list and the categorized
  // section map operate on the same top-N slice (MAX_ASSETS_IN_PROMPT cap).
  // Asset selection is now driven by the explicit keepLogo/keepSourceImages flags
  // rather than the preserve-design predicate, so the agent only sees assets
  // the user chose to bring over.
  const orderedAssets = [...assetManifest.assets]
    .sort((a, b) => placementOrder(a.placement) - placementOrder(b.placement));
  const promptAssets = selectPromptAssets(orderedAssets, stylePreferences);
  const categorizedAssets = categorizeAssets(promptAssets);
  const assetsList = renderAssetList(promptAssets);

  // Cap on the verbose full-content reference — the extracted key content and
  // the categorized assets are the load-bearing inputs; the full text is a
  // fallback for anything the regexes missed. In redesign mode this verbatim,
  // section-ordered dump is the strongest "clone this" anchor, so trim it harder
  // (the extracted key content still carries the copy) and reframe it below as
  // content-only, not a layout blueprint (AIROBUILD-2682).
  const fullContent = pageContent.sanitizedContent.substring(0, preserveDesign ? 4000 : 2000);
  const fullContentLabel = preserveDesign
    ? 'reference for context'
    : 'content & messaging reference ONLY — NOT a layout blueprint';
  // Redesign mode adds a "not a blueprint" note so the verbatim, section-ordered
  // dump stops anchoring the agent toward cloning the source structure.
  const fullContentNote = preserveDesign
    ? ''
    : "\nUse this only to capture the real copy. Do NOT mirror the section order or structure below — it is the source's old layout. Arrange the content freshly per the design direction.";
  const fullContentSection = `=== FULL PAGE CONTENT (${fullContentLabel}) ===${fullContentNote}\n${fullContent}`;
  const extractedContent = extractKeyContent(pageContent.sanitizedContent);

  const designIntentBlock = buildDesignIntentBlock(stylePreferences.designIntent);
  const colorInstructions = isFirstPage ? buildColorInstructions(stylePreferences, siteMetadata, hasScreenshot) : '';
  const designInstructions = isFirstPage ? buildDesignInstructions(stylePreferences, siteMetadata, hasScreenshot) : '';
  const typographyInstructions = buildTypographyInstructions(stylePreferences, siteMetadata);

  // Asset directive is now a three-way keyed on the explicit bring-over flags
  // rather than the preserve-design predicate (AIROBUILD-2715).
  const assetDirectiveNum = isFirstPage ? '5' : '4';
  const assetDirective = stylePreferences.keepSourceImages
    ? `${assetDirectiveNum}. **USE IMPORTED ASSETS — DO NOT GENERATE NEW IMAGES** - The source site's images are already downloaded and listed above with paths like \`/assets/images/[filename]\`. Use those paths directly. Do NOT use the media tool to search for or generate replacement images. Only search for stock images if a section genuinely has no suitable imported image AND the design requires one.`
    : stylePreferences.keepLogo
      ? `${assetDirectiveNum}. **REIMAGINE WITH FRESH IMAGERY** - This is a redesign. Keep the source **logo** (listed above with a \`/assets/images/[filename]\` path) so the brand stays recognizable. For everything else — hero, sections, backgrounds — choose fresh imagery: use the media tool for modern stock photos.`
      : `${assetDirectiveNum}. **FRESH IMAGERY, NO SOURCE BRAND ASSETS** - Do not reuse any source images, including the logo. Choose all imagery fresh via the media tool to fit the new design.`;

  const siteType = siteMetadata.siteType ?? 'content';
  const siteTypeRules = buildSiteTypeRules(siteType, isFirstPage);

  const patternsBlock = buildPatternsBlock(pageContent.structure.interactivePatterns, preserveDesign);
  const formsBlock = buildFormsBlock(pageContent.structure.forms);
  const contentLinksBlock = buildContentLinksBlock(pageContent.structure.contentLinks);
  const navigationBlock = buildNavigationBlock(pageContent.structure.navigation);
  const footerNavBlock = isFirstPage ? buildFooterNavBlock(siteMetadata.footerNavigation) : '';
  const contactBlock = isFirstPage && siteMetadata.contact
    ? `\n=== CONTACT INFORMATION (from source site — use ONLY what's listed) ===\n${buildContactBlock(siteMetadata.contact)}\n`
    : '';
  const faviconBlock = isFirstPage && siteMetadata.favicon
    ? buildFaviconBlock(resolveFavicon(siteMetadata.favicon, assetManifest.assets))
    : '';

  return `Generate a detailed prompt for building this ${isFirstPage ? 'homepage' : 'page'}. Your job is to OPTIMIZE the existing content, not create new content.

SITE TYPE: ${siteType}
${siteTypeRules}

SITE METADATA:
- Purpose: ${siteMetadata.sitePurpose}
- Target Audience: ${siteMetadata.targetAudience}
- Brand Voice: ${siteMetadata.brandVoice}
- Current Design Style: ${siteMetadata.designStyle}
- Current Colors: Primary: ${siteMetadata.colorPalette.primary.join(', ') || 'Not specified'}, Secondary: ${siteMetadata.colorPalette.secondary.join(', ') || 'Not specified'}
- Current Typography: Headings: ${siteMetadata.typography.headingFonts.join(', ') || 'Not specified'}, Body: ${siteMetadata.typography.bodyFonts.join(', ') || 'Not specified'}${siteMetadata.typography.scale && siteMetadata.typography.scale.length > 0 ? ` (${siteMetadata.typography.scale.length} scale entries available)` : ''}

STYLE PREFERENCES FROM USER:
- Design Direction: ${stylePreferences.designDirection}
- Color Preference: ${stylePreferences.colorPreference}
- Typography Style: ${stylePreferences.typographyStyle}
- Layout Approach: ${stylePreferences.layoutApproach}

${designIntentBlock}
${colorInstructions}

${designInstructions}

${typographyInstructions}

PAGE CONTENT TO REBUILD:
- Title: ${pageContent.title}
- URL: ${pageContent.url}
${patternsBlock}${formsBlock}${contentLinksBlock}${navigationBlock}${footerNavBlock}${contactBlock}${faviconBlock}
=== EXTRACTED KEY CONTENT (use this for the rebuild) ===
${extractedContent}

${fullContentSection}

=== AVAILABLE ASSETS (from source website) ===

**IMAGE SIZE GUIDE:**
- Hero/banner images: Use images 800px+ wide (marked as "hero-suitable" or "large")
- Logos: Use images marked as "logo-suitable" (typically 100-400px). AVOID tiny icons (<50px) for logos.
- Feature images: Use "medium" or larger images (300px+)
- Icons: Small images (<100px) are suitable for icons only

**CATEGORIZED ASSETS:**
${categorizedAssets}

**ALL ASSETS WITH DIMENSIONS:**
${assetsList}

**CRITICAL INSTRUCTIONS:**

${isFirstPage ? `1. **SET PROJECT NAME FIRST** - At the start of the prompt, instruct the develop agent to set the project name using the site's brand/name (e.g., "First, set the project name to '[Site Name]' using the setProjectName tool").

` : ''}${isFirstPage ? '2' : '1'}. **USE THE ACTUAL CONTENT ABOVE** - Quote the real headings, taglines, feature descriptions, and CTAs from the source. The develop agent should implement the REAL copy, not make up new content.

${isFirstPage ? '3' : '2'}. **PRESERVE KEY MESSAGING** - The hero headline, value propositions, and CTAs should be the actual text from the source website.

${isFirstPage ? '4' : '3'}. **CHOOSE APPROPRIATELY SIZED IMAGES** - Check the dimensions before recommending an image:
   - For logos: Use images 100-400px wide, NOT tiny icons (<50px)
   - For hero sections: Use images 800px+ wide
   - For feature images: Use images 300px+ wide
   - Only use small images (<100px) for icons or decorative elements

${assetDirective}

${isFirstPage ? `6. **HOMEPAGE STRUCTURE**:
   - **HEADER**: Include explicit requirements for header with logo, navigation, and any CTAs
   - **FOOTER**: ALWAYS include a footer. The footer is ESSENTIAL - do not omit it.
     - **ONLY include contact info that was ACTUALLY FOUND** in the CONTACT INFORMATION section above
     - **DO NOT use placeholder phone numbers like (555) 123-4567 or fake addresses**
     - **If no phone was found, skip phone number entirely**
     - **If no address was found, skip address entirely**
     - Always include: Copyright notice, navigation links
     - Include social media links only if found

7` : '5'}. **STRUCTURE THE PROMPT** so the develop agent knows exactly:
   - What headline text to use (quoted from source)
   - What feature descriptions to use (quoted from source)
   - What CTA text to use (quoted from source)
   - Which imported images to use for each section${isFirstPage ? '\n   - The specific design direction and colors' : ''}

${isFirstPage ? 'Generate a comprehensive, actionable prompt (400-1000 words)' : 'Generate a focused, actionable prompt (300-600 words)'} that enables the develop agent to rebuild this page with the REAL content optimized for the ${isFirstPage ? 'new' : 'existing'} design.`;
}

/** Length cap on the rendered design-intent block — enough for a real instruction,
 *  short enough that it can't crowd out the rest of the prompt. */
const MAX_DESIGN_INTENT_CHARS = 600;

/**
 * Render the customer's free-text design instruction as a high-priority prompt
 * block (AIROBUILD-2682). The four-enum designDirection can't encode intent like
 * "ignore the existing structure"; this carries the customer's actual words so
 * the develop agent can honor them over the generic direction guidance.
 *
 * The intent is the customer's own input but still LLM-bound text: strip control
 * chars, collapse runs of `=` so it can't forge a `=== … ===` section header,
 * and cap length so it can't crowd out the rest of the prompt. Returns '' when
 * absent (the field is optional — only the typed/NL rebuild path supplies it).
 *
 * Only `===` is neutralized because that's the only delimiter this prompt
 * template uses to mark sections; `##`/`---`/backticks have no structural
 * meaning here, and the threat model is mild anyway (the customer is steering
 * their own rebuild, and their text is a user message, not the system prompt).
 */
export function buildDesignIntentBlock(designIntent: string | undefined): string {
  if (!designIntent) return '';
  const sanitized = designIntent
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B-\x1F]/g, '') // strip control chars, keep newline (\x0A) + tab (\x09)
    .replace(/={3,}/g, '==') // neutralize forged prompt-section delimiters
    .slice(0, MAX_DESIGN_INTENT_CHARS)
    .trim();
  if (!sanitized) return '';
  return `=== CUSTOMER'S DESIGN INSTRUCTION (highest priority — follow this over the generic direction guidance below) ===
"${sanitized}"
This is the customer's own description of what they want, in their words. It takes precedence over the generic DESIGN DIRECTION guidance below. If it asks to depart from the source's structure, layout, navigation, or content organization, do so.
`;
}

// ----- Section blocks (DETECTED PATTERNS / DETECTED FORMS / NAVIGATION / FOOTER NAV / CONTACT) ---

export function buildPatternsBlock(patterns: PageContent['structure']['interactivePatterns'], preserveDesign: boolean): string {
  if (!patterns || patterns.length === 0) return '';
  const lines = patterns.map(
    p => `- ${p.type} (${p.occurrences} match${p.occurrences === 1 ? '' : 'es'}; evidence: \`${p.evidence}\`)`
  );
  // Clone reproduces the source patterns; a redesign keeps only the ones that
  // still serve the new design, so its framing must not read as "preserve".
  const framing = preserveDesign
    ? 'preserve in the rebuild'
    : 'reuse where they still serve the new design';
  return `\n=== DETECTED INTERACTIVE PATTERNS (from source HTML — ${framing}) ===\n${lines.join('\n')}\n`;
}

export function buildContentLinksBlock(contentLinks: ContentLink[] | undefined): string {
  if (!contentLinks || contentLinks.length === 0) return '';
  const lines = contentLinks.map(
    link => `- "${link.label}" → ${link.url}${link.isExternal ? ' (external)' : ''}`,
  );
  return `\n=== IN-CONTENT DOCUMENT LINKS (preserve exactly — use these absolute URLs in body copy) ===\n${lines.join('\n')}\n
**CRITICAL: Use the exact absolute URLs above for in-content document links. Do NOT rewrite them to internal routes, path-only URLs, or fabricated #-anchors.**
- Implement each link with the anchor text shown and href set to the exact URL above
- Use target="_blank" rel="noopener noreferrer" on every document link
`;
}

export function buildFormsBlock(forms: PageContent['structure']['forms']): string {
  if (!forms || forms.length === 0) return '';
  const blocks = forms.map((f, i) => {
    const action = f.action ?? '(no action — scaffold a stub handler)';
    const fieldLines = f.fields.map(field => {
      const parts = [`    - ${field.type}`];
      if (field.name) parts.push(` name="${field.name}"`);
      if (field.label) parts.push(` label="${field.label}"`);
      if (field.placeholder) parts.push(` placeholder="${field.placeholder}"`);
      if (field.required) parts.push(' (required)');
      if (field.options && field.options.length > 0) {
        parts.push(` options=[${field.options.slice(0, 5).join(', ')}]`);
      }
      return parts.join('');
    });
    const submit = f.submitButton ? `\n  Submit button: "${f.submitButton.text}"` : '';
    return `Form ${i + 1}: ${f.method.toUpperCase()} ${action}\n  Fields:\n${fieldLines.join('\n')}${submit}`;
  });
  return `\n=== DETECTED FORMS (from source HTML — preserve as real <form> elements with these exact fields) ===\n${blocks.join('\n\n')}\n`;
}

export function buildNavigationBlock(navigation: PageContent['structure']['navigation']): string {
  if (navigation.length === 0) return '';
  const lines = navigation.map(
    n => `- "${n.label}" → ${n.url}${n.isExternal ? ' (EXTERNAL — keep full URL, open in new tab)' : ''}`
  );
  return `\n=== HEADER NAVIGATION (use EXACT paths and URLs) ===\n${lines.join('\n')}\n
**CRITICAL: Use the exact URL paths above for navigation links. Do NOT rename or simplify paths (e.g., if the source has "/about-us", use "/about-us", NOT "/about").**
- External links should be implemented with target="_blank" rel="noopener noreferrer"
- Only the homepage is being built right now. The other paths will be built later when the user picks them from the rebuild page selector — leaving them unrouted (so they fall through to the 404 page) is the correct behavior for this turn.
`;
}

export function buildFooterNavBlock(footerNav: NavigationItem[] | undefined): string {
  if (!footerNav || footerNav.length === 0) return '';
  const lines = footerNav.map(
    n => `- "${n.label}" → ${n.url}${n.isExternal ? ' (external)' : ''}`
  );
  return `\n=== FOOTER NAVIGATION (separate set of links for the site footer) ===\n${lines.join('\n')}\n`;
}

/**
 * Strip characters that can't legitimately appear in a favicon `<link>`
 * attribute (URL, rel, sizes, mimeType) but, if a hostile source site supplied
 * them, could break out of the tag or inject a fake prompt section: double
 * quotes, angle brackets, and newlines. These values are Atlas's extraction of
 * an arbitrary third-party site, so treat them as untrusted — same rationale as
 * `sanitizeEmbeddedText` for vision transcriptions.
 */
function sanitizeFaviconAttr(value: string): string {
  return value.replace(/["<>\r\n]+/g, '').trim();
}

/**
 * Render the chosen site favicon as a `<head>` directive. First-page only —
 * the favicon lives in the document head, set once for the whole site.
 */
export function buildFaviconBlock(favicon: ResolvedFavicon): string {
  const attrs = [`rel="${sanitizeFaviconAttr(favicon.rel ?? 'icon')}"`, `href="${sanitizeFaviconAttr(favicon.href)}"`];
  if (favicon.mimeType) attrs.push(`type="${sanitizeFaviconAttr(favicon.mimeType)}"`);
  if (favicon.sizes) attrs.push(`sizes="${sanitizeFaviconAttr(favicon.sizes)}"`);
  return `\n=== SITE FAVICON (from source site — add to the document <head>) ===\n<link ${attrs.join(' ')}>\nUse this exact favicon; do not substitute a generated or placeholder icon.\n`;
}

/**
 * Render the source-extracted contact info as prompt-friendly bullets.
 * Atlas (or whichever extractor) is the source of truth — we only surface
 * fields that were actually present.
 */
export function buildContactBlock(contact: SiteContactInfo): string {
  const lines: string[] = [];

  if (contact.phones?.length) {
    const phones = contact.phones.map(p => `${p.number}${p.type ? ` (${p.type})` : ''}`).join(', ');
    lines.push(`- Phone: ${phones}`);
  }
  if (contact.emails?.length) {
    const emails = contact.emails.map(e => `${e.address}${e.type ? ` (${e.type})` : ''}`).join(', ');
    lines.push(`- Email: ${emails}`);
  }
  if (contact.addresses?.length) {
    for (const a of contact.addresses) {
      lines.push(`- Address: ${a.formatted}`);
    }
  }
  if (contact.hours?.length) {
    lines.push('- Hours:');
    for (const h of contact.hours) {
      const isClosed = h.open === '00:00' && h.close === '00:00';
      lines.push(`    ${h.day}: ${isClosed ? 'Closed' : `${h.open}–${h.close}`}`);
    }
  }
  if (contact.social?.length) {
    lines.push('- Social:');
    for (const s of contact.social) {
      if (s.platform?.toLowerCase() === 'whatsapp' && s.phone) {
        const href = `https://wa.me/${s.phone}${s.text ? `?text=${encodeURIComponent(s.text)}` : ''}`;
        const msg = s.text ? ` (prefilled message: "${s.text}")` : '';
        lines.push(`    WhatsApp click-to-chat: ${href}${msg}`);
      } else {
        lines.push(`    ${s.platform}: ${s.url}`);
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') : '(no contact info extracted)';
}

// ----- Asset categorization + listing -------------------------------------

/**
 * Logo/brand-mark heuristic — the one source asset reimagine keeps so the brand
 * stays recognizable.
 *
 * The Atlas `inHeader` placement is the most reliable cue and the only one that
 * catches wide wordmark exports (e.g. 1000x250), which the `logo-suitable` size
 * bucket (maxDim < 300) misses. The size + "logo"-in-path/alt checks remain as
 * fallbacks for legacy scrapes without placement signals.
 */
export function isLikelyLogo(asset: AssetInfo): boolean {
  if (asset.type !== 'image') return false;

  // Priority 1: Header placement
  if (asset.placement?.inHeader) return true;

  // Priority 2: Size & aspect ratio
  if (getSizeCategory(asset.dimensions) === 'logo-suitable') return true;

  // Priority 3: Text matching
  const haystack = `${asset.altText ?? ''} ${asset.localPath ?? ''} ${asset.description ?? ''}`.toLowerCase();
  return haystack.includes('logo');
}

/** Bucket label based on a "fits-on-screen" interpretation of asset dimensions. */
export function getSizeCategory(dimensions?: { width: number; height: number }): string {
  if (!dimensions) return 'unknown-size';

  const maxDim = Math.max(dimensions.width, dimensions.height);
  const minDim = Math.min(dimensions.width, dimensions.height);

  // Likely-logo heuristic: medium-sized, near-square or horizontal aspect ratio.
  const aspectRatio = dimensions.width / dimensions.height;
  const isLogoLike = minDim >= 50 && minDim <= 400 && aspectRatio >= 0.5 && aspectRatio <= 3;

  if (maxDim < 50) return 'tiny-icon';
  if (maxDim < 100) return 'small-icon';
  if (maxDim < 300) {
    if (isLogoLike && minDim >= 80) return 'logo-suitable';
    return 'small';
  }
  if (maxDim < 600) {
    if (isLogoLike) return 'logo-suitable';
    return 'medium';
  }
  if (maxDim < 1000) return 'large';
  return 'hero-suitable';
}

/** Cap on assets included in the prompt. buildUserPrompt sorts by placement
 *  once and passes the result to both renderAssetList and categorizeAssets so
 *  the dimensioned list and the bucketed view agree on which assets are in scope. */
const MAX_ASSETS_IN_PROMPT = 30;

/** Dimensioned asset list (top {@link MAX_ASSETS_IN_PROMPT}) rendered as bullet lines. */
/**
 * Human-readable section role derived from Atlas SSM placement signals — the
 * section-mapping signal develop needs to put each image back where it belongs.
 * Returns '' when no placement was captured (e.g. CSS/background images).
 */
function placementRole(p: ImagePlacement | undefined): string {
  if (!p) return '';
  if (p.inHeader) return 'site header (logo/nav)';
  if (p.inFooter) return 'footer';
  const parts: string[] = [];
  if (p.inFirstSection || p.nearH1) parts.push('hero / top of page');
  if (p.linkedTo) {
    const path = linkedToPath(p.linkedTo);
    if (path) parts.push(`card linking to ${path}`);
  }
  if (p.isFirstInContainer && parts.length === 0) parts.push('first image in its section');
  return parts.join(', ');
}

/** Pathname of a linkedTo href (absolute or relative), or '' for off-site/root/malformed. */
function linkedToPath(href: string): string {
  try {
    const path = new URL(href, 'https://x.invalid').pathname;
    return path && path !== '/' ? path : '';
  } catch {
    return '';
  }
}

/** Render order: header → hero → cards/sections → body → footer → unplaced. */
function placementOrder(p: ImagePlacement | undefined): number {
  if (!p) return 5;
  if (p.inHeader) return 0;
  if (p.inFirstSection || p.nearH1) return 1;
  if (p.linkedTo || p.isFirstInContainer) return 2;
  if (p.inFooter) return 4;
  return 3;
}

export function renderAssetList(assets: AssetInfo[]): string {
  // Caller provides assets pre-sorted by placementOrder so both this list and
  // categorizeAssets apply the same MAX cap to the same ordered input.
  return assets
    .slice(0, MAX_ASSETS_IN_PROMPT)
    .map(a => {
      const publicPath = normalizeAssetPath(a.localPath);
      const dims = a.dimensions ? `${a.dimensions.width}x${a.dimensions.height}px` : 'unknown size';
      const sizeCategory = getSizeCategory(a.dimensions);
      // Alt text is the strongest signal we have for logos and named images
      // (often contains the literal brand name). Surface it before the
      // AI-generated description so the LLM can disambiguate.
      const altNote = a.altText ? ` - alt: "${a.altText}"` : '';
      const compositionNote = a.composition ? ` - COMPOSITION: ${a.composition}` : '';
      const descriptionNote = a.description ? ` - ${a.description}` : '';
      // PLACEMENT is the section map: where this image sat on the source page.
      const role = placementRole(a.placement);
      const placementNote = role ? ` - PLACEMENT: ${role}` : '';
      // The source already baked heading text into this image — keep the agent
      // from stacking its own heading on top (double text).
      const embeddedTextNote = a.hasEmbeddedText && a.embeddedText
        ? ` - ⚠️ IMAGE CONTAINS TEXT: "${sanitizeEmbeddedText(a.embeddedText)}" — do NOT overlay additional headings`
        : '';
      return `- ${publicPath} [${dims}] (${a.type}, ${sizeCategory}${altNote}${compositionNote}${descriptionNote})${placementNote}${embeddedTextNote}`;
    })
    .join('\n');
}

/**
 * Bucket the top {@link MAX_ASSETS_IN_PROMPT} assets by where they sat on the
 * source page (Atlas placement). Images with placement are grouped by section
 * role — header/hero/cards/footer — so the agent rebuilds each section with its
 * real image. Images without placement (CSS/background art) fall back to
 * size-based buckets.
 */
export function categorizeAssets(assets: AssetInfo[]): string {
  // Placement-anchored buckets (preferred — these carry the section map).
  const headerImages: string[] = [];
  const heroImages: string[] = [];
  const cardImages: string[] = [];
  const footerImages: string[] = [];
  // Size-based buckets (fallback for images with no placement signal).
  const bigImages: string[] = [];
  const logoImages: string[] = [];
  const featureImages: string[] = [];
  const smallImages: string[] = [];
  const unknownImages: string[] = [];

  for (const asset of assets.slice(0, MAX_ASSETS_IN_PROMPT)) {
    const publicPath = normalizeAssetPath(asset.localPath);
    const dims = asset.dimensions
      ? `${asset.dimensions.width}x${asset.dimensions.height}`
      : '?x?';
    // Alt text first — strongest disambiguator for logos and named images.
    // AI-generated description (from vision pass) comes after.
    const alt = asset.altText ? ` alt:"${asset.altText}"` : '';
    const desc = asset.description ? ` - ${asset.description.substring(0, 50)}` : '';
    // Surfaces on hero/header buckets so the agent reuses the image as-is
    // instead of overlaying a duplicate heading.
    const textWarning = asset.hasEmbeddedText && asset.embeddedText
      ? ` [CONTAINS TEXT: "${sanitizeEmbeddedText(asset.embeddedText)}"]`
      : '';
    const baseEntry = `${publicPath} [${dims}]${alt}${textWarning}${desc}`;

    const p = asset.placement;
    if (p?.inHeader) { headerImages.push(baseEntry); continue; }
    if (p?.inFooter) { footerImages.push(baseEntry); continue; }
    if (p && (p.inFirstSection || p.nearH1)) { heroImages.push(baseEntry); continue; }
    if (p?.linkedTo) {
      const path = linkedToPath(p.linkedTo);
      cardImages.push(path ? `${baseEntry} → links to ${path}` : baseEntry);
      continue;
    }

    if (!asset.dimensions) {
      unknownImages.push(baseEntry);
      continue;
    }

    const maxDim = Math.max(asset.dimensions.width, asset.dimensions.height);
    const minDim = Math.min(asset.dimensions.width, asset.dimensions.height);
    const aspectRatio = asset.dimensions.width / asset.dimensions.height;
    const isLogoLike = minDim >= 50 && minDim <= 400 && aspectRatio >= 0.3 && aspectRatio <= 4;

    if (maxDim >= 800) {
      bigImages.push(baseEntry);
    } else if (isLogoLike && minDim >= 80 && maxDim <= 500) {
      logoImages.push(baseEntry);
    } else if (maxDim >= 300) {
      featureImages.push(baseEntry);
    } else {
      smallImages.push(baseEntry);
    }
  }

  const output: string[] = [];

  const pushBucket = (label: string, items: string[], cap: number) => {
    if (items.length === 0) return;
    output.push(`\n**${label}:**`);
    items.slice(0, cap).forEach(item => output.push(`  - ${item}`));
    if (items.length > cap) output.push(`  ... and ${items.length - cap} more`);
  };

  // By source-page position first — this is the section map.
  pushBucket('Header (logo/nav — from page position)', headerImages, 5);
  pushBucket('Hero / Top of Page (from page position)', heroImages, 5);
  pushBucket('Cards / Section Images that link to other pages (use as the image for that nav/card)', cardImages, 10);
  pushBucket('Footer (from page position)', footerImages, 5);
  // Then by size, for images with no captured placement.
  pushBucket('Large Images (800px+, placement unknown)', bigImages, 5);
  pushBucket('Logo Candidates (100-400px, good proportions)', logoImages, 5);
  pushBucket('Feature Images (300-800px)', featureImages, 5);
  pushBucket('Small Images/Icons (<300px)', smallImages, 5);
  pushBucket('Unknown Size', unknownImages, 3);

  return output.join('\n');
}
