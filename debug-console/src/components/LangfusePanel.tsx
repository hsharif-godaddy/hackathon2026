'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Module-level cache for Langfuse config
interface LangfuseConfig {
  baseUrl: string | null;
  projectId: string | null;
}
let cachedLangfuseConfig: LangfuseConfig | null = null;
let configFetchPromise: Promise<LangfuseConfig | null> | null = null;

async function getLangfuseConfig(): Promise<LangfuseConfig | null> {
  if (cachedLangfuseConfig) {return cachedLangfuseConfig;}
  if (configFetchPromise) {return configFetchPromise;}

  configFetchPromise = fetch('/api/langfuse/config')
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      cachedLangfuseConfig = {
        baseUrl: data?.baseUrl || null,
        projectId: data?.projectId || null
      };
      return cachedLangfuseConfig;
    })
    .catch(() => null);

  return configFetchPromise;
}

interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | null | Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; result?: unknown; args?: unknown }>;
}

interface TraceInput {
  system?: string;
  prompt?: string;
  messages?: Message[];
  [key: string]: unknown;
}

interface TraceAttributes {
  'ai.model.id'?: string;
  'ai.model.provider'?: string;
  'ai.usage.inputTokens'?: string;
  'ai.usage.outputTokens'?: string;
  'ai.usage.totalTokens'?: string;
  'ai.usage.cachedInputTokens'?: string;
  'ai.settings.temperature'?: string;
  'ai.response.finishReason'?: string;
  'ai.response.text'?: string;
  'ai.response.toolCalls'?: string;
  'session.id'?: string;
  [key: string]: unknown;
}

interface TraceMetadata {
  attributes?: TraceAttributes;
  tools?: unknown[];
  [key: string]: unknown;
}

interface Observation {
  id: string;
  name: string;
  type: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  statusMessage?: string;
  level?: string;
  parentObservationId?: string;
  startTime?: string;
  endTime?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  calculatedInputCost?: number;
  calculatedOutputCost?: number;
  calculatedTotalCost?: number;
  metadata?: {
    attributes?: TraceAttributes;
    [key: string]: unknown;
  };
}

interface Trace {
  id: string;
  name: string;
  timestamp: string;
  input: TraceInput | string | null;
  output: unknown;
  metadata: TraceMetadata | null;
  tags: string[];
  observations?: Observation[];
}

interface Session {
  sessionId: string;
  traces: Trace[];
  firstTrace: string;
  lastTrace: string;
  traceCount: number;
}

interface SessionsResponse {
  userId: string;
  sessions: Session[];
  totalTraces: number;
  pagination?: {
    page: number;
    totalPages: number;
    hasMore: boolean;
  };
}

interface ESError {
  timestamp: string;
  type: 'error' | 'client_error';
  message: string;
  eventType?: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

interface ESErrorsResponse {
  errors: ESError[];
  totalErrors: number;
  totalClientErrors: number;
  uniqueErrors: number;
}

interface ToolCallInfo {
  name: string;
  args?: string;
  toolCallId?: string;
}

interface AgentStep {
  generationId: string;
  text: string;
  toolCalls: {
    name: string;
    args?: string;
    toolCallId?: string;
    result?: unknown;
    durationMs?: number;
    success?: boolean;
    statusMessage?: string;
  }[];
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface ConversationItem {
  id: string;
  type: 'user' | 'assistant' | 'summarization';
  timestamp: string;
  content: string;
  agentName?: string;
  traceId?: string;
  sessionId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cost?: number;
  model?: string;
  provider?: string;
  temperature?: number;
  finishReason?: string;
  tools?: ToolCallInfo[];
  systemPrompt?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  isAgentHandoff?: boolean;
  sourceAgent?: string;
  msToFirstChunk?: number;
  msToFinish?: number;
  cacheWriteInputTokens?: number;
  toolObservations?: Observation[];
  traceLatencyMs?: number;
  llmStepCount?: number;
  toolTimings?: { name: string; durationMs: number }[];
  totalToolTimeMs?: number;
  totalLlmTimeMs?: number;
  summaryTimeMs?: number;
  ragTimeMs?: number;
  observationErrors?: { name: string; message: string; obsType?: string }[];
  agentSteps?: AgentStep[];
  // Summarization-only trace fields
  summaryStepCount?: number;
  summarySteps?: { name: string; durationMs: number; inputTokens: number; outputTokens: number; outputPreview?: string }[];
  queueDelayMs?: number;
}

interface LangfusePanelProps {
  globalAppId?: string;
  refreshKey?: number;
  onRefresh?: () => void;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatNumber(n: number): string {
  if (n >= 1000) {return (n / 1000).toFixed(1) + 'k';}
  return n.toString();
}

function formatMs(ms: number): string {
  return Math.round(ms).toLocaleString('en-US');
}

function getMessageContent(content: Message['content']): string | null {
  if (!content) {return null;}
  if (typeof content === 'string') {return content;}
  if (Array.isArray(content)) {
    const textPart = content.find(p => p.type === 'text' && p.text);
    if (textPart?.text) {return textPart.text;}
  }
  return null;
}

// Fraction of generations that must be summarization-type for a trace to be treated as a
// summarization-only card. 0.75 means if >75% of generations are summarization, render as
// a compact summarization card instead of an agent response bubble.
const SUMMARIZATION_DOMINANCE_THRESHOLD = 0.75;

// Exported for testing
export type { Session, ConversationItem };
export function extractConversationItems(sessions: Session[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  let itemId = 0;

  const sortedSessions = [...sessions].sort((a, b) => new Date(a.firstTrace).getTime() - new Date(b.firstTrace).getTime());

  for (const session of sortedSessions) {
    const sortedTraces = [...session.traces].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    for (const trace of sortedTraces) {
      const generationObservations = (trace.observations?.filter(obs => obs.type === 'GENERATION') || [])
        .sort((a, b) => new Date(a.startTime || a.endTime || trace.timestamp).getTime() - new Date(b.startTime || b.endTime || trace.timestamp).getTime());

      // Separate agent vs non-agent (summarization) generations for proper selection
      const agentGenObs = generationObservations.filter(obs => !obs.name || /^agent-/i.test(obs.name));
      const nonAgentGenObs = generationObservations.filter(obs => obs.name && !/^agent-/i.test(obs.name));

      // Pick the text-producing generation: prefer agent generation with ai.response.text,
      // then last agent generation, then any generation with ai.response.text, then last overall.
      // This avoids picking summarization output as the "assistant response".
      const textGenObs =
        agentGenObs.find(obs => obs.metadata?.attributes?.['ai.response.text']) ||
        (agentGenObs.length > 0 ? agentGenObs[agentGenObs.length - 1] : null) ||
        generationObservations.find(obs => obs.metadata?.attributes?.['ai.response.text']) ||
        generationObservations[generationObservations.length - 1];
      // First generation has the initial input/messages for display
      const firstGenObs = generationObservations[0];
      const obsAttrs = textGenObs?.metadata?.attributes;

      const traceInput = trace.input;
      const obsInput = firstGenObs?.input;
      const input = (traceInput && typeof traceInput === 'object') ? traceInput : obsInput;

      let messagesArray: Message[] | undefined;
      if (input && typeof input === 'object' && 'messages' in input && Array.isArray((input as TraceInput).messages)) {
        messagesArray = (input as TraceInput).messages;
      } else if (Array.isArray(input)) {
        messagesArray = input as Message[];
      }

      let agentName: string | undefined;
      if (trace.name.includes('agent-')) {
        agentName = trace.name.split(':')[0].replace('agent-', '');
      }

      let systemPrompt: string | undefined;
      if (input && typeof input === 'object' && 'system' in input && typeof (input as TraceInput).system === 'string') {
        systemPrompt = (input as TraceInput).system;
      }

      // Aggregate tokens across all generation steps for accurate totals
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let totalCost = 0;
      for (const gen of generationObservations) {
        inputTokens += gen.promptTokens || 0;
        outputTokens += gen.completionTokens || 0;
        totalTokens += gen.totalTokens || 0;
        totalCost += gen.calculatedTotalCost || 0;
      }
      // If no generations had tokens, set to undefined to avoid showing 0
      const hasTokenData = generationObservations.some(g => g.promptTokens || g.completionTokens);

      // Parse ai.usage.cachedInputTokens (cache reads) from all generation observations
      let cacheReadInputTokens: number | undefined;
      for (const gen of generationObservations) {
        const genAttrs = gen.metadata?.attributes;
        const cachedTokensRaw = genAttrs?.['ai.usage.cachedInputTokens'];
        if (cachedTokensRaw) {
          if (typeof cachedTokensRaw === 'number') {
            cacheReadInputTokens = (cacheReadInputTokens || 0) + cachedTokensRaw;
          } else if (typeof cachedTokensRaw === 'string') {
            try {
              const parsed = JSON.parse(cachedTokensRaw);
              const val = parsed.intValue ?? parsed;
              if (typeof val === 'number') {cacheReadInputTokens = (cacheReadInputTokens || 0) + val;}
            } catch {
              const num = parseInt(cachedTokensRaw, 10);
              if (!isNaN(num)) {cacheReadInputTokens = (cacheReadInputTokens || 0) + num;}
            }
          }
        }
      }

      const cost = totalCost || undefined;
      const model = obsAttrs?.['ai.model.id'] || textGenObs?.model;
      const provider = obsAttrs?.['ai.model.provider'];
      const temperature = obsAttrs?.['ai.settings.temperature'] ? parseFloat(obsAttrs['ai.settings.temperature']) : undefined;
      const finishReason = obsAttrs?.['ai.response.finishReason'];

      // Extract streaming performance metrics from the text-producing generation
      const msToFirstChunkStr = obsAttrs?.['ai.response.msToFirstChunk'];
      const msToFirstChunk = typeof msToFirstChunkStr === 'string'
        ? parseInt(msToFirstChunkStr, 10)
        : undefined;
      const msToFinishStr = obsAttrs?.['ai.response.msToFinish'];
      const msToFinish = typeof msToFinishStr === 'string'
        ? parseInt(msToFinishStr, 10)
        : undefined;

      // Aggregate cache write tokens from providerMetadata across ALL generation observations.
      // For cache reads: providerMetadata is used as a per-observation fallback only when the
      // AI SDK did not emit ai.usage.cachedInputTokens for that observation (avoids double-counting).
      let cacheWriteInputTokens: number | undefined;
      for (const gen of generationObservations) {
        const genAttrs = gen.metadata?.attributes;
        const metaStr = genAttrs?.['ai.response.providerMetadata'];
        if (typeof metaStr !== 'string') {continue;}
        try {
          const parsed = JSON.parse(metaStr);
          // After `parsed.anthropic || parsed`, top-level keys are camelCase per @ai-sdk/anthropic
          // The nested `usage` object retains the raw Anthropic snake_case fields as a fallback
          const meta: Record<string, unknown> = parsed.anthropic || parsed;
          const rawUsage = meta.usage as Record<string, unknown> | undefined;
          const write =
            (meta.cacheCreationInputTokens as number | null) ??
            (rawUsage?.cache_creation_input_tokens as number | undefined);
          if (typeof write === 'number' && write > 0) {cacheWriteInputTokens = (cacheWriteInputTokens || 0) + write;}
          // Only use providerMetadata reads as fallback when this observation didn't emit
          // the AI SDK attribute — otherwise we'd double-count with the loop above.
          const hasAiSdkRead = !!genAttrs?.['ai.usage.cachedInputTokens'];
          if (!hasAiSdkRead) {
            const read =
              (meta.cacheReadInputTokens as number | null) ??
              (rawUsage?.cache_read_input_tokens as number | undefined);
            if (typeof read === 'number' && read > 0) {cacheReadInputTokens = (cacheReadInputTokens || 0) + read;}
          }
        } catch { /* ignore parse errors */ }
      }

      // Compute trace-level metrics from all observations
      const allObservations = trace.observations || [];

      // traceLatencyMs: max(obs.endTime) - trace.timestamp
      const traceStartMs = new Date(trace.timestamp).getTime();
      const endTimes = allObservations
        .filter(obs => obs.endTime)
        .map(obs => new Date(obs.endTime!).getTime());
      const traceLatencyMs = endTimes.length > 0
        ? Math.max(...endTimes) - traceStartMs
        : undefined;

      // Reuse agentGenObs/nonAgentGenObs from above for metrics
      const summaryGenerations = nonAgentGenObs.filter(obs => obs.name && /^summarization/i.test(obs.name));

      // llmStepCount: only agent steps
      const llmStepCount = agentGenObs.length;

      // totalLlmTimeMs: sum of (endTime - startTime) for agent GENERATIONs only
      let totalLlmTimeMs = 0;
      for (const gen of agentGenObs) {
        if (gen.startTime && gen.endTime) {
          totalLlmTimeMs += new Date(gen.endTime).getTime() - new Date(gen.startTime).getTime();
        }
      }

      // summaryTimeMs: sum of summarization GENERATIONs
      let summaryTimeMs = 0;
      for (const gen of summaryGenerations) {
        if (gen.startTime && gen.endTime) {
          summaryTimeMs += new Date(gen.endTime).getTime() - new Date(gen.startTime).getTime();
        }
      }

      // toolTimings: per-tool timing from TOOL observations
      const toolObsForTimings = allObservations.filter(obs => obs.type === 'TOOL');
      const toolTimings: { name: string; durationMs: number }[] = [];
      let totalToolTimeMs = 0;
      for (const toolObs of toolObsForTimings) {
        if (toolObs.startTime && toolObs.endTime) {
          const dur = new Date(toolObs.endTime).getTime() - new Date(toolObs.startTime).getTime();
          toolTimings.push({ name: toolObs.name, durationMs: dur });
          totalToolTimeMs += dur;
        }
      }

      // ragTimeMs: find SPAN observation with name containing KnowB, Retrieval, or rag
      let ragTimeMs: number | undefined;
      const ragObs = allObservations.find(obs =>
        obs.type === 'SPAN' && obs.name && /knowb|retrieval|rag/i.test(obs.name)
      );
      if (ragObs?.startTime && ragObs?.endTime) {
        ragTimeMs = new Date(ragObs.endTime).getTime() - new Date(ragObs.startTime).getTime();
      }

      // observationErrors: observations with level === 'ERROR'
      const observationErrors = allObservations
        .filter(obs => obs.level === 'ERROR')
        .map(obs => ({ name: obs.name, message: obs.statusMessage || 'Unknown error', obsType: obs.type }));

      const toolCalls: ToolCallInfo[] = [];

      // Source 1: TOOL observations (NEW in latest Langfuse - separate observations for each tool call)
      const toolTypeObservations = (trace.observations?.filter(obs =>
        obs.type === 'TOOL'
      ) || []).sort((a, b) => new Date(a.startTime || 0).getTime() - new Date(b.startTime || 0).getTime());
      for (const toolObs of toolTypeObservations) {
        const toolName = toolObs.name;
        const argsStr = toolObs.input ? JSON.stringify(toolObs.input, null, 2) : undefined;
        const toolCallId = toolObs.metadata?.attributes?.['ai.toolCall.id'] as string | undefined;
        const isDuplicate = toolCalls.some(t => t.name === toolName && t.args === argsStr);
        if (!isDuplicate && toolName && toolName.length > 0) {
          toolCalls.push({ name: toolName, args: argsStr, toolCallId });
        }
      }

      // Source 2: SPAN observations with tool-related names (OLD format - fallback)
      const toolObservations = (trace.observations?.filter(obs =>
        obs.type === 'SPAN' && (obs.name?.includes('ai.toolCall.') || obs.name?.startsWith('tool-'))
      ) || []).sort((a, b) => new Date(a.startTime || 0).getTime() - new Date(b.startTime || 0).getTime());
      for (const toolObs of toolObservations) {
        const toolInput = toolObs.input as { toolName?: string; args?: unknown } | undefined;
        let toolName = toolInput?.toolName;
        if (!toolName && toolObs.name) {
          // Extract actual tool name from observation name
          if (toolObs.name.startsWith('ai.toolCall.')) {
            toolName = toolObs.name.substring('ai.toolCall.'.length);
          } else if (toolObs.name.startsWith('tool-')) {
            toolName = toolObs.name.substring('tool-'.length);
          }
        }
        // Skip if no valid tool name or if it's just the prefix
        if (toolName && toolName !== 'ai.toolCall' && toolName.length > 0) {
          const argsStr = toolInput?.args ? JSON.stringify(toolInput.args, null, 2) : undefined;
          const isDuplicate = toolCalls.some(t => t.name === toolName && t.args === argsStr);
          if (!isDuplicate) {
            toolCalls.push({ name: toolName, args: argsStr });
          }
        }
      }

      // Source 3 & 4: Check ALL generation observations for tool calls
      for (const genObs of generationObservations) {
        const genAttrs = genObs?.metadata?.attributes;

        // Source 3: ai.response.toolCalls in metadata attributes
        if (genAttrs?.['ai.response.toolCalls']) {
          try {
            const parsedToolCalls = JSON.parse(genAttrs['ai.response.toolCalls']);
            if (Array.isArray(parsedToolCalls)) {
              for (const tc of parsedToolCalls) {
                if (tc.toolName) {
                  const argsStr = tc.input ? JSON.stringify(tc.input, null, 2) : undefined;
                  const isDuplicate = toolCalls.some(t => t.name === tc.toolName && t.args === argsStr);
                  if (!isDuplicate) {
                    toolCalls.push({ name: tc.toolName, args: argsStr });
                  }
                }
              }
            }
          } catch { /* ignore parse errors */ }
        }

        // Source 4: tool_calls in generation output (NEW Langfuse format - JSON string with snake_case)
        const genOutput = genObs?.output;
        if (genOutput && typeof genOutput === 'object') {
          // Try NEW format: snake_case tool_calls as JSON string
          const outputToolCallsString = (genOutput as { tool_calls?: string }).tool_calls;
          if (typeof outputToolCallsString === 'string') {
            try {
              const parsedToolCalls = JSON.parse(outputToolCallsString);
              if (Array.isArray(parsedToolCalls)) {
                for (const tc of parsedToolCalls) {
                  const toolName = tc.toolName || tc.name;
                  if (toolName) {
                    const argsStr = (tc.input || tc.args) ? JSON.stringify(tc.input || tc.args, null, 2) : undefined;
                    const toolCallId = tc.toolCallId;
                    const isDuplicate = toolCalls.some(t => t.name === toolName && t.args === argsStr);
                    if (!isDuplicate) {
                      toolCalls.push({ name: toolName, args: argsStr, toolCallId });
                    }
                  }
                }
              }
            } catch { /* ignore parse errors */ }
          }

          // Fallback: Try OLD format: camelCase toolCalls as array
          const outputToolCalls = (genOutput as { toolCalls?: Array<{ toolName?: string; name?: string; args?: unknown; input?: unknown; toolCallId?: string }> }).toolCalls;
          if (Array.isArray(outputToolCalls)) {
            for (const tc of outputToolCalls) {
              const toolName = tc.toolName || tc.name;
              if (toolName) {
                const argsStr = (tc.args || tc.input) ? JSON.stringify(tc.args || tc.input, null, 2) : undefined;
                const toolCallId = tc.toolCallId;
                const isDuplicate = toolCalls.some(t => t.name === toolName && t.args === argsStr);
                if (!isDuplicate) {
                  toolCalls.push({ name: toolName, args: argsStr, toolCallId });
                }
              }
            }
          }
        }
      }

      const messageTimestamp = firstGenObs?.startTime || trace.timestamp;
      const responseTimestamp = textGenObs?.endTime || trace.timestamp;

      // Detect summarization-dominated traces: when summarization generations make up the
      // majority of all generations. Threshold is 75% because mixed traces (e.g., 1 agent gen +
      // 3 summarization gens) should still render as agent responses with summary timing in the
      // details section, not as standalone summarization cards.
      const isSummarizationOnly = summaryGenerations.length > 0
        && summaryGenerations.length > generationObservations.length * SUMMARIZATION_DOMINANCE_THRESHOLD;

      if (isSummarizationOnly) {
        // Build per-step details for the summarization card
        const summarySteps: ConversationItem['summarySteps'] = [];
        for (const gen of summaryGenerations) {
          const dur = gen.startTime && gen.endTime
            ? new Date(gen.endTime).getTime() - new Date(gen.startTime).getTime()
            : 0;
          let outputPreview: string | undefined;
          if (gen.output && typeof gen.output === 'object' && 'content' in gen.output) {
            const content = (gen.output as { content?: string }).content;
            if (typeof content === 'string') {outputPreview = content.substring(0, 200);}
          } else if (typeof gen.output === 'string') {
            outputPreview = gen.output.substring(0, 200);
          }
          summarySteps.push({
            name: gen.name || 'summarization',
            durationMs: dur,
            inputTokens: gen.promptTokens || 0,
            outputTokens: gen.completionTokens || 0,
            outputPreview,
          });
        }

        // Queue delay: trace.timestamp → first generation startTime
        const firstSummaryStart = summaryGenerations[0]?.startTime;
        const queueDelayMs = firstSummaryStart
          ? new Date(firstSummaryStart).getTime() - traceStartMs
          : undefined;

        items.push({
          id: `item-${itemId++}`,
          type: 'summarization',
          timestamp: messageTimestamp,
          content: `${summaryGenerations.length} summarization steps [${trace.id}]`,
          traceId: trace.id,
          sessionId: session.sessionId,
          inputTokens: hasTokenData ? inputTokens : undefined,
          outputTokens: hasTokenData ? outputTokens : undefined,
          totalTokens: hasTokenData ? totalTokens : undefined,
          cost,
          model,
          provider,
          temperature,
          traceLatencyMs,
          summaryTimeMs: summaryTimeMs > 0 ? summaryTimeMs : undefined,
          summaryStepCount: summaryGenerations.length,
          summarySteps,
          queueDelayMs: queueDelayMs != null && queueDelayMs > 5000 ? queueDelayMs : undefined,
          observationErrors: observationErrors.length > 0 ? observationErrors : undefined,
        });
      } else {
      // Normal user/assistant flow

      let userContent: string | undefined;

      if (messagesArray && messagesArray.length > 0) {
        const userMessages = messagesArray.filter((msg: Message) => msg.role === 'user');
        const lastUserMsg = userMessages[userMessages.length - 1];
        if (lastUserMsg) {
          userContent = getMessageContent(lastUserMsg.content) || undefined;
        }
      }

      if (!userContent && input && typeof input === 'object' && 'prompt' in input) {
        const promptVal = (input as { prompt?: unknown }).prompt;
        if (typeof promptVal === 'string' && promptVal.length > 0) {
          userContent = promptVal;
        }
      }

      if (userContent &&
          !userContent.startsWith('[Current Project Context]') &&
          !userContent.startsWith('## Dynamic Context') &&
          !userContent.startsWith('# Relevant Documentation') &&
          userContent.length > 20) {
        const exists = items.some(i => i.type === 'user' && i.content === userContent);
        if (!exists) {
          const isLargeContext = inputTokens > 50000;
          const previousItem = items[items.length - 1];
          const previousAgentName = previousItem?.type === 'assistant' ? previousItem.agentName : undefined;
          const isAgentHandoff = isLargeContext && !!previousAgentName && previousAgentName !== agentName;
          const sourceAgent = isAgentHandoff ? previousAgentName : undefined;

          items.push({
            id: `item-${itemId++}`,
            type: 'user',
            timestamp: messageTimestamp,
            content: userContent,
            traceId: trace.id,
            sessionId: session.sessionId,
            inputTokens: hasTokenData ? inputTokens : undefined,
            systemPrompt,
            rawInput: input,
            isAgentHandoff,
            sourceAgent,
          });
        }
      }

      let responseText: string | undefined;

      // Priority 1: output.content in text-producing GENERATION observation (NEW Langfuse format)
      if (textGenObs?.output) {
        const genOutput = textGenObs.output;
        if (typeof genOutput === 'object' && 'content' in genOutput) {
          const content = (genOutput as { content?: string }).content;
          if (typeof content === 'string' && content.length > 0) {
            responseText = content;
          }
        } else if (typeof genOutput === 'string' && genOutput.length > 0) {
          responseText = genOutput;
        }
      }

      // Priority 2: ai.response.text in metadata attributes (OLD format - fallback)
      if (!responseText && obsAttrs?.['ai.response.text'] && typeof obsAttrs['ai.response.text'] === 'string' && obsAttrs['ai.response.text'].length > 0) {
        responseText = obsAttrs['ai.response.text'];
      }

      // Priority 3: First agent generation with output content (agent thinking text)
      // In tool-loop traces where the last step ends with tool_calls, the first generation
      // often has the agent's initial response/plan text.
      if (!responseText && agentGenObs.length > 0) {
        for (const gen of agentGenObs) {
          if (gen.output && typeof gen.output === 'object' && 'content' in gen.output) {
            const content = (gen.output as { content?: string }).content;
            if (typeof content === 'string' && content.length > 0) {
              responseText = content;
              break;
            }
          }
        }
      }

      // Priority 4: trace.output (fallback)
      if (!responseText) {
        const output = trace.output;
        if (typeof output === 'string' && output.length > 0) {
          responseText = output;
        } else if (output && typeof output === 'object') {
          const outputObj = output as { text?: string; content?: string; 'ai.response.text'?: string };
          responseText = outputObj.content || outputObj.text || outputObj['ai.response.text'];
        }
      }

      // Build agent steps: interleave each agent GENERATION's text with its tool calls
      let agentSteps: AgentStep[] | undefined;
      if (agentGenObs.length > 0) {
        const steps: AgentStep[] = [];
        for (let gi = 0; gi < agentGenObs.length; gi++) {
          const gen = agentGenObs[gi];

          // Extract text from generation output
          let stepText = '';
          if (gen.output && typeof gen.output === 'object' && 'content' in gen.output) {
            const content = (gen.output as { content?: string }).content;
            if (typeof content === 'string') {stepText = content;}
          } else if (typeof gen.output === 'string') {
            stepText = gen.output;
          }

          // Parse tool_calls from generation output
          const stepToolCalls: AgentStep['toolCalls'] = [];
          const matchedToolObsIds = new Set<string>();
          if (gen.output && typeof gen.output === 'object') {
            const genOut = gen.output as { tool_calls?: string; toolCalls?: Array<{ toolName?: string; name?: string; args?: unknown; input?: unknown; toolCallId?: string }> };
            let parsedCalls: Array<{ toolName?: string; name?: string; args?: unknown; input?: unknown; toolCallId?: string }> = [];
            if (typeof genOut.tool_calls === 'string') {
              try { parsedCalls = JSON.parse(genOut.tool_calls); } catch { /* ignore */ }
            } else if (Array.isArray(genOut.toolCalls)) {
              parsedCalls = genOut.toolCalls;
            }
            for (const tc of parsedCalls) {
              const tcName = tc.toolName || tc.name;
              if (!tcName) {continue;}
              const tcArgs = (tc.input || tc.args) ? JSON.stringify(tc.input || tc.args, null, 2) : undefined;
              const tcId = tc.toolCallId;

              // Find matching TOOL observation by parentObservationId → generationId, or by toolCallId, or by name+time window
              const nextGenStart = gi + 1 < agentGenObs.length
                ? new Date(agentGenObs[gi + 1].startTime || 0).getTime()
                : Infinity;
              const genStartMs = new Date(gen.startTime || 0).getTime();

              // Track which TOOL observations have already been claimed by a prior tool call in this step
              const matchedToolObs = toolTypeObservations.find(tObs => {
                if (matchedToolObsIds.has(tObs.id)) {return false;}
                // Strategy 1: Match by toolCallId (most precise, works across parents)
                const obsToolCallId = tObs.metadata?.attributes?.['ai.toolCall.id'] as string | undefined;
                if (tcId && obsToolCallId && obsToolCallId === tcId) {return true;}
                // Strategy 2: Match by parentObservationId + name
                if (tObs.parentObservationId === gen.id && tObs.name === tcName) {return true;}
                // Strategy 3: Fallback - name + time window (between this gen start and next gen start)
                // Applies when tool has no parent, or parent doesn't match any agent generation
                // (e.g., parented to a SPAN wrapper rather than the GENERATION directly)
                if (tObs.name === tcName && tObs.parentObservationId !== gen.id) {
                  const toolStartMs = new Date(tObs.startTime || 0).getTime();
                  return toolStartMs >= genStartMs && toolStartMs < nextGenStart;
                }
                return false;
              });
              if (matchedToolObs) {matchedToolObsIds.add(matchedToolObs.id);}

              const toolDur = matchedToolObs?.startTime && matchedToolObs?.endTime
                ? new Date(matchedToolObs.endTime).getTime() - new Date(matchedToolObs.startTime).getTime()
                : undefined;
              const isSuccess = matchedToolObs ? matchedToolObs.level !== 'ERROR' : undefined;

              stepToolCalls.push({
                name: tcName,
                args: tcArgs,
                toolCallId: tcId,
                result: matchedToolObs?.output,
                durationMs: toolDur,
                success: isSuccess,
                statusMessage: matchedToolObs?.statusMessage,
              });
            }
          }

          // Also pick up TOOL observations parented to this generation but not already matched
          for (const tObs of toolTypeObservations) {
            if (matchedToolObsIds.has(tObs.id)) {continue;}
            if (tObs.parentObservationId === gen.id) {
              matchedToolObsIds.add(tObs.id);
              const toolDur = tObs.startTime && tObs.endTime
                ? new Date(tObs.endTime).getTime() - new Date(tObs.startTime).getTime()
                : undefined;
              stepToolCalls.push({
                name: tObs.name,
                args: tObs.input ? JSON.stringify(tObs.input, null, 2) : undefined,
                toolCallId: tObs.metadata?.attributes?.['ai.toolCall.id'] as string | undefined,
                result: tObs.output,
                durationMs: toolDur,
                success: tObs.level !== 'ERROR',
                statusMessage: tObs.statusMessage,
              });
            }
          }

          const genDur = gen.startTime && gen.endTime
            ? new Date(gen.endTime).getTime() - new Date(gen.startTime).getTime()
            : undefined;

          // Only add step if it has text or tool calls
          if (stepText || stepToolCalls.length > 0) {
            steps.push({
              generationId: gen.id,
              text: stepText,
              toolCalls: stepToolCalls,
              durationMs: genDur,
              inputTokens: gen.promptTokens,
              outputTokens: gen.completionTokens,
            });
          }
        }
        if (steps.length > 1 || (steps.length === 1 && steps[0].toolCalls.length > 0)) {
          agentSteps = steps;
        }
      }

      if ((responseText && responseText.length > 0) || toolCalls.length > 0) {
        items.push({
          id: `item-${itemId++}`,
          type: 'assistant',
          timestamp: responseTimestamp,
          content: responseText || '',
          agentName,
          traceId: trace.id,
          sessionId: session.sessionId,
          inputTokens: hasTokenData ? inputTokens : undefined,
          outputTokens: hasTokenData ? outputTokens : undefined,
          totalTokens: hasTokenData ? totalTokens : undefined,
          cacheReadInputTokens,
          cost,
          model,
          provider,
          temperature,
          finishReason,
          tools: toolCalls.length > 0 ? toolCalls : undefined,
          rawOutput: trace.output,
          msToFirstChunk,
          msToFinish,
          cacheWriteInputTokens,
          toolObservations: toolTypeObservations,
          traceLatencyMs,
          llmStepCount: llmStepCount > 0 ? llmStepCount : undefined,
          toolTimings: toolTimings.length > 0 ? toolTimings : undefined,
          totalToolTimeMs: toolTimings.length > 0 ? totalToolTimeMs : undefined,
          totalLlmTimeMs: totalLlmTimeMs > 0 ? totalLlmTimeMs : undefined,
          summaryTimeMs: summaryTimeMs > 0 ? summaryTimeMs : undefined,
          ragTimeMs,
          observationErrors: observationErrors.length > 0 ? observationErrors : undefined,
          agentSteps,
        });
      }

      } // end normal user/assistant flow
    }
  }

  items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const deduped: ConversationItem[] = [];
  for (const item of items) {
    const last = deduped[deduped.length - 1];
    if (last?.type === item.type && last.content === item.content && !item.tools?.length) {continue;}
    deduped.push(item);
  }

  return deduped;
}

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '12px', height: '12px', borderRadius: '50%',
          fontSize: '0.45rem', fontWeight: 700, fontStyle: 'italic', fontFamily: 'serif',
          color: '#94a3b8', border: '1px solid #cbd5e1',
          cursor: 'pointer', marginLeft: '0.25rem', flexShrink: 0,
          userSelect: 'none',
        }}
      >
        i
      </span>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{
            position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
            marginBottom: '6px', zIndex: 100,
            backgroundColor: '#1e293b', color: '#f1f5f9',
            fontSize: '0.65rem', lineHeight: 1.5, padding: '0.5rem 0.75rem',
            borderRadius: '6px', width: '280px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            whiteSpace: 'pre-wrap',
          }}>
            {text}
            <div style={{
              position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
              width: 0, height: 0,
              borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
              borderTop: '6px solid #1e293b',
            }} />
          </div>
        </>
      )}
    </span>
  );
}

function TokenBadge({ label, value, color, suffix }: { label: string; value?: number; color: string; suffix?: string }) {
  if (!value) {return null;}
  return (
    <span style={{ fontSize: '0.7rem', fontWeight: 600, color, backgroundColor: `${color}18`, padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
      {label}: {formatNumber(value)}{suffix ? ` ${suffix}` : ''}
    </span>
  );
}

function CostBadge({ value }: { value?: number }) {
  if (!value) {return null;}
  return (
    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#059669', backgroundColor: '#d1fae518', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
      ${value.toFixed(4)}
    </span>
  );
}

function ToolsSection({ tools, item, expanded: initialExpanded = false }: { tools: ToolCallInfo[]; item: ConversationItem; expanded?: boolean }) {
  const [expanded, setExpanded] = useState(initialExpanded);

  if (!tools || tools.length === 0) {return null;}

  return (
    <div style={{ marginTop: '0.5rem', borderTop: '1px dashed #d1fae5', paddingTop: '0.5rem' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.65rem', color: '#047857' }}
      >
        <span>🔧</span>
        <span style={{ fontWeight: 600 }}>{tools.length} tool{tools.length > 1 ? 's' : ''} called</span>
        <span style={{ color: '#94a3b8' }}>{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: '0.35rem', paddingLeft: '0.5rem', borderLeft: '2px solid #d1fae5' }}>
          {tools.map((tool, idx) => {
            // Find matching TOOL observation for this tool call
            // Match by toolCallId first (handles duplicate tool names), then fall back to name
            const toolObs = item.toolObservations?.find(obs => {
              if (obs.type !== 'TOOL') {return false;}
              // If both have toolCallId, match by ID (most reliable)
              if (tool.toolCallId && obs.metadata?.attributes?.['ai.toolCall.id']) {
                return obs.metadata.attributes['ai.toolCall.id'] === tool.toolCallId;
              }
              // Fall back to name matching
              return obs.name === tool.name;
            });

            // Check if has output or statusMessage (error info when output is null)
            const hasOutput = toolObs?.output != null || toolObs?.statusMessage != null;

            // Determine success/failure - simply use the level field
            // Langfuse sets level='ERROR' for failed tools, otherwise 'DEFAULT' or success
            const isSuccess = hasOutput && toolObs?.level !== 'ERROR';

            // Compute execution duration from observation timestamps
            const toolDurationMs = toolObs?.startTime && toolObs?.endTime
              ? new Date(toolObs.endTime).getTime() - new Date(toolObs.startTime).getTime()
              : undefined;

            return (
              <details key={idx} style={{ marginBottom: '0.2rem' }}>
                <summary style={{
                  cursor: 'pointer',
                  fontSize: '0.6rem',
                  color: '#065f46',
                  fontFamily: 'monospace',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}>
                  {/* Success indicator */}
                  <span
                    style={{
                      fontSize: '0.7rem',
                      color: isSuccess ? '#10b981' : hasOutput ? '#dc2626' : '#94a3b8'
                    }}
                    title={isSuccess ? 'Tool executed successfully' : hasOutput ? 'Tool execution failed' : 'No output data available (older trace format)'}
                  >
                    {isSuccess ? '✓' : hasOutput ? '✗' : '⏳'}
                  </span>
                  {tool.name}
                  {toolDurationMs != null && (
                    <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                      {formatMs(toolDurationMs)}ms
                    </span>
                  )}
                </summary>

                {/* Tool input (args) */}
                {tool.args && (
                  <div style={{ marginTop: '0.25rem' }}>
                    <div style={{ fontSize: '0.55rem', color: '#64748b', fontWeight: 600, marginBottom: '0.1rem' }}>
                      Input:
                    </div>
                    <pre style={{
                      fontSize: '0.55rem',
                      backgroundColor: '#ecfdf5',
                      padding: '0.3rem',
                      borderRadius: '3px',
                      overflow: 'auto',
                      maxHeight: '80px',
                      margin: 0,
                      border: '1px solid #d1fae5'
                    }}>
                      {tool.args}
                    </pre>
                  </div>
                )}

                {/* Tool output (NEW) */}
                {hasOutput && (
                  <div style={{ marginTop: '0.25rem' }}>
                    <div style={{ fontSize: '0.55rem', color: '#64748b', fontWeight: 600, marginBottom: '0.1rem' }}>
                      Output:
                    </div>
                    <pre style={{
                      fontSize: '0.55rem',
                      backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
                      padding: '0.3rem',
                      borderRadius: '3px',
                      overflow: 'auto',
                      maxHeight: '120px',
                      margin: 0,
                      border: `1px solid ${isSuccess ? '#bbf7d0' : '#fecaca'}`
                    }}>
                      {toolObs?.output != null
                        ? (typeof toolObs.output === 'string'
                            ? toolObs.output
                            : JSON.stringify(toolObs.output, null, 2))
                        : toolObs?.statusMessage || ''}
                    </pre>
                  </div>
                )}
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getToolResultSummary(tc: AgentStep['toolCalls'][number]): string {
  const name = tc.name;
  const argsObj = tc.args ? (() => { try { return JSON.parse(tc.args!); } catch { return null; } })() : null;
  const resultObj = tc.result;

  if (name === 'readFile' || name === 'readDir') {
    const filePath = argsObj?.filePath || argsObj?.path;
    if (filePath) {return String(filePath).split('/').pop() || filePath;}
  }
  if (name === 'str_replace_based_edit_tool' || name === 'textEditor' || name === 'fileEdit' || name === 'writeFile' || name === 'createFile') {
    const filePath = argsObj?.filePath || argsObj?.path || argsObj?.file_path;
    if (filePath) {return String(filePath).split('/').pop() || filePath;}
  }
  if (name === 'setProjectName') {
    const projectName = argsObj?.name || argsObj?.projectName;
    if (projectName) {return `"${projectName}"`;}
  }
  if (name === 'todoList') {
    const items = argsObj?.items;
    if (Array.isArray(items)) {return `${items.length} items`;}
    const op = argsObj?.operation;
    if (op) {return op;}
  }
  if (name === 'handoff') {
    const target = argsObj?.targetAgent || argsObj?.agent;
    if (target) {return String(target);}
  }
  if (name === 'fontTheme') {
    const theme = argsObj?.theme || argsObj?.name;
    if (theme) {return String(theme);}
  }
  if (name === 'colorScheme') {
    const scheme = argsObj?.scheme || argsObj?.name;
    if (scheme) {return String(scheme);}
  }
  if (name === 'suggestedResponse' || name === 'suggestedResponses') {
    const suggestions = argsObj?.suggestions || argsObj?.responses;
    if (Array.isArray(suggestions)) {return `${suggestions.length} suggestions`;}
  }
  if (name === 'grepSearch' || name === 'searchFiles') {
    const query = argsObj?.query || argsObj?.pattern;
    if (query) {return `"${String(query).substring(0, 40)}"`;}
  }
  if (name === 'terminalCommand' || name === 'runTerminalCommand') {
    const cmd = argsObj?.command;
    if (cmd) {return String(cmd).substring(0, 50);}
  }

  // Default: compact result preview
  if (resultObj != null) {
    const str = typeof resultObj === 'string' ? resultObj : JSON.stringify(resultObj);
    if (str.length <= 100) {return str;}
    return str.substring(0, 100) + '...';
  }
  return '';
}

function StepByStepContent({ steps }: { steps: AgentStep[] }) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [expandedStepTools, setExpandedStepTools] = useState<Set<number>>(new Set());
  const TOOL_COLLAPSE_THRESHOLD = 4;

  const toggleTool = (key: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(key)) {next.delete(key);}
      else {next.add(key);}
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {steps.map((step, stepIdx) => (
        <div key={step.generationId} style={{
          borderTop: stepIdx > 0 ? '1px solid #d1fae5' : undefined,
          paddingTop: stepIdx > 0 ? '0.5rem' : undefined,
          marginTop: stepIdx > 0 ? '0.5rem' : undefined,
        }}>
          {/* Step header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
            <span style={{
              fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8',
              backgroundColor: '#f1f5f9', padding: '0.1rem 0.35rem', borderRadius: '3px',
              fontFamily: 'monospace',
            }}>
              Step {stepIdx + 1}
            </span>
            {step.durationMs != null && (
              <span style={{ fontSize: '0.55rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                {formatMs(step.durationMs)}ms
              </span>
            )}
            {step.outputTokens != null && step.outputTokens > 0 && (
              <span style={{ fontSize: '0.55rem', color: '#10b981', fontFamily: 'monospace' }}>
                {formatNumber(step.outputTokens)} out
              </span>
            )}
          </div>

          {/* Step text */}
          {step.text && (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: step.toolCalls.length > 0 ? '0.35rem' : 0, fontSize: '0.85rem' }}>
              {step.text}
            </div>
          )}

          {/* Tool calls inline */}
          {step.toolCalls.length > 0 && (() => {
            const shouldCollapse = step.toolCalls.length > TOOL_COLLAPSE_THRESHOLD;
            const isStepToolsExpanded = expandedStepTools.has(stepIdx);
            const visibleTools = shouldCollapse && !isStepToolsExpanded
              ? step.toolCalls.slice(0, TOOL_COLLAPSE_THRESHOLD)
              : step.toolCalls;
            const hiddenCount = step.toolCalls.length - TOOL_COLLAPSE_THRESHOLD;
            const failedHiddenCount = shouldCollapse && !isStepToolsExpanded
              ? step.toolCalls.slice(TOOL_COLLAPSE_THRESHOLD).filter(t => t.success === false).length
              : 0;

            return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', paddingLeft: '0.25rem' }}>
              {visibleTools.map((tc, tcIdx) => {
                const realIdx = tcIdx; // index in full array matches since visibleTools is a prefix slice
                const toolKey = `${stepIdx}-${realIdx}`;
                const isExpanded = expandedTools.has(toolKey);
                const isFailed = tc.success === false;
                const statusIcon = tc.success === true ? '✓' : isFailed ? '✗' : '·';
                const statusColor = tc.success === true ? '#10b981' : isFailed ? '#dc2626' : '#94a3b8';
                const nameColor = isFailed ? '#991b1b' : '#065f46';
                const summary = isFailed && tc.statusMessage
                  ? tc.statusMessage.substring(0, 120)
                  : getToolResultSummary(tc);

                return (
                  <div key={realIdx}>
                    <div
                      onClick={() => toggleTool(toolKey)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.3rem',
                        cursor: 'pointer', fontSize: '0.65rem', fontFamily: 'monospace',
                        color: nameColor, padding: '0.1rem 0',
                        backgroundColor: isFailed ? '#fef2f2' : undefined,
                        borderRadius: isFailed ? '3px' : undefined,
                        paddingLeft: isFailed ? '0.25rem' : undefined,
                      }}
                    >
                      <span style={{ color: statusColor, fontWeight: 700, fontSize: '0.7rem' }}>{statusIcon}</span>
                      <span style={{ fontWeight: 600 }}>{tc.name}</span>
                      {tc.durationMs != null && (
                        <span style={{ color: '#94a3b8', fontWeight: 400 }}>{formatMs(tc.durationMs)}ms</span>
                      )}
                      {summary && (
                        <span style={{ color: isFailed ? '#dc2626' : '#6b7280', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                          {summary}
                        </span>
                      )}
                      <span style={{ color: '#cbd5e1', marginLeft: 'auto', flexShrink: 0 }}>{isExpanded ? '▼' : '▶'}</span>
                    </div>

                    {isExpanded && (
                      <div style={{ paddingLeft: '1rem', marginBottom: '0.2rem' }}>
                        {tc.args && (
                          <div style={{ marginTop: '0.15rem' }}>
                            <div style={{ fontSize: '0.55rem', color: '#64748b', fontWeight: 600, marginBottom: '0.1rem' }}>Input:</div>
                            <pre style={{
                              fontSize: '0.55rem', backgroundColor: '#ecfdf5', padding: '0.3rem',
                              borderRadius: '3px', overflow: 'auto', maxHeight: '80px',
                              margin: 0, border: '1px solid #d1fae5',
                            }}>
                              {tc.args}
                            </pre>
                          </div>
                        )}
                        {tc.result != null && (
                          <div style={{ marginTop: '0.15rem' }}>
                            <div style={{ fontSize: '0.55rem', color: '#64748b', fontWeight: 600, marginBottom: '0.1rem' }}>Output:</div>
                            <pre style={{
                              fontSize: '0.55rem',
                              backgroundColor: tc.success !== false ? '#f0fdf4' : '#fef2f2',
                              padding: '0.3rem', borderRadius: '3px', overflow: 'auto',
                              maxHeight: '120px', margin: 0,
                              border: `1px solid ${tc.success !== false ? '#bbf7d0' : '#fecaca'}`,
                            }}>
                              {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}
                            </pre>
                          </div>
                        )}
                        {tc.statusMessage && tc.result == null && (
                          <div style={{ marginTop: '0.15rem' }}>
                            <div style={{ fontSize: '0.55rem', color: '#64748b', fontWeight: 600, marginBottom: '0.1rem' }}>Status:</div>
                            <pre style={{
                              fontSize: '0.55rem', backgroundColor: '#fef2f2', padding: '0.3rem',
                              borderRadius: '3px', overflow: 'auto', maxHeight: '80px',
                              margin: 0, border: '1px solid #fecaca',
                            }}>
                              {tc.statusMessage}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {shouldCollapse && (
                <div
                  onClick={() => setExpandedStepTools(prev => {
                    const next = new Set(prev);
                    if (next.has(stepIdx)) {next.delete(stepIdx);}
                    else {next.add(stepIdx);}
                    return next;
                  })}
                  style={{
                    cursor: 'pointer', fontSize: '0.6rem', fontFamily: 'monospace',
                    color: '#047857', padding: '0.15rem 0', display: 'flex', alignItems: 'center', gap: '0.3rem',
                  }}
                >
                  <span style={{ color: '#94a3b8' }}>{isStepToolsExpanded ? '▲' : '▼'}</span>
                  <span style={{ fontWeight: 600 }}>
                    {isStepToolsExpanded ? 'show less' : `${hiddenCount} more tool${hiddenCount > 1 ? 's' : ''}`}
                  </span>
                  {failedHiddenCount > 0 && (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>({failedHiddenCount} failed)</span>
                  )}
                </div>
              )}
            </div>
            );
          })()}
        </div>
      ))}
    </div>
  );
}

interface ContentSection {
  type: 'text' | 'user' | 'action' | 'result';
  content: string;
  actionType?: string;
}

function parseAssistantContent(content: string): ContentSection[] {
  const sections: ContentSection[] = [];
  const lines = content.split('\n');
  let currentSection: ContentSection | null = null;
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (currentSection && buffer.length > 0) {
      currentSection.content = buffer.join('\n').trim();
      if (currentSection.content) {
        sections.push(currentSection);
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith('User:')) {
      flushBuffer();
      currentSection = { type: 'user', content: '' };
      buffer.push(line.replace('User:', '').trim());
    } else if (line.startsWith('Assistant actions:') || line.startsWith('Assistant action:')) {
      flushBuffer();
      currentSection = { type: 'action', content: '' };
    } else if (line.match(/^(Read|Write|Edit|Delete|Search|Terminal|Grep|List|Create|Execute|Run|File operations):/i)) {
      flushBuffer();
      const match = line.match(/^([\w\s]+):\s*(.*)$/i);
      currentSection = { type: 'action', content: '', actionType: match?.[1]?.trim() };
      buffer.push(match?.[2] || line);
    } else if (line.startsWith('Tool result:')) {
      flushBuffer();
      currentSection = { type: 'result', content: '' };
      buffer.push(line.replace('Tool result:', '').trim());
    } else if (line.match(/^(File|Total lines|File size|Exit code|Output|Error|Lines \d):/i) || line.match(/^\s*\d+\|/)) {
      if (currentSection?.type !== 'result') {
        flushBuffer();
        currentSection = { type: 'result', content: '' };
      }
      buffer.push(line);
    } else {
      if (!currentSection || currentSection.type === 'text') {
        if (!currentSection) {
          currentSection = { type: 'text', content: '' };
        }
        buffer.push(line);
      } else {
        buffer.push(line);
      }
    }
  }
  flushBuffer();

  return sections;
}

function FormattedContent({ content }: { content: string }) {
  const sections = parseAssistantContent(content);
  const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set());

  if (sections.length === 0) {
    return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</span>;
  }

  const toggleResult = (idx: number) => {
    setExpandedResults(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {next.delete(idx);}
      else {next.add(idx);}
      return next;
    });
  };

  return (
    <div>
      {sections.map((section, idx) => {
        if (section.type === 'text') {
          return (
            <div key={idx} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: '0.5rem' }}>
              {section.content}
            </div>
          );
        }
        if (section.type === 'user') {
          return (
            <div key={idx} style={{ backgroundColor: '#dbeafe', borderRadius: '6px', padding: '0.4rem 0.6rem', marginBottom: '0.5rem', borderLeft: '3px solid #3b82f6' }}>
              <span style={{ fontWeight: 600, color: '#1e40af', fontSize: '0.7rem' }}>User: </span>
              <span style={{ color: '#1e3a8a', fontSize: '0.75rem' }}>{section.content}</span>
            </div>
          );
        }
        if (section.type === 'action') {
          return (
            <div key={idx} style={{ backgroundColor: '#fef3c7', borderRadius: '6px', padding: '0.4rem 0.6rem', marginBottom: '0.25rem', borderLeft: '3px solid #f59e0b', fontFamily: 'monospace', fontSize: '0.7rem' }}>
              <span style={{ fontWeight: 600, color: '#92400e' }}>{section.actionType ? `${section.actionType}: ` : 'Action: '}</span>
              <span style={{ color: '#78350f' }}>{section.content}</span>
            </div>
          );
        }
        if (section.type === 'result') {
          const isExpanded = expandedResults.has(idx);
          const preview = section.content.split('\n').slice(0, 3).join('\n');
          const hasMore = section.content.split('\n').length > 3;
          return (
            <div key={idx} style={{ backgroundColor: '#f1f5f9', borderRadius: '6px', padding: '0.4rem 0.6rem', marginBottom: '0.5rem', borderLeft: '3px solid #64748b', fontSize: '0.65rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600, color: '#475569', fontSize: '0.6rem' }}>Tool Result:</span>
                {hasMore && (
                  <button onClick={() => toggleResult(idx)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '0.55rem', cursor: 'pointer', padding: 0 }}>
                    {isExpanded ? '▲ collapse' : '▼ expand'}
                  </button>
                )}
              </div>
              <pre style={{ margin: '0.25rem 0 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#334155', fontFamily: 'monospace', fontSize: '0.6rem', maxHeight: isExpanded ? 'none' : '80px', overflow: 'hidden' }}>
                {isExpanded ? section.content : preview}{!isExpanded && hasMore && '...'}
              </pre>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function UserMessage({ item, langfuseBaseUrl }: { item: ConversationItem; langfuseBaseUrl?: string }) {
  const [expanded, setExpanded] = useState(false);

  const hasStructuredContent = /^(User:|Assistant actions?:|Tool result:|Read:|Write:|Edit:|Terminal:)/m.test(item.content);

  let userPrompt = item.content;
  if (hasStructuredContent && item.content.startsWith('User:')) {
    const match = item.content.match(/^User:\s*(.+?)(?:\n\n|\nAssistant|$)/s);
    if (match) {
      userPrompt = match[1].trim();
    }
  }

  const isLong = userPrompt.length > 250;
  const displayContent = isLong && !expanded ? userPrompt.substring(0, 250) + '...' : userPrompt;
  const hasFullContent = hasStructuredContent && item.content !== userPrompt;
  const isCollapsible = isLong || hasFullContent;

  const isHandoff = item.isAgentHandoff;
  const avatarBg = isHandoff ? '#f59e0b' : '#3b82f6';
  const avatarIcon = isHandoff ? '🔄' : '👤';
  const labelColor = isHandoff ? '#92400e' : '#1e40af';
  const bubbleBg = isHandoff ? '#fef3c7' : '#eff6ff';
  const textColor = isHandoff ? '#78350f' : '#1e3a8a';
  const label = isHandoff ? `Handoff from ${item.sourceAgent || 'Agent'}` : 'User';

  const traceLink = langfuseBaseUrl && item.traceId ? `${langfuseBaseUrl}/trace/${item.traceId}` : undefined;

  return (
    <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.6rem' }}>
      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.9rem', flexShrink: 0 }}>{avatarIcon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: labelColor }}>{label}</span>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{formatTime(item.timestamp)}</span>
            {isCollapsible && expanded && (
              <button onClick={() => setExpanded(false)} style={{ background: 'none', border: 'none', fontSize: '0.65rem', color: isHandoff ? '#f59e0b' : '#3b82f6', cursor: 'pointer', padding: '0 0.25rem' }}>
                ↑ less
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <TokenBadge label="in" value={item.inputTokens} color={isHandoff ? '#f59e0b' : '#3b82f6'} />
          </div>
        </div>
        <div style={{ backgroundColor: bubbleBg, borderRadius: '12px', borderTopLeftRadius: '2px', padding: '0.75rem 1rem', fontSize: '0.9rem', color: textColor, lineHeight: 1.6, borderLeft: isHandoff ? '3px solid #f59e0b' : undefined }}>
          {expanded ? (
            hasFullContent ? (
              <FormattedContent content={item.content} />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{userPrompt}</div>
            )
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {displayContent}
              {isCollapsible && <button onClick={() => setExpanded(true)} style={{ display: 'block', background: 'none', border: 'none', color: isHandoff ? '#f59e0b' : '#3b82f6', fontSize: '0.65rem', cursor: 'pointer', marginTop: '0.25rem', padding: 0 }}>↓ more</button>}
            </div>
          )}
        </div>
        {/* Always-visible details */}
        <div style={{ marginTop: '0.35rem', padding: '0.4rem 0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px', fontSize: '0.6rem', color: '#64748b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap', fontFamily: 'monospace' }}>
            {item.traceId && (
              traceLink ? (
                <a href={traceLink} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>
                  trace {item.traceId}
                </a>
              ) : (
                <span style={{ color: '#1f2937' }}>trace {item.traceId}</span>
              )
            )}
            {item.sessionId && (
              <>
                <span style={{ color: '#cbd5e1' }}>,</span>
                <span style={{ color: '#1f2937' }}>session {item.sessionId}</span>
              </>
            )}
          </div>
          {item.systemPrompt && (
            <details style={{ marginTop: '0.2rem', color: '#1f2937' }}>
              <summary style={{ cursor: 'pointer', color: '#64748b' }}>system prompt ({item.systemPrompt.length} chars)</summary>
              <pre style={{ fontSize: '0.55rem', backgroundColor: '#fff', padding: '0.35rem', borderRadius: '3px', overflow: 'auto', maxHeight: '120px', whiteSpace: 'pre-wrap', margin: '0.25rem 0 0 0', border: '1px solid #e5e7eb' }}>{item.systemPrompt}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ item, langfuseBaseUrl }: { item: ConversationItem; langfuseBaseUrl?: string }) {
  const [expanded, setExpanded] = useState(false);

  const hasStructuredContent = /^(User:|Assistant actions?:|Tool result:|Read:|Write:|Edit:|Terminal:)/m.test(item.content);
  const hasContent = item.content.length > 0;

  const firstLine = item.content.split('\n')[0] || '';
  const hasMoreLines = item.content.includes('\n') || item.content.length > 150;
  const isCollapsible = hasContent && (hasMoreLines || hasStructuredContent || !!item.agentSteps);

  const traceLink = langfuseBaseUrl && item.traceId ? `${langfuseBaseUrl}/trace/${item.traceId}` : undefined;

  return (
    <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.6rem' }}>
      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.9rem', flexShrink: 0 }}>🤖</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#047857' }}>{item.agentName || 'Assistant'}</span>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{formatTime(item.timestamp)}</span>
            {isCollapsible && expanded && (
              <button onClick={() => setExpanded(false)} style={{ background: 'none', border: 'none', fontSize: '0.65rem', color: '#10b981', cursor: 'pointer', padding: '0 0.25rem' }}>
                ↑ less
              </button>
            )}
            {item.agentSteps && (
              <span style={{ fontSize: '0.6rem', fontWeight: 600, color: '#047857', backgroundColor: '#d1fae5', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                {item.agentSteps.length} steps
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <TokenBadge label="in" value={item.inputTokens} color="#64748b" />
            <TokenBadge
              label="c.read" value={item.cacheReadInputTokens} color="#8b5cf6"
              suffix={item.cacheReadInputTokens && item.inputTokens ? `(${Math.round(item.cacheReadInputTokens / item.inputTokens * 100)}%)` : undefined}
            />
            <TokenBadge label="c.write" value={item.cacheWriteInputTokens} color="#d97706" />
            <TokenBadge label="out" value={item.outputTokens} color="#10b981" />
            <CostBadge value={item.cost} />
            {item.finishReason && !['stop', 'tool-calls', 'tool_calls'].includes(item.finishReason) && (
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#f59e0b', backgroundColor: '#fef3c7', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>{item.finishReason}</span>
            )}
          </div>
        </div>
        <div style={{ backgroundColor: '#f0fdf4', borderRadius: '12px', borderTopLeftRadius: '2px', padding: '0.75rem 1rem', fontSize: '0.9rem', color: '#14532d', lineHeight: 1.6 }}>
          {item.agentSteps ? (
            expanded ? <StepByStepContent steps={item.agentSteps} /> : (
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {firstLine.length > 150 ? firstLine.substring(0, 150) + '...' : firstLine || `${item.agentSteps.length} agent steps`}
                {isCollapsible && <button onClick={() => setExpanded(true)} style={{ display: 'block', background: 'none', border: 'none', color: '#10b981', fontSize: '0.65rem', cursor: 'pointer', marginTop: '0.25rem', padding: 0 }}>↓ more</button>}
              </div>
            )
          ) : (
            <>
              {hasContent ? (
                expanded ? (
                  hasStructuredContent ? (
                    <FormattedContent content={item.content} />
                  ) : (
                    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.content}</div>
                  )
                ) : (
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {firstLine.length > 150 ? firstLine.substring(0, 150) + '...' : firstLine}
                    {isCollapsible && <button onClick={() => setExpanded(true)} style={{ display: 'block', background: 'none', border: 'none', color: '#10b981', fontSize: '0.65rem', cursor: 'pointer', marginTop: '0.25rem', padding: 0 }}>↓ more</button>}
                  </div>
                )
              ) : (
                <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.7rem' }}>Processing...</span>
              )}
              {expanded && <ToolsSection tools={item.tools || []} item={item} />}
            </>
          )}
        </div>
        {/* Always-visible details */}
        <div style={{ marginTop: '0.35rem', padding: '0.4rem 0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px', fontSize: '0.6rem', color: '#64748b' }}>
          {/* Model info line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap', fontFamily: 'monospace' }}>
            {item.provider && <span style={{ color: '#1f2937' }}>{item.provider}</span>}
            {item.provider && item.model && <span style={{ color: '#cbd5e1' }}>:</span>}
            {item.model && <span style={{ color: '#1f2937' }}>{item.model}</span>}
            {item.temperature !== undefined && <><span style={{ color: '#cbd5e1' }}>:</span><span style={{ color: '#1f2937' }}>temp {item.temperature}</span></>}
            {item.traceId && (
              <>
                <span style={{ color: '#cbd5e1' }}>,</span>
                {traceLink ? (
                  <a href={traceLink} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>
                    trace {item.traceId}
                  </a>
                ) : (
                  <span style={{ color: '#1f2937' }}>trace {item.traceId}</span>
                )}
              </>
            )}
          </div>
          {/* System prompt */}
          {item.systemPrompt && (
            <details style={{ marginTop: '0.2rem', color: '#1f2937' }}>
              <summary style={{ cursor: 'pointer', color: '#64748b' }}>system prompt ({item.systemPrompt.length} chars)</summary>
              <pre style={{ fontSize: '0.55rem', backgroundColor: '#fff', padding: '0.35rem', borderRadius: '3px', overflow: 'auto', maxHeight: '120px', whiteSpace: 'pre-wrap', margin: '0.25rem 0 0 0', border: '1px solid #e5e7eb' }}>{item.systemPrompt}</pre>
            </details>
          )}
          {/* Timing breakdown */}
          {(item.msToFirstChunk || item.msToFinish || item.traceLatencyMs != null || item.totalLlmTimeMs != null || item.totalToolTimeMs != null || item.ragTimeMs != null || item.summaryTimeMs != null) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.1rem 0.5rem', marginTop: '0.3rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.3rem' }}>
              {item.traceLatencyMs != null && (
                <><span style={{ color: '#d97706' }}>End-to-end:</span><span style={{ fontFamily: 'monospace', color: '#1f2937', display: 'flex', alignItems: 'center' }}>{formatMs(item.traceLatencyMs)}ms<InfoTip text={"Wall-clock time from trace start to the last observation completing.\n\nThis is the total user wait time for this request. It includes RAG retrieval, all LLM calls (agent steps + summarization), tool executions, and any framework overhead or gaps between steps."} /></span></>
              )}
              {item.ragTimeMs != null && (
                <><span style={{ color: '#2563eb' }}>RAG:</span><span style={{ fontFamily: 'monospace', color: '#1f2937', display: 'flex', alignItems: 'center' }}>{formatMs(item.ragTimeMs)}ms<InfoTip text={"Time spent retrieving context from the knowledge base (KnowB Documentation Retrieval).\n\nThis happens before the agent starts reasoning. It fetches relevant documentation chunks to include in the LLM context for better answers."} /></span></>
              )}
              {item.totalLlmTimeMs != null && (
                <><span style={{ color: '#6366f1' }}>Agent LLM:</span><span style={{ fontFamily: 'monospace', color: '#1f2937', display: 'flex', alignItems: 'center' }}>{formatMs(item.totalLlmTimeMs)}ms{item.llmStepCount != null && item.llmStepCount > 1 ? ` (${item.llmStepCount} steps)` : ''}<InfoTip text={"Sum of all agent LLM generation times (observations starting with \"agent-\").\n\nIn a tool-loop agent, each step is a separate LLM call: the model reads context, decides to call a tool or produce text, then waits for the tool result before the next step. Multiple steps means the agent used tools before producing its final answer.\n\nExcludes summarization LLM calls which run after the agent finishes."} /></span></>
              )}
              {item.msToFirstChunk && (
                <><span style={{ color: '#8b5cf6' }}>TTFB:</span><span style={{ fontFamily: 'monospace', color: '#1f2937', display: 'flex', alignItems: 'center' }}>{formatMs(item.msToFirstChunk)}ms<InfoTip text={"Time To First Byte \u2014 how long until the first token of the final text response started streaming.\n\nMeasured from the last (text-producing) LLM generation only. Lower TTFB means the user sees text appearing sooner. This does not include tool-call steps, only the final streaming response."} /></span></>
              )}
              {item.totalToolTimeMs != null && item.toolTimings && (
                <><span style={{ color: '#0d9488' }}>Tools:</span><span style={{ fontFamily: 'monospace', color: '#1f2937', display: 'flex', alignItems: 'center' }}>{formatMs(item.totalToolTimeMs)}ms ({item.toolTimings.length} calls)<InfoTip text={"Sum of execution time for all tool calls (readFile, fileEdit, grepSearch, terminalCommand, etc.).\n\nEach tool call runs between LLM steps. Tool time is usually small compared to LLM time, but file edits and terminal commands can take longer. Failed tools (level=ERROR) are included in this total."} /></span></>
              )}
              {item.summaryTimeMs != null && (
                <><span style={{ color: '#a855f7' }}>Summary:</span><span style={{ fontFamily: 'monospace', color: '#1f2937', display: 'flex', alignItems: 'center' }}>{formatMs(item.summaryTimeMs)}ms<InfoTip text={"Time spent on post-agent summarization (observations starting with \"summarization-\").\n\nAfter the agent finishes its tool loop and produces a response, a separate LLM call summarizes the changes made. This runs after the user sees the agent's response but before the trace completes. It can be significant (30-60s) for complex multi-file edits."} /></span></>
              )}
            </div>
          )}
          {/* Observation errors - when agentSteps present, only show non-TOOL errors (TOOL errors are inline) */}
          {(() => {
            const errors = item.observationErrors;
            if (!errors || errors.length === 0) {return null;}
            const filtered = item.agentSteps ? errors.filter(e => e.obsType !== 'TOOL') : errors;
            if (filtered.length === 0) {return null;}
            return (
              <div style={{ marginTop: '0.2rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.2rem' }}>
                <span style={{ fontWeight: 600, color: '#dc2626' }}>Errors:</span>
                {filtered.map((err, i) => (
                  <div key={i} style={{ color: '#991b1b', fontFamily: 'monospace' }}>
                    {err.name}: {err.message}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function SummarizationMessage({ item, langfuseBaseUrl }: { item: ConversationItem; langfuseBaseUrl?: string }) {
  const [expanded, setExpanded] = useState(false);

  const traceLink = langfuseBaseUrl && item.traceId ? `${langfuseBaseUrl}/trace/${item.traceId}` : undefined;
  const steps = item.summarySteps || [];
  const totalProcessingMs = item.summaryTimeMs || steps.reduce((sum, s) => sum + s.durationMs, 0);
  const stepCount = item.summaryStepCount || steps.length;

  return (
    <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem' }}>
      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#a855f7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.6rem', flexShrink: 0 }}>
        <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>S</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Compact inline summary */}
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
            cursor: 'pointer', padding: '0.35rem 0.6rem',
            backgroundColor: '#faf5ff', borderRadius: '8px', borderLeft: '2px solid #a855f7',
            fontSize: '0.7rem', color: '#6b21a8',
          }}
        >
          <span style={{ fontWeight: 600 }}>Summarization</span>
          <span style={{ color: '#94a3b8', fontSize: '0.65rem' }}>{formatTime(item.timestamp)}</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
            {stepCount > 1 ? `${stepCount} steps` : ''}{stepCount > 1 ? ' · ' : ''}{formatMs(totalProcessingMs)}ms
          </span>
          {item.queueDelayMs != null && (
            <span style={{ fontFamily: 'monospace', color: '#d97706', fontSize: '0.6rem' }}>queued {formatMs(item.queueDelayMs)}ms</span>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <TokenBadge label="in" value={item.inputTokens} color="#64748b" />
            <TokenBadge label="out" value={item.outputTokens} color="#a855f7" />
            <CostBadge value={item.cost} />
            <span style={{ color: '#cbd5e1', fontSize: '0.6rem' }}>{expanded ? '▼' : '▶'}</span>
          </span>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div style={{ marginTop: '0.25rem', padding: '0.35rem 0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px', fontSize: '0.6rem', color: '#64748b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap', fontFamily: 'monospace' }}>
              {item.model && <span style={{ color: '#1f2937' }}>{item.model}</span>}
              {item.traceId && (
                <>
                  <span style={{ color: '#cbd5e1' }}>,</span>
                  {traceLink ? (
                    <a href={traceLink} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>trace {item.traceId}</a>
                  ) : (
                    <span style={{ color: '#1f2937' }}>trace {item.traceId}</span>
                  )}
                </>
              )}
            </div>
            {/* Per-step breakdown */}
            {steps.length > 1 && (
              <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                {steps.map((step, idx) => (
                  <details key={idx} style={{ fontSize: '0.6rem' }}>
                    <summary style={{
                      display: 'flex', gap: '0.5rem', cursor: step.outputPreview ? 'pointer' : 'default',
                      fontFamily: 'monospace', color: '#581c87', alignItems: 'center',
                    }}>
                      <span style={{ color: '#94a3b8', width: '1.2rem' }}>{idx + 1}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.name}</span>
                      <span style={{ fontWeight: 600 }}>{formatMs(step.durationMs)}ms</span>
                      <span style={{ color: '#64748b' }}>{formatNumber(step.inputTokens)}in</span>
                      <span style={{ color: '#a855f7' }}>{formatNumber(step.outputTokens)}out</span>
                    </summary>
                    {step.outputPreview && (
                      <pre style={{
                        fontSize: '0.55rem', backgroundColor: '#fff', padding: '0.3rem', borderRadius: '3px',
                        overflow: 'auto', maxHeight: '80px', whiteSpace: 'pre-wrap',
                        margin: '0.15rem 0 0.15rem 1.7rem', border: '1px solid #e9d5ff', color: '#374151',
                      }}>
                        {step.outputPreview}{step.outputPreview.length >= 200 ? '...' : ''}
                      </pre>
                    )}
                  </details>
                ))}
              </div>
            )}
            {/* Observation errors */}
            {item.observationErrors && item.observationErrors.length > 0 && (
              <div style={{ marginTop: '0.2rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.2rem' }}>
                <span style={{ fontWeight: 600, color: '#dc2626' }}>Errors:</span>
                {item.observationErrors.map((err, i) => (
                  <div key={i} style={{ color: '#991b1b', fontFamily: 'monospace' }}>
                    {err.name}: {err.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DateSeparator({ date }: { date: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '1rem 0' }}>
      <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }} />
      <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{date}</span>
      <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }} />
    </div>
  );
}

function ErrorMessage({ error }: { error: ESError }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.6rem' }}>
      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.9rem', flexShrink: 0 }}>⚠️</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#dc2626' }}>{error.type === 'client_error' ? 'Client Error' : 'Error'}</span>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{formatTime(error.lastSeen)}</span>
          {error.count > 1 && (
            <span style={{ fontSize: '0.7rem', fontWeight: 600, backgroundColor: '#fee2e2', color: '#dc2626', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>×{error.count}</span>
          )}
          {error.eventType && (
            <span style={{ fontSize: '0.7rem', backgroundColor: '#fef3c7', color: '#92400e', padding: '0.15rem 0.4rem', borderRadius: '4px', fontFamily: 'monospace' }}>{error.eventType}</span>
          )}
        </div>
        <div
          onClick={() => setExpanded(!expanded)}
          style={{ backgroundColor: '#fef2f2', borderRadius: '10px', padding: '0.6rem 0.8rem', fontSize: '0.85rem', color: '#991b1b', cursor: 'pointer', borderLeft: '3px solid #dc2626', lineHeight: 1.5 }}
        >
          {expanded ? error.message : (error.message.length > 100 ? error.message.substring(0, 100) + '...' : error.message)}
          {error.message.length > 100 && (
            <span style={{ color: '#dc2626', fontSize: '0.6rem', marginLeft: '0.3rem' }}>{expanded ? '↑' : '↓'}</span>
          )}
        </div>
      </div>
    </div>
  );
}

interface TimelineItem {
  type: 'conversation' | 'error';
  timestamp: string;
  data: ConversationItem | ESError;
}

function ConversationView({ items, errors, langfuseBaseUrl }: { items: ConversationItem[]; errors?: ESError[]; langfuseBaseUrl?: string }) {
  const timeline: TimelineItem[] = [
    ...items.map(item => ({ type: 'conversation' as const, timestamp: item.timestamp, data: item })),
    ...(errors || []).map(err => ({ type: 'error' as const, timestamp: err.lastSeen, data: err }))
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let lastDate = '';
  return (
    <div>
      {timeline.map((item, idx) => {
        const itemDate = formatDate(item.timestamp);
        const showDateSeparator = itemDate !== lastDate;
        lastDate = itemDate;
        return (
          <React.Fragment key={`${item.type}-${idx}`}>
            {showDateSeparator && <DateSeparator date={itemDate} />}
            {item.type === 'error' && <ErrorMessage error={item.data as ESError} />}
            {item.type === 'conversation' && (item.data as ConversationItem).type === 'user' && <UserMessage item={item.data as ConversationItem} langfuseBaseUrl={langfuseBaseUrl} />}
            {item.type === 'conversation' && (item.data as ConversationItem).type === 'assistant' && <AssistantMessage item={item.data as ConversationItem} langfuseBaseUrl={langfuseBaseUrl} />}
            {item.type === 'conversation' && (item.data as ConversationItem).type === 'summarization' && <SummarizationMessage item={item.data as ConversationItem} langfuseBaseUrl={langfuseBaseUrl} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function LangfusePanel({ globalAppId, refreshKey = 0, onRefresh }: LangfusePanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [esErrors, setEsErrors] = useState<ESErrorsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [langfuseBaseUrl, setLangfuseBaseUrl] = useState<string | undefined>(undefined);
  const [langfuseProjectId, setLangfuseProjectId] = useState<string | undefined>(undefined);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const mergeSessions = useCallback((existing: Session[], newSessions: Session[]): Session[] => {
    const sessionMap = new Map<string, Session>();
    for (const s of existing) {
      sessionMap.set(s.sessionId, s);
    }
    for (const s of newSessions) {
      const existingSession = sessionMap.get(s.sessionId);
      if (existingSession) {
        const traceIds = new Set(existingSession.traces.map(t => t.id));
        const newTraces = s.traces.filter(t => !traceIds.has(t.id));
        existingSession.traces = [...existingSession.traces, ...newTraces].sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        existingSession.traceCount = existingSession.traces.length;
        if (new Date(s.firstTrace) < new Date(existingSession.firstTrace)) {existingSession.firstTrace = s.firstTrace;}
        if (new Date(s.lastTrace) > new Date(existingSession.lastTrace)) {existingSession.lastTrace = s.lastTrace;}
      } else {
        sessionMap.set(s.sessionId, s);
      }
    }
    return Array.from(sessionMap.values()).sort((a, b) =>
      new Date(b.lastTrace).getTime() - new Date(a.lastTrace).getTime()
    );
  }, []);

  const loadingMoreRef = useRef(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadAllProgress, setLoadAllProgress] = useState({ loaded: 0, total: 0 });
  const loadAllAbortRef = useRef<AbortController | null>(null);

  const fetchAllPages = useCallback(async () => {
    if (!globalAppId || loadingMoreRef.current) {return;}

    const abortController = new AbortController();
    loadAllAbortRef.current = abortController;

    setLoadingAll(true);
    setLoadingMore(true);
    loadingMoreRef.current = true;

    try {
      let nextPage = currentPage + 1;
      while (nextPage <= totalPages) {
        if (abortController.signal.aborted) {break;}
        setLoadAllProgress({ loaded: nextPage - currentPage, total: totalPages - currentPage });
        const lfResponse = await fetch(
          `/api/langfuse/sessions/${encodeURIComponent(globalAppId)}?page=${nextPage}`,
          { signal: abortController.signal }
        );
        if (!lfResponse?.ok) {throw new Error(`Failed to fetch page ${nextPage}: ${lfResponse?.status}`);}
        const data: SessionsResponse = await lfResponse.json();

        const totalPagesValue = data.pagination?.totalPages || 1;
        setTotalPages(totalPagesValue);
        setSessions(prev => mergeSessions(prev, data.sessions));
        setCurrentPage(nextPage);

        if (nextPage >= totalPagesValue) {
          setHasMore(false);
          break;
        }
        nextPage++;
      }
    } catch (err) {
      // AbortError is expected when user clicks Stop — don't show as error
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Cancelled by user
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
      }
    } finally {
      setLoadingAll(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      loadAllAbortRef.current = null;
      setLoadAllProgress({ loaded: 0, total: 0 });
    }
  }, [globalAppId, currentPage, totalPages, mergeSessions]);

  const stopLoadAll = useCallback(() => {
    loadAllAbortRef.current?.abort();
  }, []);

  const fetchPage = useCallback(async function fetchPageData(pageToFetch: number, options?: { forceRefresh?: boolean; isLoadMore?: boolean }) {
    if (!globalAppId) {return;}
    const { forceRefresh = false, isLoadMore = false } = options || {};
    if (loadingMoreRef.current && !forceRefresh) {return;}

    if (isLoadMore) {
      setLoadingMore(true);
      loadingMoreRef.current = true;
    } else {
      setLoading(true);
      setSessions([]);
    }
    setError(null);

    try {
      const lfResponse = await fetch(`/api/langfuse/sessions/${encodeURIComponent(globalAppId)}?page=${pageToFetch}`);
      if (!lfResponse?.ok) {throw new Error(`Failed to fetch: ${lfResponse?.status}`);}
      const data: SessionsResponse = await lfResponse.json();

      const totalPagesValue = data.pagination?.totalPages || 1;
      setTotalPages(totalPagesValue);
      setCurrentPage(pageToFetch);
      setHasMore(pageToFetch < totalPagesValue);

      setSessions(prev => isLoadMore ? mergeSessions(prev, data.sessions) : data.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    } finally {
      if (!isLoadMore) {setLoading(false);}
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [globalAppId, mergeSessions]);

  useEffect(() => {
    if (globalAppId) {
      fetchPage(1);
    } else {
      setSessions([]);
      setEsErrors(null);
    }
  }, [globalAppId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger refetch when refreshKey changes
  useEffect(() => {
    if (refreshKey > 0 && globalAppId) {
      loadingMoreRef.current = false; // Reset loading state
      setSessions([]);
      setEsErrors(null);
      setCurrentPage(0);
      setHasMore(true);
      fetchPage(1, { forceRefresh: true });
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (loading || sessions.length === 0 || !globalAppId) {return;}

    let earliestTimestamp: string | undefined;
    for (const session of sessions) {
      if (session.firstTrace && (!earliestTimestamp || session.firstTrace < earliestTimestamp)) {
        earliestTimestamp = session.firstTrace;
      }
    }

    if (!earliestTimestamp) {return;}

    fetch(`/api/analytics/${encodeURIComponent(globalAppId)}/errors?fromTimestamp=${encodeURIComponent(earliestTimestamp)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) {setEsErrors(data);} })
      .catch(() => {});
  }, [globalAppId, loading, sessions]);

  useEffect(() => {
    getLangfuseConfig().then(config => {
      if (config?.baseUrl) {setLangfuseBaseUrl(config.baseUrl);}
      if (config?.projectId) {setLangfuseProjectId(config.projectId);}
    });
  }, []);

  const conversationItems = extractConversationItems(sessions);
  const userMessages = conversationItems.filter(i => i.type === 'user').length;
  const assistantMessages = conversationItems.filter(i => i.type === 'assistant').length;
  const totalTools = conversationItems.reduce((sum, i) => sum + (i.tools?.length || 0), 0);

  const lfTotals = useMemo(() => {
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let cost = 0;
    let observationCount = 0;
    let traceCount = 0;

    for (const session of sessions) {
      for (const trace of session.traces) {
        traceCount++;
        for (const obs of (trace.observations || [])) {
          observationCount++;
          // Only count tokens and cost from GENERATION observations to avoid
          // double-counting parent SPANs that aggregate their children's costs
          if (obs.type === 'GENERATION') {
            inputTokens += obs.promptTokens || 0;
            outputTokens += obs.completionTokens || 0;
            totalTokens += obs.totalTokens || 0;
            cost += obs.calculatedTotalCost || 0;
            const cachedRaw = obs.metadata?.attributes?.['ai.usage.cachedInputTokens'];
            if (cachedRaw) {
              const num = typeof cachedRaw === 'number' ? cachedRaw : parseInt(String(cachedRaw), 10);
              if (!isNaN(num)) {cachedInputTokens += num;}
            }
          }
        }
      }
    }
    return { inputTokens, cachedInputTokens, outputTokens, totalTokens, cost, observationCount, traceCount };
  }, [sessions]);

  return (
    <div style={{
      backgroundColor: 'white',
      padding: '1rem',
      borderRadius: '8px',
      border: '2px solid #8b5cf6',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        gap: '0.75rem',
        paddingLeft: '36px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h2 style={{
            margin: 0,
            fontSize: '1rem',
            fontWeight: 600,
            color: '#1a1a1a',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span style={{ fontSize: '1.25rem' }}>💬</span>
            Conversation
          </h2>
          {globalAppId && (
            <span style={{
              backgroundColor: '#dbeafe',
              color: '#1e40af',
              padding: '0.125rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 500
            }}>
              {globalAppId.substring(0, 12)}...
            </span>
          )}
          {/* Loading Status */}
          {globalAppId && !loading && conversationItems.length > 0 && (
            <span style={{
              fontSize: '0.7rem',
              color: hasMore ? '#6b7280' : '#16a34a',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}>
              {hasMore ? `Page ${currentPage} of ${totalPages}` : '✓ All loaded'}
            </span>
          )}
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading || !globalAppId}
            style={{
              padding: '0.625rem 1.25rem',
              backgroundColor: (loading || !globalAppId) ? '#9ca3af' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: (loading || !globalAppId) ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              opacity: (loading || !globalAppId) ? 0.6 : 1
            }}
          >
            Refresh
          </button>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div style={{
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          padding: '0.75rem',
          borderRadius: '6px',
          marginBottom: '1rem',
          fontSize: '0.875rem'
        }}>
          {error}
        </div>
      )}

      {/* Empty State - No App ID */}
      {!globalAppId ? (
        <div style={{
          textAlign: 'center',
          padding: '2rem',
          backgroundColor: '#f9fafb',
          borderRadius: '6px'
        }}>
          <p style={{ margin: 0, fontWeight: 500 }}>Enter an App ID to view conversation</p>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            Use the App Context filter in the header
          </p>
        </div>
      ) : loading ? (
        <div style={{
          textAlign: 'center',
          padding: '2rem',
          color: '#6b7280'
        }}>
          ⏳ Loading latest traces...
        </div>
      ) : conversationItems.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '2rem',
          backgroundColor: '#f9fafb',
          borderRadius: '6px'
        }}>
          <p style={{ margin: 0, fontWeight: 500 }}>💬 No conversation found</p>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            No traces found for this App ID
          </p>
        </div>
      ) : (
        <>
          {/* Stats Row */}
          <div style={{
            padding: '0.6rem 1rem',
            borderRadius: '6px',
            backgroundColor: '#f0f9ff',
            display: 'flex',
            gap: '1rem',
            marginBottom: '1rem',
            fontSize: '0.8rem',
            flexWrap: 'wrap'
          }}>
            <span>👤 {userMessages}</span>
            <span>🤖 {assistantMessages}</span>
            <span>🔧 {totalTools}</span>
            <span style={{ color: '#64748b' }}>|</span>
            <span style={{ color: '#64748b' }}>{lfTotals.traceCount} traces</span>
            <span style={{ color: '#334155', fontWeight: 600 }}>
              📥 {formatNumber(Math.max(0, lfTotals.inputTokens - lfTotals.cachedInputTokens))}
              {lfTotals.cachedInputTokens > 0 && (
                <span style={{ color: '#8b5cf6', fontWeight: 400, marginLeft: '0.3rem' }}>
                  +{formatNumber(lfTotals.cachedInputTokens)} cached
                  {lfTotals.inputTokens > 0 && (
                    <span style={{ color: '#7c3aed', marginLeft: '0.25rem' }}>
                      ({Math.round(lfTotals.cachedInputTokens / lfTotals.inputTokens * 100)}%)
                    </span>
                  )}
                </span>
              )}
            </span>
            <span style={{ color: '#334155', fontWeight: 600 }}>📤 {formatNumber(lfTotals.outputTokens)}</span>
            {lfTotals.cost > 0 && <span style={{ color: '#059669', fontWeight: 600 }}>💰 ${lfTotals.cost.toFixed(2)}</span>}
            {esErrors && esErrors.uniqueErrors > 0 && (
              <span style={{ color: '#dc2626', fontWeight: 600 }}>⚠️ {esErrors.totalErrors + esErrors.totalClientErrors} errors</span>
            )}
            {langfuseBaseUrl && langfuseProjectId && (
              <a href={`${langfuseBaseUrl}/project/${langfuseProjectId}/users/${globalAppId}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.7rem', color: '#3b82f6', textDecoration: 'none', marginLeft: 'auto' }}>
                Langfuse ↗
              </a>
            )}
          </div>

          {/* Conversation View */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, maxHeight: '600px' }}>
            {/* Load More (older traces) */}
            {hasMore && (
              <div style={{ textAlign: 'center', padding: '0.5rem 0 0.75rem', display: 'flex', justifyContent: 'center', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  onClick={() => fetchPage(currentPage + 1, { isLoadMore: true })}
                  disabled={loadingMore}
                  style={{
                    padding: '0.4rem 1rem',
                    backgroundColor: loadingMore ? '#e5e7eb' : '#f0f9ff',
                    color: loadingMore ? '#9ca3af' : '#3b82f6',
                    border: '1px solid',
                    borderColor: loadingMore ? '#d1d5db' : '#93c5fd',
                    borderRadius: '6px',
                    cursor: loadingMore ? 'not-allowed' : 'pointer',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                  }}
                >
                  {loadingMore && !loadingAll ? '⏳ Loading...' : `Load older traces (page ${currentPage + 1} of ${totalPages})`}
                </button>
                {totalPages - currentPage > 1 && (
                  loadingAll ? (
                    <button
                      onClick={stopLoadAll}
                      style={{
                        padding: '0.4rem 1rem',
                        backgroundColor: '#fef2f2',
                        color: '#dc2626',
                        border: '1px solid #fca5a5',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                      }}
                    >
                      ⏳ Loading {loadAllProgress.loaded}/{loadAllProgress.total}... Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const remaining = totalPages - currentPage;
                        const confirmed = window.confirm(
                          `Load all ${remaining} remaining pages?\n\n` +
                          `This may take a while and is rarely needed. ` +
                          `Recent conversations are usually most relevant — ` +
                          `older traces may not reflect the current user experience.`
                        );
                        if (confirmed) {fetchAllPages();}
                      }}
                      disabled={loadingMore}
                      style={{
                        padding: '0.4rem 1rem',
                        backgroundColor: loadingMore ? '#e5e7eb' : '#fefce8',
                        color: loadingMore ? '#9ca3af' : '#a16207',
                        border: '1px solid',
                        borderColor: loadingMore ? '#d1d5db' : '#fde047',
                        borderRadius: '6px',
                        cursor: loadingMore ? 'not-allowed' : 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                      }}
                    >
                      Load all
                    </button>
                  )
                )}
              </div>
            )}
            <ConversationView items={conversationItems} errors={esErrors?.errors} langfuseBaseUrl={langfuseBaseUrl} />
          </div>
        </>
      )}
    </div>
  );
}
