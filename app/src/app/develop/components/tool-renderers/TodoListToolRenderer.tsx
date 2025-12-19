'use client'

import { ListTodo } from 'lucide-react'
import React, { useEffect,useState } from 'react'

import MarkdownRenderer from '@/app/develop/components/MarkdownRenderer'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/develop/components/tool-renderers/ToolModal'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'

/**
 * Get operation display message
 */
function getOperationMessage(operation: string, result: any, t: (key: string, values?: Record<string, any>) => string): string {
  switch (operation) {
    case 'create_list':
      return `${t('builder_common_todo_create_list')}: ${result?.list?.name || 'Unknown'}`
    case 'get_list':
      return `${t('builder_common_todo_get_list')}: ${result?.list?.name || 'Unknown'}`
    case 'show_list':
      return `${t('builder_common_todo_show_list')}: ${result?.list?.name || t('builder_common_todo_show_list')}`
    case 'select_list':
      return `${t('builder_common_todo_select_list')} ${result?.list?.name || 'Unknown'}`
    case 'list_all':
      const count = result?.lists?.length || 0
      return t('builder_common_todo_list_all', { count })
    case 'delete_list':
      return t('builder_common_todo_delete_list')
    case 'add_items':
      const addedCount = result?.items?.length || 0
      return t('builder_common_todo_add_items', { addedCount })
    case 'update_items':
      const updatedCount = result?.items?.length || 0
      return t('builder_common_todo_update_items', { updatedCount })
    case 'delete_items':
      return t('builder_common_todo_delete_items')
    case 'mark_done':
      const doneCount = result?.items?.length || result?.item ? 1 : 0
      return t('builder_common_todo_mark_done', { doneCount })
    case 'mark_undone':
      const undoneCount = result?.items?.length || result?.item ? 1 : 0
      return t('builder_common_todo_mark_undone', { undoneCount })
    default:
      return `${t('builder_common_todo_default')}: ${operation}`
  }
}

/**
 * Circular Checkbox Component
 */
function CircularCheckbox({ checked }: { checked: boolean }) {
  return (
    <div className="relative w-2.5 h-2.5">
      <div className={`
        w-2.5 h-2.5 rounded-full border-2 transition-all duration-200
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
function renderTodoListHTML(list: any, t: (key: string) => string): React.JSX.Element {
  if (!list) return <div>{t('builder_common_todo_no_list')}</div>

  const items = list.items || []
  const total = items.length
  const completedCount = items.filter((item: any) => item.completed).length

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-foreground">{list.name}</h1>
          {list.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{list.description}</p>
          )}
        </div>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {completedCount}/{total}
        </span>
      </div>

      {/* Items */}
      {items.length > 0 ? (
        <div className="space-y-1.5">
          {items.map((item: any) => (
            <div
              key={item.id}
              className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-1.5"
            >
              <div className="flex items-start gap-1.5">
                <div className="flex-shrink-0">
                  <CircularCheckbox checked={item.completed} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${item.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {item.title}
                  </div>
                  {item.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {item.description}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-4">
          {t('builder_common_todo_no_items')}
        </div>
      )}
    </div>
  )
}

/**
 * Render multiple lists as HTML
 */
function renderMultipleListsHTML(lists: any[], t: (key: string) => string): React.JSX.Element {
  if (!lists || lists.length === 0) {
    return <div className="text-sm text-muted-foreground">{t('builder_common_todo_no_todo')}</div>
  }

  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold text-foreground">{t('builder_common_todo_all_todo')} ({lists.length})</h1>

      <div className="space-y-1.5">
        {lists.map((list) => {
          const totalItems = list.items?.length || 0
          const completedItems = list.items?.filter((item: any) => item.completed).length || 0

          return (
            <div key={list.id} className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <h2 className="text-sm font-medium text-foreground">{list.name}</h2>
                  {list.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{list.description}</p>
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
    <div className="space-y-2">
      {listName && (
        <h1 className="text-lg font-semibold text-foreground">{listName}</h1>
      )}
      <h2 className="text-sm font-medium text-foreground">{title}</h2>

      <div className="space-y-1.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-1.5"
          >
            <div className="flex items-start gap-1.5">
              <div className="flex-shrink-0">
                <CircularCheckbox checked={item.completed} />
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium ${item.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {item.title}
                </div>
                {item.description && (
                  <div className="text-xs text-muted-foreground mt-0.5">
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
  const t = useTranslations();
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isVisible, setIsVisible] = useState(true)

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
      logger.error('tool.todo_list.parse.failed', {
        error: e instanceof Error ? e.message : String(e),
        resultLength: result?.length
      })
    }
  }

  // Get operation from input if not in result
  if (!operation && input && typeof input === 'object') {
    const inputObj = input as any
    operation = inputObj.operation || ''
  }

  // Handle select_list visibility with auto-removal after 4 seconds
  useEffect(() => {
    if (operation === 'select_list' && toolStatus === 'completed') {
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 4000)

      return () => clearTimeout(timer)
    }

    // Reset visibility for other operations or when tool reruns
    setIsVisible(true)
    return undefined
  }, [operation, toolStatus])

  // Don't render anything for mark_done/mark_undone/show_list operations
  // The persistent todo list UI handles these updates
  if (operation === 'mark_done' || operation === 'mark_undone' || operation === 'show_list') {
    return null
  }

  // Don't render select_list if it's been hidden
  if (operation === 'select_list' && !isVisible) {
    return null
  }

  // Generate display message
  if (toolStatus === 'completed' && parsedResult) {
    displayMessage = getOperationMessage(operation, parsedResult, t)
  } else if (operation) {
    displayMessage = `${t('builder_common_todo_default')}: ${operation.replace(/_/g, ' ')}`
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
      modalContentElement = renderTodoListHTML(parsedResult.list, t)
    } else if (parsedResult.lists) {
      modalContentElement = renderMultipleListsHTML(parsedResult.lists, t)
    } else if (parsedResult.items) {
      modalContentElement = renderItemsHTML(parsedResult.items, t('builder_common_todo_affected'), listName)
    } else if (parsedResult.item) {
      modalContentElement = renderItemsHTML([parsedResult.item], t('builder_common_todo_details'), listName)
    } else if (parsedResult.message) {
      modalContentElement = <div className="text-sm text-foreground/80">{parsedResult.message}</div>
    }
  }

  const modalContent = (
    <ToolModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      title={listName ? `${listName} - ${operation.replace(/_/g, ' ')}` : `${t('builder_common_todo_show_list')}: ${operation.replace(/_/g, ' ')}`}
    >
      <div className="flex-1 overflow-y-auto">
        {modalContentElement}
      </div>
    </ToolModal>
  )

  return (
    <div>
      <ToolHeader
        icon={<ListTodo className="w-2 h-2" />}
        displayName={displayMessage}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />
      {modalContent}
    </div>
  )
}
