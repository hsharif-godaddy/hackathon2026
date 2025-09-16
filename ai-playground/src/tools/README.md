# AI Playground Tools

This directory contains all the tools available in the AI Playground. Each tool is defined in its own file for better organization and maintainability.

## Available Tools

### 🧮 Calculator (`calculator.ts`)
- **Purpose**: Perform mathematical calculations
- **Input**: Mathematical expression as a string
- **Example**: `"2 + 3 * 4"`
- **Output**: Calculation result with success status

### 🌤️ Weather (`weather.ts`)
- **Purpose**: Get real-time weather information using Open-Meteo API
- **Input**: Location name (city, country, etc.)
- **Example**: `"Tokyo"`, `"New York, NY"`
- **Features**: 
  - Geocoding to convert location names to coordinates
  - Current weather conditions, temperature, humidity, wind speed
  - Weather code interpretation

### 📋 Task Planner (`task-planner.ts`)
- **Purpose**: Break down complex tasks into actionable steps
- **Input**: Task description and optional timeframe
- **Example**: `"Plan a website redesign"`, timeframe: `"2 weeks"`
- **Output**: Step-by-step breakdown with estimated duration

### 🎨 Image Generator (`image-generator.ts`)
- **Purpose**: Generate images using DALL-E based on text descriptions
- **Input**: Text prompt, optional size and count
- **Example**: `"A serene mountain landscape at sunset"`
- **Features**:
  - Multiple image sizes (256x256 to 1792x1024)
  - Support for multiple images (1-4)
  - Base64 and URL output formats

## Usage

### Import Individual Tools
```typescript
import { calculatorTool, weatherTool } from '../tools'
```

### Import All Tools
```typescript
import { tools } from '../tools'

// Use as: tools.calculator, tools.weather, etc.
```

## Adding New Tools

1. Create a new file in this directory (e.g., `my-tool.ts`)
2. Use the `createTool` function from `@airo/ai-lib`
3. Export your tool
4. Add the export to `index.ts`
5. Update this README

### Tool Template
```typescript
import { createTool } from '@airo/ai-lib'
import { z } from 'zod'

export const myTool = createTool(
  'Tool description for the AI',
  z.object({
    input: z.string().describe('Input description')
  }),
  async ({ input }: { input: string }) => {
    // Tool implementation
    return {
      result: 'Tool output',
      success: true
    }
  }
)
```

## Architecture

- **Modular**: Each tool is self-contained
- **Type-safe**: Full TypeScript support with Zod validation
- **Reusable**: Tools can be imported individually or as a collection
- **Testable**: Each tool can be tested independently
- **Maintainable**: Clear separation of concerns

## Development

When modifying tools:
1. Update the tool file
2. Test the tool individually if needed
3. Run `pnpm run build:server` to compile
4. Test in the playground interface

## Error Handling

All tools should:
- Return a `success: boolean` field
- Include error messages in case of failure
- Log relevant information for debugging
- Handle edge cases gracefully
