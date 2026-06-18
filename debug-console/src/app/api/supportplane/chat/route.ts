import { NextRequest, NextResponse } from 'next/server';

import { type AuthenticatedRequest, withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { callGoCode } from '@/lib/gocode-client';
import { TRANSCRIPT_TOOLS, executeToolCall } from '@/lib/chat-tools';
import {
  getOrCreateSession,
  saveChatMessage,
  getChatMessages,
} from '@/lib/chat-db';

export const dynamic = 'force-dynamic';

interface ChatRequest {
  prompt: string;
  context?: string;
  session_id?: string;
  load_history?: boolean;
}

function readToolArgs(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid tool arguments payload');
  }
  return parsed as Record<string, unknown>;
}

/**
 * POST /api/supportplane/chat
 *
 * Simple chat endpoint for transcript and feedback panels.
 * Routes to GoCode for AI responses.
 */
export const POST = withAuth(async function supportplaneChat(
  request: NextRequest,
  auth: AuthenticatedRequest
) {
  try {
    const body = (await request.json()) as ChatRequest;
    const { prompt, context, session_id, load_history } = body;

    const userEmail = auth.user?.email || 'unknown@example.com';

    // If requesting history only
    if (load_history) {
      const session = getOrCreateSession(userEmail, context || 'general');
      const messages = getChatMessages(session.session_id);
      return NextResponse.json({
        session_id: session.session_id,
        messages: messages.map(m => ({ role: m.role, content: m.content, ts: m.created_at })),
      });
    }

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }

    // Get or create session
    const session = getOrCreateSession(userEmail, context || 'general');

    // Build system prompt based on context
    let systemPrompt = 'You are a helpful AI assistant for the Airo App Builder support team.';
    let tools = undefined;

    if (context === 'transcripts') {
      systemPrompt = `You are an L1 Transcript Intelligence assistant for the GoDaddy Airo App Builder support team.
You have direct access to the L1 transcripts SQLite database via function calling tools.

Database schema:
- interaction_id, shopper_id, customer_id, app_id, domain
- created_at, updated_at, ingested_at
- tags (JSON array of AI-generated friction points like "publish_failure", "responsiveness_not_working")
- conversation_summary, full_transcript
- sentiment_score, interaction_status, resolution_time_seconds
- category, subcategory, agent_name

When asked about trends, friction points, or statistics, USE YOUR TOOLS to query the database.
Focus on AI-generated tags which represent customer pain points with Airo App Builder.

Be concise and data-driven. Always cite exact numbers from tool results.`;
      tools = TRANSCRIPT_TOOLS;
    } else if (context === 'feedback') {
      systemPrompt = `You are a Product Feedback Intelligence assistant for the GoDaddy Airo App Builder team.
You analyze customer feedback data including ratings (1-7), sentiment, topics, and verbatim comments.
Help identify trends, sentiment patterns, common issues, and feature requests.
Be concise and actionable. Reference data when available, note when database queries would give exact numbers.`;
    }

    // Initial API call
    let response = await callGoCode({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1024,
      timeout_ms: 30000,
      tools,
    });

    let message = response.choices[0]?.message;
    if (!message) {
      throw new Error('No response from GoCode');
    }

    // Handle function calls (multi-turn conversation)
    const conversationHistory: any[] = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: prompt },
      { role: 'assistant' as const, content: message.content || '', tool_calls: message.tool_calls },
    ];

    while (message.tool_calls && message.tool_calls.length > 0) {
      // Execute all tool calls
      for (const toolCall of message.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = readToolArgs(toolCall.function.arguments);

        logger.info('chat.tool_call', { function: functionName, args: functionArgs });

        const toolResult = await executeToolCall(functionName, functionArgs);

        conversationHistory.push({
          role: 'tool' as const,
          content: toolResult,
          tool_call_id: toolCall.id,
        });
      }

      // Continue conversation with tool results
      response = await callGoCode({
        messages: conversationHistory as any,
        temperature: 0.7,
        max_tokens: 1024,
        timeout_ms: 30000,
        tools,
      });

      message = response.choices[0]?.message;
      if (!message) {
        throw new Error('No response from GoCode after tool calls');
      }

      conversationHistory.push({
        role: 'assistant' as const,
        content: message.content || '',
        tool_calls: message.tool_calls,
      });
    }

    if (!message.content) {
      throw new Error('No content in final response');
    }

    // Save user message and assistant response to DB
    saveChatMessage(session.session_id, 'user', prompt);
    saveChatMessage(session.session_id, 'assistant', message.content);

    return NextResponse.json({
      text: message.content,
      message: message.content,
      session_id: session.session_id,
    });

  } catch (err) {
    logger.error('supportplane.chat.error', {}, { error: err as Error });
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Unknown error',
        text: 'Sorry, I encountered an error processing your request.'
      },
      { status: 500 }
    );
  }
});
