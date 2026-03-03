import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { logger } from '../../logging/index.js'

interface RuntimeErrorData {
  message: string
  name: string
  stack?: string
  componentStack?: string
  url?: string
  timestamp?: number
}

/**
 * Formats JavaScript stack traces for better readability
 * Extracts file paths and line numbers from stack traces
 */
function formatStackTrace(stack: string): string {
  const lines = stack.split('\n')
  const formattedLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip empty lines
    if (!trimmed) continue

    // Extract file location (file:line:column) from stack trace
    // Support multiple formats: Chrome (file:line:col), Firefox functionName@file:line:col, and without parentheses
    const locationMatch = trimmed.match(/(?:[@(]|at\s+)([^)@\s]+):(\d+):(\d+)/)
    if (locationMatch && locationMatch[1]) {
      const file = locationMatch[1]
      const lineNum = locationMatch[2]
      const colNum = locationMatch[3]
      // Extract just the filename from the full path for readability (handle both Unix and Windows paths)
      const fileName = file.split(/[/\\]/).pop() || file
      formattedLines.push(`  ${trimmed}`)
      formattedLines.push(`    → ${fileName}:${lineNum}:${colNum}`)
    } else {
      formattedLines.push(`  ${trimmed}`)
    }
  }

  return formattedLines.join('\n')
}

/**
 * Formats React component stack for better readability
 */
function formatComponentStack(componentStack: string): string {
  return componentStack
    .split('\n')
    .map(line => `  ${line.trim()}`)
    .filter(line => line.length > 2)
    .join('\n')
}

export class RuntimeErrorContextRenderer implements ContextAttachmentRenderer<RuntimeErrorData> {
  canHandle(type: string): boolean {
    return type === 'runtime_error'
  }

  async render(
    attachment: ContextAttachment<RuntimeErrorData>,
    _userPrompt: string
  ): Promise<RenderedContext | null> {
    try {
      const { message, name, stack, componentStack, url, timestamp } = attachment.data

      if (!message && !stack) {
        return null
      }

      const sections: string[] = []

      // Header
      sections.push('### Runtime Error Occurred')
      sections.push('')

      // Error details
      sections.push(`**Error Type:** ${name}`)
      sections.push(`**Error Message:** ${message}`)

      if (url) {
        sections.push(`**Location:** ${url}`)
      }

      if (timestamp) {
        const date = new Date(timestamp)
        sections.push(`**Timestamp:** ${date.toISOString()}`)
      }

      sections.push('')

      // JavaScript stack trace
      if (stack) {
        sections.push('**JavaScript Stack Trace:**')
        sections.push('```')
        sections.push(formatStackTrace(stack))
        sections.push('```')
        sections.push('')
      }

      // React component stack
      if (componentStack) {
        sections.push('**React Component Stack:**')
        sections.push('```')
        sections.push(formatComponentStack(componentStack))
        sections.push('```')
        sections.push('')
      }

      sections.push('The user needs this error fixed and verified.')
      sections.push('')
      sections.push('**Required Workflow:**')
      sections.push('')
      sections.push('1. Analyze: Examine stack trace (topmost frame = error location), review component stack, identify root cause')
      sections.push('')
      sections.push('2. Fix: Make minimal changes following existing patterns')
      sections.push('')
      sections.push('3. **Verify (REQUIRED):** Run `npm run type-check` and `npm run build`')
      sections.push('   - If verification fails: analyze, fix, re-verify')
      sections.push('   - Iterate until both pass with zero errors')
      sections.push('')
      sections.push('4. Complete only when: original error fixed + type-check passes + build succeeds + no new errors')
      sections.push('')
      
      const content = sections.join('\n')

      return {
        role: 'user',
        content,
        insertionOrder: 'after_history'
      }
    } catch (error) {
      logger.error('context.attachment.render.runtime_error.error', {
        error: error instanceof Error ? error.message : String(error),
        attachmentType: attachment.type
      })
      return null
    }
  }

  shouldPersist(attachment: ContextAttachment<RuntimeErrorData>): boolean {
    return attachment.persistence === 'save'
  }
}
