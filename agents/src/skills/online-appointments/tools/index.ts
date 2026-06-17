import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { SkillToolDefinition, SkillHooks, SkillSessionAnnouncements } from '@airo/ai-skills';
import { trace } from '@opentelemetry/api';
import { Logger } from '../../../logging/index.js';
import { ensureViteResolveDedupe } from '../../../services/vite-dedupe.js';
import { AppRepository } from '../../../database/repositories/AppRepository.js';
import {
  OLA_CATALOG_VERSION,
  computePending,
  computeNewSinceLastSeen,
  detectInstalled,
  hasBookingFootprint,
  type OlaFeature,
} from './feature-catalog.js';

//module-level logger — all OLA log events carry component: "online-appointments.skill"
// and are queryable in Loki via {job="airo-agents"} | json | component="online-appointments.skill"
const logger = Logger.create({ component: 'online-appointments.skill' });

type ToolContext = { metadata?: { appId?: string } };

function getAppId(ctx?: ToolContext): string | undefined {
  return ctx?.metadata?.appId;
}

export const getBookingConfigTool: SkillToolDefinition = {
  name: 'getBookingConfig',
  description:
    'Returns the payment provider configuration for the online-appointments skill. ' +
    'Load commerce for store/catalog/cart setup, then payment/godaddy-payments for checkout. ' +
    'Do NOT load stripe.',
  parameters: z.object({}),

  async execute(_input, context) {
    const appId = getAppId(context as ToolContext);

    if (appId) {
      logger.info('online-appointments.skill.getBookingConfig.called', { appId });
    } else {
      logger.warn('online-appointments.skill.getBookingConfig.missing_app_id', {});
    }

    const result = {
      paymentProvider: 'godaddy-commerce',
      message:
        'Online appointments uses GoDaddy Commerce for store/catalog/cart setup and GoDaddy Payments checkout. ' +
        'Load commerce first, then payment/godaddy-payments. Do NOT load stripe.',
    };

    if (appId) {
      logger.info('online-appointments.skill.getBookingConfig.returned', {
        appId,
        paymentProvider: result.paymentProvider,
      });
    }

    return result;
  },

  // persists paymentProvider to .airo/skills/online-appointments/state.json and
  // registers the skill in applied-skills.json on first successful call, eliminating
  // skill amnesia across conversation summarisation and multi-day session gaps.
  computeState(_input: unknown, output: unknown) {
    const o = output as { paymentProvider?: string } | null;
    if (!o?.paymentProvider) return null;
    return {
      paymentProvider: o.paymentProvider,
      queriedAt: new Date().toISOString(),
    };
  },

  // timeout enforced by the framework as Promise.race — prevents indefinite hangs.
  config: { requiresApp: true, timeout: 240_000 },
};

// Section-tracking tools — one per `.md` file in templates/sections/, built
// dynamically at module load. The model is instructed (in skill.md) to call
// the matching tool when it loads a section, surfacing the section as a
// tool_call in Langfuse traces. The tool body is a no-op beyond a structured
// log line.
const SECTIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'templates',
  'sections'
);

function discoverSectionSlugs(): string[] {
  try {
    return readdirSync(SECTIONS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => f.slice(0, -'.md'.length))
      .sort();
  } catch (err) {
    logger.warn('online-appointments.skill.sections.discover_failed', {
      dir: SECTIONS_DIR,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function makeSectionTool(slug: string): SkillToolDefinition {
  return {
    name: `section-${slug}`,
    description:
      `Mark that the online-appointments \`templates/sections/${slug}.md\` section is being used. ` +
      `Call this immediately before reading that section file so the section invocation is tracked in Langfuse. ` +
      `Takes no input and returns nothing meaningful — it exists purely as a tracing signal.`,
    parameters: z.object({}),

    async execute(_input, _context) {
      logger.info('online-appointments.skill.section.invoked', {
        section: `online-appointments/${slug}`,
      });
      return { ok: true };
    },

    config: { requiresApp: false, timeout: 5_000 },
  };
}

// Exported as an array — the skill-tools loader flattens arrays of tool
// definitions, which lets us register an arbitrary number of tools without
// listing them statically.
export const sectionTools: SkillToolDefinition[] =
  discoverSectionSlugs().map(makeSectionTool);

// The appointments UI renders React components (date picker, booking form).
// Skills that install npm packages may pull in transitive deps that bundle
// their own React copy, causing dual-instance crashes. Dedupe proactively.
export const hooks: SkillHooks = {
  // structured timing logs so install lifecycle is visible in Loki.
  // ensureViteResolveDedupe still runs and errors still propagate.
  onInstall: async ({ appPath }) => {
    const start = Date.now();
    logger.info('online-appointments.skill.install.start', { appPath });

    if (appPath) {
      try {
        ensureViteResolveDedupe(appPath);
        logger.info('online-appointments.skill.install.complete', {
          appPath,
          durationMs: Date.now() - start,
          dedupeApplied: true,
        });
      } catch (err) {
        logger.error('online-appointments.skill.install.failed', {
          appPath,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }
  },
  // Powers behaviour (returning customer) proactively — the generic bootstrap
  // calls this before the user mentions appointments. Self-gates on footprint:
  // returns null for apps without a booking system so most sessions do nothing.
  // The caller version-gates the returned pending capabilities against the
  // customer's last-seen marker, so we report ALL not-yet-adopted features here.
  //
  // Logged at each stage so dev.log shows: the call + its session inputs (begin),
  // why a session produced nothing (skipped), and the full versioned pending set
  // we hand back (success) — the catalog version plus what the customer has already
  // built vs. still has to develop.
  onSessionStart: async ({
    skillName,
    appId,
    appPath,
  }): Promise<SkillSessionAnnouncements | null> => {
    logger.info('skill.online-appointments.session_start.begin', {
      skillName,
      appId: appId ?? null,
      hasAppPath: !!appPath,
      currentVersion: OLA_CATALOG_VERSION,
    });

    if (!appPath) {
      logger.info('skill.online-appointments.session_start.skipped', {
        skillName,
        appId: appId ?? null,
        reason: 'no-app-path',
      });
      return null;
    }

    if (!(await hasBookingFootprint(appPath))) {
      logger.info('skill.online-appointments.session_start.skipped', {
        skillName,
        appId: appId ?? null,
        reason: 'no-booking-footprint',
      });
      return null;
    }

    const installedIds = await detectInstalled(appPath);
    const pending = computePending(installedIds);

    logger.info('skill.online-appointments.session_start.success', {
      skillName,
      appId: appId ?? null,
      currentVersion: OLA_CATALOG_VERSION,
      installedCount: installedIds.size,
      pendingCount: pending.length,
    });

    return {
      currentVersion: OLA_CATALOG_VERSION,
      announcements: pending.map((feature) => ({
        id: feature.id,
        label: feature.label,
        summary: feature.summary,
        version: feature.addedInVersion,
      })),
    };
  },
};

const appRepository = new AppRepository();

/** Shape returned for each capability — trimmed for prompt economy. */
interface SuggestedFeature {
  id: string;
  label: string;
  summary: string;
}

function toSuggested(feature: OlaFeature): SuggestedFeature {
  return { id: feature.id, label: feature.label, summary: feature.summary };
}

/**
 * Compact "id@vN, id@vN" summary of a feature set for the versioning logs — keeps
 * each capability's catalog version visible (which feature was developed vs. is yet
 * to develop) without dumping full label/summary text. Debug aid only, not a
 * structured-logging field.
 */
function summarizeFeatures(features: readonly OlaFeature[]): string {
  return features.map((feature) => `${feature.id}@v${feature.addedInVersion}`).join(', ');
}

/**
 * suggest_next — read-only inspector that powers the two suggestion behaviours.
 *
 * Given the current app, it reports which Online Appointments capabilities are
 * NOT built yet (`pending`) and which were added since a supplied catalog version
 * (`newSinceLastSeen`, when `lastSeenVersion` is passed). The agent feeds the
 * results into `suggestedResponse` to offer next steps. This tool is read-only and
 * does NOT read or write any memory marker — the returning-customer "what's new"
 * bookmark is owned and advanced by the server-side session-start bootstrap (stored
 * under `online-appointments.announceState`), so re-calling this is always safe.
 */
export const suggestNextTool: SkillToolDefinition = {
  name: 'suggest_next',
  description:
    'Inspect the current app and report Online Appointments capabilities that are NOT built yet (pending) ' +
    'plus any added since a supplied catalog version (newSinceLastSeen). Call after a build turn to offer ' +
    'pending next steps. Read-only: feed results into suggestedResponse. Do NOT read or write any memory ' +
    'marker — the returning-customer "what\'s new" bookmark is managed automatically by the server.',

  parameters: z.object({
    lastSeenVersion: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'Catalog version the customer last saw (optional). ' +
          "Omit to skip computing 'newSinceLastSeen'; pass 0 to treat every capability as new.",
      ),
  }),

  async execute(input: { lastSeenVersion?: number }, context): Promise<{
    success: boolean;
    currentVersion: number;
    pending: SuggestedFeature[];
    newSinceLastSeen: SuggestedFeature[];
  }> {
    const appId = context?.metadata?.appId as string | undefined;

    // Stage: the agent invoked the inspector. Log the call and its inputs — which
    // app/session, and the last-seen catalog version it is diffing against (the
    // versioning input that decides what counts as "new").
    logger.info('skill.online-appointments.suggest_next.begin', {
      appId: appId ?? null,
      currentVersion: OLA_CATALOG_VERSION,
      lastSeenVersion: input.lastSeenVersion ?? null,
    });

    if (!appId) {
      logger.warn('skill.online-appointments.suggest_next.failure', {
        reason: 'missing-app-id',
      });
      throw new Error('App ID required to inspect appointment features');
    }

    const app = appRepository.findById(appId);
    if (!app) {
      logger.warn('skill.online-appointments.suggest_next.failure', {
        appId,
        reason: 'app-not-found',
      });
      throw new Error(`App '${appId}' not found`);
    }

    // Stage: inspect the app filesystem (the changes built so far) and diff the
    // catalog. `pendingFeatures`/`newFeatures` are kept as full OlaFeatures so the
    // success log can report each capability's catalog version; the trimmed
    // SuggestedFeature shape is what the agent receives.
    const installedIds = await detectInstalled(app.path);
    const pendingFeatures = computePending(installedIds);
    const newFeatures =
      input.lastSeenVersion === undefined
        ? []
        : computeNewSinceLastSeen(input.lastSeenVersion);

    const pending = pendingFeatures.map(toSuggested);
    const newSinceLastSeen = newFeatures.map(toSuggested);

    // Stage: results. Log every essential output — the catalog version, what the
    // customer has already developed (installed), what is still to develop
    // (pending, with versions), and what is new since they last looked.
    logger.info('skill.online-appointments.suggest_next.success', {
      appId,
      appPath: app.path,
      currentVersion: OLA_CATALOG_VERSION,
      lastSeenVersion: input.lastSeenVersion ?? null,
      installedCount: installedIds.size,
      pendingCount: pending.length,
      newCount: newSinceLastSeen.length,
      // Human-readable: features the customer has already developed.
      installedIds: [...installedIds].join(', '), // for debugging; not intended for structured logging
      // Human-readable "id@vN": features still to develop, with their catalog version.
      pending: summarizeFeatures(pendingFeatures), // for debugging; not intended for structured logging
      // Human-readable "id@vN": features added since lastSeenVersion.
      newSinceLastSeen: summarizeFeatures(newFeatures), // for debugging; not intended for structured logging
    });

    return {
      success: true,
      currentVersion: OLA_CATALOG_VERSION,
      pending,
      newSinceLastSeen,
    };
  },

  config: {
    timeout: 10000,
    requiresApp: true,
  },
};
