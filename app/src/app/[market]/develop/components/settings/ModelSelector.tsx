'use client'

import { isEmployeeAuthType } from '@airo/shared/auth'
import { useQuery } from '@tanstack/react-query'
import Alert from '@ux/alert'
import Select from '@ux/select'
import Spinner from '@ux/spinner'

import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

interface ModelInfo {
  shortName: string
  fullName: string
  provider: string
  isSupported: boolean
}

function useAvailableModels(siteId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['agent-models', siteId],
    queryFn: async () => {
      if (!siteId) throw new Error('No siteId')
      const url = await buildDynamicAgentUrl('models', siteId)
      const response = await agentFetch(url, { siteId })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `Failed to fetch models (${response.status})`)
      }
      return response.json() as Promise<{ models: ModelInfo[] }>
    },
    enabled: enabled && !!siteId,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

export default function ModelSelector() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const { authState } = useAuthContext()
  // CRM skip / impersonation sessions (e2s, e2s2s) always get the selector,
  // matching the server-side bypass in /api/auth/agent-token and the
  // impersonation patterns used in Feedback.tsx and ChatPane.tsx.
  const isImpersonating = isEmployeeAuthType((authState as any)?.authType)
  const flagEnabled = useSwitchboard('appbuilder-model-selector')
  const isEnabled = isImpersonating || flagEnabled

  const selectedModel = useDevelopPageStore(s => s.selectedModel)
  const setSelectedModel = useDevelopPageStore(s => s.setSelectedModel)

  const { data: modelsData, isLoading: isModelsLoading, error } = useAvailableModels(appId, !!isEnabled)

  if (!isEnabled) return null

  const models = modelsData?.models ?? []

  return (
    <SettingsSection
      title={t('builder_settings_model_override_title', undefined, 'Model Override')}
      hideStatus
      description={t('builder_settings_model_override_desc', undefined, 'Override the AI model for this project. "Default" uses the system-configured model.')}
    >
      {isModelsLoading ? (
        <Spinner size="sm" />
      ) : error ? (
        <Alert emphasis="critical" data-testid="model-selector-error">
          {error.message}
        </Alert>
      ) : (
        <Select
          id="model-override-select"
          name="model-override"
          label={t('builder_settings_model_override_label', undefined, 'AI Model')}
          value={selectedModel ?? ''}
          onChange={(value: string) => setSelectedModel(value || null)}
          visualSize="md"
          data-testid="model-selector"
        >
          <option value="">{t('builder_settings_model_override_default', undefined, 'Default')}</option>
          {models.map((model) => (
            <option key={model.shortName} value={model.shortName}>
              {model.shortName} ({model.provider})
            </option>
          ))}
        </Select>
      )}
    </SettingsSection>
  )
}
