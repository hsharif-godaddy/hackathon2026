/**
 * Media Skill Tools
 *
 * Provides MCP-based tools for:
 * - Logo generation (logo-agent MCP server)
 * - Image generation (imagegen-agent MCP server)
 * - Image editing (imagegen-agent MCP server)
 * - Video generation (imagegen-agent MCP server)
 *
 * Security: MCP calls are proxied through the browser via ClientActionService.
 * This allows the browser to make requests with its auth_idp cookie,
 * so user credentials never flow through the agent context.
 */

import { z } from 'zod';
import { logger } from '../../../logging/index.js';
import { getClientActionService } from '../../../server/ai-lib-websocket-server.js';
import type { SkillToolDefinition } from '@airo/ai-lib';

// ============================================================================
// Environment Configuration
// ============================================================================

/**
 * Valid environment prefixes for MCP server URLs
 */
type EnvironmentPrefix = 'dev-' | 'test-' | '';

/**
 * Get MCP environment prefix based on GODADDY_API_BASE_URL
 * Returns validated prefix to ensure requests go to expected hosts only
 */
function getMcpEnvironmentPrefix(): EnvironmentPrefix {
  const apiUrl = process.env.GODADDY_API_BASE_URL || '';
  if (apiUrl.endsWith('dev-godaddy.com')) return 'dev-';
  if (apiUrl.endsWith('test-godaddy.com')) return 'test-';
  return ''; // production
}

/**
 * Get MCP server URLs based on environment
 */
function getMcpServerUrls() {
  const envPrefix = getMcpEnvironmentPrefix();
  return {
    logoAgent: `https://logo-agent.mvci.api.${envPrefix}godaddy.com/mcp`,
    imagegenAgent: `https://imagegen-agent.mvci.api.${envPrefix}godaddy.com/mcp`,
  };
}

// ============================================================================
// MCP Client Helper (via Client-Side Proxy)
// ============================================================================

/**
 * Call an MCP tool via client-side proxy
 *
 * The browser makes the request with its auth_idp SSO cookie,
 * so user credentials never leave the browser boundary.
 *
 * Flow:
 * 1. Agent tool calls this function with socketId from context
 * 2. ClientActionService emits 'client_action' to browser via WebSocket
 * 3. Browser's mcpCallAction makes fetch() with credentials: 'include'
 * 4. MCP server receives request with auth_idp cookie
 * 5. Result flows back via WebSocket to agent tool
 */
async function callMcpTool<T>(
  serverUrl: string,
  toolName: string,
  input: Record<string, unknown>,
  context: unknown
): Promise<T> {
  // Extract socketId from context (set by ai-lib during tool execution)
  const socketId = (context as { socketId?: string })?.socketId;

  if (!socketId) {
    throw new Error(
      'Socket ID not available in context - cannot proxy MCP call to client. ' +
      'Tool must be called via WebSocket connection.'
    );
  }

  // Get the ClientActionService for this socket
  const clientActionService = getClientActionService(socketId);
  if (!clientActionService) {
    throw new Error(
      'Client action service not available for socket - cannot proxy MCP call. ' +
      'WebSocket connection may have been closed.'
    );
  }

  logger.info('skills.media.tools.mcp_call.start', {
    serverUrl,
    toolName,
    viaClientProxy: true,
  });

  try {
    // Execute MCP call via client-side proxy
    const result = await clientActionService.executeAction({
      action: 'mcp_call',
      params: { serverUrl, toolName, input },
      timeoutMs: 120000, // MCP calls can be slow (image/video generation)
    });

    // Check if client action succeeded
    if (!result.success) {
      throw new Error(result.error || 'MCP call failed on client');
    }

    logger.info('skills.media.tools.mcp_call.success', {
      toolName,
    });

    return result.result as T;
  } catch (error) {
    logger.error('skills.media.tools.mcp_call.error', {
      toolName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// Input Schemas
// ============================================================================

const GenerateLogoInputSchema = z.object({
  businessName: z
    .string()
    .min(1, { message: 'Business name required' })
    .describe('The name of the business'),
  businessDescription: z
    .string()
    .min(1, { message: 'Business description required' })
    .describe('A description of the business'),
  businessVibe: z
    .string()
    .optional()
    .describe('The desired vibe or feeling for the logo (e.g., modern, playful, professional)'),
  logoColors: z
    .string()
    .optional()
    .describe('Desired colors for the logo as a text description (e.g., "warm earth tones", "blue and white")'),
  logoSymbol: z.string().optional().describe('Desired symbol or icon for the logo'),
  logoText: z.string().optional().describe('Text to include in the logo'),
  logoCount: z
    .coerce // Coerce string to number since LLMs often pass numbers as strings
    .number()
    .int()
    .min(1)
    .max(4)
    .default(4)
    .describe('Number of logos to generate as a number (1-4, default: 4)'),
});

const GenerateImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('The text prompt to generate an image for'),
  orientation: z
    .enum(['landscape', 'portrait', 'square'])
    .default('landscape')
    .describe('The orientation of the image'),
  imageCount: z
    .coerce // Coerce string to number since LLMs often pass numbers as strings
    .number()
    .int()
    .min(1)
    .max(4)
    .default(1)
    .describe('Number of images to generate as a number (1-4, default: 1)'),
});

const EditImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('The prompt for the edits to be made to the image'),
  imageUrl: z.string().url().describe('The URL of the image to be edited'),
});

const GenerateVideoInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('The text prompt to generate a video for'),
  model: z
    .enum(['sora-2', 'veo-2', 'veo-3'])
    .default('veo-2')
    .describe('The model to use for video generation'),
  orientation: z
    .enum(['landscape', 'portrait'])
    .default('landscape')
    .describe('The orientation of the video'),
  duration: z
    .string()
    .describe(
      'The duration of the video in seconds (4, 8, 12 for sora-2; 5-8 for veo-2; 4, 6, 8 for veo-3)'
    ),
});

// ============================================================================
// Type Aliases for Tool Inputs
// ============================================================================

type GenerateLogoInput = z.infer<typeof GenerateLogoInputSchema>;
type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;
type EditImageInput = z.infer<typeof EditImageInputSchema>;
type GenerateVideoInput = z.infer<typeof GenerateVideoInputSchema>;

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Logo generation tool using logo-agent MCP server
 */
export const generateLogoTool: SkillToolDefinition = {
  name: 'generate_logo',
  description:
    'Generate professional logos for a business using AI. Returns URLs to generated logo images. Requires business name and description.',

  parameters: GenerateLogoInputSchema,

  async execute(input: GenerateLogoInput, context?: unknown) {
    const servers = getMcpServerUrls();

    logger.info('skills.media.tools.generate_logo.start', {
      businessName: input.businessName,
      logoCount: input.logoCount,
    });

    const result = await callMcpTool(servers.logoAgent, 'generate_logo', input, context);

    logger.info('skills.media.tools.generate_logo.success', {
      businessName: input.businessName,
    });

    return result;
  },

  config: {
    timeout: 120000, // 2 minutes for logo generation
  },
};

/**
 * Image generation tool using imagegen-agent MCP server
 */
export const generateImageTool: SkillToolDefinition = {
  name: 'generate_image',
  description:
    'Generate images from text prompts using AI. Returns URLs to generated images. Use this when image search does not find suitable results or when custom AI-generated images are needed.',

  parameters: GenerateImageInputSchema,

  async execute(input: GenerateImageInput, context?: unknown) {
    const servers = getMcpServerUrls();

    logger.info('skills.media.tools.generate_image.start', {
      promptLength: input.prompt.length,
      orientation: input.orientation,
      imageCount: input.imageCount,
    });

    const result = await callMcpTool(servers.imagegenAgent, 'generate_image', input, context);

    logger.info('skills.media.tools.generate_image.success', {
      orientation: input.orientation,
    });

    return result;
  },

  config: {
    timeout: 120000, // 2 minutes for image generation
  },
};

/**
 * Image editing tool using imagegen-agent MCP server
 */
export const editImageTool: SkillToolDefinition = {
  name: 'edit_image',
  description:
    'Edit an existing image using AI-powered modifications. Provide the image URL and describe the changes you want to make.',

  parameters: EditImageInputSchema,

  async execute(input: EditImageInput, context?: unknown) {
    const servers = getMcpServerUrls();

    logger.info('skills.media.tools.edit_image.start', {
      promptLength: input.prompt.length,
      hasImageUrl: !!input.imageUrl,
    });

    const result = await callMcpTool(servers.imagegenAgent, 'edit_image', input, context);

    logger.info('skills.media.tools.edit_image.success', {});

    return result;
  },

  config: {
    timeout: 120000, // 2 minutes for image editing
  },
};

/**
 * Video generation tool using imagegen-agent MCP server
 */
export const generateVideoTool: SkillToolDefinition = {
  name: 'generate_video',
  description:
    'Generate videos from text prompts using AI models like Sora or Veo. Returns URL to generated video.',

  parameters: GenerateVideoInputSchema,

  async execute(input: GenerateVideoInput, context?: unknown) {
    const servers = getMcpServerUrls();

    logger.info('skills.media.tools.generate_video.start', {
      promptLength: input.prompt.length,
      model: input.model,
      orientation: input.orientation,
      duration: input.duration,
    });

    const result = await callMcpTool(servers.imagegenAgent, 'generate_video', input, context);

    logger.info('skills.media.tools.generate_video.success', {
      model: input.model,
    });

    return result;
  },

  config: {
    timeout: 300000, // 5 minutes for video generation
  },
};
