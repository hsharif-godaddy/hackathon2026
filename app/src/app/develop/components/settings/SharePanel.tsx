'use client';

import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import CopyIcon from '@ux/icon/copy';
import ShareIcon from '@ux/icon/share';
import Spinner from '@ux/spinner';

import { useAppIdFromParams } from '@/app/develop/components/utils';
import BigCard from '@/components/layout/BigCard';
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
    if (!appId) {return;}

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
      <BigCard
        title={t('builder_settings_share_title', undefined, 'Share Preview Links')}
        description={t('builder_settings_share_description', undefined, 'Create shareable links that allow others to preview your app without signing in. Links expire after 7 days.')}
        button={
          <Button
            text={t('builder_settings_share_create', undefined, 'Create Share Link')}
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
          <div className="text-red-600">{t('builder_settings_share_error', undefined, 'Failed to load share links')}</div>
        ) : tokens.length === 0 ? (
          <div className="p-4 rounded-md bg-gray-50 text-gray-500">
            {t('builder_settings_share_empty', undefined, 'No share links yet. Create one to allow others to preview your app.')}
          </div>
        ) : (
          <Box orientation="vertical" gap="md">
            {tokens.map((token) => (
              <div
                key={token.token}
                className="p-3 rounded-md bg-gray-50 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <div
                      className="text-sm font-bold font-mono break-all"
                    >
                      {token.token}
                    </div>
                    <div className="text-xs text-gray-600">
                      {t('builder_settings_share_expires', undefined, 'Expires')}: {formatExpiration(token.expiresAt)}
                    </div>
                    {token.firstUsedAt && (
                      <div className="text-xs text-gray-600">
                        {t('builder_settings_share_first_used', undefined, 'First used')}: {new Date(token.firstUsedAt).toLocaleDateString(undefined, {
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
                    text={copiedToken === token.token ? t('builder_settings_share_copied', undefined, 'Copied!') : t('builder_settings_share_copy', undefined, 'Copy Link')}
                    onClick={() => handleCopy(token)}
                  />
                </div>
              </div>
            ))}
          </Box>
        )}

        {createToken.isError && (
          <div className="text-red-600 mt-2">
            {t('builder_settings_share_create_error', undefined, 'Failed to create share link. Please try again.')}
          </div>
        )}
      </BigCard>
    </Box>
  );
}
