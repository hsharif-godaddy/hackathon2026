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

import { getS2SToken, BudgetExceededError } from '@airo/ai-lib';
import { logger } from '../logging/index.js';

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
  // Caller context (not sent in body)
  customerId: string;
  budgetUserId: string;
}

export interface ProcessedLogo {
  id: string;
  transparentUrl: string;
  solidUrl: string;
  mockupUrl: string;
}

export interface LogoGenerateResult {
  sessionId: string;
  logos: ProcessedLogo[];
}

function getLogoApiBaseUrl(): string {
  if (process.env.LOGO_API_URL) {
    return process.env.LOGO_API_URL;
  }
  const apiUrl = process.env.GODADDY_API_BASE_URL || '';
  if (apiUrl.includes('dev-godaddy.com')) return 'https://logo-agent.mvci.api.dev-godaddy.com';
  if (apiUrl.includes('test-godaddy.com')) return 'https://logo-agent.mvci.api.test-godaddy.com';
  return 'https://logo-agent.mvci.api.godaddy.com';
}

class LogoService {
  private readonly appKey = 'airo-app-builder';

  async generateLogos(input: LogoGenerateInput): Promise<LogoGenerateResult | null> {
    const baseUrl = getLogoApiBaseUrl();
    const url = `${baseUrl}/api/logo`;

    logger.info('logo.generate.begin', {
      brandName: input.brandName,
      style: input.style,
      count: input.count ?? 4,
      customerId: input.customerId,
    });

    try {
      const token = await getS2SToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'x-app-key': this.appKey,
        'x-customer-id': input.customerId,
        'x-budget-user-id': input.budgetUserId,
      };

      // Build request body (exclude caller context fields)
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
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const errorText = await response.text();

        // HTTP 402 = budget exceeded during image generation in the logo API
        if (response.status === 402) {
          logger.warn('logo.generate.budget_exceeded', {
            customerId: input.customerId,
            budgetUserId: input.budgetUserId,
          });
          throw new BudgetExceededError(
            'Logo generation budget exceeded',
            402,
            errorText,
          );
        }

        logger.error('logo.generate.api_error', {
          status: response.status,
          error: errorText.slice(0, 500),
          customerId: input.customerId,
        });
        return null;
      }

      const result = (await response.json()) as LogoGenerateResult;

      logger.info('logo.generate.success', {
        sessionId: result.sessionId,
        logoCount: result.logos.length,
        customerId: input.customerId,
      });

      return result;
    } catch (error) {
      // Let BudgetExceededError propagate for grant advancement
      if (BudgetExceededError.isInstance(error)) {
        throw error;
      }

      // Handle timeout/abort errors distinctly
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        logger.error('logo.generate.timeout', {
          timeoutMs: 120_000,
          customerId: input.customerId,
        });
        return null;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        logger.error('logo.generate.aborted', {
          customerId: input.customerId,
        });
        return null;
      }

      logger.error('logo.generate.error', {
        error: error instanceof Error ? error.message : String(error),
        customerId: input.customerId,
      });
      return null;
    }
  }
}

export const logoService = new LogoService();
