'use client';

import type { AdSenseSettings, AdSenseSettingsInput, AdSenseValidationErrors } from '@airo/shared/adsense';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';

export const adsenseSettingsQueryKey = (appId: string | undefined) => ['adsense-settings', appId] as const;

interface AdSenseErrorBody {
  error?: string;
  message?: string;
  fields?: AdSenseValidationErrors;
}

export class AdSenseSettingsError extends Error {
  fields?: AdSenseValidationErrors;
  status?: number;

  constructor(message: string, fields?: AdSenseValidationErrors, status?: number) {
    super(message);
    this.name = 'AdSenseSettingsError';
    this.fields = fields;
    this.status = status;
  }
}

export function getAdSenseSettingsErrorFields(error: unknown): AdSenseValidationErrors | undefined {
  if (error instanceof AdSenseSettingsError) {
    return error.fields;
  }

  if (typeof error === 'object' && error !== null && 'fields' in error) {
    return (error as { fields?: AdSenseValidationErrors }).fields;
  }

  return undefined;
}

async function parseAdSenseError(response: Response, fallback: string): Promise<AdSenseSettingsError> {
  const body = await response.json().catch(async () => {
    const text = await response.text().catch(() => '');
    return text ? { error: text } : {};
  }) as AdSenseErrorBody;

  return new AdSenseSettingsError(
    body.error ?? body.message ?? fallback,
    body.fields,
    response.status,
  );
}

async function fetchAdSenseSettings(appId: string): Promise<AdSenseSettings> {
  const url = await buildDynamicApiUrl('adsense', appId);
  const response = await agentFetch(url, {
    siteId: appId,
    method: 'GET',
  });

  if (!response.ok) {
    throw await parseAdSenseError(response, `Failed to load AdSense settings: ${response.status}`);
  }

  return response.json() as Promise<AdSenseSettings>;
}

async function saveAdSenseSettings(appId: string, input: AdSenseSettingsInput): Promise<AdSenseSettings> {
  const url = await buildDynamicApiUrl('adsense', appId);
  const response = await agentFetch(url, {
    siteId: appId,
    method: 'PUT',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await parseAdSenseError(response, `Failed to save AdSense settings: ${response.status}`);
  }

  return response.json() as Promise<AdSenseSettings>;
}

export function useAdSenseSettings(appId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: adsenseSettingsQueryKey(appId),
    queryFn: () => fetchAdSenseSettings(appId!),
    enabled: !!appId,
    retry: 1,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (input: AdSenseSettingsInput) => {
      if (!appId) {
        throw new AdSenseSettingsError('App ID is required.');
      }

      return saveAdSenseSettings(appId, input);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(adsenseSettingsQueryKey(appId), settings);
      queryClient.invalidateQueries({ queryKey: adsenseSettingsQueryKey(appId) });
    },
  });

  return {
    settings: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    saveSettings: mutation.mutateAsync,
    isSaving: mutation.isPending,
    saveError: mutation.error,
  };
}
