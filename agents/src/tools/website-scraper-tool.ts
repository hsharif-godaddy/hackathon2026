/**
 * Website Scraper Tool
 * 
 * MCP tool for scraping website content and capturing screenshots
 * to extract design inspiration and context from existing websites
 */
import { Logger } from '../logging/index.js';
import { WebsiteScraperDriver } from './ai-lib-tools/drivers/website-scraper-driver.js';

const logger = Logger.create({ component: 'website-scraper-tool' });

/**
 * MCP Tool types
 */
interface CallToolRequestSchema {
  params: {
    arguments: Record<string, unknown>;
  };
}

interface ToolOptions {
  requestId?: string;
}

interface ToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

/**
 * Website scraper tool handler
 * 
 * Extracts content and captures screenshots from websites to analyze design patterns
 * and content structure for building similar applications
 * 
 * @param request - MCP tool call request containing the target URL
 * @param options - Tool execution options
 * @returns Promise resolving to tool response with website content and screenshot
 * 
 * @example
 * ```typescript
 * const result = await scrapeWebsite({
 *   params: {
 *     arguments: {
 *       url: 'https://example.com'
 *     }
 *   }
 * });
 * ```
 */
export async function scrapeWebsite(
  request: CallToolRequestSchema,
  options?: ToolOptions
): Promise<ToolResponse> {
  try {
    const { url } = request.params.arguments as { url?: string };

    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'A valid URL is required. Please provide the website URL you want to analyze.'
          }, null, 2)
        }],
        isError: true
      };
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Invalid URL format. Please provide a valid HTTP/HTTPS URL.'
          }, null, 2)
        }],
        isError: true
      };
    }

    logger.info('website-scraper-tool.execute.begin', {
      url,
      requestId: options?.requestId
    });

    const driver = new WebsiteScraperDriver();
    const result = await driver.scrapeAndScreenshot({ url });

    if (!result.success) {
      logger.warn('website-scraper-tool.execute.failed', {
        url,
        error: result.error
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: result.error || 'Failed to scrape website'
          }, null, 2)
        }],
        isError: true
      };
    }

    logger.info('website-scraper-tool.execute.success', {
      url,
      contentLength: result.sanitizedContent?.length || 0,
      hasScreenshot: !!result.screenshotUrl,
      scrapeTime: result.scrapeTime
    });

    // Return both content and screenshot for design inspiration
    const response = {
      success: true,
      url: result.url,
      content: result.sanitizedContent,
      screenshot: result.screenshotUrl,
      scrapeTime: result.scrapeTime,
      message: 'Successfully extracted website content and captured screenshot. Use the content to understand structure and the screenshot for visual design inspiration.'
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };

  } catch (error) {
    logger.error('website-scraper-tool.execute.error', {
      error: error instanceof Error ? error.message : String(error),
      requestId: options?.requestId
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Unexpected error during website scraping: ${error instanceof Error ? error.message : String(error)}`
        }, null, 2)
      }],
      isError: true
    };
  }
}

/**
 * Tool definition for MCP server registration
 */
export const websiteScraperToolDefinition = {
  name: 'scrape_website',
  description: 'Scrape website content and capture screenshot to extract design inspiration and context. ' +
    'This tool fetches both the text content and a visual screenshot of any website, ' +
    'allowing you to analyze layout, design patterns, and content structure when building similar applications. ' +
    'Use this when a user asks to create something "like [website]" or provides a URL as reference.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The full URL of the website to scrape (must include http:// or https://). ' +
          'Example: https://example.com'
      }
    },
    required: ['url']
  }
};

