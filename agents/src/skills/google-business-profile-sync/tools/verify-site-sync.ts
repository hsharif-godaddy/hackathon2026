/**
 * verifySiteSync — Google Business Profile sync skill
 *
 * After a gbp-to-site edit, confirms the new value actually propagated to the
 * site by polling the preview URL (the dev container auto-rebuilds, so the value
 * should appear within seconds). Agent-side only.
 *
 * - Re-scrapes `app.previewUrl` up to `timeoutMs` (default 15s), checking the
 *   scraped content for the expected value (phone compared by digits; other
 *   fields by case-insensitive substring).
 * - On success: { ok: true, attempts }.
 * - On timeout: { ok: false, attempts } and, when `previousValue` is given,
 *   a source search for leftover occurrences so the agent can surface exactly
 *   which files still hold the old value for a second pass.
 */

import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import type { AgentsAppContext } from '../../../types/agents-app-context.js';
import { appRepository } from '../../../database/repositories/index.js';
import { createForWorkspace } from '../../../workspace/index.js';
import { WebsiteScraperDriver } from '../../../tools/ai-lib-tools/drivers/website-scraper-driver.js';
import { Logger } from '../../../logging/index.js';

const logger = Logger.create({ component: 'google-business-profile-sync-skill' });
const scraper = new WebsiteScraperDriver();

const DEFAULT_POLL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 15000;

const SOURCE_INCLUDE_GLOBS = ['**/*.tsx', '**/*.ts', '**/*.jsx', '**/*.js', '**/*.json', '**/*.html'];
const SOURCE_EXCLUDE_GLOBS = ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/build/**'];

type VerifyField = 'name' | 'phone' | 'address' | 'hours' | 'website' | 'description';

type VerifySiteSyncOutput =
  | { success: false; error: string }
  | { success: true; ok: true; field: VerifyField; attempts: number; sourceUrl?: string; verifiedVia: 'preview' | 'source' }
  | { success: true; ok: false; field: VerifyField; attempts: number; sourceUrl?: string; leftoverFiles: string[] };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reduce a phone to its comparable digits (last 10, dropping a US country code). */
function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** Does the scraped page contain the expected value? Phone compares digits; others substring. */
function contentContainsValue(content: string, field: VerifyField, expectedValue: string): boolean {
  if (field === 'phone') {
    const wanted = phoneDigits(expectedValue);
    return wanted.length > 0 && content.replace(/\D/g, '').includes(wanted);
  }
  return content.toLowerCase().includes(expectedValue.trim().toLowerCase());
}

export const verifySiteSyncTool: SkillToolDefinition = {
  name: 'verifySiteSync',
  description:
    'Confirm that a gbp-to-site edit propagated to the live preview. ONLY call this ' +
    'AFTER syncField has edited the site (direction gbp-to-site), passing the field ' +
    'and the expected new value — it polls the preview for that value, falling back ' +
    'to the source (the edit applied if no file still holds the old value) when the ' +
    'preview cannot be reached, and reports leftover files if the old value remains. ' +
    'Do NOT use this to check whether the site matches GBP or to find differences — ' +
    'that is diffBusinessInfo. Requires { field, expectedValue }.',

  parameters: z.object({
    field: z.enum(['name', 'phone', 'address', 'hours', 'website', 'description']),
    expectedValue: z.string(),
    previousValue: z.string().optional(),
    pollMs: z.number().optional(),
    timeoutMs: z.number().optional(),
  }),

  async execute(input, context) {
    const { field, expectedValue, previousValue, pollMs, timeoutMs } = input as {
      field: VerifyField;
      expectedValue: string;
      previousValue?: string;
      pollMs?: number;
      timeoutMs?: number;
    };
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

    if (!appId) {
      logger.error('google-business-profile-sync.verifySiteSync.missing-app-id', {});
      return { success: false, error: 'App ID is required' };
    }

    const app = appRepository.findById(appId);
    // Prefer the warm preview; fall back to the published URL. Either may be absent
    // for an unpublished app with no running preview container — in that case skip
    // the rendered-page poll entirely and let the source check below be the authority
    // (the whole point of the source-first design).
    const previewUrl = app?.previewUrl ?? app?.publishedUrl;
    if (!previewUrl) {
      logger.info('google-business-profile-sync.verifySiteSync.no-preview-url', { appId, field });
    }

    const poll = pollMs ?? DEFAULT_POLL_MS;
    const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();
    let attempts = 0;

    while (previewUrl && Date.now() - start < timeout) {
      // Wait before each scrape (including the first) — the dev container needs a
      // moment to rebuild after the edit, so an immediate scrape just burns an attempt.
      await sleep(poll);
      if (Date.now() - start >= timeout) {
        break;
      }
      attempts += 1;
      try {
        const scrape = await scraper.scrapeAndScreenshot({ url: previewUrl });
        if (scrape.success) {
          const haystack = `${scrape.sanitizedContent ?? ''}\n${scrape.html ?? ''}`;
          if (contentContainsValue(haystack, field, expectedValue)) {
            logger.info('google-business-profile-sync.verifySiteSync.verified', { appId, field, attempts });
            return { success: true, ok: true, field, attempts, sourceUrl: previewUrl, verifiedVia: 'preview' };
          }
        }
      } catch (err: unknown) {
        logger.warn('google-business-profile-sync.verifySiteSync.scrape-error', {
          appId,
          field,
          attempts,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // No URL to scrape, or the scraper couldn't confirm (preview unreachable/auth-gated/
    // slow — the same reason getSiteBusinessInfo reads source-first). Use the source as
    // the source of truth. To match the preview path's "new value present" check (not just
    // "old value gone"), require BOTH: no file still holds the old value AND at least
    // one file now holds the new value — so a mangled replace or a stray line deletion
    // isn't mistaken for a successful sync.
    let leftoverFiles: string[] = [];
    let newValuePresent = false;
    const files = previousValue ? createForWorkspace(appId, 'preview')?.files : undefined;
    if (files && previousValue) {
      try {
        const oldMatches = await files.search({
          pattern: escapeRegex(previousValue),
          includeGlobs: SOURCE_INCLUDE_GLOBS,
          excludeGlobs: SOURCE_EXCLUDE_GLOBS,
        });
        leftoverFiles = [...new Set(oldMatches.map((m) => m.path))];
        if (leftoverFiles.length === 0) {
          const newMatches = await files.search({
            pattern: escapeRegex(expectedValue),
            includeGlobs: SOURCE_INCLUDE_GLOBS,
            excludeGlobs: SOURCE_EXCLUDE_GLOBS,
          });
          newValuePresent = newMatches.length > 0;
        }
      } catch (err: unknown) {
        logger.warn('google-business-profile-sync.verifySiteSync.source-search-error', {
          appId,
          field,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (leftoverFiles.length === 0 && newValuePresent) {
      // Old value gone everywhere AND the new value is present → the edit applied,
      // even though the rendered preview never confirmed it.
      logger.info('google-business-profile-sync.verifySiteSync.verified-via-source', { appId, field, attempts });
      return { success: true, ok: true, field, attempts, sourceUrl: previewUrl, verifiedVia: 'source' };
    }

    logger.info('google-business-profile-sync.verifySiteSync.not-verified', { appId, field, attempts, leftoverFiles });
    return { success: true, ok: false, field, attempts, sourceUrl: previewUrl, leftoverFiles };
  },

  computeState(_input: unknown, output: VerifySiteSyncOutput) {
    if ('error' in output) {
      return {
        workflowState: 'site-verify-failed',
        lastError: output.error,
        nextStep: 'retry-verify',
        updatedAt: new Date().toISOString(),
      };
    }

    if (output.ok) {
      return {
        workflowState: 'site-verified',
        verifiedField: output.field,
        nextStep: 'sync-next-field',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      workflowState: 'site-verify-incomplete',
      verifiedField: output.field,
      leftoverCount: output.leftoverFiles.length,
      nextStep: 'report-leftovers',
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
  },
};
