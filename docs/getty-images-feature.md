# Getty Images Search Feature

This feature provides access to professional stock photos from Getty Images API. The tool searches for images based on a phrase and returns high-quality image URLs.

## Setup Instructions

1. Add your SSO JWT token to the `.env` file:
   ```
   # Getty Images API configuration
   SSO_JWT=your-sso-jwt-token
   ```

2. (Optional) You can also configure the Getty API URL and app key if needed:
   ```
   GETTY_API_URL=https://getty-images-proxy.api.test-godaddy.com/v1/search
   GETTY_APP_KEY=airo-app-builder
   ```

## Usage Example

The Getty image search tool can be used in your LLM model interactions:

```javascript
import { getToolDefinitions, executeToolFunction } from './tools';

// In your LLM service
const response = await client.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Find me a professional image of a gym" }
  ],
  tools: getToolDefinitions(),
});

// Handle tool calls
if (response.choices[0]?.message?.tool_calls) {
  for (const toolCall of response.choices[0].message.tool_calls) {
    if (toolCall.function.name === 'getty_image') {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await executeToolFunction('getty_image', args, context);
      // Process result (contains markdown image link with Getty image URLs)
    }
  }
}
```

## Parameters

The Getty image search tool supports the following parameters:

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `phrase` | string | Search phrase for finding images (e.g., "gym", "office meeting") | (required) |
| `page` | number | Page number for results pagination | 1 |
| `pageSize` | number | Number of results per page | 50 |
| `graphicalStyles` | string | Type of imagery to search for (e.g., photography, illustration) | 'photography' |
| `sortOrder` | string | Sort order for results: 'best_match', 'most_popular', or 'newest' | 'best_match' |

## Implementation Details

The Getty image search tool uses the Getty Images API to find high-quality stock photos. It provides the following features:

1. **Professional Stock Photography** - Access to Getty Images' vast collection of professional photos
2. **Search Options** - Find images with customizable search parameters
3. **Multiple Image Resolutions** - Returns URLs for various image sizes (thumbnail, preview, standard, high-res)
4. **Image Metadata** - Provides image dimensions and ID information
5. **API Integration** - Direct integration with Getty Images API

## Response Format

The tool returns results in markdown format: `![search phrase](image_url)`

The response also includes:
```
Getty Image ID: 1346094138 (5464x8192)
Thumbnail URL: https://media.gettyimages.com/id/1346094138/photo/shot-of-an-empty-gym.jpg?s=170x170
Found 544540 total images matching your search.
```

## Example API Response

Here's an example of the Getty Images API response structure that the tool processes:

```json
{
  "result_count": 544540,
  "images": [
    {
      "display_sizes": [
        {
          "is_watermarked": false,
          "name": "comp",
          "uri": "https://media.gettyimages.com/id/1346094138/photo/shot-of-an-empty-gym-ready-to-be-used.jpg?b=1&s=612x612&w=0&k=20&c=qDp6tlTdlgozHKzxxkVW-a9H6yJ1xl_JIUk9hpdN_JI="
        },
        {
          "is_watermarked": false,
          "name": "thumb",
          "uri": "https://media.gettyimages.com/id/1346094138/photo/shot-of-an-empty-gym-ready-to-be-used.jpg?b=1&s=170x170&k=20&c=tZxefwN_jmQ0bcGTq-v6KSvGt-cIYf5gVVi3K8acS-0="
        },
        {
          "is_watermarked": false,
          "name": "high_res_comp",
          "uri": "https://media.gettyimages.com/id/1346094138/photo/shot-of-an-empty-gym-ready-to-be-used.jpg?b=1&s=2048x2048&w=0&k=20&c=UFOtPHQ-eVfHLHiPUNKqFwxUDWd3A3bHvNgacPX_tVI="
        }
      ],
      "id": "1346094138",
      "max_dimensions": {
        "height": 5464,
        "width": 8192
      }
    }
  ]
}
```

## Usage Considerations

1. **Stock Photo Licensing** - Be aware of Getty Images licensing requirements for production use
2. **Attribution** - Some images may require attribution - check Getty's terms for details
3. **API Limits** - Getty Images API may have usage limits
4. **Image Selection** - The tool automatically selects the highest resolution non-watermarked image available