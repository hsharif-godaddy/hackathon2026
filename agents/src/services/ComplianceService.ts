import { getS2SToken } from '@airo/ai-lib';

import { validate as validateUuid } from 'uuid';

import { logger } from '../logging/index.js';
import { resolveEnv } from '../utils/gd-env.js';

export interface PrivacyPolicyInput {
  documentType: 'privacy-policy';
  businessName: string;
  email: string;
  children: boolean;
  customerId: string;
  appId: string;
}

export interface TermsOfUseInput {
  documentType: 'terms-of-use';
  businessName: string;
  domainName: string;
  children: boolean;
  jurisdiction: string;
  customerId: string;
  appId: string;
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

  /**
   * Resolve a UUID-shaped customerId for the compliance API. In local dev or
   * the unit-test runner we substitute the nil UUID for non-UUID seed users
   * (e.g. `local-user-001`) so the flow stays runnable; everywhere else a
   * non-UUID is a hard error to avoid mis-attributing generated legal docs.
   */
  private async resolveCustomerId(
    inputCustomerId: string,
    documentType: GenerateDocumentInput['documentType'],
    appId: string,
  ): Promise<string> {
    if (validateUuid(inputCustomerId)) {
      return inputCustomerId;
    }
    const gasket = process.env.GASKET_ENV ?? '';
    const nodeEnv = process.env.NODE_ENV ?? '';
    const isLocalOrTestRunner = gasket.startsWith('local') || nodeEnv === 'test';
    if (!isLocalOrTestRunner) {
      logger.error('compliance.generateDocument.customerId.invalid', {
        documentType,
        appId,
        reason: 'invalid_uuid',
        gasketEnv: gasket,
      });
      throw new Error('customerId must be a UUID');
    }
    logger.warn('compliance.generateDocument.customerId.localFallback', {
      documentType,
      appId,
      reason: 'invalid_uuid',
      gasketEnv: gasket,
    });
    return '00000000-0000-0000-0000-000000000000';
  }

  async generateDocument(input: GenerateDocumentInput): Promise<GenerateDocumentResult> {
    const { customerId: inputCustomerId, appId, ...body } = input;
    // The compliance API requires a UUID-shaped customerId. Local dev seeds
    // (e.g. `local-user-001`) aren't UUIDs, so locally we substitute the nil
    // UUID to keep the flow runnable. In any hosted environment we refuse —
    // a non-UUID customerId reaching this point would silently mis-attribute
    // generated legal documents and is something to fix upstream, not paper
    // over here. Matches the gasket+NODE_ENV gate used elsewhere
    // (knowb-driver.ts:127-132).
    const customerId = await this.resolveCustomerId(inputCustomerId, input.documentType, appId);
    const baseUrl = getComplianceApiBaseUrl();
    const url = `${baseUrl}/api/document/generate`;

    logger.info(LOG_EVENTS.begin, {
      documentType: input.documentType,
      businessName: input.businessName,
      customerId,
      appId,
    });

    try {
      const token = await getS2SToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'x-app-key': this.appKey,
        'x-app-id': appId,
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
