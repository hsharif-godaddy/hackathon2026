'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Button from '@ux/button'
import Growl from '@ux/growl'
import PlusIcon from '@ux/icon/plus'
import RefreshIcon from '@ux/icon/refresh'
import SparklesIcon from '@ux/icon/sparkles'
import text from '@ux/text'
import Tooltip from '@ux/tooltip'

import AddView from '@/app/[market]/develop/components/automations/AddView'
import AutomationCard from '@/app/[market]/develop/components/automations/AutomationCard'
import { getDefaultAutomations } from '@/app/[market]/develop/components/automations/automationData'
import AutomationDeleteModal from '@/app/[market]/develop/components/automations/AutomationDeleteModal'
import AutomationScheduleModal, { cronExprToScheduleConfig, formatScheduleSummary,type ScheduleConfig } from '@/app/[market]/develop/components/automations/AutomationScheduleModal'
import EditForm from '@/app/[market]/develop/components/automations/EditForm'
import RunsHistoryView from '@/app/[market]/develop/components/automations/RunsHistoryView'
import { Automation } from '@/app/[market]/develop/components/automations/types'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { usePublishedUrl } from '@/app/[market]/develop/hooks/usePublishedUrl'
import { useAutomations } from '@/hooks/useAutomations'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import * as automationFiles from '@/services/automation-files'
import { useIsActivelyStreaming, useIsLoading, useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

interface AutomationsPanelProps {
  chatLoadingMessage?: string | null
}

function isQuotaExceeded(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'AUTOMATION_QUOTA_EXCEEDED'
}

export default function AutomationsPanel({ chatLoadingMessage = null }: AutomationsPanelProps) {
  const t = useTranslations()
  const tRef = useRef(t)
  const appId = useAppIdFromParams()

  const { setActiveChatTab } = useChatTabs()
  const isLoading = useIsLoading()
  const isStreaming = useIsActivelyStreaming()
  const isAgentBusy = isLoading || isStreaming || !!chatLoadingMessage
  const schedulingEnabled = useSwitchboard('appbuilder-automation-scheduling') === true
  const publishedUrl = usePublishedUrl()
  const isPublished = !!publishedUrl
  const [schedulingAutomation, setSchedulingAutomation] = useState<Automation | null>(null)
  const [isSavingSchedule, setIsSavingSchedule] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null)
  const [confirmDeleteAutomation, setConfirmDeleteAutomation] = useState<Automation | null>(null)
  const [customAutomations, setCustomAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const pendingNames = useRef(new Set<string>())
  const createButtonRef = useRef<HTMLSpanElement>(null)
  const [showCreateTooltip, setShowCreateTooltip] = useState(false)
  const createTooltipId = useId()
  const {
    scheduleByDefnRef,
    loading: schedulesLoading,
    registerAutomation: apiRegisterAutomation,
    saveSchedule: apiSaveSchedule,
    removeSchedule: apiRemoveSchedule,
    loadError: schedulesLoadError,
    triggerRun: apiTriggerRun,
  } = useAutomations(appId)
  const [isCancellingSchedule, setIsCancellingSchedule] = useState(false)
  const [viewingRunsFor, setViewingRunsFor] = useState<Automation | null>(null)

  useEffect(() => {
    if (!schedulesLoadError) return
    Growl.addGrowlMessage({
      id: 'automations-schedules-load-error',
      title: tRef.current('builder_automations_schedules_load_error_title', undefined, 'Could not load schedules'),
      children: tRef.current('builder_automations_schedules_load_error_body', undefined, 'Schedule status may be outdated. Refresh the page and try again.'),
      emphasis: 'critical',
      lifetime: 5000,
    })
  }, [schedulesLoadError])

  const canManageSchedules = schedulingEnabled && isPublished && !schedulesLoadError
  const scheduleComingSoon = !schedulingEnabled

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

  const handleRun = useCallback(function run(automation: Automation) {
    if (!appId) return
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
      return
    }

    if (scheduleByDefnRef[automation.id]) {
      // Hosted automation — go through airo-go → hosting → agent callback.
      apiTriggerRun(automation.id).catch(function onTriggerError(err: unknown) {
        const is409 = typeof err === 'object' && err !== null && (err as { status?: number }).status === 409
        Growl.addGrowlMessage({
          id: 'automation-run-error',
          title: tRef.current('builder_automations_run_error_title', undefined, 'Could not start run'),
          children: is409
            ? tRef.current('builder_automations_agent_busy_body', undefined, 'Only 1 automation can run at a time. Please wait for it to finish.')
            : tRef.current('builder_automations_run_error_body', undefined, 'Failed to trigger automation run. Please try again.'),
          emphasis: is409 ? 'warning' : 'critical',
          lifetime: 5000,
        })
      })
    } else {
      // Not yet registered (e.g. registration in-flight or failed) — fall back to SSE.
      // Recommended automations have slug ids (e.g. 'seo-optimization') which the agent
      // strips as non-UUID. Block these with a visible error rather than silently losing
      // all automation context. Custom automations always have UUID ids and fall through
      // normally.
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(automation.id)
      if (!isUUID) {
        Growl.addGrowlMessage({
          id: 'automation-run-not-ready',
          title: tRef.current('builder_automations_run_error_title', undefined, 'Could not start run'),
          children: tRef.current('builder_automations_run_not_ready_body', undefined, 'This automation is still being set up. Please try again in a moment.'),
          emphasis: 'warning',
          lifetime: 4000,
        })
        return
      }
      window.dispatchEvent(new CustomEvent('airo-automation-run', {
        detail: { appId, prompt: automation.prompt, automationId: automation.id },
      }))
      setActiveChatTab(ChatTab.CHAT)
    }
  }, [appId, chatLoadingMessage, setActiveChatTab, scheduleByDefnRef, apiTriggerRun])

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
        void apiRegisterAutomation(created.id, { name: created.name, description: created.description, prompt: created.prompt })
      })
      .catch(function onCreateError(err: unknown) {
        Growl.addGrowlMessage({
          id: 'automation-create-error',
          title: tRef.current('builder_automations_save_error_title', undefined, 'Could not save automation'),
          children: isQuotaExceeded(err)
            ? tRef.current('builder_automations_quota_exceeded_body', undefined, 'You have reached the limit of 10 automations. Delete one to add more.')
            : tRef.current('builder_automations_save_error_body', undefined, 'Failed to create automation. Please try again.'),
          emphasis: 'critical',
          lifetime: 5000,
        })
      })
      .finally(() => setIsSaving(false))
  }, [appId, apiRegisterAutomation])

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
    const id = confirmDeleteAutomation.id
    // Cancel any active schedule first — only swallow 404 (already gone).
    // Any other error (auth, network) propagates to the outer catch so the
    // user sees the delete-error growl and the re-auth modal if needed.
    const cancelSchedule = scheduleByDefnRef[id]
      ? apiRemoveSchedule(id).catch((err: unknown) => {
          const status = typeof err === 'object' && err !== null ? (err as { status?: number }).status : undefined
          if (status === 404) return
          throw err
        })
      : Promise.resolve()
    cancelSchedule
      .then(() => automationFiles.remove(appId, id))
      .then(function onRemoved() {
        setCustomAutomations(prev => prev.filter(a => a.id !== id))
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
  }, [appId, confirmDeleteAutomation, scheduleByDefnRef, apiRemoveSchedule])

  const handleScheduleRequest = useCallback(function requestSchedule(automation: Automation) {
    setSchedulingAutomation(automation)
  }, [])

  const handleScheduleConfirm = useCallback(async function confirmSchedule(config: ScheduleConfig) {
    if (!schedulingAutomation) return
    setIsSavingSchedule(true)
    try {
      await apiSaveSchedule(
        schedulingAutomation.id,
        {
          name: schedulingAutomation.name,
          description: schedulingAutomation.description,
          prompt: schedulingAutomation.prompt,
        },
        config,
      )
      const description = formatScheduleSummary(config.frequency, config.day, config.time)
      Growl.addGrowlMessage({
        id: 'automation-schedule-saved',
        title: tRef.current('builder_automations_schedule_saved_title', undefined, 'Schedule saved'),
        children: description,
        emphasis: 'success',
        lifetime: 4000,
      })
      setSchedulingAutomation(null)
    } catch (err) {
      const isConflict = err instanceof Error && err.message.startsWith('schedule_conflict:')
      Growl.addGrowlMessage({
        id: 'automation-schedule-error',
        title: tRef.current('builder_automations_schedule_error_title', undefined, 'Could not save schedule'),
        children: isConflict
          ? tRef.current('builder_automations_schedule_conflict_body', undefined, 'Another automation is already scheduled at that time. Choose a different time.')
          : tRef.current('builder_automations_schedule_error_body', undefined, 'Failed to save schedule. Please try again.'),
        emphasis: 'critical',
        lifetime: 5000,
      })
    } finally {
      setIsSavingSchedule(false)
    }
  }, [schedulingAutomation, apiSaveSchedule])

  const handleScheduleCancel = useCallback(async function cancelSchedule(automation: Automation) {
    setIsCancellingSchedule(true)
    try {
      await apiRemoveSchedule(automation.id)
      Growl.addGrowlMessage({
        id: 'automation-schedule-cancelled',
        title: tRef.current('builder_automations_schedule_cancelled_title', undefined, 'Schedule removed'),
        children: tRef.current('builder_automations_schedule_cancelled_body', undefined, 'The automation will no longer run automatically.'),
        emphasis: 'success',
        lifetime: 4000,
      })
      setSchedulingAutomation(null)
    } catch {
      Growl.addGrowlMessage({
        id: 'automation-schedule-cancel-error',
        title: tRef.current('builder_automations_schedule_remove_error_title', undefined, 'Could not remove schedule'),
        children: tRef.current('builder_automations_schedule_remove_error_body', undefined, 'Failed to remove schedule. Please try again.'),
        emphasis: 'critical',
        lifetime: 5000,
      })
    } finally {
      setIsCancellingSchedule(false)
    }
  }, [apiRemoveSchedule])

  const addedNames = useMemo(() => new Set(customAutomations.map(a => a.name)), [customAutomations])
  const defaultAutomations = useMemo(() => getDefaultAutomations(t), [t])
  // Default automations that were scheduled directly (without being explicitly added)
  // — promoted into the "Your Automations" section so they appear with their schedule badge.
  const scheduledDefaults = useMemo(
    () => defaultAutomations.filter(a => !addedNames.has(a.name) && !!scheduleByDefnRef[a.id]),
    [defaultAutomations, addedNames, scheduleByDefnRef],
  )

  const handleRunRecommended = useCallback(function runRecommended(automation: Automation) {
    if (pendingNames.current.has(`${appId}:${automation.name}`)) return
    const { isLoading, streamingState, activeStream } = useStreamingConversationStore.getState()
    if (isLoading || (streamingState === 'streaming' && !!activeStream) || !!chatLoadingMessage) return

    // Already saved — scheduleByDefnRef is populated, run directly via hosted path.
    if (!appId || addedNames.has(automation.name)) {
      handleRun(automation)
      return
    }

    // First run of a recommended automation: register with airo-go first so
    // scheduleByDefnRef is populated before handleRun checks it.
    pendingNames.current.add(`${appId}:${automation.name}`)
    setSavingIds(prev => new Set([...prev, automation.id]))
    const { isDefault, id, ...data } = automation
    automationFiles.create(appId, data, id)
      .then(async function onCreated(created) {
        setCustomAutomations(prev => [...prev, created])
        Growl.addGrowlMessage({
          id: `automation-saved-on-run-${created.id}`,
          title: tRef.current('builder_automations_saved_on_run_title', undefined, 'Automation saved'),
          children: tRef.current('builder_automations_saved_on_run_body', undefined, `"${created.name}" has been added to Your Automations.`),
          emphasis: 'success',
          lifetime: 4000,
        })
        await apiRegisterAutomation(created.id, { name: created.name, description: created.description, prompt: created.prompt })
        // Call apiTriggerRun directly with the defnRef (created.id) — hostedIdRef is
        // synchronously updated inside apiRegisterAutomation, but scheduleByDefnRef
        // (React state) won't reflect until the next render, so handleRun would see
        // a stale empty map and fall back to SSE.
        apiTriggerRun(created.id).catch(function onTriggerError(err: unknown) {
          const is409 = typeof err === 'object' && err !== null && (err as { status?: number }).status === 409
          Growl.addGrowlMessage({
            id: 'automation-run-error',
            title: tRef.current('builder_automations_run_error_title', undefined, 'Could not start run'),
            children: is409
              ? tRef.current('builder_automations_agent_busy_body', undefined, 'Only 1 automation can run at a time. Please wait for it to finish.')
              : tRef.current('builder_automations_run_error_body', undefined, 'Failed to trigger automation run. Please try again.'),
            emphasis: is409 ? 'warning' : 'critical',
            lifetime: 5000,
          })
        })
      })
      .catch(function onCreateError(err: unknown) {
        Growl.addGrowlMessage({
          id: 'automation-create-error',
          title: tRef.current('builder_automations_save_error_title', undefined, 'Could not save automation'),
          children: isQuotaExceeded(err)
            ? tRef.current('builder_automations_quota_exceeded_body', undefined, 'You have reached the limit of 10 automations. Delete one to add more.')
            : tRef.current('builder_automations_save_error_body', undefined, 'Failed to save automation. Please try again.'),
          emphasis: 'critical',
          lifetime: 5000,
        })
      })
      .finally(function cleanup() {
        pendingNames.current.delete(`${appId}:${automation.name}`)
        setSavingIds(prev => { const next = new Set(prev); next.delete(automation.id); return next })
      })
  }, [appId, addedNames, handleRun, apiRegisterAutomation, apiTriggerRun])

  const handleAddRecommended = useCallback(function addRecommended(automation: Automation) {
    if (!appId || addedNames.has(automation.name) || pendingNames.current.has(`${appId}:${automation.name}`)) return
    pendingNames.current.add(`${appId}:${automation.name}`)
    setSavingIds(prev => new Set([...prev, automation.id]))
    const { isDefault, id, ...data } = automation
    automationFiles.create(appId, data, id)
      .then(function onCreated(created) {
        setCustomAutomations(prev => [...prev, created])
        void apiRegisterAutomation(created.id, { name: created.name, description: created.description, prompt: created.prompt })
      })
      .catch(function onCreateError(err: unknown) {
        Growl.addGrowlMessage({
          id: 'automation-create-error',
          title: tRef.current('builder_automations_save_error_title', undefined, 'Could not save automation'),
          children: isQuotaExceeded(err)
            ? tRef.current('builder_automations_quota_exceeded_body', undefined, 'You have reached the limit of 10 automations. Delete one to add more.')
            : tRef.current('builder_automations_save_error_body', undefined, 'Failed to save automation. Please try again.'),
          emphasis: 'critical',
          lifetime: 5000,
        })
      })
      .finally(function cleanup() {
        pendingNames.current.delete(`${appId}:${automation.name}`)
        setSavingIds(prev => { const next = new Set(prev); next.delete(automation.id); return next })
      })
  }, [appId, addedNames, apiRegisterAutomation])

  return (
    <div className="relative flex h-full overflow-hidden" data-testid="automations-panel">
      {/* Run history slide-in — rendered inline so it stays inside PreviewPane's stacking
          context. The ChatPane has z-20 which beats PreviewPane's isolate (z-index: auto),
          so chat modals always paint above this panel. */}
      <div
        className={`absolute inset-0 bg-develop-bg overflow-hidden transition-transform duration-300 ease-in-out ${viewingRunsFor ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {viewingRunsFor && (
          <RunsHistoryView
            appId={appId}
            automation={viewingRunsFor}
            hostedAutomationId={scheduleByDefnRef[viewingRunsFor.id]?.id ?? ''}
            onBack={() => setViewingRunsFor(null)}
          />
        )}
      </div>

      {/* Main automations list */}
      <div className={`flex flex-col w-full overflow-y-auto transition-transform duration-300 ease-in-out ${viewingRunsFor ? '-translate-x-full' : 'translate-x-0'}`}>
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
        ) : (customAutomations.length > 0 || scheduledDefaults.length > 0) && (
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
                    appId={appId}
                    automation={automation}
                    onRun={handleRun}
                    onEdit={setEditingAutomation}
                    onDelete={handleDeleteRequest}
                    onSchedule={handleScheduleRequest}
                    onViewAllRuns={setViewingRunsFor}
                    isRunning={isAgentBusy || schedulesLoading}
                    schedulingEnabled={canManageSchedules}
                    schedulingComingSoon={scheduleComingSoon}
                    activeSchedule={scheduleByDefnRef[automation.id]}
                  />
                )
              })}
              {scheduledDefaults.map(function renderScheduledDefault(automation) {
                return (
                  <AutomationCard
                    key={automation.id}
                    appId={appId}
                    automation={automation}
                    onRun={handleRunRecommended}
                    onSchedule={handleScheduleRequest}
                    onViewAllRuns={setViewingRunsFor}
                    isRunning={isAgentBusy || schedulesLoading}
                    schedulingEnabled={canManageSchedules}
                    schedulingComingSoon={scheduleComingSoon}
                    activeSchedule={scheduleByDefnRef[automation.id]}
                  />
                )
              })}
            </div>
          </div>
        )}

        {!loading && defaultAutomations.some(a => !addedNames.has(a.name) && !scheduleByDefnRef[a.id]) && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-px flex-1 bg-intents-ux-box-borderColor" />
              <text.p size={-2} className="font-semibold uppercase tracking-widest text-intents-ux-neutral-color px-1">
                {t('builder_automations_recommended_section', undefined, 'Recommended Automations')}
              </text.p>
              <div className="h-px flex-1 bg-intents-ux-box-borderColor" />
            </div>
            <div className="flex flex-col gap-2">
              {defaultAutomations.filter(a => !addedNames.has(a.name) && !scheduleByDefnRef[a.id]).map(function renderDefault(automation) {
                return (
                  <AutomationCard
                    key={automation.id}
                    appId={appId}
                    automation={automation}
                    onRun={handleRunRecommended}
                    onAdd={handleAddRecommended}
                    onSchedule={handleScheduleRequest}
                    onViewAllRuns={setViewingRunsFor}
                    isRunning={isAgentBusy || schedulesLoading}
                    isAdding={savingIds.has(automation.id)}
                    schedulingEnabled={canManageSchedules}
                    schedulingComingSoon={scheduleComingSoon}
                    activeSchedule={scheduleByDefnRef[automation.id]}
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
      {schedulingAutomation && (() => {
        const activeSchedule = scheduleByDefnRef[schedulingAutomation.id]
        const initialSchedule = activeSchedule?.cronExpr
          ? cronExprToScheduleConfig(activeSchedule.cronExpr) ?? undefined
          : undefined
        return (
          <AutomationScheduleModal
            isOpen
            automation={schedulingAutomation}
            initialSchedule={initialSchedule}
            hasExistingSchedule={!!activeSchedule}
            saving={isSavingSchedule || isCancellingSchedule}
            onSave={handleScheduleConfirm}
            onRemoveSchedule={() => void handleScheduleCancel(schedulingAutomation)}
            onClose={() => setSchedulingAutomation(null)}
          />
        )
      })()}
      </div>
    </div>
  )
}
