import { AABAgentsApiClient }
  from '../../clients/aab-agents-api-client.js';
import type { SeedPriorTurn, SeedSummaryInput }
  from '../../clients/aab-agents-api-client.js';
import type { StatefulAppOptions, SummarySeeder }
  from '../stateful/create-stateful-app.js';
import type { Config } from '../../../config/environments/types.js';

export interface SkillEvalBaseInjection {
  injection: StatefulAppOptions;
  seedSummary: SummarySeeder;
}

export const SKILL_EVAL_BASE_SUMMARY_TEXT: string = [
  '## State',
  'A 6-page dental practice marketing site with complete navigation header',
  'and footer. All pages wired into React Router routes file.',
  '',
  '## Completed',
  '- index.tsx: Home page with hero banner, tagline, and "Book Appointment" CTA',
  '- about.tsx: About page with practice history and team member placeholders',
  '- services.tsx: Services page listing common treatments (cleanings, fillings, whitening)',
  '- contact.tsx: Contact page with address, phone number, and placeholder contact form',
  '- blog.tsx: Blog page with three placeholder article cards',
  '- faq.tsx: FAQ page with five accordion-style question-and-answer pairs',
  '',
  '## Decisions',
  '- React Router for client-side routing with file-based page components',
  '- Blue-and-white palette with professional typography throughout',
  '',
  '## Pending',
  '- Contact form submits to a placeholder handler; no backend wired yet',
  '- Blog articles are static placeholders with no CMS integration',
  '- Appointment booking CTA links to an external placeholder URL',
].join('\n');

export const SKILL_EVAL_BASE_PRIOR_TURNS: SeedPriorTurn[] = [
  {
    sender: 'user',
    content:
      'Can you add a FAQ page that answers common questions about dental visits?',
  },
  {
    sender: 'agent',
    content:
      "I've added a FAQ page at /faq with five accordion-style Q&A pairs " +
      'covering appointment booking, insurance, cleaning frequency, what to ' +
      'expect on a first visit, and emergency contacts. The route is wired ' +
      'into the navigation header.',
  },
  {
    sender: 'user',
    content: 'Looks good. Can you also add blog articles about dental health tips?',
  },
  {
    sender: 'agent',
    content:
      "I've added a Blog page at /blog with three placeholder article cards: " +
      '"5 Tips for Healthier Teeth", "Why Regular Cleanings Matter", and ' +
      '"Understanding Dental X-Rays". Each card has a title, excerpt, and ' +
      '"Read More" link.',
  },
  {
    sender: 'user',
    content: 'Perfect. The site is looking complete for now.',
  },
  {
    sender: 'agent',
    content:
      'Great! The site now has all six pages: Home, About, Services, Contact, ' +
      'Blog, and FAQ. All pages are linked in the navigation. Let me know ' +
      'whenever you want to add more features or content.',
  },
];

const SEEDED_SUMMARY: SeedSummaryInput = {
  summaryText: SKILL_EVAL_BASE_SUMMARY_TEXT,
  priorTurns: SKILL_EVAL_BASE_PRIOR_TURNS,
  messageCount: 20, // Synthetic value satisfying schema's optional field for realism
  originalTokenCount: 12000, // Synthetic value satisfying schema's optional field for realism
};

/**
 * Returns stateful injection config for the 12 skill-eval scenarios.
 * All three EVAL_SKILL_BASE_* env vars must be set and non-empty for
 * injection to be active. Returns undefined when any is absent (backward-
 * compatible: scenarios fall back to fresh provision). Throws if env vars
 * are set but config.aab.agentsUrl is missing (misconfiguration).
 */
export function getSkillEvalBaseInjection(
  config?: Config,
): SkillEvalBaseInjection | undefined {
  const appId: string | undefined = process.env.EVAL_SKILL_BASE_APP_ID;
  const previewUrl: string | undefined = process.env.EVAL_SKILL_BASE_PREVIEW_URL;
  const resetCommit: string | undefined = process.env.EVAL_SKILL_BASE_RESET_COMMIT;

  if (!appId || !previewUrl || !resetCommit) {
    return undefined;
  }

  const agentsUrl: string | undefined = config?.aab.agentsUrl;
  if (!agentsUrl) {
    throw new Error(
      'EVAL_SKILL_BASE_* env vars are set but config.aab.agentsUrl is ' +
      'missing; cannot construct AABAgentsApiClient for summary seeding',
    );
  }

  const agentsApi: AABAgentsApiClient = new AABAgentsApiClient(agentsUrl);
  const seedSummary: SummarySeeder = async (
    id: string,
    summary: SeedSummaryInput,
  ): Promise<void> => {
    await agentsApi.seedSummary(id, summary);
  };

  const injection: StatefulAppOptions = {
    existingApp: { appId, previewUrl },
    resetCommit,
    seededSummary: SEEDED_SUMMARY,
  };

  return { injection, seedSummary };
}
