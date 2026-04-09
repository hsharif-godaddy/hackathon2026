/**
 * Chat API Route — Streaming Chatbot / Agent
 *
 * Handles POST /api/chat
 * Streams raw text responses from the configured AI provider using the Vercel AI SDK.
 *
 * The client reads this as a plain ReadableStream<string> — no special protocol needed.
 *
 * For AGENT MODE: Uncomment the two import lines at the top and the
 * tools/maxSteps block inside streamText() below, then implement your tools.
 *
 * See src/lib/chatbot/chat-config.ts to configure the provider and model.
 */

import type { Request, Response } from 'express';
import { streamText } from 'ai';
// import { tool } from 'ai';   // ← Uncomment for agent mode
// import { z } from 'zod';     // ← Uncomment for agent mode
import { getChatModel, SYSTEM_PROMPT } from '@/lib/chatbot/chat-config';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default async function handler(req: Request, res: Response) {
  const messages = req.body?.messages as ChatMessage[] | undefined;

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'Missing or invalid messages array' });
    return;
  }

  // Strip any system-role messages from the client — the server-side SYSTEM_PROMPT
  // is the only authoritative system context. Allowing 'system' from the client
  // would enable prompt injection attacks.
  const safeMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');

  try {
    const model = getChatModel();

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: safeMessages,

      // ─── AGENT MODE ──────────────────────────────────────────────────────
      // Uncomment tools and maxSteps to enable multi-step tool calling.
      // tools: {
      //   getCurrentTime: tool({
      //     description: 'Get the current date and time',
      //     parameters: z.object({}),
      //     execute: async () => ({ time: new Date().toISOString() }),
      //   }),
      //   // Add more tools here...
      // },
      // maxSteps: 5,
      // ─────────────────────────────────────────────────────────────────────
    });

    // Disable nginx proxy buffering so chunks reach the client immediately.
    res.setHeader('X-Accel-Buffering', 'no');

    // pipeTextStreamToResponse is the confirmed Express streaming method on
    // StreamTextResult in AI SDK v6. It pipes the raw text stream directly
    // into the Express ServerResponse and calls res.end() when complete.
    result.pipeTextStreamToResponse(res);

    console.log(JSON.stringify({ event: 'chat.stream.started', messageCount: safeMessages.length }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(JSON.stringify({ event: 'chat.error', error: message }));

    if (!res.headersSent) {
      res.status(500).json({ error: 'Chat request failed' });
    }
  }
}
