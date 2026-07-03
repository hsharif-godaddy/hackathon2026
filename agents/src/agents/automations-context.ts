import { AsyncLocalStorage } from 'node:async_hooks'

interface AutomationsContext {
  enabled: boolean
  automationId?: string
}

const als = new AsyncLocalStorage<AutomationsContext>()

export function runWithAutomations<T>(enabled: boolean, fn: () => T, automationId?: string): T {
  return als.run({ enabled, automationId }, fn)
}

export function getAutomationId(): string | undefined {
  return als.getStore()?.automationId
}
