import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { Logger } from '../../logging/index.js';

const logger = Logger.create({ service: 'social-status' });

export const socialStatus: Tool = createTool(
  `Check connection status for all social media platforms.

This tool returns a visual dashboard widget showing which platforms are connected and which are not.

WHAT IT SHOWS:
- Visual grid of all 4 supported platforms (Facebook, Instagram, Google Business Profile, TikTok Shop)
- Connection status for each platform (connected/not connected)
- Visual indicators for connected platforms (green) and disconnected platforms (muted)
- Count of connected platforms

WHEN TO USE:
- When user asks "what platforms am I connected to?"
- Before attempting to post to social media
- To verify authentication status after connecting
- As first step in any social media workflow

IMPORTANT NOTES:
- Returns widget signal - frontend fetches connections directly
- Let the visual dashboard speak for itself
- Widget displays in real-time in the UI
- Shows ALL platforms regardless of connection status

Use this tool at the start of social media workflows to check which platforms are available.`,
  z.object({}),
  async (_input, _context) => {
    logger.info('social-status.signal');

    return {
      action: 'status',
      success: true,
    };
  }
);
