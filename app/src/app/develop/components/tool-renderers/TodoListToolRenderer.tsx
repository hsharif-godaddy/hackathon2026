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
 * Circular Checkbox Component
 */
function CircularCheckbox({ checked }: { checked: boolean }) {
  return (
    <div className="relative w-5 h-5">
      <div className={`
        w-5 h-5 rounded-full border-2 transition-all duration-200
        ${checked ? 'border-intents-success-borderColor bg-intents-success-backgroundColor' : 'border-border bg-intents-ux-box-backgroundColor'}
      `}>
        {checked && (
          <svg
            className="w-full h-full text-intents-success-color"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M6 10L9 13L14 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  )
}

/**
 * Render todo list as HTML
 */
function renderTodoListHTML(list: any): React.JSX.Element {
  if (!list) return <div>No list data</div>

  const items = list.items || []
  const total = items.length
  const completedCount = items.filter((item: any) => item.completed).length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-foreground">{list.name}</h1>
          {list.description && (
            <p className="text-sm text-muted-foreground mt-1">{list.description}</p>
          )}
        </div>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {completedCount}/{total}
        </span>
      </div>

      {/* Items */}
      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item: any) => (
            <div
              key={item.id}
              className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-3"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <CircularCheckbox checked={item.completed} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${item.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {item.title}
                  </div>
                  {item.description && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {item.description}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-8">
          No items yet
        </div>
      )}
    </div>
  )
}

/**
 * Render multiple lists as HTML
 */
function renderMultipleListsHTML(lists: any[]): React.JSX.Element {
  if (!lists || lists.length === 0) {
    return <div className="text-sm text-muted-foreground">No todo lists found.</div>
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-foreground">All Todo Lists ({lists.length})</h1>
      
      <div className="space-y-3">
        {lists.map((list) => {
          const totalItems = list.items?.length || 0
          const completedItems = list.items?.filter((item: any) => item.completed).length || 0

          return (
            <div key={list.id} className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h2 className="text-sm font-medium text-foreground">{list.name}</h2>
                  {list.description && (
                    <p className="text-xs text-muted-foreground mt-1">{list.description}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {completedItems}/{totalItems}
                </span>
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
    return <div className="text-sm text-muted-foreground">No items</div>
  }

  return (
    <div className="space-y-4">
      {listName && (
        <h1 className="text-lg font-semibold text-foreground">{listName}</h1>
      )}
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-3"
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <CircularCheckbox checked={item.completed} />
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium ${item.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {item.title}
                </div>
                {item.description && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {item.description}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
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

  // Don't render anything for mark_done/mark_undone/show_list operations
  // The persistent todo list UI handles these updates
  if (operation === 'mark_done' || operation === 'mark_undone' || operation === 'show_list') {
    return null
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

      {modalContent}
    </div>
  )
}

