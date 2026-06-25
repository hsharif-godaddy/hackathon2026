'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Button from '@ux/button'
import Growl from '@ux/growl'
import ClockIcon from '@ux/icon/clock'
import PlusIcon from '@ux/icon/plus'
import RefreshIcon from '@ux/icon/refresh'
import SparklesIcon from '@ux/icon/sparkles'
import text from '@ux/text'
import Tooltip from '@ux/tooltip'

import AddView from '@/app/[market]/develop/components/automations/AddView'
import AutomationCard from '@/app/[market]/develop/components/automations/AutomationCard'
import { getDefaultAutomations } from '@/app/[market]/develop/components/automations/automationData'
import AutomationDeleteModal from '@/app/[market]/develop/components/automations/AutomationDeleteModal'
import EditForm from '@/app/[market]/develop/components/automations/EditForm'
import { Automation } from '@/app/[market]/develop/components/automations/types'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useTranslations } from '@/hooks/useTranslations'
import * as automationFiles from '@/services/automation-files'
import { useIsActivelyStreaming, useIsLoading, useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

interface AutomationsPanelProps {
  chatLoadingMessage?: string | null
}

export default function AutomationsPanel({ chatLoadingMessage = null }: AutomationsPanelProps) {
  const t = useTranslations()
  const tRef = useRef(t)
  const appId = useAppIdFromParams()
  const { setActiveChatTab } = useChatTabs()
  const isLoading = useIsLoading()
  const isStreaming = useIsActivelyStreaming()
  const isAgentBusy = isLoading || isStreaming || !!chatLoadingMessage
  const [showWizard, setShowWizard] = useState(false)
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null)
  const [confirmDeleteAutomation, setConfirmDeleteAutomation] = useState<Automation | null>(null)
  const [customAutomations, setCustomAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const pendingNames = useRef(new Set<string>())
  const scheduleButtonRef = useRef<HTMLButtonElement>(null)
  const [showScheduleTooltip, setShowScheduleTooltip] = useState(false)
  const scheduleTooltipId = useId()
  const createButtonRef = useRef<HTMLSpanElement>(null)
  const [showCreateTooltip, setShowCreateTooltip] = useState(false)
  const createTooltipId = useId()

  useLayoutEffect(() => { tRef.current = t })

  const loadAutomations = useCallback(function load() {
    if (!appId) return
    setLoading(true)
    automationFiles.list(appId)
      .then(setCustomAutomations)
      .catch(function onListError() {
        Growl.addGrowlMessage({
          id: 'automations-load-error',
          title: tRef.current('builder_automations_load_error_title', undefined, 'Could not load automations'),
          children: tRef.current('builder_automations_load_error_body', undefined, 'Failed to load your automations. Please refresh.'),
          emphasis: 'critical',
          lifetime: 5000,
        })
      })
      .finally(() => setLoading(false))
  }, [appId])

  useEffect(() => { loadAutomations() }, [loadAutomations])

  const handleRun = useCallback(function run(automation: Automation): boolean {
    if (!appId) return false
    const { isLoading, streamingState, activeStream } = useStreamingConversationStore.getState()
    const isBusy = isLoading || (streamingState === 'streaming' && !!activeStream) || !!chatLoadingMessage
    if (isBusy) {
      Growl.addGrowlMessage({
        id: 'automation-agent-busy',
        title: tRef.current('builder_automations_agent_busy_title', undefined, 'Automation already running'),
        children: tRef.current('builder_automations_agent_busy_body', undefined, 'Only 1 automation can run at a time. Please wait for it to finish.'),
        emphasis: 'warning',
        lifetime: 4000,
      })
      return false
    }
    window.dispatchEvent(new CustomEvent('airo-automation-run', {
      detail: { appId, prompt: automation.prompt, automationId: automation.id }
    }))
    setActiveChatTab(ChatTab.CHAT)
    return true
  }, [appId, chatLoadingMessage, setActiveChatTab])

  const handleAdd = useCallback(function add(data: Omit<Automation, 'id'>) {
    if (!appId) return
    setIsSaving(true)
    automationFiles.create(appId, data)
      .then(function onCreated(created) {
        setCustomAutomations(prev => [...prev, created])
        setShowWizard(false)
        Growl.addGrowlMessage({
          id: `automation-created-${created.id}`,
          title: tRef.current('builder_automations_created_title', undefined, 'Automation created'),
          children: tRef.current('builder_automations_created_body', undefined, 'Your automation has been added successfully.'),
          emphasis: 'success',
          lifetime: 4000,
        })
      })
      .catch(function onCreateError() {
        Growl.addGrowlMessage({
          id: 'automation-create-error',
          title: tRef.current('builder_automations_save_error_title', undefined, 'Could not save automation'),
          children: tRef.current('builder_automations_save_error_body', undefined, 'Failed to create automation. Please try again.'),
          emphasis: 'critical',
          lifetime: 5000,
        })
      })
      .finally(() => setIsSaving(false))
  }, [appId])

  const handleEdit = useCallback(function edit(data: Omit<Automation, 'id'>) {
    if (!appId || !editingAutomation) return
    setIsSaving(true)
    automationFiles.update(appId, editingAutomation.id, data)
      .then(function onUpdated(updated) {
        setCustomAutomations(prev => prev.map(a => a.id === updated.id ? updated : a))
        setEditingAutomation(null)
      })
      .catch(function onEditError() {
        Growl.addGrowlMessage({
          id: 'automation-edit-error',
          title: tRef.current('builder_automations_save_error_title', undefined, 'Could not save automation'),
          children: tRef.current('builder_automations_save_error_body', undefined, 'Failed to save changes. Please try again.'),
          emphasis: 'critical',
          lifetime: 5000,
        })
      })
      .finally(() => setIsSaving(false))
  }, [appId, editingAutomation])

  const handleDeleteRequest = useCallback(function requestDelete(automation: Automation) {
    setConfirmDeleteAutomation(automation)
  }, [])

  const handleDeleteConfirm = useCallback(function confirmDelete() {
    if (!appId || !confirmDeleteAutomation) return
    setIsDeleting(true)
    automationFiles.remove(appId, confirmDeleteAutomation.id)
      .then(function onRemoved() {
        setCustomAutomations(prev => prev.filter(a => a.id !== confirmDeleteAutomation.id))
        setConfirmDeleteAutomation(null)
      })
      .catch(function onDeleteError() {
        Growl.addGrowlMessage({
          id: 'automation-delete-error',
          title: tRef.current('builder_automations_delete_error_title', undefined, 'Could not delete automation'),
          children: tRef.current('builder_automations_delete_error_body', undefined, 'Failed to delete automation. Please try again.'),
          emphasis: 'critical',
          lifetime: 5000,
        })
      })
      .finally(() => setIsDeleting(false))
  }, [appId, confirmDeleteAutomation])

  const addedNames = useMemo(() => new Set(customAutomations.map(a => a.name)), [customAutomations])
  const defaultAutomations = useMemo(() => getDefaultAutomations(t), [t])

  const handleRunRecommended = useCallback(function runRecommended(automation: Automation) {
    if (pendingNames.current.has(`${appId}:${automation.name}`)) return
    const id = crypto.randomUUID()
    if (!handleRun({ ...automation, id })) return
    if (!appId || addedNames.has(automation.name)) return
    pendingNames.current.add(`${appId}:${automation.name}`)
    setSavingIds(prev => new Set([...prev, automation.id]))
    const { isDefault, ...data } = automation
    automationFiles.create(appId, data, id)
      .then(function onCreated(created) {
        setCustomAutomations(prev => [...prev, created])
        Growl.addGrowlMessage({
          id: `automation-saved-on-run-${created.id}`,
          title: tRef.current('builder_automations_saved_on_run_title', undefined, 'Automation saved'),
          children: tRef.current('builder_automations_saved_on_run_body', undefined, `"${created.name}" has been added to Your Automations.`),
          emphasis: 'success',
          lifetime: 4000,
        })
      })
      .catch(function onCreateError() {
        Growl.addGrowlMessage({
          id: 'automation-create-error',
          title: tRef.current('builder_automations_save_error_title', undefined, 'Could not save automation'),
          children: tRef.current('builder_automations_save_error_body', undefined, 'Failed to save automation. Please try again.'),
          emphasis: 'critical',
          lifetime: 5000,
        })
      })
      .finally(function cleanup() {
        pendingNames.current.delete(`${appId}:${automation.name}`)
        setSavingIds(prev => { const next = new Set(prev); next.delete(automation.id); return next })
      })
  }, [appId, addedNames, handleRun])

  const handleAddRecommended = useCallback(function addRecommended(automation: Automation) {
    if (!appId || addedNames.has(automation.name) || pendingNames.current.has(`${appId}:${automation.name}`)) return
    pendingNames.current.add(`${appId}:${automation.name}`)
    setSavingIds(prev => new Set([...prev, automation.id]))
    const { isDefault, ...data } = automation
    automationFiles.create(appId, data)
      .then(function onCreated(created) {
        setCustomAutomations(prev => [...prev, created])
      })
      .catch(function onCreateError() {
        Growl.addGrowlMessage({
          id: 'automation-create-error',
          title: tRef.current('builder_automations_save_error_title', undefined, 'Could not save automation'),
          children: tRef.current('builder_automations_save_error_body', undefined, 'Failed to save automation. Please try again.'),
          emphasis: 'critical',
          lifetime: 5000,
        })
      })
      .finally(function cleanup() {
        pendingNames.current.delete(`${appId}:${automation.name}`)
        setSavingIds(prev => { const next = new Set(prev); next.delete(automation.id); return next })
      })
  }, [appId, addedNames])

  return (
    <div className="flex flex-col h-full overflow-y-auto" data-testid="automations-panel">
      <div className="p-4 md:p-6 max-w-4xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 p-2 rounded-xl bg-intents-ux-actionPrimary-backgroundColor/20 border border-intents-ux-actionPrimary-borderColor/25 shadow-sm">
              <SparklesIcon className="size-4 text-intents-ux-actionPrimary-backgroundColor" />
            </div>
            <div className="min-w-0">
              <text.h2 size={1} className="font-bold">
                {t('builder_automations_title', undefined, 'Automations')}
              </text.h2>
              <text.p size={-1} emphasis="passive" className="hidden sm:block">
                {t('builder_automations_description', undefined, 'Run pre-built tasks to improve your site automatically.')}
              </text.p>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <span
              ref={scheduleButtonRef}
              onMouseEnter={() => setShowScheduleTooltip(true)}
              onMouseLeave={() => setShowScheduleTooltip(false)}
              aria-describedby={showScheduleTooltip ? scheduleTooltipId : undefined}
              className="cursor-not-allowed"
            >
              <Button
                type="button"
                design="secondary"
                size="sm"
                disabled
                className="pointer-events-none"
                icon={<ClockIcon />}
                text={t('builder_automations_schedule', undefined, 'Create Schedule')}
              />
            </span>
            <span
              ref={createButtonRef}
              onMouseEnter={() => isAgentBusy && setShowCreateTooltip(true)}
              onMouseLeave={() => setShowCreateTooltip(false)}
              aria-describedby={showCreateTooltip ? createTooltipId : undefined}
              className={isAgentBusy ? 'cursor-not-allowed' : undefined}
            >
              <Button
                type="button"
                design="primary"
                size="sm"
                onClick={isAgentBusy ? undefined : () => setShowWizard(true)}
                disabled={isAgentBusy}
                data-testid="automations-create-button"
                className={isAgentBusy ? 'pointer-events-none' : undefined}
                icon={<PlusIcon />}
                text={t('builder_automations_add', undefined, 'Create')}
              />
            </span>
            <button
              type="button"
              onClick={loadAutomations}
              disabled={loading}
              aria-label={t('builder_automations_refresh', undefined, 'Refresh automations')}
              className="p-1 text-intents-ux-neutral-color hover:text-intents-ux-color disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshIcon className={`size-3 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        {showScheduleTooltip && (
          <Tooltip id={scheduleTooltipId} anchorRef={scheduleButtonRef} portalElem={document.body}>
            <div className="p-1 text-start max-w-[25ch] break-words">
              {t('builder_automations_schedule_coming_soon', undefined, 'Coming soon')}
            </div>
          </Tooltip>
        )}
        {showCreateTooltip && isAgentBusy && (
          <Tooltip id={createTooltipId} anchorRef={createButtonRef} portalElem={document.body}>
            <div className="p-1 text-start max-w-[25ch] break-words">
              {t('builder_automations_agent_busy_tooltip', undefined, 'Agent is processing')}
            </div>
          </Tooltip>
        )}

        {showWizard && (
          <div className="mb-5" data-testid="automations-add-view">
            <AddView
              onAdd={handleAdd}
              onClose={() => setShowWizard(false)}
              isSaving={isSaving}
              isAgentBusy={isAgentBusy}
            />
          </div>
        )}

        {editingAutomation && (
          <div className="mb-5" data-testid="automations-edit-form">
            <EditForm
              automation={editingAutomation}
              onSave={handleEdit}
              onCancel={() => setEditingAutomation(null)}
              isSaving={isSaving}
            />
          </div>
        )}

        {loading ? (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-px flex-1 bg-intents-ux-box-borderColor" />
              <text.p size={-2} className="font-semibold uppercase tracking-widest text-intents-ux-neutral-color px-1">
                {t('builder_automations_custom_section', undefined, 'Your Automations')}
              </text.p>
              <div className="h-px flex-1 bg-intents-ux-box-borderColor" />
            </div>
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map(function renderSkeleton(i) {
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-3 rounded-xl border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor animate-pulse"
                  >
                    <div className="shrink-0 size-6 rounded-lg bg-intents-ux-box-borderColor" />
                    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                      <div className="h-3 w-1/3 rounded bg-intents-ux-box-borderColor" />
                      <div className="h-2.5 w-1/2 rounded bg-intents-ux-box-borderColor opacity-60" />
                    </div>
                    <div className="shrink-0 h-6 w-14 rounded-lg bg-intents-ux-box-borderColor" />
                  </div>
                )
              })}
            </div>
          </div>
        ) : customAutomations.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-px flex-1 bg-intents-ux-box-borderColor" />
              <text.p size={-2} className="font-semibold uppercase tracking-widest text-intents-ux-neutral-color px-1">
                {t('builder_automations_custom_section', undefined, 'Your Automations')}
              </text.p>
              <div className="h-px flex-1 bg-intents-ux-box-borderColor" />
            </div>
            <div className="flex flex-col gap-2">
              {customAutomations.map(function renderCustom(automation) {
                return (
                  <AutomationCard
                    key={automation.id}
                    automation={automation}
                    onRun={handleRun}
                    onEdit={setEditingAutomation}
                    onDelete={handleDeleteRequest}
                    isRunning={isAgentBusy}
                  />
                )
              })}
            </div>
          </div>
        )}

        {!loading && defaultAutomations.some(a => !addedNames.has(a.name)) && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-px flex-1 bg-intents-ux-box-borderColor" />
              <text.p size={-2} className="font-semibold uppercase tracking-widest text-intents-ux-neutral-color px-1">
                {t('builder_automations_recommended_section', undefined, 'Recommended Automations')}
              </text.p>
              <div className="h-px flex-1 bg-intents-ux-box-borderColor" />
            </div>
            <div className="flex flex-col gap-2">
              {defaultAutomations.filter(a => !addedNames.has(a.name)).map(function renderDefault(automation) {
                return (
                  <AutomationCard
                    key={automation.id}
                    automation={automation}
                    onRun={handleRunRecommended}
                    onAdd={handleAddRecommended}
                    isRunning={isAgentBusy}
                    isAdding={savingIds.has(automation.id)}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>

      {confirmDeleteAutomation && (
        <AutomationDeleteModal
          automation={confirmDeleteAutomation}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmDeleteAutomation(null)}
          isDeleting={isDeleting}
        />
      )}
    </div>
  )
}
