/**
 * Logo Service
 *
 * Calls the logo-agent REST API directly using S2S auth.
 * Follows the GettyUploadService pattern for service-to-service calls.
 *
 * Customer identity is passed via x-customer-id header.
 * LiteLLM budget metadata is passed via x-budget-user-id header.
 *
 * If the logo API returns HTTP 402, this indicates the LiteLLM budget was
 * exceeded during image generation. This is surfaced as a BudgetExceededError
 * so the agent-factory grant advancement logic can retry with the next grant.
 */

import { getS2SToken } from '@airo/ai-lib';
import { BudgetExceededError } from '@airo/ai-common';

import { logger } from '../logging/index.js';
import { resolveEnv } from '../utils/gd-env.js';

export interface LogoGenerateInput {
  brandName: string;
  brandDescription: string;
  style: string;
  brandTagline?: string;
  brandColors?: string;
  brandPersonality?: string;
  brandAudience?: string;
  styleDescription?: string;
  symbol?: string;
  count?: number;
  layout?: string;
  // Caller context (not sent in body)
  customerId: string;
  budgetUserId: string;
}

export interface ProcessedLogo {
  id: string;
  // Square layout (default)
  transparentUrl?: string;
  solidUrl?: string;
  reversedUrl?: string;
  mockupUrl?: string;
  // Horizontal layout
  horizontalTransparentUrl?: string;
  horizontalSolidUrl?: string;
  horizontalReversedUrl?: string;
  horizontalMockupUrl?: string;
  // Vertical layout
  verticalTransparentUrl?: string;
  verticalSolidUrl?: string;
  verticalReversedUrl?: string;
  verticalMockupUrl?: string;
}

export interface LogoGenerateResult {
  sessionId: string;
  logos: ProcessedLogo[];
}

export interface LogoEditInput {
  sourceSessionId: string;
  sourceLogoId: string;
  prompt: string;
  layout?: string;
  count?: number;
  // Caller context (not sent in body)
  customerId: string;
  budgetUserId: string;
}

const logoUrls = {
  dev: 'https://logo-agent.mvci.api.dev-godaddy.com',
  test: 'https://logo-agent.mvci.api.test-godaddy.com',
  prod: 'https://logo-agent.mvci.api.godaddy.com',
} as const;

function getLogoApiBaseUrl(): string {
  if (process.env.LOGO_API_URL) return process.env.LOGO_API_URL;
  return logoUrls[resolveEnv()];
}

const LOG_EVENTS = {
  generate: {
    budget_exceeded: 'logo.generate.budget_exceeded',
    api_error: 'logo.generate.api_error',
    success: 'logo.generate.success',
    timeout: 'logo.generate.timeout',
    aborted: 'logo.generate.aborted',
    error: 'logo.generate.error',
  },
  edit: {
    budget_exceeded: 'logo.edit.budget_exceeded',
    api_error: 'logo.edit.api_error',
    success: 'logo.edit.success',
    timeout: 'logo.edit.timeout',
    aborted: 'logo.edit.aborted',
    error: 'logo.edit.error',
  },
} as const;

class LogoService {
  private readonly appKey = 'airo-app-builder';

  private async callLogoApi(endpoint: string, body: Record<string, unknown>, customerId: string, budgetUserId: string, operation: keyof typeof LOG_EVENTS): Promise<LogoGenerateResult> {
    const baseUrl = getLogoApiBaseUrl();
    const url = `${baseUrl}${endpoint}`;

    try {
      const token = await getS2SToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'x-app-key': this.appKey,
        'x-customer-id': customerId,
        'x-budget-user-id': budgetUserId,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 402) {
          logger.warn(LOG_EVENTS[operation].budget_exceeded, { customerId, budgetUserId });
          throw new BudgetExceededError(`Logo ${operation} budget exceeded`, 402, errorText);
        }

        logger.error(LOG_EVENTS[operation].api_error, {
          status: response.status,
          error: errorText.slice(0, 500),
          customerId,
        });

        throw new Error(`Logo API error: ${response.status} ${errorText.slice(0, 500)}`);
      }

      const result = (await response.json()) as LogoGenerateResult;

      logger.info(LOG_EVENTS[operation].success, {
        sessionId: result.sessionId,
        logoCount: result.logos.length,
        customerId,
      });

      return result;
    } catch (error) {
      if (BudgetExceededError.isInstance(error)) {
        throw error;
      }

      if (error instanceof DOMException && error.name === 'TimeoutError') {
        logger.error(LOG_EVENTS[operation].timeout, { timeoutMs: 120_000, customerId });
        throw error;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        logger.error(LOG_EVENTS[operation].aborted, { customerId });
        throw error;
      }

      logger.error(LOG_EVENTS[operation].error, {
        error: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error ? (error.cause !== undefined ? (error.cause instanceof Error ? error.cause.message : String(error.cause)) : undefined) : undefined,
        customerId,
      });

      const normalizedError = error instanceof Error ? error : new Error(String(error), { cause: error });
      throw normalizedError;
    }
  }

  async generateLogos(input: LogoGenerateInput): Promise<LogoGenerateResult> {
    logger.info('logo.generate.begin', {
      brandName: input.brandName,
      style: input.style,
      count: input.count ?? 4,
      customerId: input.customerId,
    });

    const body = {
      brandName: input.brandName,
      brandDescription: input.brandDescription,
      style: input.style,
      ...(input.brandTagline && { brandTagline: input.brandTagline }),
      ...(input.brandColors && { brandColors: input.brandColors }),
      ...(input.brandPersonality && { brandPersonality: input.brandPersonality }),
      ...(input.brandAudience && { brandAudience: input.brandAudience }),
      ...(input.styleDescription && { styleDescription: input.styleDescription }),
      ...(input.symbol && { symbol: input.symbol }),
      ...(input.count && { count: input.count }),
      ...(input.layout && { layout: input.layout }),
    };

    return this.callLogoApi('/api/logo', body, input.customerId, input.budgetUserId, 'generate');
  }

  async editLogos(input: LogoEditInput): Promise<LogoGenerateResult> {
    logger.info('logo.edit.begin', {
      sourceSessionId: input.sourceSessionId,
      sourceLogoId: input.sourceLogoId,
      promptLength: input.prompt.length,
      count: input.count ?? 1,
      customerId: input.customerId,
    });

    const body = {
      sourceSessionId: input.sourceSessionId,
      sourceLogoId: input.sourceLogoId,
      prompt: input.prompt,
      ...(input.layout && { layout: input.layout }),
      ...(input.count && { count: input.count }),
    };

    return this.callLogoApi('/api/logo/edit', body, input.customerId, input.budgetUserId, 'edit');
  }
}

export const logoService = new LogoService();
