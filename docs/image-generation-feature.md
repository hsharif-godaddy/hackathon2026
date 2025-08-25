# Image Generation Feature

This feature adds AI-powered image generation capabilities to the Airo App Builder using OpenAI's DALL-E model. It enables you to create custom images based on text prompts and automatically saves them to your app's public directory for immediate use.

## Setup Instructions

1. Ensure your OpenAI API key is configured in the `.env` file:
   ```
   # OpenAI API key
   OPENAI_API_KEY=sk-your-openai-api-key
   ```

2. The image generation feature uses the same OpenAI API key that you're already using for other LLM services.

3. Generated images are automatically saved to your app's public directory at `apps/{appId}/public/images/` and can be accessed via the path `/images/filename.png` in your application.

## Usage Example

The image generation tool can be used in your LLM model interactions:

```javascript
import { getToolDefinitions, executeToolFunction } from './tools';

// In your LLM service
const response = await client.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Generate an image of a space station orbiting Jupiter" }
  ],
  tools: getToolDefinitions(),
});

// Handle tool calls
if (response.choices[0]?.message?.tool_calls) {
  for (const toolCall of response.choices[0].message.tool_calls) {
    if (toolCall.function.name === 'image_generate') {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await executeToolFunction('image_generate', args, context);
      // Process result (contains markdown image link with path to the saved image)
    }
  }
}
```

## Parameters

The image generation tool supports the following parameters:

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `prompt` | string | Detailed description of the image to generate | (required) |
| `size` | string | Size of the generated image: '1024x1024', '512x512', or '256x256' | '1024x1024' |
| `style` | string | Visual style for the image: 'vivid' or 'natural' | 'vivid' |
| `filename` | string | Custom filename without extension (optional) | Generated from prompt |

## Implementation Details

The image generation tool uses OpenAI's DALL-E model via the images.generate API endpoint. It provides the following features:

1. **High-Quality Image Generation** - Creates detailed images based on text prompts
2. **Customization Options** - Supports different sizes and styles
3. **Automatic Local Saving** - Saves generated images to your app's public directory
4. **Public Accessibility** - Images are immediately available for use in your application
5. **Markdown Integration** - Returns results in markdown format for easy display

## Response Format

The tool returns results in markdown format: `![image description](/images/filename.png)`

The response also includes: `Image saved to: /images/filename.png`

This path is relative to your app's public directory and can be used directly in your application's HTML or CSS.

## Pricing Considerations

Image generation uses OpenAI's DALL-E model, which incurs costs based on the number of images generated and their size. Please refer to [OpenAI's pricing page](https://openai.com/pricing) for current rates.