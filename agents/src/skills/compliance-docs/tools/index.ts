import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { logger } from '../../../logging/index.js';
import type { SkillToolDefinition } from '@airo/ai-skills';
import { DocumentType, complianceService, complianceDocStatusMemoryKey } from '../../../services/ComplianceService.js';
import { appRepository } from '../../../database/repositories/index.js';
import { MemoryRepository } from '../../../database/repositories/MemoryRepository.js';
import { readAppFqdn } from '../../../lib/app-fqdn.js';
import { chargeForComplianceDoc } from '../charge.js';

const memoryRepository = new MemoryRepository();

/**
 * Record that a compliance document was generated for an app. This per-app
 * memory marker is what the publish flow reads (O(1)) to decide whether to
 * report document status — best-effort, so a marker write failure never fails
 * the generation the user just performed.
 */
async function markComplianceDocGenerated(appId: string, documentType: DocumentType): Promise<void> {
  const result = await memoryRepository.set(appId, complianceDocStatusMemoryKey(documentType), true);
  if (!result.success) {
    logger.warn('skills.compliance-docs.tools.markGenerated.failed', {
      appId,
      documentType,
      error: result.error,
    });
  }
}

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
  domainName: z.string().min(1).max(200).describe('Website domain name (e.g., "example.com"). Call get_purchased_domain first: if it returns a domain, pass that value here; otherwise ask the user for their domain and pass that.'),
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
import rehypeRaw from 'rehype-raw';

const markdown = \`${escaped}\`;

const components = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h1 className="text-2xl font-bold mt-8 mb-4" {...props} />,
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h2 className="text-xl font-bold mt-8 mb-3" {...props} />,
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className="text-lg font-bold mt-6 mb-2" {...props} />,
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => <p className="my-4 leading-relaxed" {...props} />,
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => <ul className="my-4 ml-6 list-disc" {...props} />,
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => <ol className="my-4 ml-6 list-decimal" {...props} />,
  li: (props: React.HTMLAttributes<HTMLLIElement>) => <li className="my-1" {...props} />,
  // Pass inline HTML spans through verbatim so the editable-field and section
  // markup (data-field / data-section / data-hidden / style) survives into the
  // DOM. Inert in the published build; the preview dev-tools decorate them.
  span: (props: React.HTMLAttributes<HTMLSpanElement>) => <span {...props} />,
};

export default function ${title}Page() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <article className="max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>{markdown}</ReactMarkdown>
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

    if (!appId) {
      // Don't dump the full input object — it carries email (PII). Match the
      // shape of the .start log site below.
      logger.error('skills.compliance-docs.tools.generate_privacy_policy.noAppId', {
        businessName: input.businessName,
      });
      return { error: 'Unable to determine app identity for document generation' };
    }

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

    // Charge 1 credit before producing the document (idempotent per app+type, so
    // a regeneration replays the original charge). Block generation if the
    // budget cannot cover it.
    const bmsBudgetId = (context as { metadata?: { bmsBudgetId?: string } })?.metadata?.bmsBudgetId;
    const charge = await chargeForComplianceDoc({
      bmsBudgetId,
      appId,
      documentType: DocumentType.PrivacyPolicy,
    });
    if (!charge.ok) {
      return { error: charge.error };
    }

    try {
      const result = await complianceService.generateDocument({
        documentType: DocumentType.PrivacyPolicy,
        businessName: input.businessName,
        email: input.email,
        children: input.children,
        customerId,
        appId,
      });

      const pagePath = join(appPath, 'src', 'pages', 'privacy.tsx');
      await mkdir(dirname(pagePath), { recursive: true });
      await writeFile(pagePath, buildPageComponent(result.markdown, 'Privacy'));

      await markComplianceDocGenerated(appId, DocumentType.PrivacyPolicy);

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

    if (!appId) {
      // Don't dump the full input object — it carries email (PII). Match the
      // shape of the .start log site below.
      logger.error('skills.compliance-docs.tools.generate_terms_of_use.noAppId', {
        businessName: input.businessName,
      });
      return { error: 'Unable to determine app identity for document generation' };
    }

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

    // Charge 1 credit before producing the document (idempotent per app+type, so
    // a regeneration replays the original charge). Block generation if the
    // budget cannot cover it.
    const bmsBudgetId = (context as { metadata?: { bmsBudgetId?: string } })?.metadata?.bmsBudgetId;
    const charge = await chargeForComplianceDoc({
      bmsBudgetId,
      appId,
      documentType: DocumentType.TermsOfUse,
    });
    if (!charge.ok) {
      return { error: charge.error };
    }

    try {
      const result = await complianceService.generateDocument({
        documentType: DocumentType.TermsOfUse,
        businessName: input.businessName,
        domainName: input.domainName,
        children: input.children,
        jurisdiction: input.jurisdiction,
        customerId,
        appId,
      });

      const pagePath = join(appPath, 'src', 'pages', 'terms.tsx');
      await mkdir(dirname(pagePath), { recursive: true });
      await writeFile(pagePath, buildPageComponent(result.markdown, 'Terms'));

      await markComplianceDocGenerated(appId, DocumentType.TermsOfUse);

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

export const getPurchasedDomainTool: SkillToolDefinition = {
  name: 'get_purchased_domain',
  description:
    'Check whether a website domain is already on file for this app (e.g., carried in from a domain purchase). ' +
    'Call this BEFORE generate_terms_of_use. If it returns a domain, pass that value as the generate_terms_of_use ' +
    'domainName and skip asking the user. If it reports no domain, ask the user for their website domain.',

  parameters: z.object({}),

  async execute(_input: Record<string, never>, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;
    const domainName = readAppFqdn(appId, context as { metadata?: Record<string, unknown> } | undefined);

    if (domainName) {
      logger.info('skills.compliance-docs.tools.get_purchased_domain.found', { appId });
      return { available: true, domainName };
    }

    logger.info('skills.compliance-docs.tools.get_purchased_domain.none', { appId });
    return {
      available: false,
      text: 'No domain is on file for this app. Ask the user for their website domain name.',
    };
  },
};

export const tools: SkillToolDefinition[] = [
  generatePrivacyPolicyTool,
  generateTermsOfUseTool,
  getPurchasedDomainTool,
];
