// In-process ReAct investigation loop.
// Replaces the claude-CLI spawnClaude + stream-json parsing.
// Each generateText call is a single awaitable (clean step boundary).
// Forced-answer-on-last-step ensures the report is never empty.

/**
 * Map a tool name + input to the activity shape expected by the debug-console feed.
 * Mirrors activity.mjs label vocabulary.
 * @param {string} toolName
 * @param {Record<string, any>} input
 * @returns {{ tool: string, label: string, detail: string }}
 */
function toActivity(toolName, input) {
  const clamp = (v, max = 200) => { const s = String(v ?? ''); return s.length > max ? s.slice(0, max) + '…' : s; };

  switch (toolName) {
    case 'logDigest':
      return { tool: toolName, label: 'Searching logs', detail: 'reading log template digest' };
    case 'fetchLogLines': {
      const svc = input?.service || '';
      return { tool: toolName, label: `Fetching log lines: ${svc || 'all'}`, detail: clamp(JSON.stringify(input)) };
    }
    case 'crgQuery': {
      const op = input?.op || '';
      const target = input?.target || '';
      return { tool: toolName, label: `Querying code graph: ${op} ${target}`, detail: clamp(`${op} ${target}`) };
    }
    case 'astGrep': {
      const pattern = input?.pattern || '';
      return { tool: toolName, label: `Searching code: ${pattern}`, detail: clamp(pattern) };
    }
    case 'ripgrepSeed': {
      const q = input?.query || '';
      return { tool: toolName, label: `Seeding search: ${q}`, detail: clamp(q) };
    }
    case 'readSpan': {
      const f = input?.file || '';
      return { tool: toolName, label: `Reading ${f}`, detail: clamp(`${f}:${input?.fromLine ?? '?'}-${input?.toLine ?? '?'}`) };
    }
    default:
      return { tool: toolName, label: toolName, detail: clamp(JSON.stringify(input)) };
  }
}

// Keep the N most-recent tool-result messages full; older ones get their
// payload stubbed (the conclusion is already in the report/ledger). Prevents
// context-rot from stale raw log/code blobs squatting in the window all run.
const STALE_TOOL_KEEP = 4;
const CLEARED_STUB = '[older tool result cleared to conserve context — its conclusion is captured in the report/hypothesis ledger]';

// Retry transient model-call errors so one blip doesn't end the investigation.
const MAX_CALL_RETRIES = 2;
const CALL_RETRY_BASE_MS = 400;

/**
 * Stub the payload of tool-result parts older than `keepRecent` tool messages,
 * preserving toolCallId/toolName/type so tool-call↔result pairing stays valid.
 * Mutates in place. Defensive: any shape mismatch leaves messages untouched —
 * clearing is an optimization, never a correctness requirement.
 * @param {any[]} messages
 * @param {number} [keepRecent]
 */
export function stubStaleToolResults(messages, keepRecent = STALE_TOOL_KEEP) {
  try {
    const toolIdx = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]?.role === 'tool') toolIdx.push(i);
    }
    const clearBefore = toolIdx.length - keepRecent;
    if (clearBefore <= 0) return;
    for (let k = 0; k < clearBefore; k++) {
      const msg = messages[toolIdx[k]];
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (part && part.type === 'tool-result' && !part._cleared) {
          part.output = { type: 'text', value: CLEARED_STUB };
          part._cleared = true;
        }
      }
    }
  } catch {
    /* clearing is best-effort; never break the loop over it */
  }
}

/**
 * Run the in-process investigation loop.
 * @param {{
 *   model: any,
 *   system: string,
 *   user: string,
 *   tools: Record<string, any>,
 *   budget: { maxTurns: number, deadline?: number },
 *   onActivity: (a: { tool: string, label: string, detail: string }) => void,
 *   onPhase: (phase: string) => void,
 *   generateTextImpl?: Function,
 * }} opts
 * @returns {Promise<{ report: string, steps: any[], usage: { inputTokens: number, outputTokens: number }, coverage: { toolsUsed: Set<string>, partial: boolean, partialReason?: 'deadline'|'turn-cap'|'error', errorMessage?: string } }>}
 */
export async function runInvestigation({
  model,
  system,
  user,
  tools,
  budget,
  onActivity,
  onPhase,
  generateTextImpl,
}) {
  // Late-bind the real generateText to avoid import-time model-loading issues in tests
  if (!generateTextImpl) {
    const { generateText } = await import('ai');
    generateTextImpl = generateText;
  }

  const maxTurns = budget?.maxTurns ?? 20;
  const deadline = budget?.deadline ?? null;

  const messages = [{ role: 'user', content: user }];
  const allSteps = [];
  const coverage = { toolsUsed: new Set(), partial: false };
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let report = '';
  let turn = 0;

  // P1-1: cache the (large, stable) system prompt once. Same prefix every turn
  // → the proxy can serve it from cache at ~10% cost instead of re-billing it on
  // each of up to 100 turns. 'ephemeral' is the ONLY valid cache_control type —
  // @ai-sdk/anthropic types it as z.literal('ephemeral'), so any other value
  // (e.g. 'default') is rejected with a 400 on every call.
  const systemMessage = {
    role: 'system',
    content: system,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  };

  // P1-5: repeated-tool-call guard — track (tool, args) signatures across turns
  // so we can nudge the model when it re-issues an identical call (a real
  // budget-waster in bounded loops).
  const seenToolSignatures = new Set();
  const nudgedSignatures = new Set();

  onPhase?.('claude-analysis');

  while (turn < maxTurns) {
    // Wall-clock deadline guard — break before the Lambda is hard-killed
    if (deadline !== null && Date.now() >= deadline) {
      coverage.partial = true;
      coverage.partialReason = 'deadline';
      report = report || `[Investigation stopped: wall-clock deadline reached at turn ${turn}. Partial evidence gathered: tools used = ${[...coverage.toolsUsed].join(', ') || 'none'}]`;
      break;
    }

    // On the final turn, strip tools to force a text answer (HolmesGPT forced-answer-on-last-step)
    const isLastTurn = turn === maxTurns - 1;
    const turnTools = isLastTurn ? undefined : (Object.keys(tools).length > 0 ? tools : undefined);

    // P1-4: stub stale tool-result payloads before re-sending the history.
    stubStaleToolResults(messages);

    // System prompt rides as a cached message (P1-1), not the `system` param.
    const callOpts = { model, messages: [systemMessage, ...messages], tools: turnTools };
    // I1: derive an abort signal from the wall-clock deadline so an in-flight
    // model step or long tool fan-out is cut off NEAR the deadline, instead of
    // only being noticed at the next top-of-loop check (which can be up to one
    // tool-timeout late and overrun the Lambda hard cap, losing the report).
    if (deadline !== null) {
      const remaining = deadline - Date.now();
      if (remaining > 0) callOpts.abortSignal = AbortSignal.timeout(remaining);
    }

    // Call the model, retrying transient errors so a single blip doesn't end a
    // 100-turn investigation. A deadline AbortError is NOT retried (out of time).
    let result;
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_CALL_RETRIES; attempt++) {
      try {
        result = await generateTextImpl(callOpts);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const aborted = err?.name === 'AbortError' || err?.name === 'TimeoutError';
        // H4: ALWAYS log the throw — the previous silent catch made these
        // failures invisible in CloudWatch (a 20s run looked like a 15-min timeout).
        console.error('[investigator] agent-loop.generateText.error', {
          turn, attempt, aborted, error: String(err?.message ?? err),
        });
        if (aborted || attempt === MAX_CALL_RETRIES) break;
        await new Promise((r) => setTimeout(r, CALL_RETRY_BASE_MS * (attempt + 1)));
      }
    }
    if (lastErr) {
      // Retries exhausted (or a deadline abort). Keep the best report so far so
      // core-run still writes the report + analysis files; label the cause
      // honestly so the handler doesn't report a transient error as a timeout.
      const aborted = lastErr?.name === 'AbortError' || lastErr?.name === 'TimeoutError';
      coverage.partial = true;
      coverage.partialReason = aborted ? 'deadline' : 'error';
      coverage.errorMessage = String(lastErr?.message ?? lastErr);
      report = report || `[Investigation aborted at turn ${turn}: ${coverage.errorMessage}. Partial evidence gathered: tools used = ${[...coverage.toolsUsed].join(', ') || 'none'}]`;
      break;
    }

    // Accumulate usage (totalUsage is aggregated across steps; usage is single step)
    const stepUsage = result.totalUsage ?? result.usage ?? {};
    totalInputTokens += stepUsage.inputTokens || 0;
    totalOutputTokens += stepUsage.outputTokens || 0;

    // Accumulate steps
    allSteps.push(...(result.steps || []));

    // Emit activity for each tool call + detect repeated identical calls (P1-5).
    const repeatNudges = [];
    for (const step of (result.steps || [])) {
      for (const tc of (step.toolCalls || [])) {
        coverage.toolsUsed.add(tc.toolName);
        onActivity?.(toActivity(tc.toolName, tc.input || {}));
        const sig = `${tc.toolName}:${JSON.stringify(tc.input ?? {})}`;
        if (seenToolSignatures.has(sig) && !nudgedSignatures.has(sig)) {
          nudgedSignatures.add(sig);
          repeatNudges.push(tc.toolName);
        }
        seenToolSignatures.add(sig);
      }
    }

    // Append assistant messages to history
    if (result.response?.messages) {
      messages.push(...result.response.messages);
    }

    // P1-5: nudge once per repeated signature so the model stops burning turns
    // re-running identical queries.
    if (repeatNudges.length > 0) {
      messages.push({
        role: 'user',
        content: `[investigation-control] You re-issued an identical call to: ${[...new Set(repeatNudges)].join(', ')}. Identical calls return identical results — do not repeat them. Use the earlier result, or try a materially different query/argument.`,
      });
    }

    // If we have a text response with no tool calls, we're done
    if (result.text && result.toolCalls?.length === 0) {
      report = result.text;
      break;
    }

    // If there was text but also tool calls, keep going (intermediate text)
    if (result.text && (result.toolCalls?.length ?? 0) > 0) {
      report = result.text;
    }

    turn++;
  }

  // If no report after all turns, forced-partial (ran out of turns, not time)
  if (!report) {
    coverage.partial = true;
    coverage.partialReason = coverage.partialReason || 'turn-cap';
    report = `[Investigation reached turn limit (${maxTurns}) without a final report. Partial evidence gathered: tools used = ${[...coverage.toolsUsed].join(', ') || 'none'}]`;
  }

  return {
    report,
    steps: allSteps,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    coverage,
  };
}
