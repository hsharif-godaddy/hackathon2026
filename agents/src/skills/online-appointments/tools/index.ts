import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { SkillToolDefinition, SkillHooks } from '@airo/ai-skills';
import { trace } from '@opentelemetry/api';
import { Logger } from '../../../logging/index.js';
import { ensureViteResolveDedupe } from '../../../services/vite-dedupe.js';

//module-level logger — all OLA log events carry component: "online-appointments.skill"
// and are queryable in Loki via {job="airo-agents"} | json | component="online-appointments.skill"
const logger = Logger.create({ component: 'online-appointments.skill' });

type ToolContext = { metadata?: { appId?: string } };

function getAppId(ctx?: ToolContext): string | undefined {
  return ctx?.metadata?.appId;
}

//stamps skill.name on the active OTel span so every Langfuse trace where OLA
// was active becomes filterable by metadata.skill.name = "online-appointments".
// Called from onLoad (fires every session)
function stampSkillOnTrace(): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setAttribute('skill.name', 'online-appointments');
  span.setAttribute('skill.use_case', 'appointment_booking');
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
  // onLoad fires on every conversation where OLA is active (installed or not),
  // stamping skill.name on the trace.
  onLoad: async () => {
    stampSkillOnTrace();
  },

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
};
