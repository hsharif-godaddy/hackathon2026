import {
  createAgentFactory,
  type AgentConfig,
  createPromptBuilder,
  createFileInputFromBuffer,
  processFile,
  type ProcessedFile,
  type SessionStateManager,
  createSessionStateManager
} from '@airo/ai-lib'

import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { normalizeAssetPath } from '../utils/asset-paths.js'
import { Logger } from '../logging/index.js'
import { getAgentModelWithName } from '../utils/model-selection.js'
import type { AssetInfo, NavigationItem, PageContent, SiteContactInfo, SiteMetadata, StylePreferences, AssetManifest } from '../types/rebuild.js'
import { buildSiteTypeRules } from './site-type-helpers.js'
import { parseScreenshotDataUrl, screenshotFilenameForMime } from './screenshot-data-url.js'

const logger = Logger.create({ component: 'page-prompt-agent' })

async function buildPagePromptSystemPrompt(isFirstPage: boolean = true, useAtlasCrawler: boolean = false): Promise<string> {
  const promptBuilder = createPromptBuilder()

  // Base prompt for all pages
  promptBuilder.text(`# Page Prompt Generator Agent

You are a specialized AI agent that generates comprehensive prompts for building web pages based on scraped content and design preferences.

## Your Role

Given:
- Site metadata (purpose, brand, design style)
- User's style preferences (design direction, colors, typography)
- Asset manifest (available images, fonts, icons)
- Single page content (structure, text, sections, FULL COPY)

You generate a detailed, actionable prompt that the develop agent can use to build that page, **optimizing and enhancing the existing content rather than creating from scratch**.

## Core Principle: Optimize Existing Content

**CRITICAL**: Your primary job is to take the ACTUAL CONTENT from the source website and incorporate it into the prompt. The develop agent should be working with the real copy, real headings, real feature descriptions - not making up new content.

- PRESERVE the actual headings, taglines, and value propositions from the source
- PRESERVE the feature descriptions and benefits copy
- PRESERVE call-to-action text and button labels
- ENHANCE the structure and presentation while keeping the core messaging
- Only suggest rewrites if the original copy is genuinely poor quality

## Prompt Generation Guidelines

### 1. Structure Your Prompt

Start with context:
- "Build a [page type] page for [site purpose]"
- "Target audience: [audience]"
- "Design style: [style] with [design direction]"

### 2. Content Integration (CRITICAL)

**Include the actual content from the scraped page verbatim:**
- Quote the exact hero headline and tagline
- Quote feature headings and descriptions
- Quote call-to-action text
- Quote any testimonials or social proof
- Include navigation items and their labels

Format like:
- Hero headline: "[exact headline from source]"
- Hero tagline: "[exact tagline from source]"
- Features:
  - "[Feature 1 heading]": "[Feature 1 description]"
  - "[Feature 2 heading]": "[Feature 2 description]"
- CTA: "[exact CTA text]"

### 3. Layout Instructions

Be specific about structure:
- Section order and content (matching source structure)
- Responsive behavior

### Visual Reference (Homepage Screenshot)

When a homepage screenshot is attached, use it as the PRIMARY reference for layout:
- Describe the EXACT visual arrangement you see — section order, component placement, spacing
- Note the hero composition (text placement, image placement, background treatment)
- Note the navigation style (horizontal, hamburger, sticky, centered, left-aligned)
- Note how content sections are arranged (grid, cards, stacked, alternating, full-bleed)
- Note the footer structure (columns, density, placement of links vs contact info)
- Replicate the layout faithfully — don't invent a new arrangement
- Include specific layout instructions like "full-width hero with text overlaid on left, image right" or "3-column feature grid below a centered headline"`)

  // Preserve-detected-blocks guidance is only meaningful when Atlas extraction
  // is on — that's the only path that produces DETECTED INTERACTIVE PATTERNS /
  // DETECTED FORMS blocks in the user prompt. Skipping these sections on the
  // legacy path keeps the system prompt smaller and avoids subtly biasing
  // legacy-rebuild behavior with directives whose triggers can never fire.
  if (useAtlasCrawler) {
    promptBuilder.text(`
### Preserve Interactive Patterns

The user prompt may include a **DETECTED INTERACTIVE PATTERNS** block listing structural features extracted from the source HTML (carousels, accordions, tabs, video heroes, lightboxes, modals). When present:

- **Treat detected patterns as load-bearing.** If the source has a hero carousel, the rebuild prompt MUST specify a hero carousel/slideshow component — not a static hero with one image. Same for accordions (don't flatten to a stacked list), tabs (don't flatten to inline sections), video heroes (don't replace with a static image), lightboxes (don't drop image enlargement).
- **Be specific about the component.** Name it ("hero image carousel with N slides", "FAQ accordion with expand/collapse", "tabbed services section") and describe the slides/panels/tabs using the actual content from the source.
- **Source fidelity overrides image-size heuristics.** When a pattern is detected, slide/panel content (images + captions) MUST come from imported assets the source page references — even if those images look small or low-resolution. Do NOT instruct the develop agent to stock-search for replacement imagery for detected-pattern slides. Render imports at their native size or with object-fit: cover for full-bleed slides. The 800px+ hero-image guidance does not override pattern preservation.
- **The redesign guidance below applies WITHIN preserved structure, not as license to flatten it.** Asymmetric layouts and bento grids are encouraged for static sections; don't use them as an excuse to remove a carousel.
- If a pattern isn't listed in the detected block, you may still infer it from the screenshot — but do not REMOVE patterns that were detected.

### Preserve Forms

The user prompt may include a **DETECTED FORMS** block listing forms extracted from the source HTML, with fields, action URLs, and submit buttons. When present:

- **Forms are load-bearing.** A newsletter signup, contact form, or booking form must be rebuilt as a real \`<form>\` element with the listed fields — NOT as a visual-only mockup (e.g. "an email input next to a button" is a mockup, not a form).
- **Preserve field structure verbatim.** If the source has fields named \`email\`, \`first_name\`, \`message\` with the listed types/required flags, the rebuild prompt MUST instruct the develop agent to use those exact field names, types, and required flags. The submit-button text should match.
- **Preserve action URL and method when present.** If the form has \`action="/subscribe"\` and \`method="post"\`, instruct the develop agent to wire the form to that endpoint (or scaffold a placeholder handler that POSTs to it). If the action is missing, instruct the agent to add a stub handler — not to drop the form.
- **Don't invent forms.** If no form is detected, do not add one to the prompt.`)
  }


  // First page gets full setup instructions
  if (isFirstPage) {
    promptBuilder.text(`
- Header/navigation requirements
- Footer elements

### 4. Design Specifications

Based on style preferences, provide specific design direction.

**When color preference is "Let Airo Decide" (keep-original):**
Choose and specify an appropriate color scheme for the develop agent to use. Do NOT say "choose colors" - instead, PICK specific colors that fit the brand and purpose. Example:
- "Use a deep navy (#1a365d) primary with bright coral (#ff6b6b) accents"
- "Use forest green (#2d5016) with warm cream (#faf8f3) background"

**When design direction is "Let Airo Decide" (keep-similar):**
Include a full design direction section that creates a distinctive, high-quality redesign. See the DESIGN REDESIGN GUIDANCE section below.`)
  } else {
    // Inner pages - no design setup needed
    promptBuilder.text(`

**NOTE: This is an INNER PAGE, not the homepage. The header, footer, color scheme, fonts, and project name have ALREADY been set up. DO NOT include instructions for:**
- Setting the project name
- Choosing colors or color schemes
- Selecting fonts or typography
- Creating a header or navigation
- Creating a footer

**Focus ONLY on the main content area of this specific page.**`)
  }

  promptBuilder.text(`

### ${isFirstPage ? '5' : '4'}. Asset Integration

**PRIORITIZE imported images from the source website, but stock images are still available when needed.**

Reference available assets:
- Hero images (use imported images from source site)
- Icons for features (use imported icons when available)
- Background images (use imported backgrounds)
- Logo and branding elements (use imported logos)

When referencing assets:
- Use the actual file paths provided in the asset manifest
- Specify which imported image should be used for each section
- **If the new design needs additional images** (e.g., new sections, decorative elements, or if imported images don't fit the new design), instruct the develop agent to search for appropriate stock images
- Example: "Use /assets/images/abc123.jpg for the hero section"
- Example: "Search for a modern office interior image for the About section background"
- Imported images from the source site use paths like /assets/images/ or /assets/other/"`)

  // Homepage structure requirements only for first page
  if (isFirstPage) {
    promptBuilder.text(`

### 6. Homepage Structure Requirements

**SITE TYPE** in the user prompt sets homepage shape—read it first.

- \`app\` / \`dashboard\`: **Full-viewport shell**—one primary surface (\`app\`: map, canvas, board, editor, chat, game…; \`dashboard\`: sidebar + metrics/tables/charts). No marketing header, hero, feature grid, testimonials, or marketing footer; thin top bar OK. **Skip §6 below**; follow **Site-type rules** in the user prompt.
- \`commerce\`: **Storefront** (header, nav, search, cart, product grid/catalog, optional policy/help footer per **Site-type rules**). Not a single-canvas app shell—do not use the full-viewport bullets above.
- \`content\` (default): **§6 below** applies.

**For CONTENT-type homepages, ALWAYS include these structural elements:**

- **Header/Navigation**: Include a proper header with logo, navigation links, and any CTAs
- **Footer**: ALWAYS include a complete footer. Include ONLY contact information that was ACTUALLY FOUND in the source:
  - **Phone number** - ONLY if found in CONTACT INFORMATION section
  - **Physical address** - ONLY if found in CONTACT INFORMATION section
  - **Email address** - ONLY if found in CONTACT INFORMATION section
  - **Hours of operation** - ONLY if found in CONTACT INFORMATION section
  - **Social media links** - ONLY if found in CONTACT INFORMATION section
  - Copyright notice (always include)
  - Quick navigation links (always include)
  - The footer should match the design quality of the rest of the page

**CRITICAL RULES FOR CONTACT INFO:**
1. Check the "CONTACT INFORMATION (for footer)" section in the extracted content
2. **ONLY include contact details that are explicitly listed there**
3. **DO NOT invent, guess, or use placeholder phone numbers, emails, or addresses**
4. **If no phone number was found, DO NOT include a phone number in the footer**
5. **If no address was found, DO NOT include an address in the footer**
6. It's perfectly fine to have a footer with just navigation, copyright, and social links

## DESIGN REDESIGN GUIDANCE (for "Let Airo Decide" design direction)

When the user chooses "Let Airo Decide" for design direction, you must include comprehensive design guidance that creates a distinctive, high-quality result. Include this full section in your prompt:

### Frontend Aesthetics Direction

Create distinctive designs that surprise and delight, avoiding generic "AI slop" aesthetics.

**Typography:**
- Choose fonts that are distinctive and appropriate for the brand
- Avoid generic fonts like Arial, Inter, Roboto, system fonts
- Specify mood: friendly but professional, bold and confident, elegant and refined, etc.

**Color Direction:**
- Commit to a cohesive aesthetic with dominant colors and sharp accents
- Avoid clichéd schemes (purple gradients on white backgrounds)
- Include emotional intent: "trustworthy blues that feel enterprise-ready" not just "use blue"

**Layout Requirements:**
- DO NOT use standard icon grids for features/services
- DO NOT use empty-right hero compositions (text left, nothing right)
- DO NOT use centered-text-on-colored-band CTAs
- DO use staggered layouts, bento grids, asymmetric compositions, full-bleed imagery

**Section-Specific:**
- Hero: Visual balance (if text left, add product shot/graphic right), social proof below fold
- Features: Show, don't list—inline examples or screenshots, NOT icon cards
- CTA: Asymmetric or integrated approaches, not centered-on-band
- Footer: Maintain quality—not an afterthought

**Differentiation:**
Include ONE unexpected element for memorability:
- Oversized typography that breaks the grid
- Bento-style layout with varied card sizes
- Diagonal or curved section breaks
- Bold use of asymmetric whitespace

**Consistency:**
- Footer and CTA must match hero quality
- Don't get safer/more generic as page progresses
- Maintain energy and intentionality throughout`)
  }

  // Output format section
  if (isFirstPage) {
    promptBuilder.text(`

## Output Format

Generate a single, cohesive prompt that:
- Is 400-1000 words (longer to include actual content)
- Is actionable and specific
- **Includes actual content from the source, quoted verbatim**
- References specific imported assets
- Includes design specifications with concrete values
- **Explicitly includes header AND footer requirements**

## Important Notes

- **ALWAYS quote actual content from the source page** - this is about optimization, not creation
- Be specific, not generic
- **PREFER imported images over searching**, but allow stock image searches when the new design needs additional visuals
- Reference real assets by their public path (e.g., /assets/images/filename.jpg)
- When "Let Airo Decide" is chosen, YOU make the design decisions - don't pass that to the develop agent
- Keep the prompt focused and actionable
- **ALWAYS include explicit instructions for BOTH header AND footer** - the footer is essential and should not be omitted
- Set the project name using the site's name or brand
- Tell the develop agent to use the imported images for key branding elements`)
  } else {
    promptBuilder.text(`

## Output Format

Generate a focused, content-centric prompt that:
- Is 300-600 words
- Is actionable and specific
- **Includes actual content from the source, quoted verbatim**
- References specific imported assets for this page
- **DOES NOT mention header, footer, colors, fonts, or project name - these are already set**

## Important Notes

- **ALWAYS quote actual content from the source page** - this is about optimization, not creation
- Be specific, not generic
- **PREFER imported images over searching**, but allow stock image searches when the new design needs additional visuals
- Reference real assets by their public path (e.g., /assets/images/filename.jpg)
- Keep the prompt focused on THIS PAGE'S CONTENT ONLY
- The page will automatically use the existing header, footer, colors, and fonts from the homepage build
- **DO NOT include ANY instructions about headers, footers, colors, fonts, or project setup**`)
  }

  return await promptBuilder.build()
}

export async function createPagePromptAgent(isFirstPage: boolean = true, useAtlasCrawler: boolean = false): Promise<AgentConfig> {
  const systemPrompt = await buildPagePromptSystemPrompt(isFirstPage, useAtlasCrawler)
  const { model, modelName } = await getAgentModelWithName('full')

  return {
    name: isFirstPage ? 'Page Prompt Generator (Homepage)' : 'Page Prompt Generator (Inner Page)',
    system: systemPrompt,
    model,
    modelName,
    tools: {},
    maxSteps: 5,
    temperature: 0.4,
    maxOutputTokens: 4000,
    logger: createAgentTelemetryLogger('page-prompt'),
    enablePromptCaching: false,

    metadata: {
      contextPreferences: {
        includeAppContext: false,
        includeVisualContext: false,
        includeConversationHistory: false,
        includeTemplateDescription: false
      }
    }
  }
}

export async function createPagePromptAgentFactory(options?: {
  stateManager?: SessionStateManager
  isFirstPage?: boolean
  useAtlasCrawler?: boolean
}) {
  const factory = createAgentFactory()
  const isFirstPage = options?.isFirstPage ?? true
  const useAtlasCrawler = options?.useAtlasCrawler ?? false

  const stateManager = options?.stateManager || createSessionStateManager({
    defaultAgentId: 'page-prompt'
  })

  const pagePromptConfig = await createPagePromptAgent(isFirstPage, useAtlasCrawler)

  const agents = factory.defineAgents({
    'page-prompt': pagePromptConfig
  })

  return {
    factory,
    agents,
    getAgent: () => agents.get('page-prompt'),
    stateManager
  }
}

export class PagePromptAgent {
  private factory: Awaited<ReturnType<typeof createPagePromptAgentFactory>> | null = null
  private useAtlasCrawler: boolean
  private isFirstPage: boolean

  constructor(options?: { stateManager?: SessionStateManager; isFirstPage?: boolean; useAtlasCrawler?: boolean }) {
    this.isFirstPage = options?.isFirstPage ?? true
    this.useAtlasCrawler = options?.useAtlasCrawler ?? false
  }

  async initialize(): Promise<void> {
    logger.info('page-prompt-agent.initialization.start', { isFirstPage: this.isFirstPage })
    this.factory = await createPagePromptAgentFactory({ isFirstPage: this.isFirstPage, useAtlasCrawler: this.useAtlasCrawler })
    logger.info('page-prompt-agent.initialization.complete', { isFirstPage: this.isFirstPage })
  }

  getAgent() {
    if (!this.factory) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }
    return this.factory.getAgent()
  }

  async generate(
    siteMetadata: SiteMetadata,
    pageContent: PageContent,
    stylePreferences: StylePreferences,
    assetManifest: AssetManifest,
    isFirstPage: boolean = true,
    screenshotBase64?: string
  ): Promise<string> {
    const agent = this.getAgent()

    // Categorize assets by size and type for better recommendations
    const categorizedAssets = this.categorizeAssets(assetManifest.assets)

    const assetsList = assetManifest.assets
      .slice(0, 25)
      .map(a => {
        const publicPath = normalizeAssetPath(a.localPath)

        // Include dimensions and size category
        const dims = a.dimensions
          ? `${a.dimensions.width}x${a.dimensions.height}px`
          : 'unknown size'

        const sizeCategory = this.getSizeCategory(a.dimensions)

        // Alt text is the strongest signal we have for logos and named images
        // (often contains the literal brand name). Surface it before the
        // AI-generated description so the LLM can disambiguate.
        const altNote = a.altText ? ` - alt: "${a.altText}"` : ''
        const compositionNote = a.composition ? ` - COMPOSITION: ${a.composition}` : ''
        const descriptionNote = a.description ? ` - ${a.description}` : ''

        return `- ${publicPath} [${dims}] (${a.type}, ${sizeCategory}${altNote}${compositionNote}${descriptionNote})`
      })
      .join('\n')

    // Include FULL page content for optimization, not just a preview
    // Limit to 4000 chars to avoid token issues, but include much more than before
    const fullContent = pageContent.sanitizedContent.substring(0, 4000)

    // Extract key content sections from the page
    const extractedContent = this.extractKeyContent(pageContent.sanitizedContent)

    // Build color preference instructions (only for first page)
    const colorInstructions = isFirstPage
      ? this.buildColorInstructions(stylePreferences, siteMetadata)
      : ''

    // Build design direction instructions (only for first page)
    const designInstructions = isFirstPage
      ? this.buildDesignInstructions(stylePreferences, siteMetadata)
      : ''

    const siteType = siteMetadata.siteType ?? 'content'
    const siteTypeRules = buildSiteTypeRules(siteType, isFirstPage)

    const patternsBlock = this.buildPatternsBlock(pageContent.structure.interactivePatterns)
    const formsBlock = this.buildFormsBlock(pageContent.structure.forms)
    const navigationBlock = this.buildNavigationBlock(pageContent.structure.navigation)
    const footerNavBlock = isFirstPage
      ? this.buildFooterNavBlock(siteMetadata.footerNavigation)
      : ''
    const contactBlock = isFirstPage && siteMetadata.contact
      ? `\n=== CONTACT INFORMATION (from source site — use ONLY what's listed) ===\n${this.buildContactBlock(siteMetadata.contact)}\n`
      : ''

    const prompt = `Generate a detailed prompt for building this ${isFirstPage ? 'homepage' : 'page'}. Your job is to OPTIMIZE the existing content, not create new content.

SITE TYPE: ${siteType}
${siteTypeRules}

SITE METADATA:
- Purpose: ${siteMetadata.sitePurpose}
- Target Audience: ${siteMetadata.targetAudience}
- Brand Voice: ${siteMetadata.brandVoice}
- Current Design Style: ${siteMetadata.designStyle}
- Current Colors: Primary: ${siteMetadata.colorPalette.primary.join(', ') || 'Not specified'}, Secondary: ${siteMetadata.colorPalette.secondary.join(', ') || 'Not specified'}
- Current Typography: Headings: ${siteMetadata.typography.headingFonts.join(', ') || 'Not specified'}, Body: ${siteMetadata.typography.bodyFonts.join(', ') || 'Not specified'}

STYLE PREFERENCES FROM USER:
- Design Direction: ${stylePreferences.designDirection}
- Color Preference: ${stylePreferences.colorPreference}
- Typography Style: ${stylePreferences.typographyStyle}
- Layout Approach: ${stylePreferences.layoutApproach}

${colorInstructions}

${designInstructions}

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

${isFirstPage ? '5' : '4'}. **IMPORTED ASSETS + STOCK IMAGES** - Prioritize imported images for branding (logo, hero). If the new design needs additional images that weren't in the source (e.g., new sections, decorative backgrounds), instruct the develop agent to search for appropriate stock images.

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

${isFirstPage ? 'Generate a comprehensive, actionable prompt (400-1000 words)' : 'Generate a focused, actionable prompt (300-600 words)'} that enables the develop agent to rebuild this page with the REAL content optimized for the ${isFirstPage ? 'new' : 'existing'} design.`

    const generateArgs: { files?: ProcessedFile[] } = {}

    if (screenshotBase64) {
      const parsed = parseScreenshotDataUrl(screenshotBase64)
      if (parsed) {
        try {
          const fileInput = createFileInputFromBuffer(
            parsed.buffer,
            parsed.mimeType,
            screenshotFilenameForMime(parsed.mimeType)
          )
          const processed = await processFile(fileInput)
          generateArgs.files = [processed]
        } catch (error) {
          logger.warn('page-prompt-agent.screenshot-processing-failed', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    const result = await agent.generate(prompt, generateArgs);

    return result.content;
  }

  /**
   * Extract key content sections from the page
   */
  private extractKeyContent(content: string): string {
    const sections: string[] = []

    // Extract headings and their context
    const headingMatches = content.match(/(?:^|\n)([A-Z][^.!?\n]{5,60})\n/g) || []
    if (headingMatches.length > 0) {
      sections.push('HEADINGS FOUND:')
      headingMatches.slice(0, 10).forEach(h => {
        sections.push(`- "${h.trim()}"`)
      })
    }

    // Hero section content (usually at the beginning)
    const heroMatch = content.substring(0, 800)
    if (heroMatch) {
      sections.push('\nHERO SECTION (first 800 chars):')
      sections.push(heroMatch.trim())
    }

    // Look for feature-like content (sentences with benefit language)
    const featurePatterns = content.match(/(?:^|\n)([^.!?\n]*(?:explore|discover|connect|join|browse|enjoy|gain|experience)[^.!?\n]*[.!?])/gi) || []
    if (featurePatterns.length > 0) {
      sections.push('\nFEATURE/BENEFIT STATEMENTS:')
      featurePatterns.slice(0, 6).forEach(f => {
        sections.push(`- "${f.trim()}"`)
      })
    }

    // Look for CTA-like content
    const ctaPatterns = content.match(/(?:^|\n)([^.!?\n]*(?:shop|join|sign up|get started|learn more|contact|subscribe|buy)[^.!?\n]*[.!?]?)/gi) || []
    if (ctaPatterns.length > 0) {
      sections.push('\nCALL-TO-ACTION TEXT:')
      ctaPatterns.slice(0, 4).forEach(c => {
        sections.push(`- "${c.trim()}"`)
      })
    }

    // Navigation items (links in header area)
    const navMatches = content.match(/\( - [^)]+\)/g) || []
    if (navMatches.length > 0) {
      sections.push('\nNAVIGATION LINKS:')
      navMatches.slice(0, 8).forEach(n => {
        const cleanNav = n.replace(/\( - /g, '').replace(/\)/g, '')
        sections.push(`- ${cleanNav}`)
      })
    }

    // Extract contact information for footer
    const contactInfo: string[] = []

    // Remove URLs from content before extracting phone numbers to avoid false matches
    // (e.g., Facebook group IDs like facebook.com/groups/2915198541841275)
    const contentWithoutUrls = content.replace(/https?:\/\/[^\s]+/g, '')

    /**
     * US phone number regex pattern
     * Matches formats:
     * - (555) 123-4567
     * - 555-123-4567
     * - 555.123.4567
     * - +1-555-123-4567
     * - +1 (555) 123-4567
     *
     * Uses word boundaries (\b) to prevent matching:
     * - Numbers within longer numeric sequences
     * - IDs or codes that happen to contain 10 digits
     */
    const US_PHONE_NUMBER_PATTERN = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g

    const phonePatterns = contentWithoutUrls.match(US_PHONE_NUMBER_PATTERN) || []
    if (phonePatterns.length > 0) {
      const uniquePhones = [...new Set(phonePatterns)]
      uniquePhones.slice(0, 3).forEach(p => {
        contactInfo.push(`Phone: ${p.trim()}`)
      })
    }

    // Email addresses
    const emailPatterns = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
    if (emailPatterns.length > 0) {
      const uniqueEmails = [...new Set(emailPatterns)]
      uniqueEmails.slice(0, 3).forEach(e => {
        contactInfo.push(`Email: ${e.trim()}`)
      })
    }

    // Physical addresses (look for common patterns)
    const addressPatterns = content.match(/\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Court|Ct)[.,]?\s*(?:[A-Za-z\s]+,?\s*)?(?:[A-Z]{2}\s*)?\d{5}(?:-\d{4})?/gi) || []
    if (addressPatterns.length > 0) {
      addressPatterns.slice(0, 2).forEach(a => {
        contactInfo.push(`Address: ${a.trim()}`)
      })
    }

    // City, State ZIP pattern (backup for addresses)
    // Use bounded quantifiers to prevent ReDoS vulnerability
    if (addressPatterns.length === 0) {
      const cityStateZip = content.match(/[A-Z][a-z]{1,20}(?:\s[A-Z][a-z]{1,20}){0,3},?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/g) || []
      if (cityStateZip.length > 0) {
        cityStateZip.slice(0, 2).forEach(a => {
          contactInfo.push(`Location: ${a.trim()}`)
        })
      }
    }

    // Social media handles/links
    const socialPatterns = content.match(/(?:facebook|twitter|instagram|linkedin|youtube|tiktok)\.com\/[a-zA-Z0-9._-]+/gi) || []
    if (socialPatterns.length > 0) {
      contactInfo.push('Social Media:')
      const uniqueSocial = [...new Set(socialPatterns)]
      uniqueSocial.slice(0, 5).forEach(s => {
        contactInfo.push(`  - ${s}`)
      })
    }

    // Hours of operation
    const hoursPatterns = content.match(/(?:hours|open|mon|tue|wed|thu|fri|sat|sun)[^.!?\n]*(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))[^.!?\n]*/gi) || []
    if (hoursPatterns.length > 0) {
      contactInfo.push('Hours:')
      hoursPatterns.slice(0, 3).forEach(h => {
        contactInfo.push(`  - ${h.trim()}`)
      })
    }

    if (contactInfo.length > 0) {
      sections.push('\nCONTACT INFORMATION (for footer):')
      contactInfo.forEach(c => sections.push(`- ${c}`))
    }

    // Footer content (look at the end of the page)
    const footerContent = content.slice(-1500)
    if (footerContent && footerContent !== content.substring(0, 800)) {
      sections.push('\nFOOTER SECTION (last 1500 chars):')
      sections.push(footerContent.trim())
    }

    return sections.join('\n')
  }

  /**
   * Build color instructions based on user preference
   */
  private buildColorInstructions(prefs: StylePreferences, metadata: SiteMetadata): string {
    if (prefs.colorPreference === 'keep-original') {
      // Airo decides - provide guidance for the LLM to pick colors
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
"Use [color name] (#hexcode) as the primary color with [accent color] (#hexcode) for buttons and highlights."`
    }

    if (prefs.colorPreference === 'suggest-new') {
      return `COLOR DIRECTION (Fresh Color Scheme):
The user wants a new color scheme. Choose colors that differ from the original but still fit the brand.
Original colors were: ${metadata.colorPalette.primary.join(', ') || 'not detected'}
Pick fresh, distinctive colors that match the ${metadata.brandVoice} brand voice.`
    }

    if (prefs.colorPreference === 'custom' && prefs.customColors) {
      return `COLOR DIRECTION (Custom Colors):
Use the user's specified colors:
- Primary: ${prefs.customColors.primary || 'not specified'}
- Secondary: ${prefs.customColors.secondary || 'not specified'}
- Accent: ${prefs.customColors.accent || 'not specified'}`
    }

    return ''
  }

  /**
   * Build design direction instructions
   */
  private buildDesignInstructions(prefs: StylePreferences, metadata: SiteMetadata): string {
    if (prefs.designDirection === 'keep-similar') {
      // Airo decides - include full design redesign guidance
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
- Maintain energy and intentionality throughout`
    }

    if (prefs.designDirection === 'modernize') {
      return `DESIGN DIRECTION (Modernize):
Update the design with contemporary patterns while maintaining brand recognition.
- Use modern typography trends
- Update spacing and whitespace
- Contemporary UI patterns and interactions
- Fresher visual hierarchy`
    }

    if (prefs.designDirection === 'simplify') {
      return `DESIGN DIRECTION (Simplify):
Create a cleaner, more minimal design.
- Reduce visual clutter
- Increase whitespace
- Simpler color palette
- Focus on essential content
- Improved readability`
    }

    if (prefs.designDirection === 'bold') {
      return `DESIGN DIRECTION (Bold):
Create a striking, attention-grabbing design.
- Strong visual hierarchy
- Bold typography choices
- Vibrant colors
- Dramatic layouts
- High contrast elements`
    }

    return ''
  }

  private buildPatternsBlock(patterns: PageContent['structure']['interactivePatterns']): string {
    if (!patterns || patterns.length === 0) return ''
    const lines = patterns.map(
      p => `- ${p.type} (${p.occurrences} match${p.occurrences === 1 ? '' : 'es'}; evidence: \`${p.evidence}\`)`
    )
    return `\n=== DETECTED INTERACTIVE PATTERNS (from source HTML — preserve in the rebuild) ===\n${lines.join('\n')}\n`
  }

  private buildFormsBlock(forms: PageContent['structure']['forms']): string {
    if (!forms || forms.length === 0) return ''
    const blocks = forms.map((f, i) => {
      const action = f.action ?? '(no action — scaffold a stub handler)'
      const fieldLines = f.fields.map(field => {
        const parts = [`    - ${field.type}`]
        if (field.name) parts.push(` name="${field.name}"`)
        if (field.label) parts.push(` label="${field.label}"`)
        if (field.placeholder) parts.push(` placeholder="${field.placeholder}"`)
        if (field.required) parts.push(' (required)')
        if (field.options && field.options.length > 0) {
          parts.push(` options=[${field.options.slice(0, 5).join(', ')}]`)
        }
        return parts.join('')
      })
      const submit = f.submitButton ? `\n  Submit button: "${f.submitButton.text}"` : ''
      return `Form ${i + 1}: ${f.method.toUpperCase()} ${action}\n  Fields:\n${fieldLines.join('\n')}${submit}`
    })
    return `\n=== DETECTED FORMS (from source HTML — preserve as real <form> elements with these exact fields) ===\n${blocks.join('\n\n')}\n`
  }

  private buildNavigationBlock(navigation: PageContent['structure']['navigation']): string {
    if (navigation.length === 0) return ''
    const lines = navigation.map(
      n => `- "${n.label}" → ${n.url}${n.isExternal ? ' (EXTERNAL — keep full URL, open in new tab)' : ''}`
    )
    return `\n=== HEADER NAVIGATION (use EXACT paths and URLs) ===\n${lines.join('\n')}\n
**CRITICAL: Use the exact URL paths above for navigation links. Do NOT rename or simplify paths (e.g., if the source has "/about-us", use "/about-us", NOT "/about").**
- External links should be implemented with target="_blank" rel="noopener noreferrer"
- Only the homepage is being built right now. The other paths will be built later when the user picks them from the rebuild page selector — leaving them unrouted (so they fall through to the 404 page) is the correct behavior for this turn.
`
  }

  private buildFooterNavBlock(footerNav: NavigationItem[] | undefined): string {
    if (!footerNav || footerNav.length === 0) return ''
    const lines = footerNav.map(
      n => `- "${n.label}" → ${n.url}${n.isExternal ? ' (external)' : ''}`
    )
    return `\n=== FOOTER NAVIGATION (separate set of links for the site footer) ===\n${lines.join('\n')}\n`
  }

  /**
   * Render the source-extracted contact info as prompt-friendly bullets.
   * Atlas (or whichever extractor) is the source of truth — we only surface
   * fields that were actually present.
   */
  private buildContactBlock(contact: SiteContactInfo): string {
    const lines: string[] = []

    if (contact.phones?.length) {
      const phones = contact.phones
        .map(p => `${p.number}${p.type ? ` (${p.type})` : ''}`)
        .join(', ')
      lines.push(`- Phone: ${phones}`)
    }
    if (contact.emails?.length) {
      const emails = contact.emails
        .map(e => `${e.address}${e.type ? ` (${e.type})` : ''}`)
        .join(', ')
      lines.push(`- Email: ${emails}`)
    }
    if (contact.addresses?.length) {
      for (const a of contact.addresses) {
        lines.push(`- Address: ${a.formatted}`)
      }
    }
    if (contact.hours?.length) {
      lines.push('- Hours:')
      for (const h of contact.hours) {
        const isClosed = h.open === '00:00' && h.close === '00:00'
        lines.push(`    ${h.day}: ${isClosed ? 'Closed' : `${h.open}–${h.close}`}`)
      }
    }
    if (contact.social?.length) {
      lines.push('- Social:')
      for (const s of contact.social) {
        lines.push(`    ${s.platform}: ${s.url}`)
      }
    }

    return lines.length > 0 ? lines.join('\n') : '(no contact info extracted)'
  }

  /**
   * Get size category for an image based on dimensions
   */
  private getSizeCategory(dimensions?: { width: number; height: number }): string {
    if (!dimensions) return 'unknown-size'

    const maxDim = Math.max(dimensions.width, dimensions.height)
    const minDim = Math.min(dimensions.width, dimensions.height)

    // Detect likely logos (roughly square or horizontal, medium size)
    const aspectRatio = dimensions.width / dimensions.height
    const isLogoLike = minDim >= 50 && minDim <= 400 && aspectRatio >= 0.5 && aspectRatio <= 3

    if (maxDim < 50) return 'tiny-icon'
    if (maxDim < 100) return 'small-icon'
    if (maxDim < 300) {
      if (isLogoLike && minDim >= 80) return 'logo-suitable'
      return 'small'
    }
    if (maxDim < 600) {
      if (isLogoLike) return 'logo-suitable'
      return 'medium'
    }
    if (maxDim < 1000) return 'large'
    return 'hero-suitable'
  }

  /**
   * Categorize assets by their recommended use
   */
  private categorizeAssets(assets: AssetInfo[]): string {
    const heroImages: string[] = []
    const logoImages: string[] = []
    const featureImages: string[] = []
    const smallImages: string[] = []
    const unknownImages: string[] = []

    for (const asset of assets.slice(0, 30)) {
      const publicPath = normalizeAssetPath(asset.localPath)

      const dims = asset.dimensions
        ? `${asset.dimensions.width}x${asset.dimensions.height}`
        : '?x?'

      // Alt text first — it's the strongest disambiguator for logos and named
      // images. AI-generated description (from vision pass) comes after.
      const alt = asset.altText ? ` alt:"${asset.altText}"` : ''
      const desc = asset.description ? ` - ${asset.description.substring(0, 50)}` : ''
      const entry = `${publicPath} [${dims}]${alt}${desc}`

      if (!asset.dimensions) {
        unknownImages.push(entry)
        continue
      }

      const maxDim = Math.max(asset.dimensions.width, asset.dimensions.height)
      const minDim = Math.min(asset.dimensions.width, asset.dimensions.height)
      const aspectRatio = asset.dimensions.width / asset.dimensions.height

      // Check for logo-like images
      const isLogoLike = minDim >= 50 && minDim <= 400 && aspectRatio >= 0.3 && aspectRatio <= 4

      if (maxDim >= 800) {
        heroImages.push(entry)
      } else if (isLogoLike && minDim >= 80 && maxDim <= 500) {
        logoImages.push(entry)
      } else if (maxDim >= 300) {
        featureImages.push(entry)
      } else {
        smallImages.push(entry)
      }
    }

    // Build output string
    const output: string[] = []

    if (heroImages.length > 0) {
      output.push('\n**Hero/Banner Images (800px+):**')
      heroImages.slice(0, 5).forEach(item => output.push(`  - ${item}`))
      if (heroImages.length > 5) output.push(`  ... and ${heroImages.length - 5} more`)
    }

    if (logoImages.length > 0) {
      output.push('\n**Logo Candidates (100-400px, good proportions):**')
      logoImages.slice(0, 5).forEach(item => output.push(`  - ${item}`))
      if (logoImages.length > 5) output.push(`  ... and ${logoImages.length - 5} more`)
    }

    if (featureImages.length > 0) {
      output.push('\n**Feature Images (300-800px):**')
      featureImages.slice(0, 5).forEach(item => output.push(`  - ${item}`))
      if (featureImages.length > 5) output.push(`  ... and ${featureImages.length - 5} more`)
    }

    if (smallImages.length > 0) {
      output.push('\n**Small Images/Icons (<300px):**')
      smallImages.slice(0, 5).forEach(item => output.push(`  - ${item}`))
      if (smallImages.length > 5) output.push(`  ... and ${smallImages.length - 5} more`)
    }

    if (unknownImages.length > 0) {
      output.push('\n**Unknown Size:**')
      unknownImages.slice(0, 3).forEach(item => output.push(`  - ${item}`))
      if (unknownImages.length > 3) output.push(`  ... and ${unknownImages.length - 3} more`)
    }

    return output.join('\n')
  }

  async cleanup(): Promise<void> {
    logger.info('page-prompt-agent.cleanup.complete', {})
  }
}
