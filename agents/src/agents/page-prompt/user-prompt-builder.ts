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
  NavigationItem,
  PageContent,
  SiteContactInfo,
  SiteMetadata,
  StylePreferences,
} from '../../types/rebuild.js';
import { normalizeAssetPath } from '../../utils/asset-paths.js';
import { buildSiteTypeRules } from '../site-type-helpers.js';
import { extractKeyContent } from './extract-key-content.js';
import { buildColorInstructions, buildDesignInstructions, buildTypographyInstructions } from './style-instructions.js';

export interface BuildUserPromptArgs {
  siteMetadata: SiteMetadata;
  pageContent: PageContent;
  stylePreferences: StylePreferences;
  assetManifest: AssetManifest;
  isFirstPage: boolean;
}

export function buildUserPrompt(args: BuildUserPromptArgs): string {
  const { siteMetadata, pageContent, stylePreferences, assetManifest, isFirstPage } = args;

  const categorizedAssets = categorizeAssets(assetManifest.assets);
  const assetsList = renderAssetList(assetManifest.assets);

  // 4KB cap on the verbose full-content reference — the extracted key content
  // and the categorized assets are the load-bearing inputs; the full text is
  // a fallback for anything the regexes missed.
  const fullContent = pageContent.sanitizedContent.substring(0, 4000);
  const extractedContent = extractKeyContent(pageContent.sanitizedContent);

  const colorInstructions = isFirstPage ? buildColorInstructions(stylePreferences, siteMetadata) : '';
  const designInstructions = isFirstPage ? buildDesignInstructions(stylePreferences, siteMetadata) : '';
  const typographyInstructions = buildTypographyInstructions(stylePreferences, siteMetadata);

  const siteType = siteMetadata.siteType ?? 'content';
  const siteTypeRules = buildSiteTypeRules(siteType, isFirstPage);

  const patternsBlock = buildPatternsBlock(pageContent.structure.interactivePatterns);
  const formsBlock = buildFormsBlock(pageContent.structure.forms);
  const navigationBlock = buildNavigationBlock(pageContent.structure.navigation);
  const footerNavBlock = isFirstPage ? buildFooterNavBlock(siteMetadata.footerNavigation) : '';
  const contactBlock = isFirstPage && siteMetadata.contact
    ? `\n=== CONTACT INFORMATION (from source site — use ONLY what's listed) ===\n${buildContactBlock(siteMetadata.contact)}\n`
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

${colorInstructions}

${designInstructions}

${typographyInstructions}

PAGE CONTENT TO REBUILD:
- Title: ${pageContent.title}
- URL: ${pageContent.url}
${patternsBlock}${formsBlock}${navigationBlock}${footerNavBlock}${contactBlock}
=== EXTRACTED KEY CONTENT (use this for the rebuild) ===
${extractedContent}

=== FULL PAGE CONTENT (reference for context) ===
${fullContent}

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

${isFirstPage ? '5' : '4'}. **USE IMPORTED ASSETS — DO NOT GENERATE NEW IMAGES** - The source site's images are already downloaded and listed above with paths like \`/assets/images/[filename]\`. Use those paths directly in the code. Do NOT use the media tool to search for or generate replacement images. Only search for stock images if a section genuinely has no suitable imported image AND the design requires one.

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

// ----- Section blocks (DETECTED PATTERNS / DETECTED FORMS / NAVIGATION / FOOTER NAV / CONTACT) ---

export function buildPatternsBlock(patterns: PageContent['structure']['interactivePatterns']): string {
  if (!patterns || patterns.length === 0) return '';
  const lines = patterns.map(
    p => `- ${p.type} (${p.occurrences} match${p.occurrences === 1 ? '' : 'es'}; evidence: \`${p.evidence}\`)`
  );
  return `\n=== DETECTED INTERACTIVE PATTERNS (from source HTML — preserve in the rebuild) ===\n${lines.join('\n')}\n`;
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
      lines.push(`    ${s.platform}: ${s.url}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '(no contact info extracted)';
}

// ----- Asset categorization + listing -------------------------------------

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

/** Cap on assets included in the prompt. Both renderAssetList and
 *  categorizeAssets see the same top-N slice so the dimensioned list and
 *  the bucketed view agree on which assets are in scope. */
const MAX_ASSETS_IN_PROMPT = 30;

/** Dimensioned asset list (top {@link MAX_ASSETS_IN_PROMPT}) rendered as bullet lines. */
function renderAssetList(assets: AssetInfo[]): string {
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
      return `- ${publicPath} [${dims}] (${a.type}, ${sizeCategory}${altNote}${compositionNote}${descriptionNote})`;
    })
    .join('\n');
}

/** Bucket the top {@link MAX_ASSETS_IN_PROMPT} assets into hero/logo/feature/small/unknown sections. */
export function categorizeAssets(assets: AssetInfo[]): string {
  const heroImages: string[] = [];
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
    const entry = `${publicPath} [${dims}]${alt}${desc}`;

    if (!asset.dimensions) {
      unknownImages.push(entry);
      continue;
    }

    const maxDim = Math.max(asset.dimensions.width, asset.dimensions.height);
    const minDim = Math.min(asset.dimensions.width, asset.dimensions.height);
    const aspectRatio = asset.dimensions.width / asset.dimensions.height;
    const isLogoLike = minDim >= 50 && minDim <= 400 && aspectRatio >= 0.3 && aspectRatio <= 4;

    if (maxDim >= 800) {
      heroImages.push(entry);
    } else if (isLogoLike && minDim >= 80 && maxDim <= 500) {
      logoImages.push(entry);
    } else if (maxDim >= 300) {
      featureImages.push(entry);
    } else {
      smallImages.push(entry);
    }
  }

  const output: string[] = [];

  const pushBucket = (label: string, items: string[], cap: number) => {
    if (items.length === 0) return;
    output.push(`\n**${label}:**`);
    items.slice(0, cap).forEach(item => output.push(`  - ${item}`));
    if (items.length > cap) output.push(`  ... and ${items.length - cap} more`);
  };

  pushBucket('Hero/Banner Images (800px+)', heroImages, 5);
  pushBucket('Logo Candidates (100-400px, good proportions)', logoImages, 5);
  pushBucket('Feature Images (300-800px)', featureImages, 5);
  pushBucket('Small Images/Icons (<300px)', smallImages, 5);
  pushBucket('Unknown Size', unknownImages, 3);

  return output.join('\n');
}
