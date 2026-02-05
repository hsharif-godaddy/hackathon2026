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
  if (cachedLangfuseConfig) return cachedLangfuseConfig;
  if (configFetchPromise) return configFetchPromise;

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
}

interface ConversationItem {
  id: string;
  type: 'user' | 'assistant';
  timestamp: string;
  content: string;
  agentName?: string;
  traceId?: string;
  sessionId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
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
}

interface LangfusePanelProps {
  globalAppId?: string;
  refreshKey?: number;
  onRefresh?: () => void;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatNumber(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

function getMessageContent(content: Message['content']): string | null {
  if (!content) return null;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textPart = content.find(p => p.type === 'text' && p.text);
    if (textPart && textPart.text) return textPart.text;
  }
  return null;
}

function extractConversationItems(sessions: Session[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  let itemId = 0;

  const sortedSessions = [...sessions].sort((a, b) => new Date(a.firstTrace).getTime() - new Date(b.firstTrace).getTime());

  for (const session of sortedSessions) {
    const sortedTraces = [...session.traces].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    for (const trace of sortedTraces) {
      const generationObservations = trace.observations?.filter(obs => obs.type === 'GENERATION') || [];
      const generationObs = generationObservations[0];
      const obsAttrs = generationObs?.metadata?.attributes;

      const traceInput = trace.input;
      const obsInput = generationObs?.input;
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

      const inputTokens = generationObs?.promptTokens;
      const outputTokens = generationObs?.completionTokens;
      const totalTokens = generationObs?.totalTokens;
      const cachedTokens = obsAttrs?.['ai.usage.cachedInputTokens'] ? parseInt(String(obsAttrs['ai.usage.cachedInputTokens'])) : undefined;
      const cost = generationObs?.calculatedTotalCost;
      const model = obsAttrs?.['ai.model.id'] || generationObs?.model;
      const provider = obsAttrs?.['ai.model.provider'];
      const temperature = obsAttrs?.['ai.settings.temperature'] ? parseFloat(obsAttrs['ai.settings.temperature']) : undefined;
      const finishReason = obsAttrs?.['ai.response.finishReason'];

      const toolCalls: ToolCallInfo[] = [];

      // Source 1: SPAN observations with tool-related names (sorted by startTime ascending - execution order)
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

      // Source 2 & 3: Check ALL generation observations for tool calls
      for (const genObs of generationObservations) {
        const genAttrs = genObs?.metadata?.attributes;

        // Source 2: ai.response.toolCalls in metadata attributes
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

        // Source 3: toolCalls in generation output (Vercel AI SDK format)
        const genOutput = genObs?.output;
        if (genOutput && typeof genOutput === 'object') {
          const outputToolCalls = (genOutput as { toolCalls?: Array<{ toolName?: string; name?: string; args?: unknown; input?: unknown }> }).toolCalls;
          if (Array.isArray(outputToolCalls)) {
            for (const tc of outputToolCalls) {
              const toolName = tc.toolName || tc.name;
              if (toolName) {
                const argsStr = (tc.args || tc.input) ? JSON.stringify(tc.args || tc.input, null, 2) : undefined;
                const isDuplicate = toolCalls.some(t => t.name === toolName && t.args === argsStr);
                if (!isDuplicate) {
                  toolCalls.push({ name: toolName, args: argsStr });
                }
              }
            }
          }
        }
      }

      const messageTimestamp = generationObs?.startTime || trace.timestamp;
      const responseTimestamp = generationObs?.endTime || trace.timestamp;

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
          const isLargeContext = (inputTokens || 0) > 50000;
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
            inputTokens,
            systemPrompt,
            rawInput: input,
            isAgentHandoff,
            sourceAgent,
          });
        }
      }

      let responseText: string | undefined;

      if (obsAttrs?.['ai.response.text'] && typeof obsAttrs['ai.response.text'] === 'string' && obsAttrs['ai.response.text'].length > 0) {
        responseText = obsAttrs['ai.response.text'];
      }

      if (!responseText) {
        const output = trace.output;
        if (typeof output === 'string' && output.length > 0) {
          responseText = output;
        } else if (output && typeof output === 'object') {
          const outputObj = output as { text?: string; 'ai.response.text'?: string };
          responseText = outputObj.text || outputObj['ai.response.text'];
        }
      }

      if (!responseText && generationObs?.output) {
        if (typeof generationObs.output === 'string' && generationObs.output.length > 0) {
          responseText = generationObs.output;
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
          inputTokens,
          outputTokens,
          totalTokens,
          cachedTokens,
          cost,
          model,
          provider,
          temperature,
          finishReason,
          tools: toolCalls.length > 0 ? toolCalls : undefined,
          rawOutput: trace.output,
        });
      }
    }
  }

  items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const deduped: ConversationItem[] = [];
  for (const item of items) {
    const last = deduped[deduped.length - 1];
    if (last && last.type === item.type && last.content === item.content && !item.tools?.length) continue;
    deduped.push(item);
  }

  return deduped;
}

function TokenBadge({ label, value, color }: { label: string; value?: number; color: string }) {
  if (!value) return null;
  return (
    <span style={{ fontSize: '0.7rem', fontWeight: 600, color, backgroundColor: `${color}18`, padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
      {label}: {formatNumber(value)}
    </span>
  );
}

function CostBadge({ value }: { value?: number }) {
  if (!value) return null;
  return (
    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#059669', backgroundColor: '#d1fae518', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
      ${value.toFixed(4)}
    </span>
  );
}

function ToolsSection({ tools, expanded: initialExpanded = false }: { tools: ToolCallInfo[]; expanded?: boolean }) {
  const [expanded, setExpanded] = useState(initialExpanded);

  if (!tools || tools.length === 0) return null;

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
          {tools.map((tool, idx) => (
            <details key={idx} style={{ marginBottom: '0.2rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.6rem', color: '#065f46', fontFamily: 'monospace' }}>{tool.name}</summary>
              {tool.args && (
                <pre style={{ fontSize: '0.55rem', backgroundColor: '#ecfdf5', padding: '0.3rem', borderRadius: '3px', overflow: 'auto', maxHeight: '80px', margin: '0.15rem 0 0 0', border: '1px solid #d1fae5' }}>{tool.args}</pre>
              )}
            </details>
          ))}
        </div>
      )}
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
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
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
  const [showDetails, setShowDetails] = useState(false);

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

  const isHandoff = item.isAgentHandoff;
  const avatarBg = isHandoff ? '#f59e0b' : '#3b82f6';
  const avatarIcon = isHandoff ? '🔄' : '👤';
  const labelColor = isHandoff ? '#92400e' : '#1e40af';
  const bubbleBg = isHandoff ? '#fef3c7' : '#eff6ff';
  const textColor = isHandoff ? '#78350f' : '#1e3a8a';
  const label = isHandoff ? `Handoff from ${item.sourceAgent || 'Agent'}` : 'User';

  return (
    <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.6rem' }}>
      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.9rem', flexShrink: 0 }}>{avatarIcon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: labelColor }}>{label}</span>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{formatTime(item.timestamp)}</span>
            <button onClick={() => setShowDetails(!showDetails)} style={{ background: 'none', border: 'none', fontSize: '0.65rem', color: '#94a3b8', cursor: 'pointer', padding: '0 0.25rem' }}>
              {showDetails ? '▼' : '▶'} details
            </button>
            {hasFullContent && (
              <button onClick={() => setExpanded(!expanded)} style={{ background: 'none', border: 'none', fontSize: '0.65rem', color: isHandoff ? '#f59e0b' : '#3b82f6', cursor: 'pointer', padding: '0 0.25rem' }}>
                {expanded ? '↑ collapse' : '↓ full context'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <TokenBadge label="in" value={item.inputTokens} color={isHandoff ? '#f59e0b' : '#3b82f6'} />
          </div>
        </div>
        <div style={{ backgroundColor: bubbleBg, borderRadius: '12px', borderTopLeftRadius: '2px', padding: '0.75rem 1rem', fontSize: '0.9rem', color: textColor, lineHeight: 1.6, borderLeft: isHandoff ? '3px solid #f59e0b' : undefined }}>
          {expanded && hasFullContent ? (
            <FormattedContent content={item.content} />
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {displayContent}
              {isLong && !hasFullContent && <button onClick={() => setExpanded(!expanded)} style={{ display: 'block', background: 'none', border: 'none', color: '#3b82f6', fontSize: '0.65rem', cursor: 'pointer', marginTop: '0.25rem', padding: 0 }}>{expanded ? '↑ less' : '↓ more'}</button>}
            </div>
          )}
        </div>
        {showDetails && (
          <div style={{ marginTop: '0.35rem', padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px', fontSize: '0.6rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.15rem 0.5rem' }}>
            <span style={{ color: '#64748b' }}>Trace:</span><span style={{ fontFamily: 'monospace', color: '#1f2937' }}>{item.traceId?.substring(0, 16)}...</span>
            <span style={{ color: '#64748b' }}>Session:</span><span style={{ fontFamily: 'monospace', color: '#1f2937' }}>{item.sessionId?.substring(0, 16)}...</span>
            {item.systemPrompt && (
              <>
                <span style={{ color: '#64748b' }}>System:</span>
                <details style={{ color: '#1f2937' }}>
                  <summary style={{ cursor: 'pointer' }}>View prompt ({item.systemPrompt.length} chars)</summary>
                  <pre style={{ fontSize: '0.55rem', backgroundColor: '#fff', padding: '0.35rem', borderRadius: '3px', overflow: 'auto', maxHeight: '120px', whiteSpace: 'pre-wrap', margin: '0.25rem 0 0 0', border: '1px solid #e5e7eb' }}>{item.systemPrompt}</pre>
                </details>
              </>
            )}
            {langfuseBaseUrl && <><span style={{ color: '#64748b' }}>Link:</span><a href={`${langfuseBaseUrl}/trace/${item.traceId}`} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>Open in Langfuse ↗</a></>}
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ item, langfuseBaseUrl }: { item: ConversationItem; langfuseBaseUrl?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const hasStructuredContent = /^(User:|Assistant actions?:|Tool result:|Read:|Write:|Edit:|Terminal:)/m.test(item.content);
  const hasContent = item.content.length > 0;

  const firstLine = item.content.split('\n')[0] || '';
  const hasMoreLines = item.content.includes('\n') || item.content.length > 150;

  return (
    <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.6rem' }}>
      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.9rem', flexShrink: 0 }}>🤖</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#047857' }}>{item.agentName || 'Assistant'}</span>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{formatTime(item.timestamp)}</span>
            <button onClick={() => setShowDetails(!showDetails)} style={{ background: 'none', border: 'none', fontSize: '0.65rem', color: '#94a3b8', cursor: 'pointer', padding: '0 0.25rem' }}>
              {showDetails ? '▼' : '▶'} details
            </button>
            {!hasStructuredContent && hasMoreLines && (
              <button onClick={() => setExpanded(!expanded)} style={{ background: 'none', border: 'none', fontSize: '0.65rem', color: '#10b981', cursor: 'pointer', padding: '0 0.25rem' }}>
                {expanded ? '↑ collapse' : '↓ expand'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <TokenBadge label="in" value={item.inputTokens} color="#64748b" />
            <TokenBadge label="out" value={item.outputTokens} color="#10b981" />
            {item.cachedTokens && <TokenBadge label="cached" value={item.cachedTokens} color="#8b5cf6" />}
            <CostBadge value={item.cost} />
            {item.finishReason && !['stop', 'tool-calls', 'tool_calls'].includes(item.finishReason) && (
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#f59e0b', backgroundColor: '#fef3c7', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>{item.finishReason}</span>
            )}
          </div>
        </div>
        <div style={{ backgroundColor: '#f0fdf4', borderRadius: '12px', borderTopLeftRadius: '2px', padding: '0.75rem 1rem', fontSize: '0.9rem', color: '#14532d', lineHeight: 1.6 }}>
          {hasContent ? (
            hasStructuredContent ? (
              <FormattedContent content={item.content} />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {expanded ? item.content : (firstLine.length > 150 ? firstLine.substring(0, 150) + '...' : firstLine)}
              </div>
            )
          ) : (
            <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.7rem' }}>Processing...</span>
          )}
          <ToolsSection tools={item.tools || []} />
        </div>
        {showDetails && (
          <div style={{ marginTop: '0.35rem', padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px', fontSize: '0.6rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.15rem 0.5rem' }}>
            {item.model && <><span style={{ color: '#64748b' }}>Model:</span><span style={{ fontFamily: 'monospace', color: '#1f2937' }}>{item.model}</span></>}
            {item.provider && <><span style={{ color: '#64748b' }}>Provider:</span><span style={{ color: '#1f2937' }}>{item.provider}</span></>}
            {item.temperature !== undefined && <><span style={{ color: '#64748b' }}>Temp:</span><span style={{ color: '#1f2937' }}>{item.temperature}</span></>}
            {item.totalTokens && <><span style={{ color: '#64748b' }}>Total:</span><span style={{ color: '#1f2937' }}>{formatNumber(item.totalTokens)} tokens</span></>}
            {item.cost && <><span style={{ color: '#64748b' }}>Cost:</span><span style={{ color: '#059669', fontWeight: 600 }}>${item.cost.toFixed(4)}</span></>}
            <span style={{ color: '#64748b' }}>Trace:</span><span style={{ fontFamily: 'monospace', color: '#1f2937' }}>{item.traceId?.substring(0, 16)}...</span>
            {langfuseBaseUrl && <><span style={{ color: '#64748b' }}>Link:</span><a href={`${langfuseBaseUrl}/trace/${item.traceId}`} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>Open in Langfuse ↗</a></>}
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
        if (new Date(s.firstTrace) < new Date(existingSession.firstTrace)) existingSession.firstTrace = s.firstTrace;
        if (new Date(s.lastTrace) > new Date(existingSession.lastTrace)) existingSession.lastTrace = s.lastTrace;
      } else {
        sessionMap.set(s.sessionId, s);
      }
    }
    return Array.from(sessionMap.values()).sort((a, b) =>
      new Date(b.lastTrace).getTime() - new Date(a.lastTrace).getTime()
    );
  }, []);

  const loadingMoreRef = useRef(false);

  const fetchPage = useCallback(async function fetchPageData(pageToFetch: number, knownTotalPages?: number, forceRefresh = false) {
    if (!globalAppId) return;
    if (loadingMoreRef.current && !forceRefresh) return;

    const isInitial = knownTotalPages === undefined;
    if (isInitial) {
      setLoading(true);
      setSessions([]);
    } else {
      setLoadingMore(true);
      loadingMoreRef.current = true;
    }
    setError(null);

    try {
      let actualPage = pageToFetch;
      let totalPagesValue = knownTotalPages;

      if (isInitial) {
        const metaResponse = await fetch(`/api/langfuse/sessions/${encodeURIComponent(globalAppId)}?page=1`);
        if (!metaResponse?.ok) throw new Error(`Failed to fetch: ${metaResponse?.status}`);
        const metaData: SessionsResponse = await metaResponse.json();
        totalPagesValue = metaData.pagination?.totalPages || 1;
        setTotalPages(totalPagesValue);

        if (totalPagesValue === 1) {
          setSessions(metaData.sessions);
          setCurrentPage(1);
          setHasMore(false);
          setLoading(false);
          return;
        }

        actualPage = totalPagesValue;
      }

      const lfResponse = await fetch(`/api/langfuse/sessions/${encodeURIComponent(globalAppId)}?page=${actualPage}`);
      if (!lfResponse?.ok) throw new Error(`Failed to fetch: ${lfResponse?.status}`);
      const data: SessionsResponse = await lfResponse.json();

      setSessions(prev => isInitial ? data.sessions : mergeSessions(prev, data.sessions));
      setCurrentPage(actualPage);
      const morePages = actualPage > 1;
      setHasMore(morePages);

      if (morePages) {
        loadingMoreRef.current = false;
        setTimeout(() => fetchPage(actualPage - 1, totalPagesValue), 100);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    } finally {
      if (isInitial) setLoading(false);
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
      fetchPage(1, undefined, true); // forceRefresh = true
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (hasMore || loading || sessions.length === 0 || !globalAppId) return;

    let earliestTimestamp: string | undefined;
    for (const session of sessions) {
      if (session.firstTrace && (!earliestTimestamp || session.firstTrace < earliestTimestamp)) {
        earliestTimestamp = session.firstTrace;
      }
    }

    if (!earliestTimestamp) return;

    fetch(`/api/analytics/${encodeURIComponent(globalAppId)}/errors?fromTimestamp=${encodeURIComponent(earliestTimestamp)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setEsErrors(data); })
      .catch(() => {});
  }, [globalAppId, hasMore, loading, sessions]);

  useEffect(() => {
    getLangfuseConfig().then(config => {
      if (config?.baseUrl) setLangfuseBaseUrl(config.baseUrl);
      if (config?.projectId) setLangfuseProjectId(config.projectId);
    });
  }, []);

  const conversationItems = extractConversationItems(sessions);
  const userMessages = conversationItems.filter(i => i.type === 'user').length;
  const assistantMessages = conversationItems.filter(i => i.type === 'assistant').length;
  const totalTools = conversationItems.reduce((sum, i) => sum + (i.tools?.length || 0), 0);

  const lfTotals = useMemo(() => {
    let inputTokens = 0;
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
          inputTokens += obs.promptTokens || 0;
          outputTokens += obs.completionTokens || 0;
          totalTokens += obs.totalTokens || 0;
          cost += obs.calculatedTotalCost || 0;
        }
      }
    }
    return { inputTokens, outputTokens, totalTokens, cost, observationCount, traceCount };
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
          {/* Loading Progress */}
          {globalAppId && (hasMore || loadingMore || loading) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.7rem', color: '#f59e0b' }}>⏳</span>
              <div style={{
                width: '60px',
                height: '6px',
                backgroundColor: '#e5e7eb',
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${totalPages > 0 ? Math.round(((totalPages - currentPage + 1) / totalPages) * 100) : 0}%`,
                  height: '100%',
                  backgroundColor: '#f59e0b',
                  borderRadius: '3px',
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <span style={{ fontSize: '0.65rem', color: '#6b7280' }}>
                ({currentPage > 0 ? currentPage - 1 : 0} remaining of {totalPages})
              </span>
            </div>
          )}
          {globalAppId && !hasMore && !loadingMore && !loading && conversationItems.length > 0 && (
            <span style={{
              fontSize: '0.7rem',
              color: '#16a34a',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}>
              ✓ Loaded
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
          ⏳ Loading page {currentPage}{totalPages > 1 ? ` of ${totalPages}` : ''}...
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
            <span style={{ color: '#334155', fontWeight: 600 }}>📥 {formatNumber(lfTotals.inputTokens)}</span>
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
            <ConversationView items={conversationItems} errors={esErrors?.errors} langfuseBaseUrl={langfuseBaseUrl} />
          </div>
        </>
      )}
    </div>
  );
}
