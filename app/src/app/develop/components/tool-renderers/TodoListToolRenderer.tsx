'use client'

import React, { useState, useEffect } from 'react'
import MarkdownRenderer from '../MarkdownRenderer'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'

/**
 * Get operation display message
 */
function getOperationMessage(operation: string, result: any): string {
  switch (operation) {
    case 'create_list':
      return `Created list: ${result?.list?.name || 'Unknown'}`
    case 'get_list':
      return `Retrieved list: ${result?.list?.name || 'Unknown'}`
    case 'show_list':
      return `Todo list: ${result?.list?.name || 'Todo List'}`
    case 'list_all':
      const count = result?.lists?.length || 0
      return `Found ${count} ${count === 1 ? 'list' : 'lists'}`
    case 'delete_list':
      return `Deleted list`
    case 'add_items':
      const addedCount = result?.items?.length || 0
      return `Added ${addedCount} ${addedCount === 1 ? 'item' : 'items'}`
    case 'update_items':
      const updatedCount = result?.items?.length || 0
      return `Updated ${updatedCount} ${updatedCount === 1 ? 'item' : 'items'}`
    case 'delete_items':
      return `Deleted items`
    case 'mark_done':
      const doneCount = result?.items?.length || result?.item ? 1 : 0
      return `Completed ${doneCount} ${doneCount === 1 ? 'item' : 'items'}`
    case 'mark_undone':
      const undoneCount = result?.items?.length || result?.item ? 1 : 0
      return `Reopened ${undoneCount} ${undoneCount === 1 ? 'item' : 'items'}`
    default:
      return `Todo: ${operation}`
  }
}

/**
 * Render todo list as HTML
 */
function renderTodoListHTML(list: any): React.JSX.Element {
  if (!list) return <div>No list data</div>

  const pending = list.items?.filter((item: any) => !item.completed) || []
  const completed = list.items?.filter((item: any) => item.completed) || []
  const total = list.items?.length || 0
  const completedCount = completed.length
  const progress = total > 0 ? Math.round((completedCount / total) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{list.name}</h1>
        {list.description && (
          <p className="text-sm text-muted-foreground italic mt-1">{list.description}</p>
        )}
      </div>

      {/* Progress */}
      {total > 0 && (
        <div className="text-sm text-foreground/80">
          <strong>Progress:</strong> {completedCount}/{total} complete ({progress}%)
        </div>
      )}

      {/* Pending Items */}
      {pending.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-foreground/90 mb-2">Pending ({pending.length})</h2>
          <div className="space-y-1">
            {pending.map((item: any, index: number) => (
              <div key={item.id || index} className="flex gap-2 text-sm">
                <span className="text-muted-foreground/70 font-mono text-xs flex-shrink-0 w-6 text-right">
                  {index + 1}.
                </span>
                <span className="flex-shrink-0">⬜</span>
                <div className="flex-1">
                  <div className="text-foreground">{item.title}</div>
                  {item.description && (
                    <div className="text-muted-foreground italic text-xs mt-0.5">{item.description}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed Items */}
      {completed.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-foreground/90 mb-2">Completed ({completed.length})</h2>
          <div className="space-y-1">
            {completed.map((item: any, index: number) => (
              <div key={item.id || index} className="flex gap-2 text-sm">
                <span className="text-muted-foreground/70 font-mono text-xs flex-shrink-0 w-6 text-right">
                  {index + 1}.
                </span>
                <span className="flex-shrink-0">✅</span>
                <div className="flex-1">
                  <div className="text-foreground">{item.title}</div>
                  {item.description && (
                    <div className="text-muted-foreground italic text-xs mt-0.5">{item.description}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No items */}
      {total === 0 && (
        <div className="text-sm text-muted-foreground/70 italic">No items yet</div>
      )}
    </div>
  )
}

/**
 * Render multiple lists as HTML
 */
function renderMultipleListsHTML(lists: any[]): React.JSX.Element {
  if (!lists || lists.length === 0) {
    return <div className="text-sm text-muted-foreground/70">No todo lists found.</div>
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">All Todo Lists ({lists.length})</h1>
      
      <div className="space-y-4">
        {lists.map((list, index) => {
          const totalItems = list.items?.length || 0
          const completedItems = list.items?.filter((item: any) => item.completed).length || 0
          const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0

          return (
            <div key={list.id || index} className="border-l-2 border-border pl-4">
              <h2 className="text-lg font-semibold text-foreground/90">
                <span className="text-muted-foreground/70 font-mono text-sm mr-2">{index + 1}.</span>
                {list.name}
              </h2>
              {list.description && (
                <p className="text-sm text-muted-foreground italic mt-1">{list.description}</p>
              )}
              <div className="text-sm text-foreground/80 mt-1">
                <strong>Progress:</strong> {completedItems}/{totalItems} complete ({progress}%)
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Render items as HTML
 */
function renderItemsHTML(items: any[], title: string, listName?: string): React.JSX.Element {
  if (!items || items.length === 0) {
    return <div className="text-sm text-muted-foreground/70">No items</div>
  }

  return (
    <div className="space-y-4">
      {listName && (
        <h1 className="text-2xl font-bold text-foreground">{listName}</h1>
      )}
      <h2 className="text-lg font-semibold text-foreground/90">{title}</h2>
      
      <div className="space-y-1">
        {items.map((item, index) => {
          const checkbox = item.completed ? '✅' : '⬜'
          return (
            <div key={item.id || index} className="flex gap-2 text-sm">
              <span className="text-muted-foreground/70 font-mono text-xs flex-shrink-0 w-6 text-right">
                {index + 1}.
              </span>
              <span className="flex-shrink-0">{checkbox}</span>
              <div className="flex-1">
                <div className="text-foreground">{item.title}</div>
                {item.description && (
                  <div className="text-muted-foreground italic text-xs mt-0.5">{item.description}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Custom renderer for todoList tool
 * 
 * Shows mode-aware one-line messages.
 * Clickable to show modal with formatted todo list details.
 */
export default function TodoListToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Parse result - can be JSON (new format) or Markdown (old format)
  let parsedResult: any = null
  let operation = ''
  let isMarkdownFormat = false
  let markdownContent = ''
  let displayMessage = 'Todo List'

  if (result) {
    try {
      if (typeof result === 'string') {
        // Try to parse as JSON first
        try {
          parsedResult = JSON.parse(result)
          operation = parsedResult.operation || ''
        } catch {
          // If JSON parse fails, it's the old markdown format
          isMarkdownFormat = true
          markdownContent = result
        }
      } else if (typeof result === 'object') {
        parsedResult = result
        operation = parsedResult.operation || ''
      }
    } catch (e) {
      console.error('Failed to parse todoList result:', e)
    }
  }

  // Get operation from input if not in result
  if (!operation && input && typeof input === 'object') {
    const inputObj = input as any
    operation = inputObj.operation || ''
  }

  // Generate display message
  if (toolStatus === 'completed' && parsedResult) {
    displayMessage = getOperationMessage(operation, parsedResult)
  } else if (operation) {
    displayMessage = `Todo: ${operation.replace(/_/g, ' ')}`
  }

  // Try to get list name from input for operations that don't return the full list
  let listName = ''
  if (input && typeof input === 'object') {
    const inputObj = input as any
    listName = inputObj.listName || ''
  }

  // Generate modal content (HTML or markdown)
  let modalContentElement: React.JSX.Element | null = null
  let hasDetails = false
  
  if (isMarkdownFormat) {
    // Legacy markdown format - still use MarkdownRenderer
    hasDetails = Boolean(markdownContent)
    modalContentElement = <MarkdownRenderer content={markdownContent} fullscreen={true} />
  } else if (parsedResult) {
    hasDetails = true
    if (parsedResult.list) {
      listName = parsedResult.list.name || listName // Update listName from result
      modalContentElement = renderTodoListHTML(parsedResult.list)
    } else if (parsedResult.lists) {
      modalContentElement = renderMultipleListsHTML(parsedResult.lists)
    } else if (parsedResult.items) {
      modalContentElement = renderItemsHTML(parsedResult.items, 'Affected Items', listName)
    } else if (parsedResult.item) {
      modalContentElement = renderItemsHTML([parsedResult.item], 'Item Details', listName)
    } else if (parsedResult.message) {
      modalContentElement = <div className="text-sm text-foreground/80">{parsedResult.message}</div>
    }
  }
  
  // For show_list operation, render inline
  const isShowList = operation === 'show_list'
  const shouldRenderInline = isShowList && toolStatus === 'completed' && parsedResult?.list

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={listName ? `${listName} - ${operation.replace(/_/g, ' ')}` : `Todo List: ${operation.replace(/_/g, ' ')}`}
      mounted={mounted}
    >
      <div className="flex-1 overflow-y-auto">
        {modalContentElement}
      </div>
    </ToolModal>
  )

  return (
    <div className="-my-2">
      <ToolHeader
        icon="📋"
        displayName={displayMessage}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />

      {/* Inline list display for show_list operation */}
      {shouldRenderInline && parsedResult?.list && (
        <div className="mt-3 mb-3 p-4 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg border border-border">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-foreground/90">{parsedResult.list.name}</h3>
            {parsedResult.list.description && (
              <p className="text-sm text-muted-foreground mt-1">{parsedResult.list.description}</p>
            )}
          </div>

          {parsedResult.list.items && parsedResult.list.items.length > 0 && (
            <div className="text-foreground/90">
              {parsedResult.list.items.map((item: any, index: number) => (
                <div
                  key={item.id || index}
                  className="flex items-start gap-1 text-sm"
                >
                  <span className="text-base">
                    {item.completed ? '✅' : '⬜'}
                  </span>
                  <div className="flex-1">
                      {item.title}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Progress summary */}
          {parsedResult.list.items && parsedResult.list.items.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
              {parsedResult.list.items.filter((item: any) => item.completed).length} of{' '}
              {parsedResult.list.items.length} completed
            </div>
          )}
        </div>
      )}

      {modalContent}
    </div>
  )
}

