/**
 * Imagegen Service
 *
 * Calls the imagegen-agent REST API for image generation and editing using S2S auth.
 * Follows the LogoService pattern for service-to-service calls.
 *
 * Customer identity is passed via x-customer-id header.
 * LiteLLM budget metadata is passed via x-budget-user-id header.
 *
 * If the imagegen API returns HTTP 402, this indicates the LiteLLM budget was
 * exceeded during generation. This is surfaced as a BudgetExceededError
 * so the agent-factory grant advancement logic can retry with the next grant.
 */

import { getS2SToken } from '@airo/ai-lib';
import { BudgetExceededError } from '@airo/ai-common';

import { logger } from '../logging/index.js';
import { resolveEnv } from '../utils/gd-env.js';

// ============================================================================
// Types
// ============================================================================

export interface ImageGenerateInput {
  description: string;
  style?: string;
  orientation: 'landscape' | 'portrait' | 'square';
  count?: number;
  // Caller context (not sent in body)
  customerId: string;
  budgetUserId: string;
}

export interface GeneratedImage {
  id: string;
  url: string;
}

export interface ImageGenerateResult {
  sessionId: string;
  images: GeneratedImage[];
}

export interface ImageEditInput {
  description: string;
  imageUrl: string;
  // Caller context (not sent in body)
  customerId: string;
  budgetUserId: string;
}

export interface ImageEditResult {
  sessionId: string;
  url: string;
}

// ============================================================================
// URL Resolution
// ============================================================================

const imagegenUrls = {
  dev: 'https://imagegen-agent.mvci.api.dev-godaddy.com',
  test: 'https://imagegen-agent.mvci.api.test-godaddy.com',
  prod: 'https://imagegen-agent.mvci.api.godaddy.com',
} as const;

function getImagegenApiBaseUrl(): string {
  if (process.env.IMAGEGEN_API_URL) return process.env.IMAGEGEN_API_URL;
  return imagegenUrls[resolveEnv()];
}

// ============================================================================
// Service
// ============================================================================

class ImagegenService {
  private readonly appKey = 'airo-app-builder';

  private async buildHeaders(customerId: string, budgetUserId: string): Promise<Record<string, string>> {
    const token = await getS2SToken();
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'x-app-key': this.appKey,
      'x-customer-id': customerId,
      'x-budget-user-id': budgetUserId,
    };
  }

  private async handleErrorResponse(response: Response, operation: string, customerId: string, budgetUserId: string): Promise<never> {
    const errorText = await response.text();

    if (response.status === 402) {
      logger.warn(`imagegen.${operation}.budget_exceeded`, {
        customerId,
        budgetUserId,
      });
      throw new BudgetExceededError(
        `${operation} budget exceeded`,
        402,
        errorText,
      );
    }

    logger.error(`imagegen.${operation}.api_error`, {
      status: response.status,
      error: errorText.slice(0, 500),
      customerId,
    });

    throw new Error(`Imagegen API error (${operation}): ${response.status} ${errorText.slice(0, 500)}`);
  }

  private handleCatchError(error: unknown, operation: string, customerId: string): never {
    // Let BudgetExceededError propagate for grant advancement
    if (BudgetExceededError.isInstance(error)) {
      throw error;
    }

    if (error instanceof DOMException && error.name === 'TimeoutError') {
      logger.error(`imagegen.${operation}.timeout`, {
        customerId,
      });
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      logger.error(`imagegen.${operation}.aborted`, {
        customerId,
      });
      throw error;
    }

    logger.error(`imagegen.${operation}.error`, {
      error: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? (error.cause !== undefined ? (error.cause instanceof Error ? error.cause.message : String(error.cause)) : undefined) : undefined,
      customerId,
    });

    const normalizedError = error instanceof Error ? error : new Error(String(error), { cause: error });
    throw normalizedError;
  }

  async generateImages(input: ImageGenerateInput): Promise<ImageGenerateResult> {
    const baseUrl = getImagegenApiBaseUrl();
    const url = `${baseUrl}/v2/api/images`;

    logger.info('imagegen.image.generate.begin', {
      orientation: input.orientation,
      count: input.count ?? 4,
      customerId: input.customerId,
      url,
    });

    try {
      const headers = await this.buildHeaders(input.customerId, input.budgetUserId);

      const body = {
        description: input.description,
        orientation: input.orientation,
        ...(input.style && { style: input.style }),
        ...(input.count && { count: input.count }),
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        await this.handleErrorResponse(response, 'image.generate', input.customerId, input.budgetUserId);
      }

      const result = (await response.json()) as ImageGenerateResult & { entitled?: boolean };

      logger.info('imagegen.image.generate.success', {
        sessionId: result.sessionId,
        imageCount: result.images.length,
        customerId: input.customerId,
      });

      return {
        sessionId: result.sessionId,
        images: result.images,
      };
    } catch (error) {
      this.handleCatchError(error, 'image.generate', input.customerId);
    }
  }

  async editImage(input: ImageEditInput): Promise<ImageEditResult> {
    const baseUrl = getImagegenApiBaseUrl();
    const url = `${baseUrl}/v2/api/images/edit`;

    logger.info('imagegen.image.edit.begin', {
      customerId: input.customerId,
      url,
    });

    try {
      const headers = await this.buildHeaders(input.customerId, input.budgetUserId);

      const body = {
        description: input.description,
        imageUrl: input.imageUrl,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        await this.handleErrorResponse(response, 'image.edit', input.customerId, input.budgetUserId);
      }

      const result = (await response.json()) as ImageEditResult & { entitled?: boolean };

      logger.info('imagegen.image.edit.success', {
        sessionId: result.sessionId,
        customerId: input.customerId,
      });

      return {
        sessionId: result.sessionId,
        url: result.url,
      };
    } catch (error) {
      this.handleCatchError(error, 'image.edit', input.customerId);
    }
  }
}

export const imagegenService = new ImagegenService();
