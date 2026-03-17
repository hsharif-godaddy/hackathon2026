import { createTool, generateTextWithTracking, type Tool, type AgentContext } from '@airo/ai-lib'
import { llmMetadataContext, type LitellmMetadata } from '@airo/ai-common'
import { buildLitellmMetadataFromContext, LlmCallSource, type ExecutionContext } from '@airo/ai-grants'
import { z } from 'zod'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { readdir } from 'node:fs/promises'

import { AppRepository } from '../../database/repositories/AppRepository.js'

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

/**
 * QA History file path - stores all QA runs permanently
 */
function getQAHistoryPath(appPath: string): string {
    return join(appPath, '.airo', 'qa-history.json')
}

/**
 * QA Run file path - stores individual QA run with timestamp
 */
function getQARunFilePath(appPath: string, runId: string): string {
    return join(appPath, '.airo', 'qa-runs', `qa-run-${runId}.json`)
}

/**
 * Get the latest QA run file path
 */
async function getLatestQARunFilePath(appPath: string): Promise<string | null> {
    try {
        const runsDir = join(appPath, '.airo', 'qa-runs')
        await access(runsDir)

        const files = await readdir(runsDir)
        const runFiles = files
            .filter(f => f.startsWith('qa-run-') && f.endsWith('.json'))
            .map(f => {
                const match = f.match(/qa-run-(\d+)\.json/)
                if (match && match[1]) {
                    return { file: f, timestamp: parseInt(match[1], 10) }
                }
                return null
            })
            .filter((f): f is { file: string; timestamp: number } => f !== null)
            .sort((a, b) => b.timestamp - a.timestamp) // Most recent first

        if (runFiles.length === 0) return null
        const latestFile = runFiles[0]
        if (!latestFile) return null
        return join(runsDir, latestFile.file)
    } catch {
        return null
    }
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

/**
 * Save QA run to timestamped file
 */
async function saveQARunFile(appPath: string, runFile: QARunFile): Promise<void> {
    const runFilePath = getQARunFilePath(appPath, runFile.runId)
    const runsDir = dirname(runFilePath)

    // Ensure directory exists
    await mkdir(runsDir, { recursive: true })

    // Write run file
    await writeFile(runFilePath, JSON.stringify(runFile, null, 2), 'utf-8')

    logger.info('qa_analyze.run_file_saved', {
        appPath,
        runId: runFile.runId,
        filePath: runFilePath
    })
}

/**
 * Read QA run file by run ID
 */
async function readQARunFile(appPath: string, runId: string): Promise<QARunFile | null> {
    try {
        const runFilePath = getQARunFilePath(appPath, runId)
        await access(runFilePath)

        const content = await readFile(runFilePath, 'utf-8')
        return JSON.parse(content) as QARunFile
    } catch {
        return null
    }
}

/**
 * Mark issues as fixed in a QA run file
 */
export async function markIssuesAsFixed(
    appPath: string,
    runId: string,
    issueIds: string[]
): Promise<void> {
    const runFile = await readQARunFile(appPath, runId)
    if (!runFile) {
        throw new Error(`QA run file not found for runId: ${runId}`)
    }

    // Add issue IDs to fixedIssueIds (avoid duplicates)
    const fixedSet = new Set(runFile.fixedIssueIds)
    for (const issueId of issueIds) {
        fixedSet.add(issueId)
    }

    runFile.fixedIssueIds = Array.from(fixedSet)

    // Save updated run file
    await saveQARunFile(appPath, runFile)

    logger.info('qa_analyze.issues_marked_fixed', {
        appPath,
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

/**
 * Read QA history from file
 */
async function readQAHistory(appPath: string): Promise<QAHistory> {
    try {
        const historyPath = getQAHistoryPath(appPath)
        await access(historyPath)

        const historyContent = await readFile(historyPath, 'utf-8')
        const history: QAHistory = JSON.parse(historyContent)

        // Validate structure
        if (!history.runs || !Array.isArray(history.runs)) {
            return { runs: [], fixedIssues: {}, lastRun: null }
        }

        if (!history.fixedIssues || typeof history.fixedIssues !== 'object') {
            history.fixedIssues = {}
        }

        // Set lastRun to most recent run
        if (history.runs.length > 0) {
            const lastRun = history.runs[history.runs.length - 1]
            history.lastRun = lastRun || null
        } else {
            history.lastRun = null
        }

        return history
    } catch (error) {
        // File doesn't exist or is invalid - start fresh
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.debug('qa_analyze.history.read_error', {
                error: error instanceof Error ? error.message : String(error)
            })
        }
        return { runs: [], fixedIssues: {}, lastRun: null }
    }
}

/**
 * Write QA history to file
 */
async function writeQAHistory(appPath: string, history: QAHistory): Promise<void> {
    try {
        const historyPath = getQAHistoryPath(appPath)
        const historyDir = dirname(historyPath)

        // Ensure .airo directory exists
        await mkdir(historyDir, { recursive: true })

        await writeFile(historyPath, JSON.stringify(history, null, 2), 'utf-8')

        logger.info('qa_analyze.history.written', {
            appPath,
            runCount: history.runs.length,
            fixedCount: Object.keys(history.fixedIssues).length
        })
    } catch (error) {
        // Don't fail analysis if history write fails
        logger.warn('qa_analyze.history.write_error', {
            appPath,
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
    appPath: string,
    appId: string,
    mode: 'semantic' | 'technical' | 'full',
    report: ReturnType<typeof createQAReport>,
    allIssues: QAIssue[], // All issues found in analysis (before filtering) - needed for proper initialization
    allIssueIds: Set<string> // All issue IDs from the analysis (before filtering) - for quick lookup
): Promise<void> {
    const history = await readQAHistory(appPath)
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
                            appPath,
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
    await writeQAHistory(appPath, history)
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

async function readAppFiles(appPath: string): Promise<FileWithPriority[]> {
    async function scanDirectory(dir: string, basePath: string = ''): Promise<FileWithPriority[]> {
        try {
            const entries = await readdir(dir, { withFileTypes: true })

            // Process all entries in parallel
            const results = await Promise.all(
                entries.map(async (entry) => {
                    const fullPath = join(dir, entry.name)
                    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name

                    if (entry.isDirectory()) {
                        // Skip build artifacts and dependencies
                        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.next' || entry.name === 'coverage') {
                            return []
                        }
                        // Skip UI component library directories (they're not business content)
                        if (relativePath.includes('components/ui/')) {
                            return []
                        }
                        return scanDirectory(fullPath, relativePath)
                    } else if (entry.isFile()) {
                        // Include all TypeScript/JavaScript files that might contain content
                        if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) {
                            try {
                                const content = await readFile(fullPath, 'utf-8')

                                // Skip DemoContent component - it's part of the default engine template
                                if (entry.name === 'DemoContent.tsx' || entry.name === 'DemoContent.ts' ||
                                    entry.name === 'DemoContent.jsx' || entry.name === 'DemoContent.js' ||
                                    content.includes('export default function DemoContent') ||
                                    content.includes('export default DemoContent') ||
                                    (content.includes('function DemoContent') && content.includes('Demo Content'))) {
                                    return []
                                }

                                // Include files from important directories (content, UI, data layer, backend APIs)
                                const isRelevantFile =
                                    relativePath.includes('pages/') ||
                                    relativePath.includes('components/') ||
                                    relativePath.includes('layouts/') ||
                                    relativePath.includes('lib/') ||
                                    relativePath.includes('data/') ||
                                    relativePath.includes('content/') ||
                                    relativePath.includes('server/api/') ||  // Backend API routes (to verify endpoints exist)
                                    relativePath.includes('hooks/') ||       // Data fetching hooks
                                    relativePath.includes('services/') ||    // Service layer
                                    relativePath.includes('store/') ||       // State management (zustand, etc.)
                                    relativePath.includes('stores/') ||      // State management (plural)
                                    relativePath.includes('actions/') ||     // Server actions
                                    relativePath.includes('App.tsx') ||
                                    relativePath.includes('main.tsx') ||
                                    relativePath.includes('routes.tsx')

                                // Exclude config files, test files, and utility-only files
                                const isExcludedFile =
                                    relativePath.includes('.test.') ||
                                    relativePath.includes('.spec.') ||
                                    relativePath.includes('setup.ts') ||
                                    relativePath.includes('types.ts') ||
                                    relativePath.includes('constants.ts')

                                if (isRelevantFile && !isExcludedFile) {
                                    const priority = getFilePriority(relativePath)
                                    return [{ path: relativePath, content, priority }]
                                }
                            } catch (error) {
                                logger.warn('qa_analyze.file_read_error', {
                                    path: relativePath,
                                    error: error instanceof Error ? error.message : String(error)
                                })
                            }
                        }
                    }
                    return []
                })
            )

            // Flatten results from all entries
            return results.flat()
        } catch (error) {
            logger.warn('qa_analyze.directory_scan_error', {
                dir,
                error: error instanceof Error ? error.message : String(error)
            })
            return []
        }
    }

    // Scan all relevant source directories in parallel
    const directoriesToScan = [
        // Frontend content
        { dir: join(appPath, 'src', 'pages'), basePath: 'src/pages' },
        { dir: join(appPath, 'src', 'components'), basePath: 'src/components' },
        { dir: join(appPath, 'src', 'layouts'), basePath: 'src/layouts' },
        { dir: join(appPath, 'src', 'content'), basePath: 'src/content' },
        // Backend API routes
        { dir: join(appPath, 'src', 'api'), basePath: 'src/api' },
        // Data layer and state management
        { dir: join(appPath, 'src', 'lib'), basePath: 'src/lib' },
        { dir: join(appPath, 'src', 'data'), basePath: 'src/data' },
        { dir: join(appPath, 'src', 'hooks'), basePath: 'src/hooks' },
        { dir: join(appPath, 'src', 'services'), basePath: 'src/services' },
        { dir: join(appPath, 'src', 'store'), basePath: 'src/store' },
        { dir: join(appPath, 'src', 'stores'), basePath: 'src/stores' },
        { dir: join(appPath, 'src', 'actions'), basePath: 'src/actions' }
    ]

    // Scan all directories in parallel
    const directoryResults = await Promise.all(
        directoriesToScan.map(async ({ dir, basePath }) => {
            try {
                return await scanDirectory(dir, basePath)
            } catch {
                logger.debug('qa_analyze.directory_not_found', { path: dir })
                return []
            }
        })
    )

    // Scan root-level files in src/ (App.tsx, main.tsx, routes.tsx, etc.) in parallel
    let rootFiles: FileWithPriority[] = []
    const srcRootDir = join(appPath, 'src')
    try {
        const rootEntries = await readdir(srcRootDir, { withFileTypes: true })
        const rootFileResults = await Promise.all(
            rootEntries
                .filter(entry => entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.jsx') || entry.name.endsWith('.js')))
                .map(async (entry) => {
                    const fullPath = join(srcRootDir, entry.name)
                    try {
                        const content = await readFile(fullPath, 'utf-8')

                        // Skip DemoContent component - it's part of the default engine template
                        if (entry.name === 'DemoContent.tsx' || entry.name === 'DemoContent.ts' ||
                            entry.name === 'DemoContent.jsx' || entry.name === 'DemoContent.js' ||
                            content.includes('export default function DemoContent') ||
                            content.includes('export default DemoContent') ||
                            (content.includes('function DemoContent') && content.includes('Demo Content'))) {
                            return null
                        }

                        // Include root-level files that are likely to have content
                        if (entry.name.includes('App') || entry.name.includes('main') || entry.name.includes('routes') || entry.name.includes('router')) {
                            const priority = getFilePriority(`src/${entry.name}`)
                            return { path: `src/${entry.name}`, content, priority }
                        }
                    } catch (error) {
                        logger.warn('qa_analyze.file_read_error', {
                            path: `src/${entry.name}`,
                            error: error instanceof Error ? error.message : String(error)
                        })
                    }
                    return null
                })
        )
        rootFiles = rootFileResults.filter((file): file is FileWithPriority => file !== null)
    } catch {
        logger.debug('qa_analyze.no_src_root', { path: srcRootDir })
    }

    // Combine all results
    return [...directoryResults.flat(), ...rootFiles]
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
    subscriptionId?: string
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

    // Build execution context for grant-aware metadata
    const executionContext: ExecutionContext | undefined = (appId || sessionId || socketId) ? {
        socketId,
        metadata: {
            appId,
            sessionId,
            agentId,
            customerId,
            subscriptionId,
        }
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

        if (!appId) {
            throw new Error('App ID is required for QA analysis')
        }

        const app = appRepo.findById(appId)
        if (!app) {
            throw new Error(`App '${appId}' not found`)
        }

        logger.info('qa_analyze.begin', {
            appId,
            mode: input.mode,
            forceRefresh: input.forceRefresh
        })

        const mode = input.mode || 'semantic'
        const forceRefresh = input.forceRefresh || false

        // Check for existing history first
        const history = await readQAHistory(app.path)
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

            // Try to find the latest run file for this cached run
            const latestRunFilePath = await getLatestQARunFilePath(app.path)
            let runId: string | undefined
            let fixedIssueIds: string[] = []

            if (latestRunFilePath) {
                const match = latestRunFilePath.match(/qa-run-(\d+)\.json/)
                if (match && match[1]) {
                    runId = match[1]
                    const runFile = await readQARunFile(app.path, runId)
                    if (runFile) {
                        fixedIssueIds = runFile.fixedIssueIds
                    }
                }
            }

            // If no run file found, create one for this cached run
            if (!runId) {
                runId = existingRun.timestamp.toString()
                const runFile: QARunFile = {
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
                await saveQARunFile(app.path, runFile)
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

                const fileContents = await readAppFiles(app.path)

                logger.info('qa_analyze.files_read', {
                    appId,
                    fileCount: fileContents.length
                })

                const agentId = context?.metadata?.agentId as string | undefined
                const customTags = context?.metadata?.tags as string[] | undefined
                const issues = await analyzeWithLLM(businessContext, fileContents, appId, sessionId, agentId, socketId, customerId, customTags, subscriptionId)

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
                await addQARunToHistory(app.path, appId, mode, report, issues, allIssueIds)

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
                await saveQARunFile(app.path, runFile)

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
