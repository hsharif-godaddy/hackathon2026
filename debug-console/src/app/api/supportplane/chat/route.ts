import { NextRequest, NextResponse } from 'next/server';

import { type AuthenticatedRequest, withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { callGoCode } from '@/lib/gocode-client';
import { TRANSCRIPT_TOOLS, executeToolCall } from '@/lib/chat-tools';
import {
  getOrCreateSession,
  saveChatMessage,
  getChatMessages,
} from '@/lib/supportplane/db/chat-db';

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
You have direct access to the L1 transcripts DynamoDB database via function calling tools.

Database schema (DynamoDB):
- interaction_id (partition key), shopper_id, customer_id, app_id, domain
- created_at (ISO8601 timestamp, sort key)
- tags (JSON array of AI-generated friction points like "publish_failure", "responsiveness_not_working")
- conversation_summary, full_transcript
- sentiment_score, interaction_status, resolution_time_seconds
- category, agent_name, interaction_type
- raw_data (JSON object containing: friction_point, sub_intent, issue_resolution, customer_sentiment,
  potential_preventative_action, actionable_improvement_opportunity, inbound_volume_driver,
  preventable_contact, repeat_contact, sales_consultation, conversion_signal, related_to_known_issue,
  agent_skill_level, agent_department, call_type, care_contact_platform, customer_type_name,
  country, market_region_signal, and other structured fields from L1 transcripts)

Note: The following fields do NOT exist in DynamoDB: updated_at, ingested_at, subcategory.

When asked about trends, friction points, or statistics, USE YOUR TOOLS to query the database.
Focus on AI-generated tags which represent customer pain points with Airo App Builder.
The raw_data field contains rich structured information about each interaction.

Be concise and data-driven. Always cite exact numbers from tool results.`;
      tools = TRANSCRIPT_TOOLS;
    } else if (context === 'feedback') {
      systemPrompt = `You are a Product Feedback Intelligence assistant for the GoDaddy Airo App Builder team.
You analyze customer feedback data including ratings (1-7), sentiment, topics, and verbatim comments.
Help identify trends, sentiment patterns, common issues, and feature requests.
Be concise and actionable. Reference data when available, note when database queries would give exact numbers.`;
    }

    // Truncate large tool results to prevent context overflow
    function truncateToolResult(result: string, maxLength = 8000): string {
      if (result.length <= maxLength) {
        return result;
      }
      return result.substring(0, maxLength) + '\n\n... [Result truncated due to length. Showing first ' + maxLength + ' characters]';
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

    let toolCallRounds = 0;
    const MAX_TOOL_CALL_ROUNDS = 5;

    while (message.tool_calls && message.tool_calls.length > 0 && toolCallRounds < MAX_TOOL_CALL_ROUNDS) {
      toolCallRounds++;

      // Execute all tool calls
      for (const toolCall of message.tool_calls) {
        const functionName = toolCall.function.name;

        let toolResult: string;
        try {
          const functionArgs = readToolArgs(toolCall.function.arguments);
          logger.info('chat.tool_call', { function: functionName, args: functionArgs });

          const rawResult = await executeToolCall(functionName, functionArgs);

          // Validate and format result
          if (rawResult === null || rawResult === undefined) {
            toolResult = JSON.stringify({ error: 'Tool returned no data' });
          } else if (typeof rawResult === 'object') {
            toolResult = JSON.stringify(rawResult, null, 2);
          } else {
            toolResult = String(rawResult);
          }

          // Truncate large results to prevent context overflow
          toolResult = truncateToolResult(toolResult);

        } catch (error: unknown) {
          logger.error('chat.tool_call.error', {
            tool: functionName,
            error: error instanceof Error ? error.message : String(error)
          });
          toolResult = JSON.stringify({
            error: 'Tool execution failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        conversationHistory.push({
          role: 'tool' as const,
          content: toolResult,
          tool_call_id: toolCall.id,
        });
      }

      // Continue conversation with tool results
      try {
        response = await callGoCode({
          messages: conversationHistory as any,
          temperature: 0.7,
          max_tokens: 1024,
          timeout_ms: 30000,
          tools,
        });
      } catch (error: unknown) {
        // Handle context overflow (400 error: "Input is too long")
        if (error instanceof Error && error.message.includes('Input is too long')) {
          logger.warn('chat.context_overflow', {
            historyLength: conversationHistory.length,
            toolCallRounds,
          });

          // Truncate conversation history - keep system prompt, user message, and recent tool results
          const truncatedHistory = [
            conversationHistory[0], // system prompt
            conversationHistory[1], // user message
            ...conversationHistory.slice(-6), // last 6 messages (3 tool call/result pairs)
          ];

          response = await callGoCode({
            messages: truncatedHistory as any,
            temperature: 0.7,
            max_tokens: 1024,
            timeout_ms: 30000,
            tools,
          });
        } else {
          throw error;
        }
      }

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

    if (toolCallRounds >= MAX_TOOL_CALL_ROUNDS) {
      logger.warn('chat.max_tool_rounds_exceeded', { rounds: toolCallRounds });
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

    // Provide specific error messages based on error type
    let userMessage = 'Sorry, I encountered an error processing your request.';
    if (err instanceof Error) {
      if (err.message.includes('Input is too long')) {
        userMessage = '⚠️ The conversation has become too long. Please start a new chat session or ask a simpler question.';
      } else if (err.message.includes('timeout')) {
        userMessage = '⚠️ The request timed out. Try asking a more specific question or reducing the time range.';
      } else if (err.message.includes('Tool returned no data')) {
        userMessage = '⚠️ No data found for your query. Try adjusting the time range or search criteria.';
      }
    }

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Unknown error',
        text: userMessage
      },
      { status: 500 }
    );
  }
});
