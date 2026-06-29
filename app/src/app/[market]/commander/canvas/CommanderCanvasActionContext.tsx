'use client'

import { createContext, type ReactElement, type ReactNode, useContext, useMemo } from 'react'

interface CommanderCanvasActionContextValue {
  onPreviewRefresh?: () => void
}

const CommanderCanvasActionContext = createContext<CommanderCanvasActionContextValue>({})

interface CommanderCanvasActionProviderProps {
  onPreviewRefresh?: () => void
  children: ReactNode
}

export function CommanderCanvasActionProvider({
  onPreviewRefresh,
  children,
}: CommanderCanvasActionProviderProps): ReactElement {
  const value = useMemo<CommanderCanvasActionContextValue>(
    () => ({ onPreviewRefresh }),
    [onPreviewRefresh],
  )
  return (
    <CommanderCanvasActionContext.Provider value={value}>
      {children}
    </CommanderCanvasActionContext.Provider>
  )
}

export function useCommanderCanvasActionContext(): CommanderCanvasActionContextValue {
  return useContext(CommanderCanvasActionContext)
}
