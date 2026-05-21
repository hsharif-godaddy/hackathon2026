import { getS2SToken } from '@airo/ai-lib';

import { logger } from '../logging/index.js';
import { resolveEnv } from '../utils/gd-env.js';

export interface PrivacyPolicyInput {
  documentType: 'privacy-policy';
  businessName: string;
  email: string;
  children: boolean;
  customerId: string;
}

export interface TermsOfUseInput {
  documentType: 'terms-of-use';
  businessName: string;
  domainName: string;
  children: boolean;
  jurisdiction: string;
  customerId: string;
}

export type GenerateDocumentInput = PrivacyPolicyInput | TermsOfUseInput;

export interface GenerateDocumentResult {
  documentType: 'privacy-policy' | 'terms-of-use';
  markdown: string;
}

const complianceUrls = {
  dev: 'https://compliance-agent.mvci.api.dev-godaddy.com',
  test: 'https://compliance-agent.mvci.api.test-godaddy.com',
  prod: 'https://compliance-agent.mvci.api.godaddy.com',
} as const;

function getComplianceApiBaseUrl(): string {
  if (process.env.COMPLIANCE_API_URL) return process.env.COMPLIANCE_API_URL;
  return complianceUrls[resolveEnv()];
}

const LOG_EVENTS = {
  begin: 'compliance.generateDocument.begin',
  success: 'compliance.generateDocument.success',
  apiError: 'compliance.generateDocument.apiError',
  timeout: 'compliance.generateDocument.timeout',
  error: 'compliance.generateDocument.error',
} as const;

class ComplianceService {
  private readonly appKey = 'airo-app-builder';

  async generateDocument(input: GenerateDocumentInput): Promise<GenerateDocumentResult> {
    const { customerId, ...body } = input;
    const baseUrl = getComplianceApiBaseUrl();
    const url = `${baseUrl}/api/document/generate`;

    logger.info(LOG_EVENTS.begin, {
      documentType: input.documentType,
      businessName: input.businessName,
      customerId,
    });

    try {
      const token = await getS2SToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'x-app-key': this.appKey,
        'x-customer-id': customerId,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errorText = await response.text();

        logger.error(LOG_EVENTS.apiError, {
          status: response.status,
          error: errorText.slice(0, 500),
          customerId,
          documentType: input.documentType,
        });

        throw new Error(`Compliance API error: ${response.status} ${errorText.slice(0, 500)}`);
      }

      const result = (await response.json()) as GenerateDocumentResult;

      logger.info(LOG_EVENTS.success, {
        documentType: result.documentType,
        markdownLength: result.markdown.length,
        customerId,
      });

      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        logger.error(LOG_EVENTS.timeout, { timeoutMs: 30_000, customerId, documentType: input.documentType });
        throw error;
      }

      if (error instanceof Error && error.message.startsWith('Compliance API error:')) {
        throw error;
      }

      logger.error(LOG_EVENTS.error, {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        documentType: input.documentType,
      });

      const normalizedError = error instanceof Error ? error : new Error(String(error), { cause: error });
      throw normalizedError;
    }
  }
}

export const complianceService = new ComplianceService();
