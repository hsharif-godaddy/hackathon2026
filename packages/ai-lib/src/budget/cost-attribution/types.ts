/**
 * Cost Attribution Types and Configuration
 *
 * Types and enums for the mid-execution cost attribution system.
 * This system detects tool failures, patterns, and causal chains
 * to fairly attribute costs between customer and GoDaddy.
 */

export enum ReportLabel {
  // Standard
  General = 'airo-builder:general',

  // Full override intents
  PublishTask = 'airo-builder:publish-task',
  DomainTask = 'airo-builder:domain-task',

  // Failure attribution
  ToolFailure = 'airo-builder:tool-failure',
  EditReadLoop = 'airo-builder:edit-read-loop',
  GrepSpiral = 'airo-builder:grep-spiral',
  CausalChain = 'airo-builder:causal-chain',

  // No-value-delivered
  NoOutput = 'airo-builder:no-output',

  // Infrastructure overhead (always GoDaddy)
  InfrastructureOverhead = 'airo-builder:infrastructure-overhead',

  // Severity-based patterns
  RepeatedReads = 'airo-builder:repeated-reads',
  RepeatedEdits = 'airo-builder:repeated-edits',
  TerminalFailures = 'airo-builder:terminal-failures',
  ToolRetry = 'airo-builder:tool-retry',
}

// PATTERN DETECTION THRESHOLDS

export const PATTERN_THRESHOLDS = {
  TERMINAL_FAILURES_MIN: 3,
  EDIT_READ_LOOP_MIN_CYCLES: 3,
  GREP_SPIRAL_MIN: 5,
  REPEATED_READS_MIN: 3,
  REPEATED_EDITS_MIN: 5,
  TOOL_RETRY_MIN: 3,
} as const

// FRICTION SCORE WEIGHTS

/**
 * Weights for composite friction score calculation.
 * See FRICTION-FORMULAS.md for rationale.
 */
// TOOL CLASSIFICATION

/** Tools that run terminal/shell commands */
export const TERMINAL_TOOLS = new Set(['terminal', 'bash', 'execute_command'])

/** Tools that edit existing files (targeted modifications) */
export const EDIT_TOOLS = new Set(['str_replace_based_edit_tool', 'edit'])

/** Tools that write entire files (creation, not targeted edits) */
export const WRITE_TOOLS = new Set(['write_to_file'])

/** Tools that read files */
export const READ_TOOLS = new Set(['read_file'])

/** Tools that search for content */
export const SEARCH_TOOLS = new Set(['grep', 'search_files', 'search', 'ripgrep'])

/** Tools where repeated calls with same args is expected workflow behavior, not a retry */
export const WORKFLOW_TOOLS = new Set([
  'todolist',
  'todo_list',
  'suggestedresponse',
  'suggested_response',
])

/** Tools that work with files (read, edit, write) */
export const FILE_TOOLS = new Set([
  'str_replace_based_edit_tool',
  'edit',
  'write_to_file',
  'read_file',
])

/**
 * Check if tool name matches a set, including skill-namespaced variants.
 * Skill tools use pattern {skillName}__{toolName}, e.g., "publishing__bash"
 */
function matchesToolSet(name: string, toolSet: Set<string>): boolean {
  const lower = name.toLowerCase()
  // Direct match
  if (toolSet.has(lower)) return true
  // Skill-namespaced match (e.g., "publishing__bash" matches "bash")
  const skillSeparator = '__'
  if (lower.includes(skillSeparator)) {
    const baseName = lower.split(skillSeparator).pop()
    if (baseName && toolSet.has(baseName)) return true
  }
  return false
}

/** Check if tool name is a terminal tool */
export function isTerminalTool(name: string): boolean {
  return matchesToolSet(name, TERMINAL_TOOLS)
}

/** Check if tool name is an edit tool (targeted file modifications) */
export function isEditTool(name: string): boolean {
  return matchesToolSet(name, EDIT_TOOLS)
}

/** Check if tool name is a write tool (full file creation) */
export function isWriteTool(name: string): boolean {
  return matchesToolSet(name, WRITE_TOOLS)
}

/** Check if tool name is a read tool */
export function isReadTool(name: string): boolean {
  return matchesToolSet(name, READ_TOOLS)
}

/** Check if tool name is a search tool */
export function isSearchTool(name: string): boolean {
  return matchesToolSet(name, SEARCH_TOOLS)
}

/** Check if tool name is a file tool */
export function isFileTool(name: string): boolean {
  return matchesToolSet(name, FILE_TOOLS)
}

/** Check if tool name is a workflow tool (repeated calls expected) */
export function isWorkflowTool(name: string): boolean {
  return WORKFLOW_TOOLS.has(name.toLowerCase())
}

/**
 * Infrastructure tools - agent overhead, not customer-requested work.
 * These are always attributed to GoDaddy regardless of success/failure.
 *
 * Note: handoff is NOT included because it transitions to a different agent
 * and represents actual execution flow, not just overhead.
 */
export const INFRASTRUCTURE_TOOLS = new Set([
  'suggestedresponse',
  'suggested_response',
  'todolist',
  'todo_list',
])

/** Check if tool name is an infrastructure tool (always GoDaddy cost) */
export function isInfrastructureTool(name: string): boolean {
  return matchesToolSet(name, INFRASTRUCTURE_TOOLS)
}

// SDK STEP TYPES (minimal interface for cost attribution)

export const StepContentType = {
  ToolCall: 'tool-call',
  ToolResult: 'tool-result',
  ToolError: 'tool-error',
  Text: 'text',
} as const

export type StepContentTypeName = (typeof StepContentType)[keyof typeof StepContentType]

export interface StepContentItem {
  type: StepContentTypeName
  toolName?: string
  toolCallId?: string
  /** Tool input arguments (AI SDK uses 'input' for tool-call, we also support 'args' for compatibility) */
  input?: unknown
  args?: unknown
  /** Tool result output (AI SDK uses 'output' for tool-result, we also support 'result' for compatibility) */
  output?: unknown
  result?: unknown
  /** Tool error */
  error?: unknown
  /** Text content */
  text?: string
}

/**
 * Get tool input from a step content item.
 * Handles both 'input' (AI SDK standard) and 'args' (legacy) field names.
 */
export function getToolInput(item: StepContentItem): unknown {
  return item.input ?? item.args
}

/**
 * Get tool output from a step content item.
 * Handles both 'output' (AI SDK standard) and 'result' (legacy) field names.
 */
export function getToolOutput(item: StepContentItem): unknown {
  return item.output ?? item.result
}

export interface ExecutionStep {
  stepNumber?: number
  content: StepContentItem[]
  finishReason?: string
  response?: {
    headers?: Record<string, string>
  }
}

// PATTERN DETECTION TYPES

/** Pattern type values for severity-based failure detection */
export const PatternType = {
  RepeatedReads: 'repeated_reads',
  RepeatedEdits: 'repeated_edits',
  GrepSpiral: 'grep_spiral',
  TerminalFailures: 'terminal_failures',
  EditReadLoop: 'edit_read_loop',
  ToolRetry: 'tool_retry',
} as const

export type PatternTypeName = (typeof PatternType)[keyof typeof PatternType]

export interface PatternResult {
  type: PatternTypeName
  /** Severity score (0-1). Only patterns with severity > 0 are included in firedPatterns. */
  severity: number
  /** Correlation IDs of calls involved in this pattern */
  callIds: string[]
  /** Human-readable description of the pattern */
  details: string
}

// FRICTION ANALYSIS TYPES

// CAUSAL CHAIN TYPES

export interface CausalChain {
  /** The edit that caused the problem */
  triggerCallId: string
  /** e.g., 'Button.tsx' */
  triggerTarget: string
  /** The call that revealed the problem */
  errorCallId: string
  /** Error message for logging */
  errorMessage: string
  /** Subsequent calls fixing the issue */
  fixCallIds: string[]
  /** The successful retry that confirms fix */
  verificationCallId?: string
}

// INTENT CLASSIFICATION

/**
 * Assessment intent values (from assessment agent).
 * Duplicated here to avoid circular dependency with agents package.
 */
export const AssessmentIntentValue = {
  Publish: 'publish',
  Domain: 'domain',
  Fix: 'fix',
  General: 'general',
} as const

export type AssessmentIntent = (typeof AssessmentIntentValue)[keyof typeof AssessmentIntentValue]

// EXECUTION DATA (stored between onFinish and onBudgetReport)

// COST OVERRIDE TYPES

/**
 * Actions that trigger product cost override (GoDaddy pays).
 * Separate from AssessmentIntent to avoid mixing intent classification with billing.
 */
export const CostOverrideAction = {
  Publish: 'publish',
  Domain: 'domain',
} as const

export type CostOverrideActionType = (typeof CostOverrideAction)[keyof typeof CostOverrideAction]

/** Cost override data for product-funded actions (publish, domain) */
export interface CostOverrideData {
  /** Correlation IDs for the cost override action calls themselves */
  actionCallIds: Set<string>
  /** Correlation IDs for all flow-related calls: prep steps, skill loads, and follow-ups */
  followUpCallIds: Set<string>
  /** Map of callId to action type (includes action calls, prep, and follow-ups) */
  actions: Map<string, CostOverrideActionType>
}

export interface ExecutionData {
  /** Set of correlation IDs for calls with direct tool errors */
  failedCallIds: Set<string>
  /** Detected patterns with severity scores (only severity > 0) */
  patterns: PatternResult[]
  /** Detected causal chains */
  causalChains: CausalChain[]
  /** Failed targets for retry detection */
  failedTargets: string[]
  /** Whether this execution had any failures */
  hadFailures: boolean
  /** Total number of steps */
  totalSteps: number
  /** Product-funded actions where GoDaddy absorbs cost (publish, domain) */
  costOverride: CostOverrideData
  /** Assessment intent (publish, domain, fix, general) */
  intent?: AssessmentIntent
  /** Agent produced no output, no successful tool calls, and wasn't user-aborted */
  noValueDelivered?: boolean
  /** Correlation IDs for infrastructure tool calls (always GoDaddy cost) */
  infrastructureCallIds: Set<string>
}

// ATTRIBUTION TYPES

export const Payer = {
  Customer: 'customer',
  GoDaddy: 'godaddy',
} as const

export type AttributionPayer = (typeof Payer)[keyof typeof Payer]

export const AttributionReason = {
  Success: 'success',
  ToolError: 'tool_error',
  PatternDetected: 'pattern_detected',
  CausalChain: 'causal_chain',
  CausalChainTrigger: 'causal_chain_trigger',
  CausalChainError: 'causal_chain_error',
  CausalChainFix: 'causal_chain_fix',
  CostOverrideAction: 'cost_override_action',
  CostOverrideFollowup: 'cost_override_followup',
  NoValueDelivered: 'no_value_delivered',
  InfrastructureOverhead: 'infrastructure_overhead',
} as const

export type AttributionReasonType = (typeof AttributionReason)[keyof typeof AttributionReason]

export interface ItemAttribution {
  callRequestId: string
  cost: number
  payer: AttributionPayer
  reason: AttributionReasonType
  /** Specific label for this attribution (for GoDaddy-attributed items) */
  label: ReportLabel
  patternType?: string
  patternDetails?: string
  causalChainTarget?: string
}

export interface AttributionResult {
  customerCost: number
  godaddyCost: number
  /** Costs aggregated by label for multi-label reports */
  costsByLabel: Map<ReportLabel, number>
  attributions: ItemAttribution[]
  /** Labels describing the session (guaranteed non-empty, defaults to General) */
  labels: [ReportLabel, ...ReportLabel[]]
}

// CONTEXT TYPES

export interface AttributionContext {
  budgetId: string
  sessionId: string
  conversationId?: string
  appId?: string
}

// JUDGE AGENT TYPES (Phase 4)

/**
 * Configuration for Judge agent LLM fallback.
 */
export const JUDGE_CONFIG = {
  /** Minimum confidence to skip LLM fallback (0-100) */
  MIN_CONFIDENCE_FOR_RULE_BASED: 80,

  /** Model to use for Judge decisions */
  MODEL: 'haiku' as const,
} as const

/**
 * Result from rule-based attribution analysis with confidence score.
 */
export interface RuleBasedResult {
  /** Set of correlation IDs for calls attributed to GoDaddy */
  godaddyCallIds: Set<string>
  /** Confidence in the rule-based decision (0-100) */
  confidence: number
  /** Reasons for the attribution decisions */
  reasons: string[]
}

// RETRY DETECTION TYPES

/**
 * Configuration for retry detection.
 */
export const RETRY_DETECTION_CONFIG = {
  /** Maximum number of failed targets to track per execution (prevent memory bloat) */
  MAX_TARGETS_PER_EXECUTION: 20,

  /** Minimum target length to avoid false positives on short words */
  MIN_TARGET_LENGTH: 3,
} as const

/**
 * Stores execution history for retry detection.
 * Tracks failed targets from the immediately previous execution.
 */
export interface ExecutionHistory {
  /** Whether the previous execution had failures */
  hadFailures: boolean
  /** Failed targets (file paths, commands, queries) from previous execution */
  failedTargets: string[]
  /** Timestamp when this history was recorded */
  timestamp: number
}

/**
 * Result of retry detection check.
 */
export interface RetryDetectionResult {
  /** Whether this message is a retry of previously failed work */
  isRetry: boolean
  /** The target that was matched (if retry detected) */
  matchedTarget?: string
  /** The failed targets from previous execution */
  previousFailedTargets: string[]
  /** Whether the previous execution had failures */
  hadPreviousFailures: boolean
}
