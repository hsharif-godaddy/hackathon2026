/**
 * Shared handling for `builder_layout` SSE events (AIROBUILD-3409).
 *
 * The server emits this when an app's durable builder-layout descriptor changes
 * (e.g. the design-kit wizard advances). Mirrors `buildPhaseNotification`: scope
 * the write to the current app, normalize the payload at ingest, and update the
 * wizard store's per-app descriptor map that `useBuilderLayout` reads.
 */

import { type BuilderLayoutDescriptor, normalizeBuilderLayout } from '@airo/shared'

import { useWizardStore } from '@/stores/useWizardStore'

export function handleBuilderLayoutNotification(params: {
  raw: Record<string, unknown>
  clientAppId: string
  logPrefix: string
}): void {
  const { raw, clientAppId } = params
  const eventAppId = typeof raw.appId === 'string' ? raw.appId : clientAppId
  if (eventAppId !== clientAppId) return
  if (!clientAppId) return

  const descriptor: BuilderLayoutDescriptor = normalizeBuilderLayout(raw.builderLayout)
  useWizardStore.getState().setBuilderLayout(clientAppId, descriptor)
}
