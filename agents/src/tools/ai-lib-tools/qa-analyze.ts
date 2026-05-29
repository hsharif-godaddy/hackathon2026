import { createTool, generateTextWithTracking, type Tool, type AgentContext } from '@airo/ai-lib'
import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'
import { buildLitellmMetadataFromContext, LlmCallSource, type ExecutionContext } from '@airo/ai-grants'
import { extractBudgetContext, withBudgetFields, type ToolBudgetContext } from './tool-budget-context.js'
import { z } from 'zod'

import { AppRepository } from '../../database/repositories/AppRepository.js'
import { DevSupervisorError } from '../../services/DevSupervisorClient.js'
import { createForWorkspace } from '../../workspace/index.js'
import type { WorkspaceFiles } from '../../workspace/files.js'

import { appPlanTool } from '../app-plan-tool.js'
import { getAgentModelWithName } from '../../utils/model-selection.js'
import { logger } from '../../logging/index.js'
import { createQAReport, generateIssueId, type QAIssue, type QACategory, type QASummary, type QACategorySummary } from '../qa-analyze-tool.js'

const appRepo = new AppRepository()

/**
 * Generate text with optional LiteLLM metadata context wrapper.
 * Handles the conditional wrapping pattern used for billing/tracking.
 */
async function generateWithMetadata(
    options: Parameters<typeof generateTextWithTracking>[0],
    metadata: LitellmMetadata | null
): Promise<Awaited<ReturnType<typeof generateTextWithTracking>>> {
    if (metadata) {
        return llmMetadataContext.run(metadata, () => generateTextWithTracking(options))
    }
    return generateTextWithTracking(options)
}

const QA_HISTORY_PATH = '.airo/qa-history.json'

function getQARunPath(runId: string): string {
    return `.airo/qa-runs/qa-run-${runId}.json`
}


/**
 * Individual QA run file structure
 */
interface QARunFile {
    runId: string
    timestamp: number
    appId: string
    mode: 'semantic' | 'technical' | 'full'
    report: {
        summary: QASummary
        categories: QACategorySummary[]
    }
    issueIds: string[] // All issue IDs from this run
    fixedIssueIds: string[] // Issue IDs that have been marked as fixed
}

async function saveQARunFile(files: WorkspaceFiles, runFile: QARunFile): Promise<void> {
    const runPath = getQARunPath(runFile.runId)
    await files.write({ path: runPath, content: JSON.stringify(runFile, null, 2) })

    logger.info('qa_analyze.run_file_saved', {
        runId: runFile.runId,
        filePath: runPath
    })
}

async function readQARunFile(files: WorkspaceFiles, runId: string): Promise<QARunFile | null> {
    try {
        const result = await files.view({ path: getQARunPath(runId) })
        return JSON.parse(result.content) as QARunFile
    } catch (error) {
        if (error instanceof DevSupervisorError && error.code === 'not_found') return null
        logger.warn('qa_analyze.run_file.read_error', {
            runId,
            error: error instanceof Error ? error.message : String(error)
        })
        return null
    }
}

export async function markIssuesAsFixed(
    appId: string,
    runId: string,
    issueIds: string[]
): Promise<void> {
    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) {
        throw new Error(`Workspace not available for app: ${appId}`)
    }

    const runFile = await readQARunFile(workspace.files, runId)
    if (!runFile) {
        throw new Error(`QA run file not found for runId: ${runId}`)
    }

    const fixedSet = new Set(runFile.fixedIssueIds)
    for (const issueId of issueIds) {
        fixedSet.add(issueId)
    }

    runFile.fixedIssueIds = Array.from(fixedSet)
    await saveQARunFile(workspace.files, runFile)

    logger.info('qa_analyze.issues_marked_fixed', {
        appId,
        runId,
        issueCount: issueIds.length,
        totalFixed: runFile.fixedIssueIds.length
    })
}

/**
 * Single QA run record
 */
interface QARunRecord {
    timestamp: number
    appId: string
    mode: 'semantic' | 'technical' | 'full'
    report: {
        summary: QASummary
        categories: QACategorySummary[]
    }
    issueIds: string[] // All issue IDs from this run
}

/**
 * Fixed issue tracking
 */
interface FixedIssueRecord {
    issueId: string
    title: string
    category: QACategory
    severity: 'error' | 'warning' | 'suggestion'
    firstSeen: number // Timestamp of first run where this issue appeared
    lastSeen: number // Timestamp of last run where this issue appeared
    fixedAt: number | null // Timestamp when issue disappeared (null if still present)
}

/**
 * Complete QA history structure
 */
interface QAHistory {
    runs: QARunRecord[]
    fixedIssues: Record<string, FixedIssueRecord> // issueId -> FixedIssueRecord
    lastRun: QARunRecord | null
}

async function readQAHistory(files: WorkspaceFiles): Promise<QAHistory> {
    try {
        const result = await files.view({ path: QA_HISTORY_PATH })
        const history: QAHistory = JSON.parse(result.content)

        if (!history.runs || !Array.isArray(history.runs)) {
            return { runs: [], fixedIssues: {}, lastRun: null }
        }

        if (!history.fixedIssues || typeof history.fixedIssues !== 'object') {
            history.fixedIssues = {}
        }

        if (history.runs.length > 0) {
            const lastRun = history.runs[history.runs.length - 1]
            history.lastRun = lastRun || null
        } else {
            history.lastRun = null
        }

        return history
    } catch (error) {
        if (!(error instanceof DevSupervisorError && error.code === 'not_found')) {
            logger.warn('qa_analyze.history.read_error', {
                error: error instanceof Error ? error.message : String(error)
            })
        }
        return { runs: [], fixedIssues: {}, lastRun: null }
    }
}

async function writeQAHistory(files: WorkspaceFiles, history: QAHistory): Promise<void> {
    try {
        await files.write({ path: QA_HISTORY_PATH, content: JSON.stringify(history, null, 2) })

        logger.info('qa_analyze.history.written', {
            runCount: history.runs.length,
            fixedCount: Object.keys(history.fixedIssues).length
        })
    } catch (error) {
        logger.warn('qa_analyze.history.write_error', {
            error: error instanceof Error ? error.message : String(error)
        })
    }
}

/**
 * Add a new QA run to history and update fixed issue tracking
 * @param allIssues - All issues from the analysis - needed for proper initialization
 * @param allIssueIds - All issue IDs from the analysis - for quick lookup
 */
async function addQARunToHistory(
    files: WorkspaceFiles,
    appId: string,
    mode: 'semantic' | 'technical' | 'full',
    report: ReturnType<typeof createQAReport>,
    allIssues: QAIssue[],
    allIssueIds: Set<string>
): Promise<void> {
    const history = await readQAHistory(files)
    const now = Date.now()

    // Extract issue IDs from current report (filtered issues shown to user)
    const currentFilteredIssueIds = new Set<string>()
    for (const category of report.categories) {
        for (const issue of category.issues) {
            currentFilteredIssueIds.add(issue.id)
        }
    }

    // Create new run record
    const newRun: QARunRecord = {
        timestamp: now,
        appId,
        mode,
        report: {
            summary: report.summary,
            categories: report.categories
        },
        issueIds: Array.from(allIssueIds) // Store ALL issues found (before filtering) for accurate fixed issue tracking
    }

    // Update fixed issue tracking
    // Issues that were in previous runs but not in current analysis = fixed
    if (history.lastRun) {
        const previousIssueIds = new Set(history.lastRun.issueIds)

        // Find issues that disappeared (were in previous run but not in current analysis at all)
        for (const previousIssueId of previousIssueIds) {
            // Only mark as fixed if issue is truly not in current analysis
            if (!allIssueIds.has(previousIssueId)) {
                // This issue was fixed - update or create fixed record
                let fixedIssue = history.fixedIssues[previousIssueId]

                if (!fixedIssue) {
                    // Issue wasn't tracked in fixedIssues - try to find details from previous run's report
                    let issueDetails: { title: string; category: QACategory; severity: 'error' | 'warning' | 'suggestion' } | null = null

                    // Try to find from previous run's report
                    for (const category of history.lastRun.report.categories) {
                        const issue = category.issues.find(i => i.id === previousIssueId)
                        if (issue) {
                            issueDetails = {
                                title: issue.title,
                                category: issue.category,
                                severity: issue.severity
                            }
                            break
                        }
                    }

                    // If we found details, create the fixed record
                    if (issueDetails && history.lastRun) {
                        fixedIssue = {
                            issueId: previousIssueId,
                            title: issueDetails.title,
                            category: issueDetails.category,
                            severity: issueDetails.severity,
                            firstSeen: history.lastRun.timestamp,
                            lastSeen: history.lastRun.timestamp,
                            fixedAt: now
                        }
                        history.fixedIssues[previousIssueId] = fixedIssue
                    } else {
                        // Couldn't find issue details - log warning but continue
                        logger.warn('qa_analyze.cannot_find_issue_details', {
                            appId,
                            issueId: previousIssueId,
                            message: 'Issue was in previous run but details not found in report'
                        })
                    }
                } else {
                    // Update existing record - mark as fixed
                    fixedIssue.lastSeen = history.lastRun?.timestamp || now
                    if (!fixedIssue.fixedAt) {
                        fixedIssue.fixedAt = now
                    }
                }
            }
        }

        // Update tracking for issues that appeared in previous runs
        for (const currentIssueId of allIssueIds) {
            if (previousIssueIds.has(currentIssueId)) {
                // Issue still exists - update lastSeen
                const fixedIssue = history.fixedIssues[currentIssueId]
                if (fixedIssue) {
                    // Issue was already tracked - just update lastSeen
                    fixedIssue.lastSeen = now
                    // If it was marked as fixed, clear that (it reappeared)
                    if (fixedIssue.fixedAt) {
                        fixedIssue.fixedAt = null
                    }
                } else {
                    // Issue was in previous run but not initialized in fixedIssues
                    // Find details from allIssues
                    const issue = allIssues.find(i => i.id === currentIssueId)
                    if (issue) {
                        history.fixedIssues[currentIssueId] = {
                            issueId: currentIssueId,
                            title: issue.title,
                            category: issue.category,
                            severity: issue.severity,
                            firstSeen: history.lastRun.timestamp, // Approximate - was in previous run
                            lastSeen: now,
                            fixedAt: null
                        }
                    }
                }
            } else {
                // New issue (not in previous run) - initialize if not already tracked
                if (!history.fixedIssues[currentIssueId]) {
                    const issue = allIssues.find(i => i.id === currentIssueId)
                    if (issue) {
                        history.fixedIssues[currentIssueId] = {
                            issueId: currentIssueId,
                            title: issue.title,
                            category: issue.category,
                            severity: issue.severity,
                            firstSeen: now,
                            lastSeen: now,
                            fixedAt: null
                        }
                    }
                }
            }
        }
    } else {
        // First run - initialize fixed issue tracking for all current issues
        for (const issue of allIssues) {
            if (!history.fixedIssues[issue.id]) {
                history.fixedIssues[issue.id] = {
                    issueId: issue.id,
                    title: issue.title,
                    category: issue.category,
                    severity: issue.severity,
                    firstSeen: now,
                    lastSeen: now,
                    fixedAt: null
                }
            }
        }
    }

    // Add new run to history
    history.runs.push(newRun)
    history.lastRun = newRun

    // Write updated history
    await writeQAHistory(files, history)
}

const QA_ANALYSIS_PROMPT = `You are a QA analyst. Return ONLY valid JSON (no markdown, no code blocks):

{
  "issues": [{
    "category": "brand_voice" | "completeness" | "audience_fit" | "cta" | "trust" | "cta_functionality" | "form_validation" | "data_layer",
    "severity": "error" | "warning" | "suggestion",
    "title": "Brief title",
    "description": "Detailed description",
    "location": {"file": "path/to/file.tsx", "line": 42, "page": "PageName"},
    "recommendation": "How to fix",
    "autoFixable": true | false,
    "suggestedFix": "Code if autoFixable"
  }]
}

CATEGORIES:
- Brand Voice: Error=tone mismatch, Warning=inconsistent,sample getty images Suggestion=strengthen
- Completeness: Error=missing critical sections, Warning=missing recommended, Suggestion=add value
- Audience Fit: Error=wrong language level, Warning=misses pain points, Suggestion=connect better
- CTA Functionality: Error=no onClick/href="#" route doesn't do anything, Warning=placeholder routes, Suggestion=loading states
- CTA (Content): Error=none/unclear, Warning=weak/generic, Suggestion=improve clarity
- Trust Signals: Error=no contact/about, Warning=missing testimonials, Suggestion=add signals
- Form Validation: Error=no onSubmit/validation, Warning=no error display, Suggestion=client-side

SEVERITY:
- error: BLOCKS PUBLISHING - placeholder/demo content, broken CTAs (onClick={() => {}}), no href, missing handlers, missing error handling
- warning: Fix before publishing - functional but needs improvement, missing patterns, UX issues
- suggestion: Nice to have - optimizations, better patterns, enhanced UX

VALIDATION RULES:
1. **CRITICAL: FILE CONTENT IS THE SOURCE OF TRUTH** - The actual content in source files is what matters, NOT the app plan.
2. Verify ACTUAL non-functional code before flagging (check onClick handlers, form handlers)
3. Don't flag comments or disabled code
4. Check file content before flagging missing info (business name, contact, etc.)
5. console.log in development OK, production CTAs should do real things
6. **CRITICAL: Distinguish error messages from actual content**:
   - Error messages like "Business Listing Not Found", "Not Found", "Error", "404" are NOT business names
   - Only flag as "missing business name" if NO actual business name appears in normal content (not in error states)
   - Error states (catch blocks, error boundaries, 404 pages) showing error messages are EXPECTED and should NOT be flagged as missing business info
   - Look for error indicators: "not found", "error", "failed", "catch", "throw", "404", "500", "undefined", "null"
7. **CRITICAL: No app plan updates needed**:

AUTO-FIXABLE:
- true: Code fixes only (validation, error handling, onClick handlers, loading states, href fixes, structure)
- false: Requires business info (name, contact, stats, team, testimonials, hours, pricing, content)

Be specific and actionable.`

/**
 * File priority tiers for cost optimization
 */
type FilePriority = 'high' | 'medium' | 'low'

interface FileWithPriority {
    path: string
    content: string
    priority: FilePriority
}

/**
 * Determine file priority based on path and type
 */
function getFilePriority(filePath: string): FilePriority {
    // High priority: User-facing content that changes frequently
    if (filePath.includes('pages/') ||
        filePath.includes('layouts/') ||
        filePath.includes('content/') ||
        (filePath.includes('components/') && !filePath.includes('components/ui/')) ||
        /^(src\/)?(App|main|routes|router)\.tsx?$/.test(filePath)) {
        return 'high'
    }

    // Low priority: Static data and utility files that rarely change
    if (filePath.includes('data/') ||
        /\.(types|constants|config)\.tsx?$/.test(filePath)) {
        return 'low'
    }

    // UI component library files (shadcn, etc.) - medium priority (they're complete libraries)
    if (filePath.includes('components/ui/')) {
        return 'medium'
    }

    // Default to medium: Business logic, hooks, services, APIs, lib files
    return 'medium'
}

/**
 * Extract key sections from file content (for low-priority files)
 */
function extractKeySections(content: string): string {
    const sections: string[] = []

    // Extract exported functions/components
    const exportPattern = /export\s+(?:const|function|default)\s+\w+[^}]+}/gs
    const exportMatches = content.match(exportPattern)
    if (exportMatches) {
        sections.push(...exportMatches.slice(0, 3))
    }

    // Extract JSX return statements
    const jsxPattern = /return\s*\([^)]+\)/gs
    const jsxMatches = content.match(jsxPattern)
    if (jsxMatches) {
        sections.push(...jsxMatches.slice(0, 2))
    }

    // Extract function definitions
    const functionPattern = /(?:const|function)\s+\w+\s*=\s*(?:\([^)]+\)\s*=>|\([^)]+\))/gs
    const functionMatches = content.match(functionPattern)
    if (functionMatches) {
        sections.push(...functionMatches.slice(0, 2))
    }

    return sections.length > 0 ? '\n\n--- Key Sections ---\n' + sections.join('\n\n') : ''
}

/**
 * Sample file content based on priority
 */
function sampleFileContent(content: string, priority: FilePriority): string {
    if (priority === 'high' || priority === 'medium') {
        // Full content for high/medium priority (current behavior)
        return content.length > 5000 ? content.substring(0, 5000) + '\n... (file continues)' : content
    }

    // Low priority: Sample first 2000 chars + key sections
    if (content.length <= 2000) {
        return content
    }

    const prefix = content.substring(0, 2000)
    const keySections = extractKeySections(content)

    return prefix + '\n... (middle content omitted for low-priority file) ...' + keySections + '\n... (file continues)'
}

async function readAppFiles(files: WorkspaceFiles): Promise<FileWithPriority[]> {
    try {
        const treeResult = await files.tree({
            path: 'src',
            recursive: true,
            excludeGlobs: [
                'node_modules', '.git', 'dist', 'build', '.next', 'coverage'
            ]
        })

        const relevantEntries = treeResult.entries.filter(entry => {
            if (entry.kind !== 'file') return false
            const p = entry.path
            if (!(p.endsWith('.tsx') || p.endsWith('.ts') || p.endsWith('.jsx') || p.endsWith('.js'))) return false
            if (p.includes('.test.') || p.includes('.spec.') || p.includes('components/ui/')) return false
            const filename = p.split('/').pop() || ''
            if (filename === 'setup.ts' || filename === 'types.ts' || filename === 'constants.ts') return false
            return p.includes('pages/') ||
                p.includes('components/') ||
                p.includes('layouts/') ||
                p.includes('lib/') ||
                p.includes('data/') ||
                p.includes('content/') ||
                p.includes('server/api/') ||
                p.includes('hooks/') ||
                p.includes('services/') ||
                p.includes('store/') ||
                p.includes('stores/') ||
                p.includes('actions/') ||
                p.endsWith('App.tsx') || p.endsWith('App.ts') ||
                p.endsWith('main.tsx') || p.endsWith('main.ts') ||
                p.endsWith('routes.tsx') || p.endsWith('routes.ts') ||
                p.endsWith('router.tsx') || p.endsWith('router.ts')
        })

        const results = await Promise.all(
            relevantEntries.map(async (entry) => {
                try {
                    const result = await files.view({ path: entry.path })
                    const content = result.content
                    const filename = entry.path.split('/').pop() || ''

                    if (filename.startsWith('DemoContent.') ||
                        content.includes('export default function DemoContent') ||
                        content.includes('export default DemoContent') ||
                        (content.includes('function DemoContent') && content.includes('Demo Content'))) {
                        return null
                    }

                    const priority = getFilePriority(entry.path)
                    return { path: entry.path, content, priority }
                } catch (error) {
                    logger.warn('qa_analyze.file_read_error', {
                        path: entry.path,
                        error: error instanceof Error ? error.message : String(error)
                    })
                    return null
                }
            })
        )

        return results.filter((file): file is FileWithPriority => file !== null)
    } catch (error) {
        logger.warn('qa_analyze.directory_scan_error', {
            error: error instanceof Error ? error.message : String(error)
        })
        return []
    }
}

function extractBusinessInfoFromFiles(fileContents: FileWithPriority[]): {
    hasContactInfo: boolean
    hasAboutSection: boolean
    businessNameInFiles?: string
    hasCompleteContent: boolean
} {
    const allContent = fileContents.map(f => f.content).join('\n')


    // Check for contact info patterns
    const contactPatterns = [
        /(?:phone|tel|email|contact|address)[\s:=]+['"]?([^'"\s<>]+)['"]?/i,
        /href=["'](?:tel:|mailto:)([^"']+)["']/i,
        /contact[_-]?(?:info|us|form)/i,
        /(?:call|reach|get in touch)/i
    ]
    const hasContactInfo = contactPatterns.some(pattern => pattern.test(allContent))

    // Check for about section
    const aboutPatterns = [
        /(?:about|about[_-]?us|our[_-]?story)/i,
        /<section[^>]*id=["']about["']/i,
        /id=["']about["']/i,
        /className="[^"]*about/i
    ]
    const hasAboutSection = aboutPatterns.some(pattern => pattern.test(allContent))

    // Check if content appears complete (not truncated)
    const hasCompleteContent = !allContent.match(/const\s+conta$|function\s+\w+\s*\{?\s*$|<\w+\s*$/) &&
        allContent.split('{').length === allContent.split('}').length

    const result: {
        hasContactInfo: boolean
        hasAboutSection: boolean
        businessNameInFiles?: string
        hasCompleteContent: boolean
    } = {
        hasContactInfo,
        hasAboutSection,
        hasCompleteContent
    }

    return result
}

async function analyzeWithLLM(
    businessContext: any,
    fileContents: FileWithPriority[],
    appId?: string,
    sessionId?: string,
    agentId?: string,
    socketId?: string,
    customerId?: string,
    customTags?: string[],
    subscriptionId?: string,
    budgetContext?: ToolBudgetContext
): Promise<QAIssue[]> {
    const { model, modelName } = await getAgentModelWithName('fast')

    // Extract actual business info from files to avoid false positives
    const fileInfo = extractBusinessInfoFromFiles(fileContents)

    // Sample content based on file priority (cost optimization)
    const fileContext = fileContents.map(f => {
        const sampledContent = sampleFileContent(f.content, f.priority)
        return `File: ${f.path} [Priority: ${f.priority}]\n${f.content}`
    }).join('\n\n---\n\n')

    // Use actual business name from files if found, otherwise use context
    const businessType = businessContext.businessType || 'Unknown'

    const userPrompt = `Analyze this ${businessType !== 'Unknown' ? businessType : 'business'} website for quality issues.

Business Context (from files):
- Type: ${businessType}
- Target Audience: ${businessContext.targetAudience || 'General'}
- Brand Voice: ${businessContext.brandVoice || 'Professional'}

Validation Notes (to prevent false positives):
- Contact info in files: ${fileInfo.hasContactInfo ? 'Yes' : 'Not found in visible content'}
- About section in files: ${fileInfo.hasAboutSection ? 'Yes' : 'Not found in visible content'}
- Content appears complete: ${fileInfo.hasCompleteContent ? 'Yes' : 'May be truncated - verify before flagging'}
-

Source Files:
${fileContext}

IMPORTANT VALIDATION RULES TO AVOID FALSE POSITIVES:
1. **FILE CONTENT IS THE SOURCE OF TRUTH**: The actual content in the source files is what matters, NOT the app plan. If files contain actual business-specific content (e.g., "The Developer's Hunt", "Spice Route", "Acme Corp"), that is CORRECT content, even if it doesn't match the app plan's business name.
   - **CRITICAL**: Do NOT flag content as "generic" or "placeholder" just because it doesn't match the app plan's business name. The app plan may have a template/placeholder name (e.g., "Edit Post"), but the actual file content (e.g., "The Developer's Hunt") is the real business name.
   - **Only flag as "generic" or "placeholder" if the content is ACTUALLY placeholder content**: "Demo Content", "Lorem ipsum", "Unknown", "Placeholder", "Sample", "Test", "Example", etc.
   - If you see a business name in the actual file content, DO NOT flag "Unknown business name" or "generic content" even if appPlan shows a different name. The file content is the source of truth.
   - **CRITICAL**: Error messages like "Business Listing Not Found", "Not Found", "404", "Error" are NOT business names. These appear in error states (catch blocks, error boundaries, 404 pages) and are EXPECTED behavior. Do NOT flag these as missing business names.
   - Only flag missing business name if NO actual business name appears in normal content (outside error states).
2. **Content Quality vs Generic Content**:
   - **Generic/Placeholder content** = "Demo Content", "Lorem ipsum", "Unknown", "Placeholder", "Sample", "Test", "Example", empty strings, or obvious template text
   - **User-provided content** = Any actual business-specific content, even if it doesn't match the app plan. Examples: "The Developer's Hunt", "Tech Insights", "Code & Tutorials", "Regular Updates" - these are REAL content, not placeholders.
   - **DO NOT flag user-provided content as "generic" just because it doesn't match the app plan's business name or seems generic to you.**
3. **CRITICAL: File Sampling vs Incomplete Files**:
   - **Files may be SAMPLED/TRUNCATED for analysis efficiency** - this is INTENTIONAL and NOT an error
   - **DO NOT flag files as "incomplete" if you see these markers**: "... (file continues)", "... (middle content omitted for low-priority file) ...", "[Priority: low]", "[Priority: medium]", "[Priority: high]"
   - **These markers indicate INTENTIONAL sampling** - the file is complete in the codebase, but only a portion was sent for analysis to save tokens
   - **Only flag as "incomplete" if you see ACTUAL truncation**: code ends mid-statement (e.g., "onChange={(e) => s" with no closing), unclosed tags/braces, syntax errors from cut-off, or the file ends abruptly without any sampling marker
   - **If a file has a sampling marker** ("... (file continues)" or "... (middle content omitted)"), the file is COMPLETE in the codebase - do NOT flag it as incomplete
   - **UI component library files** (components/ui/*) are often large but complete - if they show sampling markers, they are NOT incomplete
4. **Contact Information**: Check the actual file content for contact patterns (phone, email, address, contact form). If found, don't flag as missing.
5. **Business Type Mismatch**: If file content shows specific business content (e.g., food truck, restaurant) but appPlan shows "Unknown", this is NOT an error - the content is correct, appPlan just needs updating. Flag as WARNING, not ERROR.
6. **Error States**: Error messages, 404 pages, catch blocks, and error boundaries are EXPECTED parts of applications. Do NOT flag error messages as content issues. Only flag if error handling is missing entirely.
7. **Generic Audience**: "General" is a valid audience type. Only flag if content clearly doesn't match ANY reasonable audience.

Return ONLY the JSON object with issues array. No markdown, no code blocks, no explanatory text.`

    const contextData: {
        appId?: string
        conversationId?: string
        description: string
        toolName: string
    } = {
        description: 'QA semantic analysis',
        toolName: 'qaAnalyze'
    }

    if (appId) contextData.appId = appId
    if (sessionId) contextData.conversationId = sessionId

    const executionContext: ExecutionContext | undefined = (appId || sessionId || socketId) ? {
        socketId,
        metadata: withBudgetFields({
            appId,
            sessionId,
            agentId,
            customerId,
            subscriptionId,
        }, budgetContext)
    } : undefined

    // Additional tags to always include (tool-specific and custom)
    const additionalTags = ['source:tool-llm']
    if (customTags?.length) additionalTags.push(...customTags)

    // Build metadata using the grants-aware helper
    let litellmMetadata: LitellmMetadata | null = null
    if (executionContext) {
        litellmMetadata = buildLitellmMetadataFromContext(executionContext, {
            source: LlmCallSource.ToolQaAnalyze,
            agentId,
        })
    }

    // Merge additional tags into metadata from grants-aware helper
    if (litellmMetadata) {
        const mergedTags = [...new Set([...(litellmMetadata.tags || []), ...additionalTags])]
        litellmMetadata = { ...litellmMetadata, tags: mergedTags }
    }

    // Fallback to existing context if buildLitellmMetadataFromContext returned null
    // (feature flag off or no socketId available)
    if (!litellmMetadata) {
        const existingMetadata = llmMetadataContext.getStore()
        let userIdentifier = existingMetadata?.user
        if (!userIdentifier && appId) {
            const app = appRepo.findById(appId)
            userIdentifier = app?.subscriptionId || app?.customerId
        }
        const baseTags = ['source:tool-llm', 'source:qa-analyze']
        if (agentId) baseTags.push(`agent:${agentId}`)
        if (customTags?.length) baseTags.push(...customTags)
        const mergedTags = [...new Set([...(existingMetadata?.tags || []), ...baseTags])]
        litellmMetadata = {
            ...(userIdentifier && { user: userIdentifier }),
            tags: mergedTags
        }
    }

    const result = await generateWithMetadata({
        model,
        modelName,
        system: QA_ANALYSIS_PROMPT,
        prompt: userPrompt,
        temperature: 0.3,
        context: contextData
    }, litellmMetadata)

    let cleanedText = result.text.trim()
    if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    let parsed: any
    try {
        parsed = JSON.parse(cleanedText)
    } catch (error) {
        logger.error('qa_analyze.llm.parse_error', {
            error: error instanceof Error ? error.message : String(error),
            textSnippet: cleanedText.substring(0, 200)
        })
        throw new Error(`Failed to parse LLM QA analysis response: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (!parsed.issues || !Array.isArray(parsed.issues)) {
        logger.error('qa_analyze.llm.invalid_structure', { parsed })
        throw new Error('LLM response missing issues array')
    }

    return parsed.issues.map((issue: any) => ({
        id: generateIssueId({
            category: issue.category as QACategory,
            title: issue.title,
            location: issue.location
        }),
        category: issue.category as QACategory,
        severity: issue.severity as 'error' | 'warning' | 'suggestion',
        title: issue.title,
        description: issue.description,
        location: issue.location,
        recommendation: issue.recommendation,
        autoFixable: issue.autoFixable || false,
        suggestedFix: issue.suggestedFix
    }))
}

export const qaAnalyzeAITool: Tool = createTool(
    `Perform comprehensive quality assurance analysis on the generated application.

This tool analyzes applications for semantic quality issues that require understanding of business context, brand voice, and user intent. It identifies problems that automated pattern matching cannot detect.

**CRITICAL: Semantic errors ARE blockers for business websites.**
- Sites with placeholder content (e.g., "Demo Content", "Lorem ipsum") are NOT ready to publish
- Missing business information prevents users from taking action
- Generic demo/developer content is inappropriate for business sites
- These issues must be fixed before the site can serve its purpose

**SEMANTIC MODE** (Phase 1 - Current):
- Analyzes content quality and specificity
- Evaluates brand voice alignment
- Checks for completeness of expected sections
- Assesses target audience fit
- Reviews call-to-action clarity
- Identifies missing trust signals

**TECHNICAL MODE** (Phase 2 - Coming Soon):
- Checks for broken links
- Validates image loading
- Captures console errors
- Tests accessibility compliance

**FULL MODE** (Phase 2 - Coming Soon):
- Combines semantic and technical analysis

WHEN TO USE:
- User asks: "Check my site", "Review my app", "What's wrong with my website?"
- Before publishing to catch quality issues
- After significant changes to verify quality

WORKFLOW:
1. User: "Check my site for issues"
2. You: qaAnalyze({ mode: 'semantic' })
3. Tool analyzes app and returns structured report with widget
4. STOP immediately - do NOT fix issues automatically
5. User reviews the widget and can request specific fixes

CRITICAL OUTPUT RULES:
- After calling qaAnalyze: DO NOT describe all the issues in detail - the widget shows them
- After calling qaAnalyze: DO NOT start fixing issues automatically
- After calling qaAnalyze: STOP immediately and let the user review the results
- After calling qaAnalyze: Wait for explicit user request before fixing anything
- The widget provides all details - your job is just to present the summary

OUTPUT:
- Structured report with categorized issues
- Severity levels:
  - **error**: BLOCKS PUBLISHING - Must be fixed (placeholder content, missing business info, demo content)
  - **warning**: Should be fixed before publishing (missing recommended sections, weak CTAs)
  - **suggestion**: Nice to have improvements
- Specific recommendations for each issue
- Widget data for visual display (Phase 4)

**IMPORTANT:** When reporting results, NEVER dismiss semantic errors as "just suggestions" or "not technical blockers." For business websites, semantic errors ARE blockers because they prevent the site from serving its purpose.`,
    z.object({
        mode: z.enum(['semantic', 'technical', 'full']).default('semantic').describe('Analysis mode: semantic (content quality), technical (browser testing), or full (both)'),
        focus: z.array(z.enum(['content_quality', 'brand_voice', 'completeness', 'audience_fit', 'cta', 'trust'])).optional().describe('Specific categories to focus on (optional, analyzes all if not specified)'),
        forceRefresh: z.boolean().optional().default(false).describe('Force a fresh analysis even if cached results exist. Set to true to explicitly request new analysis.')
    }),
    async (input, context?: AgentContext) => {
        const appId = context?.metadata?.appId as string
        const sessionId = context?.metadata?.sessionId as string | undefined
        // socketId is at top-level of context (added by websocket server), not in metadata
        const socketId = (context as any)?.socketId as string | undefined
        const customerId = context?.metadata?.customerId as string | undefined
        const subscriptionId = context?.metadata?.subscriptionId as string | undefined
        const budgetContext = extractBudgetContext(context)

        if (!appId) {
            throw new Error('App ID is required for QA analysis')
        }

        const workspace = createForWorkspace(appId, 'preview')
        if (!workspace) {
            throw new Error(`Workspace not available for app: ${appId}`)
        }
        const { files } = workspace

        logger.info('qa_analyze.begin', {
            appId,
            mode: input.mode,
            forceRefresh: input.forceRefresh
        })

        const mode = input.mode || 'semantic'
        const forceRefresh = input.forceRefresh || false

        // Check for existing history first
        const history = await readQAHistory(files)
        const existingRun = history.lastRun && history.lastRun.mode === mode ? history.lastRun : null

        // Return existing results if available and not forcing refresh
        if (existingRun && !forceRefresh) {
            logger.info('qa_analyze.returning_cached', {
                appId,
                mode,
                timestamp: existingRun.timestamp,
                ageMinutes: Math.round((Date.now() - existingRun.timestamp) / 1000 / 60)
            })

            // Reconstruct full QAReport from history
            const report: ReturnType<typeof createQAReport> = {
                summary: existingRun.report.summary,
                categories: existingRun.report.categories,
                timestamp: new Date(existingRun.timestamp),
                appId: existingRun.appId
            }

            // Try to load the run file for this cached run
            const runId = existingRun.timestamp.toString()
            let fixedIssueIds: string[] = []

            const runFile = await readQARunFile(files, runId)
            if (runFile) {
                fixedIssueIds = runFile.fixedIssueIds
            } else {
                const newRunFile: QARunFile = {
                    runId,
                    timestamp: existingRun.timestamp,
                    appId: existingRun.appId,
                    mode: existingRun.mode,
                    report: {
                        summary: report.summary,
                        categories: report.categories
                    },
                    issueIds: existingRun.issueIds,
                    fixedIssueIds: []
                }
                await saveQARunFile(files, newRunFile)
            }

            return {
                success: true,
                report,
                timestamp: existingRun.timestamp,
                runId,
                isCached: true,
                fixedIssueIds,
            }
        }

        // No existing results or forceRefresh=true - run fresh analysis
        try {
            if (input.mode === 'semantic' || input.mode === 'full') {
                const appPlanResult = await appPlanTool.execute({
                    appId,
                    operation: 'get'
                })

                if (!appPlanResult.success || !appPlanResult.data) {
                    logger.warn('qa_analyze.no_app_plan', { appId })
                }

                const businessContext = {
                    businessName: appPlanResult.data?.appName || 'Unknown',
                    businessType: appPlanResult.data?.planData?.businessType || 'Unknown',
                    targetAudience: appPlanResult.data?.planData?.targetAudience || 'General',
                    brandVoice: appPlanResult.data?.planData?.brandVoice || 'Professional'
                }

                const fileContents = await readAppFiles(files)

                logger.info('qa_analyze.files_read', {
                    appId,
                    fileCount: fileContents.length
                })

                const agentId = context?.metadata?.agentId as string | undefined
                const customTags = context?.metadata?.tags as string[] | undefined
                const issues = await analyzeWithLLM(businessContext, fileContents, appId, sessionId, agentId, socketId, customerId, customTags, subscriptionId, budgetContext)

                logger.info('qa_analyze.analysis_complete', {
                    appId,
                    issueCount: issues.length
                })

                // Create report from all issues
                const report = createQAReport(appId, issues)

                // Extract all issue IDs for tracking
                const allIssueIds = new Set<string>()
                for (const issue of issues) {
                    allIssueIds.add(issue.id)
                }

                // Store this run in permanent history (this will update fixed issue tracking)
                await addQARunToHistory(files, appId, mode, report, issues, allIssueIds)

                // Create timestamped run file
                const runId = Date.now().toString()
                const runFile: QARunFile = {
                    runId,
                    timestamp: Date.now(),
                    appId,
                    mode,
                    report: {
                        summary: report.summary,
                        categories: report.categories
                    },
                    issueIds: Array.from(allIssueIds),
                    fixedIssueIds: [] // Initially no issues are fixed
                }
                await saveQARunFile(files, runFile)

                return {
                    success: true,
                    report,
                    timestamp: Date.now(),
                    runId,
                    isCached: false,
                    fixedIssueIds: [],
                }
            }

            if (input.mode === 'technical') {
                return {
                    success: false,
                    message: 'Technical mode (browser testing) will be available in Phase 2. Use mode: "semantic" for now.'
                }
            }

            throw new Error(`Invalid mode: ${input.mode}`)
        } catch (error) {
            logger.error('qa_analyze.error', {
                appId,
                error: error instanceof Error ? error.message : String(error)
            })

            return {
                success: false,
                message: `QA analysis failed: ${error instanceof Error ? error.message : String(error)}`
            }
        }
    }
)
