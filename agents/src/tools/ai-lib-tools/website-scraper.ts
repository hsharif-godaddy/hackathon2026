/**
 * Website Scraper AI-Lib Tool
 * 
 * AI-Lib compatible tool wrapper for website scraping and screenshot capture
 */
import { createTool, type Tool } from '@airo/ai-lib';
import { WebsiteScraperDriver } from './drivers/website-scraper-driver.js';
import { z } from 'zod';

/**
 * Website scraper AI-Lib tool
 * 
 * Scrapes website content and captures screenshots to analyze design patterns
 * and content structure when building similar applications.
 */
export const websiteScraperAITool: Tool = createTool(
  'Use this when user asks to clone or make similar to get the information. ' + 'Scrape website content and capture screenshot to extract design inspiration and context. ' +
    'This tool fetches both the text content and a visual screenshot of any website, ' +
    'allowing you to analyze layout, design patterns, and content structure when building similar applications. ' +
    'Use this when a user asks to create something "like [website]" or provides a URL as reference.',
  z.object({
    url: z.string().url().describe('The full URL of the website to scrape (must include http:// or https://)')
  }),
  async (input, context) => {
    const { url } = input;
    
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      throw new Error('A valid URL is required');
    }
    
    const driver = new WebsiteScraperDriver();
    const result = await driver.scrapeAndScreenshot({ url });
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to scrape website');
    }
    
    // Attach screenshot to context metadata for visual processing
    if (result.screenshotBase64 && context?.metadata) {
      if (!context.metadata._screenshots) {
        context.metadata._screenshots = [];
      }
      const screenshots = context.metadata._screenshots as string[];
      screenshots.push(result.screenshotBase64);
    }
    
    // Return formatted response with content and metadata
    const response = {
      success: true,
      url: result.url,
      content: result.sanitizedContent,
      screenshotAttached: !!result.screenshotBase64,
      scrapeTime: result.scrapeTime,
      message: 'Successfully extracted website content and captured screenshot. The screenshot has been attached to the conversation context for visual analysis. Use the content to understand structure and the screenshot for visual design inspiration.'
    };
    
    return JSON.stringify(response, null, 2);
  }
);

