import { readFileSync, rmSync, existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { SkillToolDefinition, SkillHooks, SkillSessionAnnouncements } from '@airo/ai-skills';
import { createOpenAIClient, getFullModelName } from '@airo/ai-lib';
import { Logger } from '../../../logging/index.js';
import { ensureViteResolveDedupe } from '../../../services/vite-dedupe.js';
import { AppRepository } from '../../../database/repositories/AppRepository.js';

const logger = Logger.create({ component: 'online-appointments.skill' });

type ToolContext = { metadata?: { appId?: string } };

function getAppId(ctx?: ToolContext): string | undefined {
  return ctx?.metadata?.appId;
}

const sectionsDir: string = join(dirname(fileURLToPath(import.meta.url)), '..', 'sections');

interface SectionEntry {
  slug: string;
  title: string;
}

/** First-line heading in each section file: `# §N Title` */
function extractSectionTitle(content: string): string {
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  const match = firstLine.match(/^#+\s+§\S*\s+(.+)$/) ?? firstLine.match(/^#+\s+(.+)$/);
  return match ? match[1]!.trim() : '';
}

interface FeatureEntry {
  key: string;
  enabled: boolean;
}

function flattenFeatures(
  obj: Record<string, unknown>,
  prefix: string,
): FeatureEntry[] {
  return Object.entries(obj).flatMap(([k, val]) => {
    if (k === 'enabled' || typeof val !== 'object' || val === null) return [];
    const fullKey = `${prefix}.${k}`;
    return [
      { key: fullKey, enabled: (val as { enabled: boolean }).enabled },
      ...flattenFeatures(val as Record<string, unknown>, fullKey),
    ];
  });
}

function readFeaturesJson(appPath: string): FeatureEntry[] | null {
  try {
    const raw = readFileSync(join(appPath, 'src', 'appointment-features.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { features: Record<string, unknown> };
    return Object.entries(parsed.features).flatMap(([ns, flags]) =>
      flattenFeatures(flags as Record<string, unknown>, ns),
    );
  } catch {
    return null;
  }
}

const appRepository = new AppRepository();

/**
 * Returns the current enabled/disabled state of every feature flag in
 * appointment-features.json for the active app. Call this at session start
 * or when the user asks which features are on, to avoid re-asking questions
 * that were already answered in a prior session.
 */
export const getFeatureStatusTool: SkillToolDefinition = {
  name: 'getFeatureStatus',
  description:
    'Read the current appointment-features.json from the installed app and return which features ' +
    'are enabled or disabled. Use this to understand the current configuration before suggesting ' +
    'changes. Call at session start when the app already has the template installed.',

  parameters: z.object({}),

  async execute(
    _input: Record<string, never>,
    context?: ToolContext,
  ) {
    const appId: string | undefined = getAppId(context);

    if (!appId) {
      logger.warn('online-appointments.skill.getFeatureStatus.missing_app_id', {});
      throw new Error('App ID required to read feature status');
    }

    const app = appRepository.findById(appId);
    if (!app) {
      logger.warn('online-appointments.skill.getFeatureStatus.app_not_found', { appId });
      throw new Error(`App '${appId}' not found`);
    }

    logger.info('online-appointments.skill.getFeatureStatus.called', { appId });

    const features = readFeaturesJson(app.path);
    if (!features) {
      return {
        installed: false,
        message: 'appointment-features.json not found — template not yet installed',
        features: [],
      };
    }

    const enabled = features.filter(f => f.enabled).map(f => f.key);
    const disabled = features.filter(f => !f.enabled).map(f => f.key);

    logger.info('online-appointments.skill.getFeatureStatus.success', {
      appId,
      enabledCount: enabled.length,
      disabledCount: disabled.length,
    });

    return { installed: true, enabled, disabled };
  },

  computeState(_input: unknown, output: unknown) {
    const o = output as { installed?: boolean; enabled?: string[] } | null;
    if (!o?.installed || !o.enabled) return null;
    return {
      enabledFeatures: o.enabled,
      queriedAt: new Date().toISOString(),
    };
  },

  config: { requiresApp: true, timeout: 10_000 },
};

export const listSectionsTool: SkillToolDefinition = {
  name: 'listSections',
  description:
    'Lists all available implementation sections for the online-appointments skill as a table of contents. ' +
    'Returns each section\'s slug and title so you can identify which sections are relevant ' +
    'before loading them with skill({ action: "loadReference", ... }).',
  parameters: z.object({}),

  async execute(
    _input: Record<string, never>,
    context?: ToolContext,
  ): Promise<{ sections: SectionEntry[] }> {
    const appId: string | undefined = getAppId(context);

    logger.info('online-appointments.skill.listSections.begin', {
      appId: appId ?? null,
    });

    const entries: string[] = await readdir(sectionsDir);
    const mdFiles: string[] = entries.filter((f: string) => f.endsWith('.md')).sort();

    const sections: SectionEntry[] = await Promise.all(
      mdFiles.map(async (filename: string): Promise<SectionEntry> => {
        const slug: string = filename.replace(/\.md$/, '');
        const fileContent: string = await readFile(join(sectionsDir, filename), 'utf8');
        const title: string = extractSectionTitle(fileContent);
        return { slug, title };
      }),
    );

    logger.info('online-appointments.skill.listSections.success', {
      appId: appId ?? null,
      sectionCount: sections.length,
    });

    return { sections };
  },

  // Persists the section catalog + a routing rule into state.json.
  // Both appear in <applied_skills> current_state on every subsequent turn so the agent
  // always knows: (a) which sections exist, and (b) that ANY follow-up request on this
  // app requires listSections + loadReference before touching files.
  computeState(_input: unknown, output: unknown) {
    const o = output as { sections?: SectionEntry[] } | null;
    if (!o?.sections?.length) return null;
    return {
      sections: o.sections.map((s: SectionEntry) => ({ slug: s.slug, title: s.title })),
      routing_rule:
        'This app has online-appointments installed. ANY follow-up request — ' +
        '"fix admin", "add data", "add services", "improve services", "fix services", ' +
        '"service cards", "service list", "service page", "service design", ' +
        '"improve UI", "fix bookings", "improve bookings", ' +
        '"manage staff", "coupons", "auth", "settings", "seed", "my bookings" — ' +
        'is an online-appointments task. Always: ' +
        '(1) call online_appointments__listSections({}) ' +
        '(2) loadReference the section whose title matches the task. ' +
        'After matching the task to a section, check skill.md for mandatory sections that also apply to this task area. ' +
        'Do this before reading any file or writing any code.',
    };
  },

  config: { timeout: 10_000 },
};

interface DiscoveryQuestion {
  question: string;
  subtitle?: string;
  type: 'chips_single' | 'chips_multi' | 'text';
  suggestions: string[];
  allowOther: boolean;
  multiSelect: boolean;
}

const DiscoveryQuestionSchema = z.object({
  question: z.string().min(1),
  subtitle: z.string().optional(),
  type: z.enum(['chips_single', 'chips_multi', 'text']),
  suggestions: z.array(z.string()),
  allowOther: z.boolean(),
  multiSelect: z.boolean(),
});

function parseDiscoveryQuestions(raw: unknown): DiscoveryQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const valid = raw
    .map((item: unknown) => DiscoveryQuestionSchema.safeParse(item))
    .filter((r): r is z.ZodSafeParseSuccess<DiscoveryQuestion> => r.success)
    .map(r => r.data);
  return valid.length > 0 ? valid : null;
}

interface AppointmentFeatureEntry {
  enabled: boolean;
  description?: string;
  [key: string]: unknown;
}

function extractFeatureDescriptions(
  obj: Record<string, AppointmentFeatureEntry>,
  prefix: string,
): string[] {
  return Object.entries(obj).flatMap(([k, val]) => {
    if (k === 'enabled' || k === 'description' || typeof val !== 'object' || val === null) return [];
    const fullKey = `${prefix}.${k}`;
    const description = (val as AppointmentFeatureEntry).description;
    const lines: string[] = description ? [`- ${fullKey}: ${description}`] : [];
    return [...lines, ...extractFeatureDescriptions(val as Record<string, AppointmentFeatureEntry>, fullKey)];
  });
}

const FALLBACK_QUESTIONS: DiscoveryQuestion[] = [
  {
    question: 'What kind of business is this?',
    type: 'chips_single',
    suggestions: ['Spa / Wellness', 'Fitness Studio', 'Hair Salon', 'Medical / Healthcare', 'Consulting', 'Photography'],
    allowOther: true,
    multiSelect: false,
  },
  {
    question: 'What services do you offer? Select or enter with their duration and price (or "free").',
    subtitle: 'e.g. "Deep tissue massage | 60 min | $80" or "Consultation | 30 min | free"',
    type: 'text',
    suggestions: [],
    allowOther: true,
    multiSelect: true,
  },
  {
    question: 'How many people handle bookings?',
    type: 'chips_single',
    suggestions: ['Just me', 'Me + 1–2 colleagues', 'Small team (3–5)', 'Larger team (6+)'],
    allowOther: false,
    multiSelect: false,
  },
  {
    question: 'Do you want to offer discount codes to customers?',
    subtitle: 'e.g. WELCOME20 for 20% off first booking',
    type: 'chips_single',
    suggestions: ['Yes, definitely', 'Maybe later', 'Probably not', 'No'],
    allowOther: false,
    multiSelect: false,
  },
  {
    question: 'Should customers be able to log in and view their booking history?',
    type: 'chips_single',
    suggestions: ['Yes — give them a portal', 'Nice to have later', 'Not sure yet', 'No, keep it simple'],
    allowOther: false,
    multiSelect: false,
  },
  {
    question: "What's your timezone and usual working hours?",
    subtitle: 'e.g. America/New_York, Mon–Fri 9am–6pm',
    type: 'text',
    suggestions: [],
    allowOther: true,
    multiSelect: false,
  },
];

/**
 * Deletes stale files from the app that the skill installer won't overwrite because they
 * already exist. Call this immediately before `skill({ action: 'install', skill:
 * 'online-appointments' })` so the fresh template copies land correctly.
 *
 * Currently removes: src/lib/api-client.ts (if present). The installer skips existing
 * files, so without this step the bundled api-client.ts never gets written and all
 * imports from "@/lib/api-client" break.
 */
export const prepareInstallTool: SkillToolDefinition = {
  name: 'prepareInstall',
  description:
    'Delete stale template files from the app that the skill installer would otherwise skip. ' +
    'Call this IMMEDIATELY BEFORE `skill({ action: "install", skill: "online-appointments" })`. ' +
    'It removes src/lib/api-client.ts so the fresh copy from the templates is written on install.',

  parameters: z.object({}),

  async execute(_input, context) {
    const appId = getAppId(context as ToolContext);

    if (!appId) {
      logger.warn('online-appointments.skill.prepareInstall.missing_app_id', {});
      return { deleted: [], skipped: [] };
    }

    const app = appRepository.findById(appId);
    if (!app) {
      logger.warn('online-appointments.skill.prepareInstall.app_not_found', { appId });
      return { deleted: [], skipped: [] };
    }

    const filesToClear = [
      join('src', 'lib', 'api-client.ts'),
    ];

    const deleted: string[] = [];
    const skipped: string[] = [];

    for (const rel of filesToClear) {
      const abs = join(app.path, rel);
      if (existsSync(abs)) {
        rmSync(abs, { force: true });
        deleted.push(rel);
        logger.info('online-appointments.skill.prepareInstall.deleted', { appId, file: rel });
      } else {
        skipped.push(rel);
      }
    }

    return { deleted, skipped };
  },

  config: { requiresApp: true, timeout: 10_000 },
};

/**
 * Reads appointment-features.json from the installed app, makes an LLM call with the
 * user's requirements + available features, and returns user-friendly discovery questions
 * ready to pass to askQuestion.
 */
export const generateDiscoveryQuestionsTool: SkillToolDefinition = {
  name: 'generateDiscoveryQuestions',
  description:
    'Generate contextual discovery questions for a new online appointments setup. ' +
    'Reads appointment-features.json from the installed app to understand available optional ' +
    'features, then calls an LLM to produce user-friendly questions tailored to the user\'s ' +
    'requirements. Call this AFTER installing the skill and BEFORE askQuestion. ' +
    'Pass the returned questions array directly to askQuestion.',

  parameters: z.object({
    userRequirements: z
      .string()
      .describe("The whole conversation history with the user"),
  }),

  async execute(input, context) {
    const appId = getAppId(context as ToolContext);

    let featuresDescription = '';
    if (appId) {
      const app = appRepository.findById(appId);
      if (app) {
        const featuresPath = join(app.path, 'src', 'appointment-features.json');
        try {
          const raw = readFileSync(featuresPath, 'utf-8');
          const parsed = JSON.parse(raw) as { features: Record<string, AppointmentFeatureEntry> };
          const lines = extractFeatureDescriptions(parsed.features, '');
          featuresDescription = lines.join('\n');
        } catch {
          logger.warn('online-appointments.skill.generateDiscoveryQuestions.features_read_failed', {
            appId,
            featuresPath,
          });
        }
      }
    }

    logger.info('online-appointments.skill.generateDiscoveryQuestions.called', {
      appId: appId ?? null,
      hasFeatures: featuresDescription.length > 0,
    });

    const systemPrompt = `You are an expert business analyst helping set up an online appointment booking system.
Your goal is to generate a comprehensive set of discovery questions that will give a complete picture of the user's business.

Return ONLY a JSON object: { "questions": [...] }

Each question object MUST have exactly these fields:
  - question: string — friendly, conversational, non-technical
  - subtitle: string (optional) — short clarifying hint or example; omit if not needed
  - type: "chips_single" | "chips_multi" | "text"
  - suggestions: string[] — REQUIRED for chips_single and chips_multi; empty array [] ONLY for type "text"
  - allowOther: boolean — true when the user might have an answer not in suggestions; false for closed sets
  - multiSelect: boolean — true only for chips_multi, false otherwise

STRICT RULES — violations will break the UI:
1. chips_single and chips_multi MUST have AT LEAST 4 suggestion strings. Never fewer than 4.
2. type "text" is ONLY for fully open-ended answers (e.g. service list, address, working hours). Any question answerable by selecting an option MUST use chips_single or chips_multi.
3. Each suggestion must be a short, concrete, plain-English label — no bullet points, no feature flag names, no JSON keys.
4. Binary yes/no questions must use chips_single with 4 suggestions covering the real decision spectrum (e.g. "Yes — definitely", "Maybe later", "Probably not", "No").
5. Never mention feature flags, JSON keys, or technical implementation terms.

QUESTION COVERAGE — cover these foundation areas in order, then expand with context-relevant extras:

FOUNDATION (always include all 6):
1. Business type — what kind of business or practice is this?
2. Business location — where is the business based (city/country or online-only)?
3. Services offered — what services, treatments, or sessions will customers book?
4. Typical session length & pricing — how long and at what price?
5. Working hours & timezone — when is the business open?
6. Who handles bookings — solo, small team, or larger staff?

FEATURE DISCOVERY (always include all 6):
7. Staff scheduling — do different staff members have their own schedules/availability?
8. Discount codes / promotions — should customers be able to use coupon codes?
9. Customer accounts — should returning customers be able to log in and manage their bookings?
10. Service categories — do services naturally group into categories (e.g. Hair, Nails, Massage)?
11. Custom intake questions — should the booking form ask customers anything specific (e.g. health conditions, preferences)?
12. Cancellation & rescheduling policy — how far in advance can customers cancel or reschedule?

Generate EXACTLY 12 questions covering all areas above. Tailor suggestion labels to the user's specific business context.`;

    const userPrompt = `The user wants: ${input.userRequirements}

Available optional features (for context — do NOT mention these by name in questions):
${featuresDescription || `- admin.staff: Manage staff members who can be assigned to appointments
- admin.coupons + customer.booking_flow.coupons: Discount coupon codes
- customer.my_bookings: Customer login portal to view/manage their bookings
- admin.categories: Organise services into categories
- admin.questions: Custom intake questions at booking time
- staff.exception_times: Staff can block out time ranges`}

Generate exactly 12 questions following the FOUNDATION + FEATURE DISCOVERY order in the system prompt.
Tailor business type suggestions, service examples, and option labels to fit the user's stated context.
Every chips_single/chips_multi question MUST have at least 4 suggestions.`;

    try {
      const openai = await createOpenAIClient();
      const response = await openai.chat.completions.create({
        model: getFullModelName('haiku'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 2500,
      });

      const content = response.choices[0]?.message?.content ?? '';
      const parsed = JSON.parse(content) as { questions: unknown };
      const questions = parseDiscoveryQuestions(parsed.questions);

      if (!questions) {
        throw new Error('LLM returned no valid questions');
      }

      logger.info('online-appointments.skill.generateDiscoveryQuestions.success', {
        appId: appId ?? null,
        questionCount: questions.length,
      });

      return { questions };
    } catch (err) {
      logger.warn('online-appointments.skill.generateDiscoveryQuestions.llm_failed', {
        appId: appId ?? null,
        error: err instanceof Error ? err.message : String(err),
      });
      return { questions: FALLBACK_QUESTIONS };
    }
  },

  config: { requiresApp: false, timeout: 30_000 },
};


export const hooks: SkillHooks = {
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

  onSessionStart: async ({
    skillName,
    appId,
    appPath,
  }): Promise<SkillSessionAnnouncements | null> => {
    logger.info('online-appointments.skill.session_start.begin', {
      skillName,
      appId: appId ?? null,
      hasAppPath: !!appPath,
    });

    if (!appPath) {
      logger.info('online-appointments.skill.session_start.skipped', {
        skillName,
        appId: appId ?? null,
        reason: 'no-app-path',
      });
      return null;
    }

    const features = readFeaturesJson(appPath);

    if (!features) {
      const stateJson = join(appPath, '.airo', 'skills', 'online-appointments', 'state.json');
      const hasState = existsSync(stateJson);

      logger.info('online-appointments.skill.session_start.skipped', {
        skillName,
        appId: appId ?? null,
        reason: 'no-features-json',
        hasState,
      });

      if (!hasState) return null;

      const todayVersionLight = parseInt(new Date().toISOString().slice(0, 10).replace(/-/g, ''), 10);
      return {
        currentVersion: todayVersionLight,
        announcements: [{
          id: 'ola-skill-loaded',
          label: 'Online appointments skill active',
          summary:
            'The online-appointments skill was previously loaded for this app. ' +
            'For ANY request related to appointments, booking, scheduling, admin, seeding, ' +
            'auth, or UI — load this skill via `skill({ action: "load", skill: "online-appointments" })` ' +
            'and then load the relevant section before doing any work. ' +
            'Do not solve appointments problems from general knowledge.',
          version: todayVersionLight,
        }],
      };
    }

    const disabled = features.filter(f => !f.enabled);

    logger.info('online-appointments.skill.session_start.success', {
      skillName,
      appId: appId ?? null,
      enabledCount: features.length - disabled.length,
      disabledCount: disabled.length,
    });

    // Build the live section catalog from disk so the announcement always reflects
    // what actually exists.
    let sectionCatalogLines = '';
    try {
      const entries: string[] = await readdir(sectionsDir);
      const mdFiles: string[] = entries.filter((f: string) => f.endsWith('.md')).sort();
      const sections: SectionEntry[] = await Promise.all(
        mdFiles.map(async (filename: string): Promise<SectionEntry> => {
          const slug: string = filename.replace(/\.md$/, '');
          const fileContent: string = await readFile(join(sectionsDir, filename), 'utf8');
          const title: string = extractSectionTitle(fileContent);
          return { slug, title };
        }),
      );
      sectionCatalogLines = sections.map(s => `  ${s.slug}: ${s.title}`).join('\n');
    } catch {
      sectionCatalogLines = '  (call online_appointments__listSections({}) to retrieve)';
    }

    const todayVersion = parseInt(new Date().toISOString().slice(0, 10).replace(/-/g, ''), 10);

    const sectionLoadAnnouncement = {
      id: 'ola-load-sections',
      label: 'Load reference sections',
      summary:
        'This app has the online appointments system installed.\n\n' +
        'REQUIRED — two steps before reading any file or writing any code:\n\n' +
        'Step 1: online_appointments__listSections({}) — always run this first to see all available sections.\n' +
        'Step 2: skill({ action: "loadReference", path: "online-appointments/sections/<matching-slug>" }) — load the section whose title matches the current task.\n\n' +
        'Available sections (from last catalog scan):\n' +
        sectionCatalogLines + '\n\n' +
        'Do not skip Step 1. listSections must run before loadReference every time.',
      version: todayVersion,
    };

    const disabledAnnouncements = disabled.slice(0, 4).map(f => ({
      id: f.key,
      label: f.key,
      summary: `Feature "${f.key}" is currently disabled and can be turned on`,
      version: 1,
    }));

    return {
      currentVersion: todayVersion,
      announcements: [sectionLoadAnnouncement, ...disabledAnnouncements],
    };
  },
};
