'use client'

import { useQuery } from '@tanstack/react-query'
import Alert from '@ux/alert'
import Select from '@ux/select'
import Spinner from '@ux/spinner'

import SettingsSection from '@/app/develop/components/settings/SettingsSection'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

interface ProfileInfo {
  name: string
  description: string
  properties: Record<string, string | number | boolean | null>
}

function useAvailableProfiles(siteId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['agent-profiles', siteId],
    queryFn: async () => {
      if (!siteId) throw new Error('No siteId')
      const url = await buildDynamicAgentUrl('profiles', siteId)
      const response = await agentFetch(url, { siteId })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `Failed to fetch profiles (${response.status})`)
      }
      return response.json() as Promise<{ profiles: ProfileInfo[] }>
    },
    enabled: enabled && !!siteId,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

export default function ProfileSelector() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const { data: isEnabled, isLoading: isFlagLoading, error: flagError } = useSwitchboard('appbuilder-agent-profile-selector')

  const selectedProfile = useDevelopPageStore(s => s.selectedProfile)
  const setSelectedProfile = useDevelopPageStore(s => s.setSelectedProfile)

  const { data: profilesData, isLoading: isProfilesLoading, error } = useAvailableProfiles(appId, !!isEnabled)

  if (isFlagLoading) return null
  if (!isEnabled && !flagError) return null

  const profiles = profilesData?.profiles ?? []

  return (
    <SettingsSection
      title={t('builder_settings_agent_profile_title', undefined, 'Agent Profile')}
      hideStatus
      description={t('builder_settings_agent_profile_desc', undefined, 'Override the agent configuration for this project. "Default" uses the standard configuration. Note: profiles that affect initial agent routing (e.g. prompt version) only apply via Switchboard, not this selector.')}
    >
      {flagError ? (
        <Alert emphasis="critical" data-testid="profile-selector-flag-error">
          {t('builder_settings_agent_profile_flag_error', undefined, 'Unable to check profile selector availability')}
        </Alert>
      ) : isProfilesLoading ? (
        <Spinner size="sm" />
      ) : error ? (
        <Alert emphasis="critical" data-testid="profile-selector-error">
          {error.message}
        </Alert>
      ) : (
        <Select
          id="agent-profile-select"
          name="agent-profile"
          label={t('builder_settings_agent_profile_label', undefined, 'Agent Profile')}
          value={selectedProfile ?? ''}
          onChange={(value: string) => setSelectedProfile(value || null)}
          visualSize="md"
          data-testid="profile-selector"
        >
          <option value="">{t('builder_settings_agent_profile_default', undefined, 'Default')}</option>
          {profiles.map((profile) => (
            <option key={profile.name} value={profile.name} title={profile.description}>
              {profile.name}
            </option>
          ))}
        </Select>
      )}
    </SettingsSection>
  )
}
