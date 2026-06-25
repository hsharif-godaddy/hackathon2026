import { getS2SToken } from '@airo/ai-lib';

import { validate as validateUuid } from 'uuid';

import { logger } from '../logging/index.js';
import { resolveEnv } from '../utils/gd-env.js';

export enum DocumentType {
  PrivacyPolicy = 'privacy-policy',
  TermsOfUse = 'terms-of-use',
}

/**
 * Memory (per-app KV) key marking that a compliance document of the given type
 * has been generated for an app. Written by the compliance-docs skill tool on
 * successful generation and read at publish time to decide whether to report
 * document status — an O(1) indexed lookup that stays flat regardless of
 * conversation length (unlike scanning persisted tool calls).
 */
export function complianceDocStatusMemoryKey(documentType: DocumentType): string {
  return `compliance.document.${documentType}.generated`;
}

/**
 * Memory (per-app KV) key marking that the 1-credit charge for a compliance
 * document of the given type has already been committed for an app. Set after a
 * successful charge and read before charging, this is a local short-circuit that
 * stops the BMS deduct call from even being made on a regeneration — a layer of
 * defense in depth on top of the budget-service's own idempotency (the
 * deterministic idempotency key), not a replacement for it. Distinct from the
 * `.generated` marker because the charge precedes generation.
 */
export function complianceDocChargedMemoryKey(documentType: DocumentType): string {
  return `compliance.document.${documentType}.charged`;
}

export interface PrivacyPolicyInput {
  documentType: DocumentType.PrivacyPolicy;
  businessName: string;
  email: string;
  children: boolean;
  customerId: string;
  appId: string;
}

export interface TermsOfUseInput {
  documentType: DocumentType.TermsOfUse;
  businessName: string;
  domainName: string;
  children: boolean;
  jurisdiction: string;
  customerId: string;
  appId: string;
}

export type GenerateDocumentInput = PrivacyPolicyInput | TermsOfUseInput;

export interface GenerateDocumentResult {
  documentType: DocumentType;
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

const LOG_DOCUMENT_STATUS_EVENTS = {
  begin: 'compliance.reportDocumentStatus.begin',
  success: 'compliance.reportDocumentStatus.success',
  apiError: 'compliance.reportDocumentStatus.apiError',
  timeout: 'compliance.reportDocumentStatus.timeout',
  error: 'compliance.reportDocumentStatus.error',
} as const;

const LOG_GENERATE_DOCUMENT_EVENTS = {
  begin: 'compliance.generateDocument.begin',
  success: 'compliance.generateDocument.success',
  apiError: 'compliance.generateDocument.apiError',
  timeout: 'compliance.generateDocument.timeout',
  error: 'compliance.generateDocument.error',
} as const;

class ComplianceService {
  private readonly appKey = 'airo-app-builder';

  async reportDocumentStatus(customerId: string, appId: string, documentType: DocumentType, published?: boolean, version?: string): Promise<void> {
    const baseUrl = getComplianceApiBaseUrl();
    const url = `${baseUrl}/api/document/status`;

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
        method: 'PUT',
        headers,
        body: JSON.stringify({
          documentType,
          published,
          version,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errorText = await response.text();

        logger.error(LOG_DOCUMENT_STATUS_EVENTS.apiError, {
          status: response.status,
          error: errorText.slice(0, 500),
          customerId,
          documentType,
        });

        throw new Error(`Compliance API error: ${response.status} ${errorText.slice(0, 500)}`);
      }

      logger.info(LOG_DOCUMENT_STATUS_EVENTS.success, {
        customerId,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        logger.error(LOG_DOCUMENT_STATUS_EVENTS.timeout, { timeoutMs: 30_000, customerId, documentType, appId });
        throw error;
      }

      if (error instanceof Error && error.message.startsWith('Compliance API error:')) {
        throw error;
      }

      logger.error(LOG_DOCUMENT_STATUS_EVENTS.error, {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        documentType,
      });

      const normalizedError = error instanceof Error ? error : new Error(String(error), { cause: error });
      throw normalizedError;
    }
  }

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
    let { children } = input;
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

    logger.info(LOG_GENERATE_DOCUMENT_EVENTS.begin, {
      documentType: input.documentType,
      businessName: input.businessName,
      customerId,
      appId,
    });

    children = Boolean(children); // Ensure children is a boolean value

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
        body: JSON.stringify({
          ...body,
          children,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errorText = await response.text();

        logger.error(LOG_GENERATE_DOCUMENT_EVENTS.apiError, {
          status: response.status,
          error: errorText.slice(0, 500),
          customerId,
          documentType: input.documentType,
        });

        throw new Error(`Compliance API error: ${response.status} ${errorText.slice(0, 500)}`);
      }

      const result = (await response.json()) as GenerateDocumentResult;

      logger.info(LOG_GENERATE_DOCUMENT_EVENTS.success, {
        documentType: result.documentType,
        markdownLength: result.markdown.length,
        customerId,
      });

      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        logger.error(LOG_GENERATE_DOCUMENT_EVENTS.timeout, { timeoutMs: 30_000, customerId, documentType: input.documentType });
        throw error;
      }

      if (error instanceof Error && error.message.startsWith('Compliance API error:')) {
        throw error;
      }

      logger.error(LOG_GENERATE_DOCUMENT_EVENTS.error, {
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
