/**
 * Friction Detector — identifies known agent failure patterns from ordered Langfuse observations.
 *
 * Pattern detectors analyze temporally-ordered observations (tool calls + LLM generations)
 * to identify wasteful loops, spirals, and user-induced retries.
 *
 * Root cause categories:
 *   - EDIT_LOOP:              2+ consecutive str_replace errors on same file
 *   - GREP_SPIRAL:            4+ consecutive grep/search calls without an edit
 *   - READ_SPIRAL:            Same file read 4+ times in 6 turns without intervening edit
 *   - NO_PROGRESS_LOOP:       tools/turn ratio < 0.5 for 4+ generations in a sliding window
 *   - REDUNDANT_EXPLORATION:  reads continue 3+ turns after successful edit
 *   - ERROR_LOOP:             3+ consecutive same-error-type failures
 *   - USER_CORRECTION:        User sent a second message after agent completed (correction)
 *   - CLARIFICATION_LOOP:     Agent asks clarifying questions repeatedly (not yet detected via Langfuse)
 */

import type {
  FrictionPattern,
  FrictionPatternType,
  FrictionReport,
  FrictionSeverity,
  RetryClassification,
} from '../scenarios/types.js';
import type { OrderedObservation } from './langfuse.js';

// ── Tool name constants (matching Langfuse SPAN names from the agentic builder) ──

const EDIT_TOOLS = new Set(['str_replace_editor', 'str_replace', 'str_replace_based_edit_tool', 'editFile', 'edit_file']);
const READ_TOOLS = new Set(['readFile', 'read_file', 'viewFile', 'view_file']);
const SEARCH_TOOLS = new Set([
  'grep', 'grep_search', 'search', 'searchFiles', 'search_files',
  'find', 'findFiles', 'find_files', 'ripgrep', 'codeSearch',
]);
const TERMINAL_TOOLS = new Set(['terminalCommand', 'terminal_command', 'runCommand', 'run_command']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function isToolSpan(obs: OrderedObservation): boolean {
  return obs.type === 'SPAN' && !!obs.name;
}

function isGeneration(obs: OrderedObservation): boolean {
  return obs.type === 'GENERATION';
}

function isError(obs: OrderedObservation): boolean {
  return obs.level === 'ERROR';
}

function toolNameMatches(obs: OrderedObservation, toolSet: Set<string>): boolean {
  return !!obs.name && toolSet.has(obs.name);
}

/**
 * Extract a filename hint from an observation's input (best-effort).
 * Langfuse observations may have structured or stringified input.
 */
function extractFileName(obs: OrderedObservation): string | undefined {
  if (!obs.input) return undefined;

  // Structured object with path/file_path/filename
  if (typeof obs.input === 'object' && obs.input !== null) {
    const inp = obs.input as Record<string, unknown>;
    for (const key of ['path', 'file_path', 'filePath', 'filename', 'file']) {
      if (typeof inp[key] === 'string') return inp[key] as string;
    }
    // Check nested command field
    if (typeof inp['command'] === 'string') {
      const cmd = inp['command'] as string;
      // Simple heuristic: last path-like token
      const tokens = cmd.split(/\s+/);
      const pathToken = tokens.find(t => t.includes('/') && !t.startsWith('-'));
      if (pathToken) return pathToken;
    }
  }

  // Stringified JSON
  if (typeof obs.input === 'string') {
    try {
      const parsed = JSON.parse(obs.input);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const key of ['path', 'file_path', 'filePath', 'filename', 'file']) {
          if (typeof parsed[key] === 'string') return parsed[key];
        }
      }
    } catch {
      // Not JSON — try path-like substring
      const match = (obs.input as string).match(/[/\w.-]+\.\w{1,10}/);
      if (match) return match[0];
    }
  }

  return undefined;
}

/**
 * Estimate per-observation cost (simplified — uses totalCost when available,
 * falls back to token-based estimate).
 */
function estimateObsCost(obs: OrderedObservation): number {
  if (obs.totalCost && obs.totalCost > 0) return obs.totalCost;
  if (obs.usage) {
    const inputCost = ((obs.usage.input ?? 0) / 1_000_000) * 3.0;
    const outputCost = ((obs.usage.output ?? 0) / 1_000_000) * 15.0;
    return inputCost + outputCost;
  }
  return 0;
}

function severityFromCount(count: number, thresholds: [number, number, number]): FrictionSeverity {
  if (count >= thresholds[2]) return 'critical';
  if (count >= thresholds[1]) return 'high';
  if (count >= thresholds[0]) return 'medium';
  return 'low';
}

// ── Pattern Detectors ─────────────────────────────────────────────────────────

/**
 * EDIT_LOOP: 2+ consecutive str_replace errors (ERROR-level SPAN with an edit tool name).
 */
function detectEditLoops(observations: OrderedObservation[]): FrictionPattern[] {
  const patterns: FrictionPattern[] = [];
  let streakStart = -1;
  let streakCount = 0;

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    if (isToolSpan(obs) && toolNameMatches(obs, EDIT_TOOLS) && isError(obs)) {
      if (streakStart === -1) streakStart = i;
      streakCount++;
    } else {
      if (streakCount >= 2) {
        const window = observations.slice(streakStart, streakStart + streakCount);
        patterns.push({
          type: 'EDIT_LOOP',
          severity: severityFromCount(streakCount, [2, 4, 6]),
          count: streakCount,
          startIndex: streakStart,
          endIndex: streakStart + streakCount - 1,
          wastedCostUSD: window.reduce((sum, o) => sum + estimateObsCost(o), 0),
          description: `${streakCount} consecutive str_replace errors`,
          toolNames: [...new Set(window.map(o => o.name).filter(Boolean) as string[])],
        });
      }
      streakStart = -1;
      streakCount = 0;
    }
  }

  // Trailing streak
  if (streakCount >= 2) {
    const window = observations.slice(streakStart, streakStart + streakCount);
    patterns.push({
      type: 'EDIT_LOOP',
      severity: severityFromCount(streakCount, [2, 4, 6]),
      count: streakCount,
      startIndex: streakStart,
      endIndex: streakStart + streakCount - 1,
      wastedCostUSD: window.reduce((sum, o) => sum + estimateObsCost(o), 0),
      description: `${streakCount} consecutive str_replace errors`,
      toolNames: [...new Set(window.map(o => o.name).filter(Boolean) as string[])],
    });
  }

  return patterns;
}

/**
 * GREP_SPIRAL: 4+ consecutive grep/search tool calls without an intervening edit.
 */
function detectGrepSpirals(observations: OrderedObservation[]): FrictionPattern[] {
  const patterns: FrictionPattern[] = [];
  let streakStart = -1;
  let streakCount = 0;

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    if (!isToolSpan(obs)) continue;

    if (toolNameMatches(obs, SEARCH_TOOLS)) {
      if (streakStart === -1) streakStart = i;
      streakCount++;
    } else if (toolNameMatches(obs, EDIT_TOOLS)) {
      // Edit breaks the spiral
      if (streakCount >= 4) {
        const window = observations.slice(streakStart, streakStart + streakCount);
        patterns.push({
          type: 'GREP_SPIRAL',
          severity: severityFromCount(streakCount, [4, 6, 10]),
          count: streakCount,
          startIndex: streakStart,
          endIndex: streakStart + streakCount - 1,
          wastedCostUSD: window.reduce((sum, o) => sum + estimateObsCost(o), 0),
          description: `${streakCount} consecutive search calls without an edit`,
          toolNames: [...new Set(window.map(o => o.name).filter(Boolean) as string[])],
        });
      }
      streakStart = -1;
      streakCount = 0;
    }
    // Non-edit, non-search tools (read, terminal) don't break or extend the streak
  }

  // Trailing
  if (streakCount >= 4) {
    const window = observations.slice(streakStart, streakStart + streakCount);
    patterns.push({
      type: 'GREP_SPIRAL',
      severity: severityFromCount(streakCount, [4, 6, 10]),
      count: streakCount,
      startIndex: streakStart,
      endIndex: streakStart + streakCount - 1,
      wastedCostUSD: window.reduce((sum, o) => sum + estimateObsCost(o), 0),
      description: `${streakCount} consecutive search calls without an edit`,
      toolNames: [...new Set(window.map(o => o.name).filter(Boolean) as string[])],
    });
  }

  return patterns;
}

/**
 * READ_SPIRAL: same file read 4+ times within a 6-observation window without an intervening edit.
 */
function detectReadSpirals(observations: OrderedObservation[]): FrictionPattern[] {
  const patterns: FrictionPattern[] = [];
  const WINDOW_SIZE = 6;
  const MIN_READS = 4;

  // Track which ranges we've already reported to avoid overlapping patterns
  const reportedRanges: Array<[number, number]> = [];

  for (let i = 0; i <= observations.length - WINDOW_SIZE; i++) {
    const window = observations.slice(i, i + WINDOW_SIZE);

    // Check if any edit occurred in this window
    const hasEdit = window.some(o => isToolSpan(o) && toolNameMatches(o, EDIT_TOOLS));
    if (hasEdit) continue;

    // Count reads per file in this window
    const fileCounts: Record<string, number> = {};
    for (const obs of window) {
      if (isToolSpan(obs) && toolNameMatches(obs, READ_TOOLS)) {
        const file = extractFileName(obs) ?? obs.name ?? 'unknown';
        fileCounts[file] = (fileCounts[file] ?? 0) + 1;
      }
    }

    for (const [file, count] of Object.entries(fileCounts)) {
      if (count >= MIN_READS) {
        // Check overlap with already-reported ranges
        const startIdx = i;
        const endIdx = i + WINDOW_SIZE - 1;
        const overlaps = reportedRanges.some(
          ([rs, re]) => startIdx <= re && endIdx >= rs
        );
        if (overlaps) continue;

        reportedRanges.push([startIdx, endIdx]);
        patterns.push({
          type: 'READ_SPIRAL',
          severity: severityFromCount(count, [4, 6, 8]),
          count,
          startIndex: startIdx,
          endIndex: endIdx,
          wastedCostUSD: window.reduce((sum, o) => sum + estimateObsCost(o), 0),
          description: `${file} read ${count} times in ${WINDOW_SIZE} observations without an edit`,
          toolNames: [...new Set(window.map(o => o.name).filter(Boolean) as string[])],
        });
      }
    }
  }

  return patterns;
}

/**
 * NO_PROGRESS_LOOP: tools/turn ratio < 0.5 for 4+ consecutive turns.
 * A "turn" is a contiguous group of observations anchored by a GENERATION.
 * Detects "thinking loops" where the LLM generates multiple turns but invokes
 * very few tools relative to the number of generation calls.
 *
 * The detector scans sliding windows of observations (size 6 to capture
 * interleaved tool spans between generations). A window triggers if it contains
 * at least 4 generations and the tool-span-to-generation ratio is below 0.5.
 */
function detectNoProgressLoops(observations: OrderedObservation[]): FrictionPattern[] {
  const patterns: FrictionPattern[] = [];
  const MIN_GENERATIONS = 4;
  const WINDOW_SIZE = 8; // broad enough to capture interleaved spans
  const RATIO_THRESHOLD = 0.5;

  for (let i = 0; i <= observations.length - MIN_GENERATIONS; i++) {
    // Determine adaptive window end (up to WINDOW_SIZE or end of array)
    const windowEnd = Math.min(i + WINDOW_SIZE - 1, observations.length - 1);
    const window = observations.slice(i, windowEnd + 1);

    const generations = window.filter(isGeneration);
    if (generations.length < MIN_GENERATIONS) continue;

    const toolSpans = window.filter(o => isToolSpan(o));
    const ratio = toolSpans.length / generations.length;

    if (ratio < RATIO_THRESHOLD) {
      patterns.push({
        type: 'NO_PROGRESS_LOOP',
        severity: severityFromCount(generations.length, [4, 6, 10]),
        count: generations.length,
        startIndex: i,
        endIndex: windowEnd,
        wastedCostUSD: window.reduce((sum, o) => sum + estimateObsCost(o), 0),
        description: `${generations.length} LLM turns with only ${toolSpans.length} tool calls (ratio: ${ratio.toFixed(2)})`,
        toolNames: toolSpans.map(o => o.name).filter(Boolean) as string[],
      });

      // Skip ahead to avoid overlapping patterns
      i = windowEnd;
    }
  }

  return patterns;
}

/**
 * REDUNDANT_EXPLORATION: 3+ read/search calls after the last successful edit in the session.
 * Detects unnecessary exploration after the task is effectively done.
 */
function detectRedundantExploration(observations: OrderedObservation[]): FrictionPattern[] {
  const patterns: FrictionPattern[] = [];

  // Find the last successful edit (non-error edit tool span)
  let lastEditIdx = -1;
  for (let i = observations.length - 1; i >= 0; i--) {
    const obs = observations[i];
    if (isToolSpan(obs) && toolNameMatches(obs, EDIT_TOOLS) && !isError(obs)) {
      lastEditIdx = i;
      break;
    }
  }

  if (lastEditIdx === -1) return patterns;

  // Count read/search tool spans after the last edit
  const postEditReadSearches: OrderedObservation[] = [];
  for (let i = lastEditIdx + 1; i < observations.length; i++) {
    const obs = observations[i];
    if (isToolSpan(obs) && (toolNameMatches(obs, READ_TOOLS) || toolNameMatches(obs, SEARCH_TOOLS))) {
      postEditReadSearches.push(obs);
    }
  }

  if (postEditReadSearches.length >= 3) {
    const startIdx = postEditReadSearches[0].index;
    const endIdx = postEditReadSearches[postEditReadSearches.length - 1].index;
    patterns.push({
      type: 'REDUNDANT_EXPLORATION',
      severity: severityFromCount(postEditReadSearches.length, [3, 5, 8]),
      count: postEditReadSearches.length,
      startIndex: startIdx,
      endIndex: endIdx,
      wastedCostUSD: postEditReadSearches.reduce((sum, o) => sum + estimateObsCost(o), 0),
      description: `${postEditReadSearches.length} read/search calls after last successful edit`,
      toolNames: [...new Set(postEditReadSearches.map(o => o.name).filter(Boolean) as string[])],
    });
  }

  return patterns;
}

function normalizeErrorMessagePrefix(message: string | undefined): string {
  return (message ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function getErrorSignature(obs: OrderedObservation): string {
  const statusMessage = 'statusMessage' in obs && typeof obs.statusMessage === 'string'
    ? obs.statusMessage
    : undefined;
  return `${obs.name ?? 'unknown'}::${normalizeErrorMessagePrefix(statusMessage)}`;
}

function pushErrorLoopPattern(
  patterns: FrictionPattern[],
  observations: OrderedObservation[],
  streakStart: number,
  streakCount: number,
): void {
  if (streakStart === -1 || streakCount < 3) return;
  const window = observations.slice(streakStart, streakStart + streakCount);
  patterns.push({
    type: 'ERROR_LOOP',
    severity: severityFromCount(streakCount, [3, 5, 8]),
    count: streakCount,
    startIndex: streakStart,
    endIndex: streakStart + streakCount - 1,
    wastedCostUSD: window.reduce((sum, o) => sum + estimateObsCost(o), 0),
    description: `${streakCount} consecutive same-error-type tool failures`,
    toolNames: [...new Set(window.map(o => o.name).filter(Boolean) as string[])],
  });
}

/**
 * ERROR_LOOP: 3+ consecutive tool failures with the same normalized error signature.
 */
function detectErrorLoops(observations: OrderedObservation[]): FrictionPattern[] {
  const patterns: FrictionPattern[] = [];
  let streakStart = -1;
  let streakCount = 0;
  let streakSignature: string | null = null;

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    if (isToolSpan(obs) && isError(obs)) {
      const signature = getErrorSignature(obs);
      if (streakStart === -1) {
        streakStart = i;
        streakCount = 1;
        streakSignature = signature;
      } else if (signature === streakSignature) {
        streakCount++;
      } else {
        pushErrorLoopPattern(patterns, observations, streakStart, streakCount);
        streakStart = i;
        streakCount = 1;
        streakSignature = signature;
      }
    } else if (isToolSpan(obs)) {
      // Only non-error tool spans break the error streak (generations don't)
      pushErrorLoopPattern(patterns, observations, streakStart, streakCount);
      streakStart = -1;
      streakCount = 0;
      streakSignature = null;
    }
  }

  // Trailing
  pushErrorLoopPattern(patterns, observations, streakStart, streakCount);

  return patterns;
}

/**
 * USER_CORRECTION: detects when a user sent multiple chat messages and the timing
 * suggests corrections (message sent shortly after agent completed a prior turn).
 *
 * Uses chatMessageTimestamps from the runner and ordered observations:
 * - If 2+ chat messages exist, the second+ messages are potential corrections
 * - We check if the agent had already completed work before the correction arrived
 */
function detectUserCorrections(
  observations: OrderedObservation[],
  chatMessageTimestamps?: number[]
): FrictionPattern[] {
  const patterns: FrictionPattern[] = [];

  if (!chatMessageTimestamps || chatMessageTimestamps.length < 2) return patterns;

  // For each chat message after the first, check if agent was working/completed
  for (let i = 1; i < chatMessageTimestamps.length; i++) {
    const msgTime = chatMessageTimestamps[i];
    const prevMsgTime = chatMessageTimestamps[i - 1];

    // Find observations between the two messages
    const obsBetween = observations.filter(obs => {
      if (!obs.startTime) return false;
      const obsTime = new Date(obs.startTime).getTime();
      return obsTime >= prevMsgTime && obsTime < msgTime;
    });

    // If agent was active (had tool calls) between messages, this is likely a correction
    const toolCallsBetween = obsBetween.filter(o => isToolSpan(o));
    if (toolCallsBetween.length > 0) {
      const startIdx = obsBetween[0]?.index ?? 0;
      const endIdx = obsBetween[obsBetween.length - 1]?.index ?? 0;

      patterns.push({
        type: 'USER_CORRECTION',
        severity: 'medium',
        count: 1,
        startIndex: startIdx,
        endIndex: endIdx,
        wastedCostUSD: obsBetween.reduce((sum, o) => sum + estimateObsCost(o), 0),
        description: `User sent correction after ${toolCallsBetween.length} tool calls (message ${i + 1} of ${chatMessageTimestamps.length})`,
        toolNames: [...new Set(toolCallsBetween.map(o => o.name).filter(Boolean) as string[])],
      });
    }
  }

  return patterns;
}

// ── Retry Classification ──────────────────────────────────────────────────────

const TRANSIENT_ERROR_PATTERNS = [
  /timeout/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /rate.?limit/i,
  /429/,
  /5\d{2}/,
  /abort/i,
  /ETIMEDOUT/i,
];

function classifyRetry(obs: OrderedObservation): RetryClassification {
  const msg = obs.statusMessage ?? '';

  // Check for transient/infra errors
  for (const pattern of TRANSIENT_ERROR_PATTERNS) {
    if (pattern.test(msg)) return 'transient';
  }

  // Agent errors: bad params, stale context, wrong old_str
  return 'agent';
}

// ── Main API ──────────────────────────────────────────────────────────────────

export interface DetectFrictionOptions {
  /** Timestamps (epoch ms) when each chat message was sent by the user */
  chatMessageTimestamps?: number[];
}

/**
 * Run all friction pattern detectors on ordered observations.
 * Returns a FrictionReport summarizing all detected patterns.
 */
export function detectFriction(
  observations: OrderedObservation[],
  options: DetectFrictionOptions = {}
): FrictionReport {
  if (observations.length === 0) {
    return {
      patternCount: 0,
      patterns: [],
      score: 0,
      maxSeverity: 'low',
      retryTransient: 0,
      retryAgent: 0,
      retryUserInduced: 0,
      totalWastedCostUSD: 0,
    };
  }

  // Run all detectors
  const allPatterns: FrictionPattern[] = [
    ...detectEditLoops(observations),
    ...detectGrepSpirals(observations),
    ...detectReadSpirals(observations),
    ...detectNoProgressLoops(observations),
    ...detectRedundantExploration(observations),
    ...detectErrorLoops(observations),
    ...detectUserCorrections(observations, options.chatMessageTimestamps),
  ];

  // Classify retries from error observations
  let retryTransient = 0;
  let retryAgent = 0;
  let retryUserInduced = 0;

  for (const obs of observations) {
    if (isToolSpan(obs) && isError(obs)) {
      const classification = classifyRetry(obs);
      if (classification === 'transient') retryTransient++;
      else if (classification === 'agent') retryAgent++;
    }
  }

  // User corrections count as user-induced retries
  retryUserInduced = allPatterns.filter(p => p.type === 'USER_CORRECTION').length;

  // Calculate friction score (0-100)
  const score = calculateFrictionScore(allPatterns, observations.length);

  // Determine max severity
  const severityOrder: FrictionSeverity[] = ['low', 'medium', 'high', 'critical'];
  const maxSeverity = allPatterns.reduce<FrictionSeverity>(
    (max, p) => severityOrder.indexOf(p.severity) > severityOrder.indexOf(max) ? p.severity : max,
    'low'
  );

  const totalWastedCostUSD = Math.round(
    allPatterns.reduce((sum, p) => sum + p.wastedCostUSD, 0) * 10000
  ) / 10000;

  return {
    patternCount: allPatterns.length,
    patterns: allPatterns,
    score,
    maxSeverity,
    retryTransient,
    retryAgent,
    retryUserInduced,
    totalWastedCostUSD,
  };
}

/**
 * Calculate a 0-100 friction score based on pattern severity and density.
 */
function calculateFrictionScore(patterns: FrictionPattern[], totalObservations: number): number {
  if (patterns.length === 0 || totalObservations === 0) return 0;

  const severityWeights: Record<FrictionSeverity, number> = {
    low: 5,
    medium: 15,
    high: 30,
    critical: 50,
  };

  const rawScore = patterns.reduce((sum, p) => sum + severityWeights[p.severity], 0);

  // Normalize: cap at 100, scale relative to observation count
  // More observations = more opportunity for friction, so normalize accordingly
  const densityFactor = Math.min(patterns.length / (totalObservations * 0.1), 2);
  const normalized = Math.min(rawScore * (0.5 + densityFactor * 0.5), 100);

  return Math.round(normalized);
}

// Export individual detectors for unit testing
export const _detectors = {
  detectEditLoops,
  detectGrepSpirals,
  detectReadSpirals,
  detectNoProgressLoops,
  detectRedundantExploration,
  detectErrorLoops,
  detectUserCorrections,
};
