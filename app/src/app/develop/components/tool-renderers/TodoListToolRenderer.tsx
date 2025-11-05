'use client'

import React, { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'
import MarkdownRenderer from '../MarkdownRenderer'
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
        <h1 className="text-2xl font-bold text-gray-900">{list.name}</h1>
        {list.description && (
          <p className="text-sm text-gray-600 italic mt-1">{list.description}</p>
        )}
      </div>

      {/* Progress */}
      {total > 0 && (
        <div className="text-sm text-gray-700">
          <strong>Progress:</strong> {completedCount}/{total} complete ({progress}%)
        </div>
      )}

      {/* Pending Items */}
      {pending.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Pending ({pending.length})</h2>
          <div className="space-y-1">
            {pending.map((item: any, index: number) => (
              <div key={item.id || index} className="flex gap-2 text-sm">
                <span className="text-gray-500 font-mono text-xs flex-shrink-0 w-6 text-right">
                  {index + 1}.
                </span>
                <span className="flex-shrink-0">⬜</span>
                <div className="flex-1">
                  <div className="text-gray-900">{item.title}</div>
                  {item.description && (
                    <div className="text-gray-600 italic text-xs mt-0.5">{item.description}</div>
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
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Completed ({completed.length})</h2>
          <div className="space-y-1">
            {completed.map((item: any, index: number) => (
              <div key={item.id || index} className="flex gap-2 text-sm">
                <span className="text-gray-500 font-mono text-xs flex-shrink-0 w-6 text-right">
                  {index + 1}.
                </span>
                <span className="flex-shrink-0">✅</span>
                <div className="flex-1">
                  <div className="text-gray-900">{item.title}</div>
                  {item.description && (
                    <div className="text-gray-600 italic text-xs mt-0.5">{item.description}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No items */}
      {total === 0 && (
        <div className="text-sm text-gray-500 italic">No items yet</div>
      )}
    </div>
  )
}

/**
 * Render multiple lists as HTML
 */
function renderMultipleListsHTML(lists: any[]): React.JSX.Element {
  if (!lists || lists.length === 0) {
    return <div className="text-sm text-gray-500">No todo lists found.</div>
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">All Todo Lists ({lists.length})</h1>
      
      <div className="space-y-4">
        {lists.map((list, index) => {
          const totalItems = list.items?.length || 0
          const completedItems = list.items?.filter((item: any) => item.completed).length || 0
          const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0

          return (
            <div key={list.id || index} className="border-l-2 border-gray-300 pl-4">
              <h2 className="text-lg font-semibold text-gray-800">
                <span className="text-gray-500 font-mono text-sm mr-2">{index + 1}.</span>
                {list.name}
              </h2>
              {list.description && (
                <p className="text-sm text-gray-600 italic mt-1">{list.description}</p>
              )}
              <div className="text-sm text-gray-700 mt-1">
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
    return <div className="text-sm text-gray-500">No items</div>
  }

  return (
    <div className="space-y-4">
      {listName && (
        <h1 className="text-2xl font-bold text-gray-900">{listName}</h1>
      )}
      <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
      
      <div className="space-y-1">
        {items.map((item, index) => {
          const checkbox = item.completed ? '✅' : '⬜'
          return (
            <div key={item.id || index} className="flex gap-2 text-sm">
              <span className="text-gray-500 font-mono text-xs flex-shrink-0 w-6 text-right">
                {index + 1}.
              </span>
              <span className="flex-shrink-0">{checkbox}</span>
              <div className="flex-1">
                <div className="text-gray-900">{item.title}</div>
                {item.description && (
                  <div className="text-gray-600 italic text-xs mt-0.5">{item.description}</div>
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
  toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isModalOpen])

  const getStatusIndicator = () => {
    if (toolStatus === 'running') {
      return (
        <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )
    }
    return null
  }

  const statusIndicator = getStatusIndicator()

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
      modalContentElement = <div className="text-sm text-gray-700">{parsedResult.message}</div>
    }
  }
  
  // For show_list operation, render inline
  const isShowList = operation === 'show_list'
  const shouldRenderInline = isShowList && toolStatus === 'completed' && parsedResult?.list

  const modalContent = mounted && (
    <AnimatePresence>
      {isModalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-intents-ux-boxHighContrastOverlay-backgroundColor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setIsModalOpen(false)}
          />

          {/* Modal Container */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              className="max-w-3xl w-full bg-intents-ux-box-backgroundColor p-6 rounded-lg shadow-xl relative max-h-[85vh] flex flex-col"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <div className="absolute top-3 right-3">
                <Button
                  onClick={() => setIsModalOpen(false)}
                  icon={<XThickIcon className="h-6 w-6" />}
                  design="control"
                  aria-label="Close"
                  size="sm"
                />
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold mb-4">
                {listName ? `${listName} - ${operation.replace(/_/g, ' ')}` : `Todo List: ${operation.replace(/_/g, ' ')}`}
              </h2>

              {/* Content */}
              <div className="flex-1 overflow-y-auto">
                {modalContentElement}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )

  return (
    <div className="-my-2">
      <span className="text-gray-300 text-xs">
        {/* Todo icon */}
        <span className="text-gray-400">📋</span>
        {' '}
        {toolStatus === 'completed' && hasDetails ? (
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-gray-300 hover:text-gray-400 hover:underline cursor-pointer"
          >
            {displayMessage}
          </button>
        ) : (
          <span>
            {displayMessage}
          </span>
        )}
        {statusIndicator && (
          <span className="inline-flex ml-1.5 text-gray-300">
            {statusIndicator}
          </span>
        )}
      </span>

      {/* Inline list display for show_list operation */}
      {shouldRenderInline && parsedResult?.list && (
        <div className="mt-3 mb-3 p-4 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg border border-gray-200">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-gray-800">{parsedResult.list.name}</h3>
            {parsedResult.list.description && (
              <p className="text-sm text-gray-600 mt-1">{parsedResult.list.description}</p>
            )}
          </div>

          {parsedResult.list.items && parsedResult.list.items.length > 0 && (
            <div className="text-gray-800">
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
            <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600">
              {parsedResult.list.items.filter((item: any) => item.completed).length} of{' '}
              {parsedResult.list.items.length} completed
            </div>
          )}
        </div>
      )}

      {mounted && createPortal(modalContent, document.body)}
    </div>
  )
}

