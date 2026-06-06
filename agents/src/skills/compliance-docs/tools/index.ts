import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { logger } from '../../../logging/index.js';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { complianceService } from '../../../services/ComplianceService.js';
import { appRepository } from '../../../database/repositories/index.js';

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California',
  'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
  'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
] as const;

const PrivacyPolicyInputSchema = z.object({
  businessName: z.string().min(1).max(200).describe('Business or website name'),
  email: z.string().email().describe('Contact email address for privacy inquiries'),
  children: z.boolean().describe('Whether the site is directed at or knowingly collects data from children under 13'),
});

const TermsOfUseInputSchema = z.object({
  businessName: z.string().min(1).max(200).describe('Business or website name'),
  domainName: z.string().min(1).max(200).describe('Website domain name (e.g., "example.com")'),
  children: z.boolean().describe('Whether the site targets children under 13'),
  jurisdiction: z.enum(US_STATES).describe('US state where the business is based'),
});

type PrivacyPolicyInput = z.infer<typeof PrivacyPolicyInputSchema>;
type TermsOfUseInput = z.infer<typeof TermsOfUseInputSchema>;

function resolveCustomerId(appId: string | undefined): string | null {
  const app = appId ? appRepository.findById(appId) : null;
  return app?.customerId ?? null;
}

function resolveAppPath(appId: string | undefined): string | null {
  const app = appId ? appRepository.findById(appId) : null;
  return app?.path ?? null;
}

/**
 * Generate the React page component that renders the legal markdown.
 * The markdown is embedded as a string constant so it's never passed through
 * the LLM and cannot be paraphrased or truncated.
 */
function buildPageComponent(markdown: string, title: string): string {
  // Escape backticks and ${} in the markdown for template literal safety
  const escaped = markdown.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const markdown = \`${escaped}\`;

export default function ${title}Page() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <article className="prose prose-neutral max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
    </div>
  );
}
`;
}

export const generatePrivacyPolicyTool: SkillToolDefinition = {
  name: 'generate_privacy_policy',
  description:
    'Generate a privacy policy and write it directly to src/pages/privacy.tsx. ' +
    'The page file is created automatically — you do not need to create it yourself. ' +
    'After this tool succeeds, ensure there is a link to /privacy in the site footer.',

  parameters: PrivacyPolicyInputSchema,

  async execute(input: PrivacyPolicyInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;

    logger.info('skills.compliance-docs.tools.generate_privacy_policy.start', {
      businessName: input.businessName,
      appId,
    });

    const customerId = resolveCustomerId(appId);
    if (!customerId) {
      logger.error('skills.compliance-docs.tools.generate_privacy_policy.noCustomer', { appId });
      return { error: 'Unable to determine customer identity for document generation' };
    }

    const appPath = resolveAppPath(appId);
    if (!appPath) {
      logger.error('skills.compliance-docs.tools.generate_privacy_policy.noAppPath', { appId });
      return { error: 'Unable to determine app path for file creation' };
    }

    try {
      const result = await complianceService.generateDocument({
        documentType: 'privacy-policy',
        businessName: input.businessName,
        email: input.email,
        children: input.children,
        customerId,
      });

      const pagePath = join(appPath, 'src', 'pages', 'privacy.tsx');
      await mkdir(dirname(pagePath), { recursive: true });
      await writeFile(pagePath, buildPageComponent(result.markdown, 'Privacy'));

      logger.info('skills.compliance-docs.tools.generate_privacy_policy.success', {
        markdownLength: result.markdown.length,
        pagePath,
        appId,
      });

      return {
        text: `Privacy policy page written to src/pages/privacy.tsx. Ensure there is a link to /privacy in the site footer — if one already exists, do not add a duplicate.`,
        documentType: 'privacy-policy',
        filePath: 'src/pages/privacy.tsx',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      logger.error('skills.compliance-docs.tools.generate_privacy_policy.error', {
        error: message,
        appId,
      });

      return {
        error: `Failed to generate privacy policy: ${message}. Ask the user if they'd like to try again.`,
      };
    }
  },

  computeState(input: any, output: any) {
    if (!output?.filePath || output?.error) return null;
    return {
      privacyPolicy: {
        generated: true,
        businessName: input.businessName,
        email: input.email,
        generatedAt: new Date().toISOString(),
      },
    };
  },
  config: {
    timeout: 30_000,
  },
};

export const generateTermsOfUseTool: SkillToolDefinition = {
  name: 'generate_terms_of_use',
  description:
    'Generate terms of use and write it directly to src/pages/terms.tsx. ' +
    'The page file is created automatically — you do not need to create it yourself. ' +
    'After this tool succeeds, ensure there is a link to /terms in the site footer.',

  parameters: TermsOfUseInputSchema,

  async execute(input: TermsOfUseInput, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;

    logger.info('skills.compliance-docs.tools.generate_terms_of_use.start', {
      businessName: input.businessName,
      appId,
    });

    const customerId = resolveCustomerId(appId);
    if (!customerId) {
      logger.error('skills.compliance-docs.tools.generate_terms_of_use.noCustomer', { appId });
      return { error: 'Unable to determine customer identity for document generation' };
    }

    const appPath = resolveAppPath(appId);
    if (!appPath) {
      logger.error('skills.compliance-docs.tools.generate_terms_of_use.noAppPath', { appId });
      return { error: 'Unable to determine app path for file creation' };
    }

    try {
      const result = await complianceService.generateDocument({
        documentType: 'terms-of-use',
        businessName: input.businessName,
        domainName: input.domainName,
        children: input.children,
        jurisdiction: input.jurisdiction,
        customerId,
      });

      const pagePath = join(appPath, 'src', 'pages', 'terms.tsx');
      await mkdir(dirname(pagePath), { recursive: true });
      await writeFile(pagePath, buildPageComponent(result.markdown, 'Terms'));

      logger.info('skills.compliance-docs.tools.generate_terms_of_use.success', {
        markdownLength: result.markdown.length,
        pagePath,
        appId,
      });

      return {
        text: `Terms of use page written to src/pages/terms.tsx. Ensure there is a link to /terms in the site footer — if one already exists, do not add a duplicate.`,
        documentType: 'terms-of-use',
        filePath: 'src/pages/terms.tsx',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      logger.error('skills.compliance-docs.tools.generate_terms_of_use.error', {
        error: message,
        appId,
      });

      return {
        error: `Failed to generate terms of use: ${message}. Ask the user if they'd like to try again.`,
      };
    }
  },

  computeState(input: any, output: any) {
    if (!output?.filePath || output?.error) return null;
    return {
      termsOfUse: {
        generated: true,
        businessName: input.businessName,
        domainName: input.domainName,
        generatedAt: new Date().toISOString(),
      },
    };
  },
  config: {
    timeout: 30_000,
  },
};

export const tools: SkillToolDefinition[] = [generatePrivacyPolicyTool, generateTermsOfUseTool];
