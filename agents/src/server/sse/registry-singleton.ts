import { EventStreamRegistry } from './EventStreamRegistry.js'

let instance: EventStreamRegistry | null = null

export function initSSERegistry(registry: EventStreamRegistry): void {
  instance = registry
}

export function getSSERegistry(): EventStreamRegistry | null {
  return instance
}
