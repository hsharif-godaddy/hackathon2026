/**
 * syncField — Google Business Profile sync skill
 *
 * Applies a single user-approved field sync in one direction. Two directions:
 *
 * - `site-to-gbp` (this phase): writes the value to the GBP listing via the
 *   two-pass client-action round-trip — pass 1 emits an `updateGbp` signal with
 *   the field + GBP-shaped updates; the frontend GbpSyncToolRenderer calls
 *   SocialV2Client.updateGoogleBusinessProfile and posts a GBP_UPDATE_DONE
 *   attachment; pass 2 reads it and reports success/error.
 * - `gbp-to-site`: replaces the current site value (`previousValue`) with the
 *   GBP value (`value`) across the app source via the workspace search+edit
 *   primitives. Follow with verifySiteSync to confirm the preview picked it up.
 *
 * The `value` is the value to write: a string for name/phone/website, or the
 * GBP-shaped structured object for address (storefrontAddress) / hours
 * (regularHours). The agent is responsible for shaping address/hours to GBP's
 * form before calling.
 */

import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import type { AgentsAppContext } from '../../../types/agents-app-context.js';
import type { ContextAttachment } from '@airo/shared/context-attachment';
import { SocialPlatform, GBP_UPDATE_DONE } from '../../../types/social.js';
import { SocialAssociationRepository } from '../../../database/repositories/SocialAssociationRepository.js';
import { createForWorkspace } from '../../../workspace/index.js';
import { Logger } from '../../../logging/index.js';

const logger = Logger.create({ component: 'google-business-profile-sync-skill' });
const socialAssociationRepo = new SocialAssociationRepository();

/** Source globs searched for occurrences of the value being replaced. */
const SOURCE_INCLUDE_GLOBS = ['**/*.tsx', '**/*.ts', '**/*.jsx', '**/*.js', '**/*.json', '**/*.html'];
const SOURCE_EXCLUDE_GLOBS = ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/build/**'];

/** Above these, a gbp-to-site replace is wide enough to be worth flagging (generic value?). */
const HIGH_OCCURRENCE_THRESHOLD = 10;
const HIGH_FILE_THRESHOLD = 5;
/**
 * A replacement target this short (or shorter) is too generic for a blind replaceAll —
 * e.g. a 2-letter state code or a short business name can appear inside unrelated words
 * and CSS/identifiers. Any match of a short value is previewed for confirmation first,
 * regardless of how few files it touches.
 */
const SHORT_VALUE_MAX_LEN = 4;
/**
 * Characters that would corrupt the app source if written verbatim by the gbp-to-site
 * replaceAll: JSX/HTML angle brackets, JS/JSX braces (and `${` template syntax), and
 * backticks. A GBP value containing these is refused rather than silently breaking the
 * build (the value comes from the listing, not a trusted author).
 */
const UNSAFE_SOURCE_VALUE = /[<>{}`]/;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type SyncField = 'name' | 'phone' | 'address' | 'hours' | 'website' | 'description';
type SyncDirection = 'site-to-gbp' | 'gbp-to-site';

/** GBP update payload (GoogleBusinessProfile field names; mapped to GBP paths in the client). */
type GbpUpdates = Record<string, unknown>;

interface GbpUpdateDoneData {
  field?: string;
  updated: string[];
  error?: string;
}

type SyncFieldOutput =
  | { success: false; error: string; needsReconnect?: boolean; notImplemented?: boolean }
  | { action: 'updateGbp'; success: true; socialId: string; field: SyncField; updates: GbpUpdates }
  | { success: true; field: SyncField; updated: string[] }
  | { success: true; field: SyncField; direction: 'gbp-to-site'; noChange: true }
  | { success: true; field: SyncField; direction: 'gbp-to-site'; needsConfirmation: true; matchedFiles: string[]; occurrences: number }
  | { success: true; field: SyncField; direction: 'gbp-to-site'; editedFiles: string[]; occurrences: number; widespread: boolean };

/**
 * gbp-to-site: replace the current site value with the GBP value across the
 * app source via the standard workspace edit primitives (search to locate,
 * edit to replace). `value` is the new display text; `previousValue` is the
 * current site text to find. verify-site-sync confirms propagation afterwards.
 *
 * The edit is a literal replaceAll, so a value that matches widely (a short/generic
 * string) can clobber unrelated text. When the pre-edit match set is wide and the
 * caller hasn't passed `apply`, return a preview (needsConfirmation) WITHOUT editing
 * so the user approves first.
 */
async function syncGbpToSite(
  appId: string,
  field: SyncField,
  value: unknown,
  previousValue: string | undefined,
  apply: boolean
): Promise<SyncFieldOutput> {
  if (typeof value !== 'string') {
    return { success: false, error: 'The site edit requires a string value (the new text to write).' };
  }
  if (!previousValue) {
    return {
      success: false,
      error: 'previousValue (the current site text to replace) is required for a gbp-to-site sync.',
    };
  }
  if (previousValue === value) {
    // Already in sync — nothing to edit, and no need to verify.
    return { success: true, field, direction: 'gbp-to-site', noChange: true };
  }
  if (UNSAFE_SOURCE_VALUE.test(value)) {
    logger.warn('google-business-profile-sync.syncField.unsafe-source-value', { appId, field });
    return {
      success: false,
      error:
        'The Google value contains characters (< > { } or `) that would corrupt the site source if ' +
        'written into a code file. Edit this field on the site manually instead of syncing it.',
    };
  }

  const files = createForWorkspace(appId, 'preview')?.files;
  if (!files) {
    return { success: false, error: `Workspace for app '${appId}' is not available.` };
  }

  const matches = await files.search({
    pattern: escapeRegex(previousValue),
    includeGlobs: SOURCE_INCLUDE_GLOBS,
    excludeGlobs: SOURCE_EXCLUDE_GLOBS,
  });
  const matchedFiles = [...new Set(matches.map((m) => m.path))];
  // A short value is risky even when it matches in only one or two files, so treat any
  // match of it as "widespread" for confirmation purposes.
  const isShortValue = previousValue.trim().length <= SHORT_VALUE_MAX_LEN;
  const widespread =
    matches.length > HIGH_OCCURRENCE_THRESHOLD ||
    matchedFiles.length > HIGH_FILE_THRESHOLD ||
    (isShortValue && matches.length > 0);

  // Wide match set (or a too-short value) + not yet approved → preview without mutating.
  // The user confirms, then the skill re-calls with apply:true.
  if (widespread && !apply) {
    logger.warn('google-business-profile-sync.syncField.wide-edit-preview', {
      appId,
      field,
      matchedFiles,
      matchCount: matches.length,
      isShortValue,
      valueLength: previousValue.trim().length,
    });
    return { success: true, field, direction: 'gbp-to-site', needsConfirmation: true, matchedFiles, occurrences: matches.length };
  }

  const editedFiles: string[] = [];
  let occurrences = 0;
  for (const path of matchedFiles) {
    try {
      const { applied } = await files.edit({ path, oldString: previousValue, newString: value, replaceAll: true });
      if (applied > 0) {
        editedFiles.push(path);
        occurrences += applied;
      }
    } catch (err: unknown) {
      logger.warn('google-business-profile-sync.syncField.edit-failed', {
        appId,
        field,
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Search found the previous value but no file could actually be updated (e.g. the rendered
  // text differs from the source by entity-escaping or whitespace). Report failure rather than
  // a hollow success — otherwise verifySiteSync is the only thing that would catch it.
  if (matchedFiles.length > 0 && occurrences === 0) {
    logger.warn('google-business-profile-sync.syncField.no-op-edit', { appId, field, matchedFiles });
    return {
      success: false,
      error:
        `Found ${matchedFiles.length} file(s) containing the previous value, but none could be edited ` +
        `(the on-page text likely differs from the source by escaping or whitespace). Re-check the exact ` +
        `current site text for "${field}" and retry with that as previousValue.`,
    };
  }

  logger.info('google-business-profile-sync.syncField.site-edited', { appId, field, editedFiles, occurrences, widespread });
  return { success: true, field, direction: 'gbp-to-site', editedFiles, occurrences, widespread };
}

/**
 * Coerce a structured value to an object. Accepts a real object/array, or a JSON
 * string — models frequently stringify the object when a tool param is typed as
 * `string | object`. Returns null for non-JSON strings and other primitives.
 */
function asStructuredObject(value: unknown): Record<string, unknown> | unknown[] | null {
  if (value !== null && typeof value === 'object') {
    return value as Record<string, unknown> | unknown[];
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed !== null && typeof parsed === 'object') {
        return parsed as Record<string, unknown> | unknown[];
      }
    } catch {
      // Not JSON — fall through to the structured-object error.
    }
  }
  return null;
}

/** Map a diff field + value to a GoogleBusinessProfile update payload. */
function buildUpdates(field: SyncField, value: unknown): { updates?: GbpUpdates; error?: string } {
  const isString = typeof value === 'string';
  switch (field) {
    case 'name':
      return isString ? { updates: { name: value } } : { error: 'The "name" sync requires a string value.' };
    case 'phone':
      return isString ? { updates: { primaryPhone: value } } : { error: 'The "phone" sync requires a string value.' };
    case 'website':
      return isString ? { updates: { websiteUri: value } } : { error: 'The "website" sync requires a string value.' };
    case 'description':
      return isString ? { updates: { description: value } } : { error: 'The "description" sync requires a string value.' };
    case 'address': {
      const storefrontAddress = asStructuredObject(value);
      return storefrontAddress
        ? { updates: { storefrontAddress } }
        : {
            error:
              'The "address" sync requires a GBP storefrontAddress object, e.g. ' +
              '{ addressLines, locality, administrativeArea, postalCode, regionCode }.',
          };
    }
    case 'hours': {
      const regularHours = asStructuredObject(value);
      return regularHours
        ? { updates: { regularHours } }
        : {
            error:
              'The "hours" sync requires a GBP regularHours object, e.g. ' +
              '{ periods: [{ openDay, openTime, closeDay, closeTime }] }.',
          };
    }
    default:
      return { error: `Unknown field: ${String(field)}` };
  }
}

export const syncFieldTool: SkillToolDefinition = {
  name: 'syncField',
  description:
    'Apply one approved field sync. direction="site-to-gbp" writes the site value ' +
    'to the Google Business Profile listing. name/phone/website/description take a string. ' +
    'address takes a GBP storefrontAddress object { addressLines, locality, administrativeArea, ' +
    'postalCode, regionCode }. hours takes a GBP regularHours object that is the COMPLETE weekly ' +
    'schedule — { periods: [{ openDay, openTime: { hours, minutes }, closeDay, closeTime }] } with ' +
    'a period for EVERY open day, not just the one you are changing (GBP replaces the whole week, ' +
    'so any open day you omit becomes CLOSED). direction="gbp-to-site" edits the ' +
    'site source (handled separately). Call once per field the user approved.',

  parameters: z.object({
    field: z.enum(['name', 'phone', 'address', 'hours', 'website', 'description']),
    direction: z.enum(['site-to-gbp', 'gbp-to-site']),
    value: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .describe(
        'The value to write. name/phone/website: a plain string. ' +
          'address: a Google Business Profile storefrontAddress object (google.type.PostalAddress field names) — ' +
          '{ addressLines: string[], locality, administrativeArea (state code e.g. "CA"), postalCode, regionCode (CLDR country code e.g. "US") }. ' +
          'hours: a Google Business Profile regularHours object holding the COMPLETE weekly schedule — ' +
          '{ periods: [{ openDay: "MONDAY", openTime: { hours, minutes }, closeDay: "MONDAY", closeTime: { hours, minutes } }] } ' +
          '(days uppercase, times 24-hour numbers). Include one period per OPEN day. GBP replaces the entire ' +
          'week in one write, so to change a single day you must first read the current listing hours ' +
          '(getGbpProfile) and resend ALL open days with that day modified — any open day you leave out is ' +
          'marked closed. A day with no period is closed (that is how you intentionally close a day).',
      ),
    previousValue: z.string().optional(),
    apply: z
      .boolean()
      .optional()
      .describe(
        'gbp-to-site only. Omit (or false) for the first call: if the edit would touch many ' +
          'files/occurrences it returns a preview (needsConfirmation) WITHOUT editing. Pass true ' +
          'only after the user approves a wide edit, to actually apply it.',
      ),
  }),

  async execute(input, context) {
    const { field, direction, value, previousValue, apply } = input as {
      field: SyncField;
      direction: SyncDirection;
      value: unknown;
      previousValue?: string;
      apply?: boolean;
    };
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;

    if (!appId) {
      logger.error('google-business-profile-sync.syncField.missing-app-id', {});
      return { success: false, error: 'App ID is required' };
    }

    if (direction === 'gbp-to-site') {
      return syncGbpToSite(appId, field, value, previousValue, apply ?? false);
    }

    // Pass 2: update result delivered via context attachment (match on field).
    // Take the LATEST matching attachment — a retry in the same turn appends a newer
    // one, and an older (e.g. error) attachment must not mask it.
    const contextAttachments = agentContext?.contextAttachments;
    const doneContext = contextAttachments
      ?.filter(
        (att): att is ContextAttachment<GbpUpdateDoneData> =>
          att.type === GBP_UPDATE_DONE && (att.data as GbpUpdateDoneData | undefined)?.field === field
      )
      .at(-1);

    if (doneContext) {
      const { updated, error } = doneContext.data;
      if (error) {
        logger.warn('google-business-profile-sync.syncField.update-failed', { appId, field, error });
        return { success: false, error, needsReconnect: /401|unauthor|token/i.test(error) };
      }
      logger.info('google-business-profile-sync.syncField.updated', { appId, field, updated });
      return { success: true, field, updated };
    }

    // Pass 1: validate the value, confirm connection, emit the updateGbp signal.
    const built = buildUpdates(field, value);
    if (built.error || !built.updates) {
      return { success: false, error: built.error ?? 'Invalid value for sync.' };
    }

    try {
      const associations = socialAssociationRepo.findByAppAndPlatform(appId, SocialPlatform.GOOGLE_BUSINESS_PROFILE);

      if (associations.length === 0) {
        logger.warn('google-business-profile-sync.syncField.not-connected', { appId, field });
        return {
          success: false,
          error:
            'No Google Business Profile connection found. ' +
            'Call checkConnection first to establish connection, then retry syncField.',
          needsReconnect: true,
        };
      }

      const association = associations[0]!;
      if (associations.length > 1) {
        logger.warn('google-business-profile-sync.syncField.multi-location', {
          appId,
          count: associations.length,
          chosenSocialId: association.socialId,
        });
      }

      logger.info('google-business-profile-sync.syncField.signal', { appId, field, socialId: association.socialId });

      return { action: 'updateGbp', success: true, socialId: association.socialId, field, updates: built.updates };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error('google-business-profile-sync.syncField.error', { appId, field, error });
      return { success: false, error, needsReconnect: false };
    }
  },

  computeState(_input: unknown, output: SyncFieldOutput) {
    if ('action' in output && output.action === 'updateGbp') {
      return {
        workflowState: 'updating-gbp',
        nextStep: 'wait-for-update-attachment',
        syncField: output.field,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    if ('error' in output) {
      return {
        workflowState: 'gbp-update-failed',
        lastError: output.error,
        nextStep: output.needsReconnect ? 'reconnect-gbp' : 'retry-sync-field',
        updatedAt: new Date().toISOString(),
      };
    }

    // gbp-to-site: nothing to change — already in sync, skip verify.
    if ('noChange' in output) {
      return {
        workflowState: 'already-in-sync',
        syncedField: output.field,
        nextStep: 'sync-next-field',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    // gbp-to-site: wide edit previewed but NOT applied — confirm with the user first.
    if ('needsConfirmation' in output) {
      return {
        workflowState: 'awaiting-wide-edit-confirmation',
        syncedField: output.field,
        matchedCount: output.matchedFiles.length,
        nextStep: 'confirm-wide-edit',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    // gbp-to-site: source files edited, verify next
    if ('editedFiles' in output) {
      return {
        workflowState: 'site-edited',
        syncedField: output.field,
        editedCount: output.editedFiles.length,
        widespread: output.widespread,
        nextStep: 'verify-site-sync',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    if (output.success) {
      return {
        workflowState: 'gbp-updated',
        syncedField: output.field,
        nextStep: 'sync-next-field',
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
    }

    return null;
  },
};
