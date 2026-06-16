'use client'

import { createContext, useContext } from 'react'

export interface CommanderLayoutContextValue {
  reportNonMessagesHeight: (height: number) => void
}

export const CommanderLayoutContext = createContext<CommanderLayoutContextValue | null>(null)

export function useCommanderLayout(): CommanderLayoutContextValue | null {
  return useContext(CommanderLayoutContext)
}
