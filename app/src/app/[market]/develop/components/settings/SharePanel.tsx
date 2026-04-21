'use client';

import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import CopyIcon from '@ux/icon/copy';
import ShareIcon from '@ux/icon/share';
import Spinner from '@ux/spinner';

import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { useCreateShareToken, useShareTokens } from '@/hooks/useShareTokens';
import { useTranslations } from '@/hooks/useTranslations';

/**
 * Share Panel component for managing shareable preview links
 *
 * Allows users to create time-limited share tokens that provide
 * public access to preview apps without SSO authentication.
 */
export default function SharePanel() {
  const t = useTranslations();
  const appId = useAppIdFromParams();

  const { data: tokens = [], isLoading, error, refetch } = useShareTokens(appId);
  const createToken = useCreateShareToken();

  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  /**
   * Handle creating a new share token
   */
  const handleCreate = async () => {
    if (!appId) return;

    try {
      await createToken.mutateAsync({
        appId,
        expiresInDays: 7,
      });
      await refetch();
    } catch (err) {
      console.error('Failed to create share token:', err);
    }
  };

  /**
   * Handle copying share link to clipboard
   */
  const handleCopy = async (tokenObj: { token: string; shareUrl?: string }) => {
    // Use shareUrl from API if available, otherwise fallback to window origin
    const shareUrl = tokenObj.shareUrl || `${window.location.origin}?airoShareToken=${tokenObj.token}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopiedToken(tokenObj.token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  /**
   * Format expiration date
   */
  const formatExpiration = (expiresAt: number) => {
    const date = new Date(expiresAt);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Box gap="lg" className="@container">
      <SettingsSection
        title={t('builder_settings_share_title')}
        description={t('builder_settings_share_description')}
        button={
          <Button
            size="sm"
            text={t('builder_settings_share_create')}
            design="primary"
            icon={<ShareIcon />}
            onClick={handleCreate}
            disabled={createToken.isPending || !appId}
          />
        }
        hideStatus
      >
        {isLoading ? (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        ) : error ? (
          <div>{t('builder_settings_share_error')}</div>
        ) : tokens.length === 0 ? (
          <div className="italic">
            {t('builder_settings_share_empty')}
          </div>
        ) : (
          <Box orientation="vertical" gap="md" className="pt-2">
            {!isLoading && createToken.isPending && (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            )}
            {tokens.map((token) => (
              <div
                key={token.token}
                className="flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <div
                      className="text-sm font-bold font-mono break-all"
                    >
                      {token.token}
                    </div>
                    <div className="text-xs">
                      {t('builder_settings_share_expires')}: {formatExpiration(token.expiresAt)}
                    </div>
                    {token.firstUsedAt && (
                      <div className="text-xs">
                        {t('builder_settings_share_first_used')}: {new Date(token.firstUsedAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    )}
                  </div>

                  <Button
                    design="secondary"
                    size="sm"
                    icon={<CopyIcon />}
                    text={copiedToken === token.token ? t('builder_common_copied') : t('builder_settings_share_copy')}
                    onClick={() => handleCopy(token)}
                  />
                </div>
              </div>
            ))}
          </Box>
        )}

        {createToken.isError && (
          <div className="mt-2">
            {t('builder_settings_share_create_error')}
          </div>
        )}
      </SettingsSection>
    </Box>
  );
}
