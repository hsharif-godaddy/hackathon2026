import { useEffect, useRef } from 'react'

import { logger } from '@/lib/request-context'
import { todoListService } from '@/services/TodoListService'
import { useTodoListStore } from '@/stores/useTodoListStore'

/**
 * Hook to load the current todo list for an app into the store.
 * Extracted from PersistentTodoList so loading happens regardless of UI rendering.
 */
export function useTodoListLoader(appId: string | null | undefined) {
  const setCurrentList = useTodoListStore((state) => state.setCurrentList)
  const currentAppIdRef = useRef(appId)

  // Keep ref in sync so async callbacks can read the latest value
  useEffect(() => {
    currentAppIdRef.current = appId
  })

  // Clear list when appId changes
  useEffect(() => {
    setCurrentList(null)
  }, [appId, setCurrentList])

  // Load the current list when the app changes.
  useEffect(() => {
    const requestedAppId = appId

    async function load() {
      if (!requestedAppId) return

      try {
        const list = await todoListService.getCurrentList(requestedAppId)

        // Guard: appId may have changed while the request was in-flight
        if (requestedAppId !== currentAppIdRef.current) return

        setCurrentList(list)
        logger.debug('todo-list-loader.load.success', {
          appId: requestedAppId,
          hasCurrentList: !!list,
          listName: list?.name
        })
      } catch (error) {
        if (requestedAppId !== currentAppIdRef.current) return

        logger.error('todo-list-loader.load.failure', {
          appId: requestedAppId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    load()
  }, [appId, setCurrentList])
}
