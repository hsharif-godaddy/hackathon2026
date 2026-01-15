import { createHash } from 'node:crypto'
import { logger } from '../logging/index.js'

/**
 * QA Analysis Tool
 * Provides semantic analysis of generated applications
 */

/**
 * Issue severity levels
 */
export type QASeverity = 'error' | 'warning' | 'suggestion'

/**
 * Issue categories for semantic and technical analysis
 */
export type QACategory =
    // Semantic categories (content & business)
    | 'content_quality'
    | 'brand_voice'
    | 'completeness'
    | 'audience_fit'
    | 'cta'
    | 'trust'
    // Technical categories (functionality)
    | 'cta_functionality'
    | 'form_validation'
    // | 'api_quality'  // Commented out - API validation disabled for now
    | 'data_layer'

/**
 * Location information for an issue
 */
export interface QALocation {
    file?: string
    line?: number
    component?: string
    page?: string
}

/**
 * Individual QA issue
 */
export interface QAIssue {
    id: string
    category: QACategory
    severity: QASeverity
    title: string
    description: string
    location?: QALocation
    recommendation: string
    autoFixable: boolean
    suggestedFix?: string
}

/**
 * Summary statistics for QA report
 */
export interface QASummary {
    total: number
    errors: number
    warnings: number
    suggestions: number
    passed: number
}

/**
 * Category summary
 */
export interface QACategorySummary {
    name: string
    engine: 'semantic' | 'technical'
    status: 'pass' | 'warning' | 'error'
    issueCount: number
    issues: QAIssue[]
}

/**
 * Complete QA report
 */
export interface QAReport {
    summary: QASummary
    categories: QACategorySummary[]
    timestamp: Date
    appId: string
}

/**
 * Generate a stable, content-based ID for an issue
 * Uses hash of title + category + location to ensure same issue gets same ID across runs
 */
export function generateIssueId(issue: {
    category: QACategory
    title: string
    location?: QALocation
}): string {
    // Create a stable identifier from issue content
    const locationStr = issue.location
        ? `${issue.location.file || ''}:${issue.location.line || ''}:${issue.location.page || ''}`
        : ''
    const content = `${issue.category}:${issue.title}:${locationStr}`

    // Generate hash (first 12 chars of SHA256)
    const hash = createHash('sha256').update(content).digest('hex').substring(0, 12)

    return `${issue.category}-${hash}`
}

/**
 * Create a QA report from issues
 */
export function createQAReport(
    appId: string,
    issues: QAIssue[]
): QAReport {
    const summary: QASummary = {
        total: issues.length,
        errors: issues.filter(i => i.severity === 'error').length,
        warnings: issues.filter(i => i.severity === 'warning').length,
        suggestions: issues.filter(i => i.severity === 'suggestion').length,
        passed: 0
    }

    const categoriesByType = issues.reduce((acc, issue) => {
        if (!acc[issue.category]) {
            acc[issue.category] = []
        }
        acc[issue.category].push(issue)
        return acc
    }, {} as Record<QACategory, QAIssue[]>)

    const categories: QACategorySummary[] = Object.entries(categoriesByType).map(([category, categoryIssues]) => {
        const hasErrors = categoryIssues.some(i => i.severity === 'error')
        const hasWarnings = categoryIssues.some(i => i.severity === 'warning')

        let status: 'pass' | 'warning' | 'error' = 'pass'
        if (hasErrors) {
            status = 'error'
        } else if (hasWarnings) {
            status = 'warning'
        }

        return {
            name: formatCategoryName(category as QACategory),
            engine: isTechnicalCategory(category as QACategory) ? 'technical' : 'semantic',
            status,
            issueCount: categoryIssues.length,
            issues: categoryIssues
        }
    })

    return {
        summary,
        categories,
        timestamp: new Date(),
        appId
    }
}

/**
 * Format category name for display
 */
function formatCategoryName(category: QACategory): string {
    const names: Record<QACategory, string> = {
        // Semantic categories
        content_quality: 'Content Quality',
        brand_voice: 'Brand Voice',
        completeness: 'Completeness',
        audience_fit: 'Audience Fit',
        cta: 'Call-to-Action',
        trust: 'Trust Signals',
        // Technical categories
        cta_functionality: 'CTA Functionality',
        form_validation: 'Form Validation',
        // api_quality: 'API Quality',  // Disabled for now
        data_layer: 'Data Layer'
    }
    return names[category] || category
}

/**
 * Check if a category is technical (vs semantic)
 */
function isTechnicalCategory(category: QACategory): boolean {
    return ['cta_functionality', 'form_validation', 'data_layer'].includes(category)
}
