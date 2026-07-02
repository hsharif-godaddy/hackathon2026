/**
 * getSiteBusinessInfo — Google Business Profile sync skill
 *
 * Reads the live site's business info (name, address, phone, hours, website) so
 * it can be compared against the GBP listing. Runs entirely agent-side.
 *
 * **Source-first**, mirroring the SEO/AEO audit (`seo-audit.ts`): it reads the
 * app's own source via the workspace files client — the SAME path the gbp-to-site
 * sync uses to edit the source — rather than fetching a rendered URL through the
 * external web-scraper. That matters for the customer experience: the audit works
 * on the **unpublished, in-progress preview** (no publish required) and on local
 * dev, because the source is always reachable to the co-located agent. The
 * business-info values live in the source (footer/contact/JSON-LD), which the
 * write path already relies on.
 *
 * Extraction reuses the shared helpers:
 * - parseJsonLdBlocks + flattenSchemaNodes → a LocalBusiness/Organization node
 *   (present when the template emits a literal JSON-LD <script>).
 * - extractKeyContent → a labeled text blob (Phone/Address/Hours) for the
 *   diff step's free-text / LLM-equivalence path.
 */

import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import type { AgentsAppContext } from '../../../types/agents-app-context.js';
import { createForWorkspace } from '../../../workspace/index.js';
import { parseJsonLdBlocks, flattenSchemaNodes } from '../../../services/aeo-structure-validator.js';
import { extractKeyContent } from '../../../agents/page-prompt/extract-key-content.js';
import { Logger } from '../../../logging/index.js';

const logger = Logger.create({ component: 'google-business-profile-sync-skill' });

/** Source globs scanned for business info (mirrors the gbp-to-site write path). */
const SOURCE_INCLUDE_GLOBS = ['**/*.tsx', '**/*.ts', '**/*.jsx', '**/*.js', '**/*.json', '**/*.html'];
const SOURCE_EXCLUDE_GLOBS = ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/build/**'];

/** Signals that a source file likely carries business info — used to narrow the read. */
const BUSINESS_INFO_PATTERNS = [
  'application/ld\\+json',
  '\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}', // US phone
  '(?i)(hours|address|tel:|mailto:)',
  'name=["\']description["\']', // <meta name="description">
];

/** Pull the <meta name="description"> content (either attribute order) from raw source. */
function extractMetaDescription(html: string): string | null {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

/** Cap on files read+concatenated for extraction (business info clusters in a few files). */
const MAX_SOURCE_FILES = 15;

/**
 * Business fields lifted from a site's LocalBusiness/Organization JSON-LD node.
 * `address` and `openingHours` are passed through as-authored — the diff step
 * normalizes them.
 */
export interface SiteJsonLdBusiness {
  name?: string;
  telephone?: string;
  url?: string;
  description?: string;
  address?: unknown;
  openingHours?: unknown;
}

export interface SiteBusinessInfo {
  /** Always 'source' — the read comes from the app source tree, not a rendered URL. */
  source: 'source';
  jsonLd: SiteJsonLdBusiness | null;
  textBlob: string;
  filesScanned: string[];
}

/** Result of the agent-side site read. Shared by the getSiteBusinessInfo tool and the diff step. */
export type ReadSiteResult = ({ ok: true } & SiteBusinessInfo) | { ok: false; error: string };

type GetSiteBusinessInfoOutput =
  | { success: false; error: string }
  | ({ success: true } & SiteBusinessInfo);

type SchemaNode = ReturnType<typeof flattenSchemaNodes>[number];

/**
 * Build the site's business info from JSON-LD. Picks the primary node (name +
 * address/phone, else any node with contact/hours), then GAP-FILLS each missing
 * field from the first other node that has it — templates routinely split an
 * Organization (name/url) and a LocalBusiness (address/phone/hours) across two
 * nodes, and taking only the first match would silently drop the other's fields.
 */
function extractBusinessNode(text: string): SiteJsonLdBusiness | null {
  const nodes = flattenSchemaNodes(parseJsonLdBlocks(text));

  const primary =
    nodes.find(
      (n) => typeof n.name === 'string' && (n.address !== undefined || n.telephone !== undefined)
    ) ??
    nodes.find(
      (n) =>
        n.address !== undefined ||
        n.telephone !== undefined ||
        n.openingHoursSpecification !== undefined
    );

  if (!primary) {
    return null;
  }

  // Keep the primary node's value for a field; otherwise borrow from any node that has it.
  const fill = <T>(primaryValue: T | undefined, get: (n: SchemaNode) => T | undefined): T | undefined => {
    if (primaryValue !== undefined && primaryValue !== '') {
      return primaryValue;
    }
    for (const n of nodes) {
      const value = get(n);
      if (value !== undefined && value !== '') {
        return value;
      }
    }
    return undefined;
  };

  const stringField = (n: SchemaNode, key: 'name' | 'telephone' | 'url' | 'description'): string | undefined =>
    typeof n[key] === 'string' ? (n[key] as string) : undefined;

  if (nodes.length > 1) {
    logger.info('google-business-profile-sync.getSiteBusinessInfo.multiple-jsonld-nodes', { nodeCount: nodes.length });
  }

  return {
    name: stringField(primary, 'name'),
    telephone: fill(stringField(primary, 'telephone'), (n) => stringField(n, 'telephone')),
    url: fill(stringField(primary, 'url'), (n) => stringField(n, 'url')),
    description: fill(stringField(primary, 'description'), (n) => stringField(n, 'description')),
    address: fill(primary.address, (n) => n.address),
    openingHours: fill(primary.openingHoursSpecification ?? primary.openingHours, (n) => n.openingHoursSpecification ?? n.openingHours),
  };
}

/**
 * Agent-side site read (source-first). Locates business-info-bearing source files
 * via the workspace files client, concatenates them, and extracts JSON-LD + a
 * text-blob fallback. Shared by the getSiteBusinessInfo tool and the diff step
 * (so the diff self-reads the site instead of the model threading it as a param).
 */
export async function readSiteBusinessInfo(appId: string): Promise<ReadSiteResult> {
  const files = createForWorkspace(appId, 'preview')?.files;
  if (!files) {
    logger.warn('google-business-profile-sync.getSiteBusinessInfo.no-workspace', { appId });
    return { ok: false, error: `Workspace for app '${appId}' is not available.` };
  }

  const paths = new Set<string>();
  for (const pattern of BUSINESS_INFO_PATTERNS) {
    try {
      const matches = await files.search({
        pattern,
        includeGlobs: SOURCE_INCLUDE_GLOBS,
        excludeGlobs: SOURCE_EXCLUDE_GLOBS,
        maxResults: 100,
      });
      for (const match of matches) {
        paths.add(match.path);
      }
    } catch (err: unknown) {
      logger.warn('google-business-profile-sync.getSiteBusinessInfo.search-failed', {
        appId,
        pattern,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (paths.size === 0) {
    // The site carries no business info yet (new/sparse site). This is NOT an error:
    // return an empty read so the diff surfaces every GBP field as `gbp-only`
    // ("Google has it, your site doesn't") and the agent can offer to add it to the
    // site, rather than dead-ending. (A genuinely unavailable workspace above stays ok:false.)
    logger.info('google-business-profile-sync.getSiteBusinessInfo.no-business-info', { appId });
    return { ok: true, source: 'source', jsonLd: null, textBlob: '', filesScanned: [] };
  }

  // Sort for deterministic truncation (Set order is regex-match order across patterns).
  const matchedPaths = [...paths].sort();
  if (matchedPaths.length > MAX_SOURCE_FILES) {
    logger.warn('google-business-profile-sync.getSiteBusinessInfo.truncated', {
      appId,
      matched: matchedPaths.length,
      scanned: MAX_SOURCE_FILES,
      dropped: matchedPaths.slice(MAX_SOURCE_FILES),
    });
  }
  const filesScanned = matchedPaths.slice(0, MAX_SOURCE_FILES);
  let combined = '';
  for (const path of filesScanned) {
    try {
      const text: string = await files.readText({ path });
      combined += `\n${text}`;
    } catch (err: unknown) {
      logger.warn('google-business-profile-sync.getSiteBusinessInfo.view-failed', {
        appId,
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const jsonLd = extractBusinessNode(combined);
  let textBlob = extractKeyContent(combined);
  // Fall back to the <meta name="description"> as the site description when JSON-LD has
  // none (surfaced as a labeled blob line the diff's free-text path can read).
  if (!jsonLd?.description) {
    const metaDescription = extractMetaDescription(combined);
    if (metaDescription) {
      textBlob += `\nDescription: ${metaDescription}`;
    }
  }

  logger.info('google-business-profile-sync.getSiteBusinessInfo.read', {
    appId,
    filesScanned: filesScanned.length,
    hasJsonLd: jsonLd !== null,
  });

  return { ok: true, source: 'source', jsonLd, textBlob, filesScanned };
}

export const getSiteBusinessInfoTool: SkillToolDefinition = {
  name: 'getSiteBusinessInfo',
  description:
    "Read the live site's business info (name, address, phone, hours, website) from " +
    'the app source — works on the unpublished preview, no publish required. ' +
    'Agent-side. Optional: diffBusinessInfo reads the site itself; use this only to ' +
    "show the user their site's values on their own.",

  parameters: z.object({}),

  async execute(_input, context) {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

    if (!appId) {
      logger.error('google-business-profile-sync.getSiteBusinessInfo.missing-app-id', {});
      return { success: false, error: 'App ID is required' };
    }

    const result = await readSiteBusinessInfo(appId);
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    const { source, jsonLd, textBlob, filesScanned } = result;
    return { success: true, source, jsonLd, textBlob, filesScanned };
  },

  computeState(_input: unknown, output: GetSiteBusinessInfoOutput) {
    if ('error' in output) {
      return {
        workflowState: 'site-read-failed',
        lastError: output.error,
        nextStep: 'retry-site-read',
        updatedAt: new Date().toISOString(),
      };
    }

    if (output.success) {
      return {
        workflowState: 'site-info-read',
        nextStep: 'diff-business-info',
        siteSource: output.source,
        hasJsonLd: output.jsonLd !== null,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    return null;
  },
};
