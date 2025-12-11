# Website Scraper Tool

## Overview

The Website Scraper Tool allows you to extract content and capture screenshots from any website to analyze design patterns and content structure. This is useful when users want to build applications similar to existing websites or need design inspiration.

## Features

- **Content Extraction**: Retrieves sanitized text content from websites
- **Screenshot Capture**: Takes a visual screenshot of the website
- **Parallel Processing**: Makes both API calls simultaneously using Promise.all
- **SSO Authentication**: Uses SSO JWT tokens for secure API access

## Environment Variables

Add these environment variables to your `.env` file:

```bash
# Required: SSO JWT token for authentication
SSO_JWT=your-sso-jwt-token

# Optional: Custom API base URL (defaults to internal service)
WEB_SCRAPER_API_URL=https://web-scraper.api.int.test-gdcorp.tools

# Optional: Custom app key (defaults to 'airo-app-builder')
WEB_SCRAPER_APP_KEY=airo-app-builder

# Optional: Direct bearer token (alternative to SSO_JWT)
WEB_SCRAPER_TOKEN=your-bearer-token
```

## API Endpoints

The tool uses two endpoints from the web-scraper service:

### 1. Scrape Website

- **Endpoint**: `GET /v1/scrape-website`
- **Query Parameter**: `url` (string)
- **Returns**: Sanitized content, HTML, scrape time, and status

### 2. Screenshot Website

- **Endpoint**: `GET /v1/screenshot-website`
- **Query Parameter**: `url` (string)
- **Returns**: Image URL (string)

## Usage

### AI-Lib Tool (Recommended)

```typescript
import { websiteScraperAITool } from './tools/ai-lib-tools/website-scraper.js';

// Use in agent configuration
const agent = createAgent({
  tools: [websiteScraperAITool],
  // ... other config
});

// The agent can now use it in conversations
// User: "Make a website similar to https://example.com"
// Agent will automatically call websiteScraper with the URL
```

### Direct Usage via Driver

```typescript
import { WebsiteScraperDriver } from './tools/ai-lib-tools/drivers/website-scraper-driver.js';

const driver = new WebsiteScraperDriver();
const result = await driver.scrapeAndScreenshot({
  url: 'https://example.com',
});

if (result.success) {
  console.log('Content:', result.sanitizedContent);
  console.log('Screenshot:', result.screenshotUrl);
  console.log('Scrape time:', result.scrapeTime, 'ms');
}
```

### MCP Tool Format

```typescript
import { scrapeWebsite } from './tools/website-scraper-tool.js';

const response = await scrapeWebsite({
  params: {
    arguments: {
      url: 'https://example.com',
    },
  },
});
```

## Response Format

```typescript
{
  success: true,
  url: "https://example.com",
  content: "Sanitized text content from the website...",
  screenshotAttached: true,
  scrapeTime: 1234,
  message: "Successfully extracted website content and captured screenshot. The screenshot has been attached to the conversation context for visual analysis..."
}
```

**Note:** The screenshot is automatically converted from blob URL to base64 and attached to the conversation context metadata (`context.metadata._screenshots`), making it available for visual analysis by the AI model.

## Error Handling

The tool handles various error cases:

- **Invalid URL**: Returns error if URL is missing or malformed
- **Missing Authentication**: Returns error if SSO_JWT is not configured
- **API Failures**: Catches and reports scraping or screenshot failures
- **Network Errors**: Handles timeout and connection issues

## Use Cases

1. **Design Inspiration**: User provides a website URL and asks to create something similar
2. **Content Analysis**: Extract structure and content patterns from existing sites
3. **Competitive Analysis**: Analyze competitor websites for features and design
4. **Migration Projects**: Understand existing site structure before rebuilding

## Example Prompts

Users can trigger this tool with prompts like:

- "Make a website similar to https://airbnb.com"
- "Analyze the design of https://stripe.com"
- "I want to build something like https://example.com"
- "Get inspiration from this website: [URL]"

## Tool Registration

The tool is automatically registered in:

- **AI-Lib Registry**: Available in `allAILibTools` and `toolGroups.media`
- **Tool Index**: Exported from main tools index
- **Agents**: Can be included in any agent's tool configuration

## Logging

The tool uses structured logging with these events:

- `website-scraper.config.initialized`: Configuration loaded
- `website-scraper.request.begin`: Request started
- `website-scraper.scrape.request`: Content scraping started
- `website-scraper.screenshot.request`: Screenshot capture started
- `website-scraper.request.success`: Both operations completed
- `website-scraper.request.error`: Error occurred

## Testing

To test the tool:

```bash
# Set environment variable
export SSO_JWT="your-token-here"

# Run a test script
node -e "
import { WebsiteScraperDriver } from './dist/tools/ai-lib-tools/drivers/website-scraper-driver.js';
const driver = new WebsiteScraperDriver();
const result = await driver.scrapeAndScreenshot({ url: 'https://example.com' });
console.log(JSON.stringify(result, null, 2));
"
```

## Architecture

```
website-scraper-tool.ts (MCP wrapper)
    ↓
website-scraper.ts (AI-Lib tool)
    ↓
WebsiteScraperDriver (drivers/website-scraper-driver.ts)
    ↓
    ├── scrapeWebsite() → /v1/scrape-website
    └── screenshotWebsite() → /v1/screenshot-website
```

## Security Considerations

- Uses SSO JWT authentication for all API calls
- Validates URL format before making requests
- Does not store or cache scraped content
- Respects API rate limits and quotas
- All requests go through authenticated proxy

## Limitations

- Requires active SSO JWT token
- Subject to API rate limits
- Screenshot may not capture dynamic content perfectly
- Some websites may block scraping attempts
- Content extraction may vary based on site structure

## Future Enhancements

Potential improvements:

- Add caching for frequently scraped URLs
- Support for authenticated website scraping
- Custom viewport sizes for screenshots
- Mobile vs desktop screenshot options
- More granular content extraction options
- Rate limiting and retry logic
