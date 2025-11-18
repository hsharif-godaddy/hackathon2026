'use client'

import React, { useState } from 'react'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { GitPullRequest } from 'lucide-react'

/**
 * Git Operation Tool Renderer
 *
 * Displays git operation results with operation-specific formatting.
 * Shows a one-line summary with expandable details in a modal.
 */
export default function GitOperationToolRenderer({
  input,
  result,
  toolStatus
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  // Parse result
  let parsedResult: any = null
  if (result && typeof result === 'string') {
    try {
      parsedResult = JSON.parse(result)
    } catch {
      parsedResult = { output: result }
    }
  } else if (result && typeof result === 'object') {
    parsedResult = result
  }

  // Extract operation from input
  const operation = input && typeof input === 'object' && 'operation' in input
    ? String(input.operation)
    : 'unknown'

  // Build display message
  let displayMessage = `Git: ${operation}`

  if (parsedResult) {
    if (parsedResult.success === false && parsedResult.error) {
      displayMessage = `Git ${operation}: Error`
    } else if (operation === 'status' && parsedResult.status) {
      const { branch, isClean, ahead, behind } = parsedResult.status
      let statusText = branch ? `on ${branch}` : ''
      if (ahead || behind) {
        statusText += ` (${ahead || 0}↑ ${behind || 0}↓)`
      }
      if (isClean) {
        statusText += ' - clean'
      }
      displayMessage = `Git status: ${statusText}`
    } else if (operation === 'commit' && parsedResult.success) {
      displayMessage = `Git commit: Success`
    } else if (operation === 'log' && parsedResult.commits) {
      displayMessage = `Git log: ${parsedResult.commits.length} commit${parsedResult.commits.length !== 1 ? 's' : ''}`
    } else if (operation === 'branch' && parsedResult.branches) {
      displayMessage = `Git branch: ${parsedResult.branches.length} branch${parsedResult.branches.length !== 1 ? 'es' : ''}`
    } else if (operation === 'diff') {
      displayMessage = `Git diff: ${parsedResult.diff ? 'Changes found' : 'No changes'}`
    }
  }

  const hasDetails = Boolean(parsedResult && (parsedResult.output || parsedResult.diff || parsedResult.commits || parsedResult.branches))

  /**
   * Render the result content as HTML
   */
  function renderResultHTML(): React.JSX.Element {
    if (!parsedResult) {
      return <div className="text-sm text-muted-foreground">No result data</div>
    }

    return (
      <div className="space-y-4">
        {/* Error */}
        {parsedResult.error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded p-3">
            <div className="text-sm font-semibold text-destructive mb-1">Error</div>
            <div className="text-sm text-destructive-foreground">{parsedResult.error}</div>
          </div>
        )}

        {/* Warning */}
        {parsedResult.warning && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3">
            <div className="text-sm font-semibold text-yellow-700 mb-1">Warning</div>
            <div className="text-sm text-yellow-700/90">{parsedResult.warning}</div>
          </div>
        )}

        {/* Status */}
        {parsedResult.status && (
          <div>
            <h3 className="text-base font-semibold text-foreground/90 mb-2">Status</h3>
            <div className="bg-muted rounded p-3 space-y-1 text-sm">
              {parsedResult.status.branch && (
                <div><strong>Branch:</strong> {parsedResult.status.branch}</div>
              )}
              {typeof parsedResult.status.ahead === 'number' && (
                <div><strong>Ahead:</strong> {parsedResult.status.ahead} commit{parsedResult.status.ahead !== 1 ? 's' : ''}</div>
              )}
              {typeof parsedResult.status.behind === 'number' && (
                <div><strong>Behind:</strong> {parsedResult.status.behind} commit{parsedResult.status.behind !== 1 ? 's' : ''}</div>
              )}
              {typeof parsedResult.status.isClean === 'boolean' && (
                <div><strong>Working tree:</strong> {parsedResult.status.isClean ? 'Clean' : 'Modified'}</div>
              )}
            </div>
          </div>
        )}

        {/* Commits */}
        {parsedResult.commits && parsedResult.commits.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-foreground/90 mb-2">
              Commits ({parsedResult.commits.length})
            </h3>
            <div className="space-y-2">
              {parsedResult.commits.map((commit: any, index: number) => (
                <div key={commit.hash || index} className="bg-muted rounded p-3 border border-border">
                  <div className="flex items-start gap-2 mb-1">
                    <span className="font-mono text-xs bg-muted-foreground/20 px-2 py-0.5 rounded">
                      {commit.hash?.substring(0, 7) || 'unknown'}
                    </span>
                    <span className="text-xs text-muted-foreground">{commit.date}</span>
                  </div>
                  <div className="text-sm text-foreground mb-1">{commit.message}</div>
                  <div className="text-xs text-muted-foreground">{commit.author}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Branches */}
        {parsedResult.branches && parsedResult.branches.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-foreground/90 mb-2">
              Branches ({parsedResult.branches.length})
            </h3>
            <div className="bg-muted rounded p-3">
              <div className="space-y-1">
                {parsedResult.branches.map((branch: string, index: number) => {
                  const isCurrent = branch.startsWith('* ')
                  const branchName = isCurrent ? branch.substring(2) : branch
                  return (
                    <div key={index} className="text-sm font-mono">
                      {isCurrent && <span className="text-success font-bold">* </span>}
                      <span className={isCurrent ? 'text-success font-semibold' : 'text-foreground/70'}>
                        {branchName}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Diff */}
        {parsedResult.diff && (
          <div>
            <h3 className="text-base font-semibold text-foreground/90 mb-2">Diff</h3>
            <pre className="text-xs font-mono whitespace-pre-wrap bg-muted p-3 rounded border border-border overflow-x-auto">
              {parsedResult.diff}
            </pre>
          </div>
        )}

        {/* Output */}
        {parsedResult.output && !parsedResult.diff && (
          <div>
            <h3 className="text-base font-semibold text-foreground/90 mb-2">Output</h3>
            <pre className="text-sm font-mono whitespace-pre-wrap bg-muted p-3 rounded border border-border">
              {parsedResult.output}
            </pre>
          </div>
        )}
      </div>
    )
  }

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={`Git: ${operation}`}
      mounted={mounted}
    >
      <div className="flex-1 overflow-y-auto">
        {renderResultHTML()}
      </div>
    </ToolModal>
  )

  return (
    <div>
      <ToolHeader
        icon={<GitPullRequest className="w-4 h-4" />}
        displayName={displayMessage}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}
