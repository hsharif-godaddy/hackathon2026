# Image Search Feature

This extension adds image search capabilities to the Airo App Builder using OpenAI's API with web search capability. It allows you to find relevant images based on text prompts.

## Setup Instructions

1. Copy `.env.example` to `.env` in the project root directory if you haven't already:
   ```bash
   cp .env.example .env
   ```

2. Ensure your OpenAI API key is configured in the `.env` file:
   ```
   # OpenAI API key
   OPENAI_API_KEY=sk-your-openai-api-key
   ```

3. The image search feature uses the same OpenAI API key that you're already using for other LLM services in the application.

## Usage Example

The image search tool can be used in your LLM model interactions:

```javascript
import { getToolDefinitions, executeToolFunction } from './tools';

// In your LLM service
const response = await client.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Find me an image of a mountain landscape" }
  ],
  tools: getToolDefinitions(),
});

// Handle tool calls
if (response.choices[0]?.message?.tool_calls) {
  for (const toolCall of response.choices[0].message.tool_calls) {
    const args = JSON.parse(toolCall.function.arguments);
    const result = await executeToolFunction(toolCall.function.name, args, context);
    // Process result (contains markdown image link)
  }
}
```

The tool returns results in markdown format: `![image description](image_url)`

## Implementation Details

The image search tool leverages OpenAI's API with web search capabilities to find relevant images. It sends a prompt to OpenAI's API, which searches the web and returns information including image URLs. The tool then extracts the most relevant image URL from the response and provides it in markdown format.

This implementation provides several benefits:

1. **Simplified Setup** - No need for additional API keys beyond your existing OpenAI API key
2. **Powerful Search** - Leverages OpenAI's web search capabilities
3. **Context-Aware** - The model understands the context of your image request
4. **Up-to-Date Results** - Access to recent images via web search