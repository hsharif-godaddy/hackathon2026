/**
 * QR Code AI Tool
 *
 * AI-lib wrapper for the QR code generation tool.
 * Allows agents to generate QR codes for specific pages of the user's site.
 */

import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { generateQRCode } from '../qr-code-tool.js'
import { getActionService } from '../../server/agent-runtime.js'

/**
 * QR Code generation tool for AI agents
 *
 * This tool generates QR codes that link to specific pages of the user's site.
 * The QR code is saved to the app's public directory and a public URL is returned.
 */
export const qrCodeAITool: Tool = createTool(
  `Generate a QR code for a specific page of the user's site.

WHEN TO USE:
- User requests a QR code for their site ("create a QR code", "generate QR code for my about page")
- User wants to share a specific page via QR code
- User needs a QR code for marketing or print materials

IMPORTANT:
- If user doesn't specify which page, ask them which page they want the QR code for (home page, about page, contact page, etc.)
- The QR code is saved to persistent storage (accessible at /qr-codes/ in the generated app)
- Returns a public URL that can be used to access the QR code image`,
  z.object({
    targetPage: z
      .string()
      .optional()
      .describe('The page path to generate QR code for (e.g., "/" for home, "/about" for about page). Defaults to home page if not specified.'),
    size: z
      .number()
      .optional()
      .default(1000)
      .describe('Size of the QR code in pixels (default: 1000)'),
  }),
  async (input, context) => {
    // Extract required context
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for QR code generation')
    }

    // Get socketId from context with validation
    // Note: ai-lib sets socketId on context during tool execution, but it's not in types
    const socketId = (context as any)?.socketId
    if (!socketId || typeof socketId !== 'string') {
      throw new Error('Socket ID not available in context - tool must be called via WebSocket')
    }

    // Get client action service from global registry
    const clientActionService = getActionService(socketId)
    if (!clientActionService) {
      throw new Error('Client action service not available - cannot fetch published URL')
    }

    // Default to home page if no target page specified
    const targetPage = input.targetPage || '/'

    // Generate QR code
    const result = await generateQRCode({
      appId,
      targetPage,
      size: input.size,
      clientActionService
    })

    // If generation failed, throw error to inform agent
    if (!result.success) {
      throw new Error(result.error || 'QR code generation failed')
    }

    // Return structured result for tool renderer
    return {
      success: true,
      targetUrl: result.targetUrl,
      targetPage,
      size: result.size,
      base64: result.base64
    }
  }
)
