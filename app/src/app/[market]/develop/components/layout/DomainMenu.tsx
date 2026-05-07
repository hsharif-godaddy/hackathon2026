'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@ux/button';
import CheckmarkIcon from '@ux/icon/checkmark';
import CopyIcon from '@ux/icon/copy';
import LinkIcon from '@ux/icon/link';
import WindowNewIcon from '@ux/icon/window-new';
import Tag from '@ux/tag';

import IconButton from '@/app/[market]/develop/components/IconButton';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { usePublishSyncState } from '@/hooks/usePublishSyncState';
import type { ShareToken } from '@/hooks/useShareTokens';
import { useCreateShareToken, useShareTokens } from '@/hooks/useShareTokens';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/lib/shadcn/popover';
import { Separator } from '@/lib/shadcn/separator';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logClickEvent } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';

/**
 * Pick the URL we copy to the clipboard for a given share token. Prefer the
 * server-resolved BFF URL (`token.shareUrl`); fall back to a legacy
 * `<origin>?airoShareToken=…` when the agents service couldn't construct one
 * (e.g. local dev without a cell prefix in the preview hostname).
 *
 * Exported for unit testing.
 */
export function resolveShareUrl(
  token: Pick<ShareToken, 'token' | 'shareUrl'>,
  origin: string = typeof window === 'undefined' ? '' : window.location.origin
): string {
  return token.shareUrl ?? `${origin}?airoShareToken=${token.token}`;
}

export default function DomainMenu() {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout on unmount to prevent state update on unmounted component
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const site = useDevelopPageStore((state) => state.site);
  const previewUrl = site?.preview_url;
  const publishedUrl = site?.published_url;
  const isPublished = hasBeenPublished(site);

  // Share links feature flag
  const isShareLinksEnabled = useSwitchboard('appbuilder-share-links');

  // Share tokens
  const {
    data: tokens = [],
    isLoading: isTokensLoading,
    isError: isTokensError,
  } = useShareTokens(appId, {
    enabled: !!appId && !!isShareLinksEnabled && open,
  });
  const createToken = useCreateShareToken();

  const activeToken = useMemo(
    () => tokens.find((token) => token.expiresAt > Date.now()),
    [tokens]
  );
  const hasActiveToken = !!activeToken;

  // Publish sync state
  const { changesSincePublish, isLoading: isSyncLoading, isError: isSyncError, hasNeverBeenPublished } =
    usePublishSyncState({
      appId,
      enabled: !!appId && isPublished && open,
    });
  const isInSync = changesSincePublish === 0 && !hasNeverBeenPublished;

  // If no URLs available, disable the button
  const isDisabled = !previewUrl && !isPublished;

  const handlePreviewClick = () => {
    if (!previewUrl) return;
    try {
      logClickEvent('develop.header.view_share.preview', clickContext)();
    } catch (err) {
      logger.warn('domain-menu.preview.clickLogFailure', {
        message: err instanceof Error ? err.message : 'Unknown instrumentation error',
      });
    }
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  const handlePublishedClick = () => {
    if (!publishedUrl || !isPublished) return;
    try {
      logClickEvent('develop.header.view_share.published', clickContext)();
    } catch (err) {
      logger.warn('domain-menu.published.clickLogFailure', {
        message: err instanceof Error ? err.message : 'Unknown instrumentation error',
      });
    }
    window.open(publishedUrl, '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  const handleCreateShareLink = async () => {
    if (!appId || hasActiveToken) return;
    try {
      await createToken.mutateAsync({ appId, expiresInDays: 7 });
    } catch (err) {
      logger.warn('domain-menu.share-create.mutationError', {
        message: err instanceof Error ? err.message : 'Unknown error',
        appId,
      });
      return;
    }
    try {
      logClickEvent('develop.header.view_share.create', clickContext)();
    } catch (err) {
      logger.warn('domain-menu.share-create.clickLogFailure', {
        message: err instanceof Error ? err.message : 'Unknown instrumentation error',
      });
    }
  };

  const handleCopyShareLink = () => {
    if (!activeToken) return;
    const shareUrl = resolveShareUrl(activeToken);
    setCopyError(false);
    let clipboardPromise: Promise<void>;
    try {
      clipboardPromise = navigator.clipboard.writeText(shareUrl);
    } catch (err) {
      logger.warn('domain-menu.share-copy.syncFailure', {
        message: err instanceof Error ? err.message : 'Clipboard API unavailable',
      });
      setCopyError(true);
      return;
    }
    clipboardPromise
      .then(() => {
        setCopied(true);
        if (copiedTimeoutRef.current) {
          clearTimeout(copiedTimeoutRef.current);
        }
        copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => {
        logger.warn('domain-menu.share-copy.failure', {
          message: err instanceof Error ? err.message : 'Unknown clipboard error',
        });
        setCopyError(true);
      });
    try {
      logClickEvent('develop.header.view_share.copy', clickContext)();
    } catch (err) {
      logger.warn('domain-menu.share-copy.clickLogFailure', {
        message: err instanceof Error ? err.message : 'Unknown instrumentation error',
      });
    }
  };

  const getPublishedHelperText = (): string => {
    if (isSyncLoading) {
      return '...';
    }
    if (isSyncError) {
      return t('builder_view_share_published_status_unavailable');
    }
    if (isInSync) {
      return t('builder_view_share_published_sync');
    }
    return t('builder_view_share_published_stale', { count: changesSincePublish });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          icon={<WindowNewIcon className="size-2.5 rtl:scale-x-[-1]" />}
          label={t('builder_view_share_label')}
          showLabelWhenActive={false}
          onClick={() => {
            try {
              logClickEvent('develop.header.view_share.open', clickContext)();
            } catch (err) {
              logger.warn('domain-menu.open.clickLogFailure', {
                message: err instanceof Error ? err.message : 'Unknown instrumentation error',
              });
            }
            setOpen(!open);
          }}
          disabled={isDisabled}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid="header-view-share-button"
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[300px] p-1"
        data-testid="header-view-share-popover"
      >
        <div className="flex flex-col">
          {/* View Preview */}
          {previewUrl && (
            <button
              type="button"
              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-intents-ux-boxLowContrast-backgroundColor transition-colors cursor-pointer"
              onClick={handlePreviewClick}
              data-testid="header-view-share-preview"
            >
              <span className="flex items-center justify-between">
                <span className="text-sm">{t('builder_view_share_preview')}</span>
                <WindowNewIcon className="size-2 text-intents-ux-feedbackHighContrastPassive-feedbackColor" />
              </span>
              <span className="text-xs text-intents-ux-feedbackHighContrastPassive-feedbackColor block">
                {t('builder_view_share_preview_desc')}
              </span>
            </button>
          )}

          {/* View Published Site */}
          {isPublished ? (
            <button
              type="button"
              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-intents-ux-boxLowContrast-backgroundColor transition-colors cursor-pointer"
              onClick={handlePublishedClick}
              data-testid="header-view-share-published"
            >
              <span className="flex items-center justify-between">
                <span className="text-sm">{t('builder_view_share_published')}</span>
                <WindowNewIcon className="size-2 text-intents-ux-feedbackHighContrastPassive-feedbackColor" />
              </span>
              <span className="text-xs text-intents-ux-feedbackHighContrastPassive-feedbackColor block">
                {getPublishedHelperText()}
              </span>
            </button>
          ) : (
            <div
              className="w-full text-left px-2 py-1.5 opacity-50"
              data-testid="header-view-share-published"
            >
              <span className="flex items-center justify-between">
                <span className="text-sm">{t('builder_view_share_published')}</span>
                <WindowNewIcon className="size-2 text-intents-ux-feedbackHighContrastPassive-feedbackColor" />
              </span>
              <span className="text-xs text-intents-ux-text-base-02 block">
                {t('builder_view_share_published_inactive')}
              </span>
            </div>
          )}

          {/* Share Link Section - gated by feature flag */}
          {isShareLinksEnabled && (
            <>
              <Separator className="my-1" />

              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between mb-0">
                  <span className="text-sm">{t('builder_view_share_section_title')}</span>
                  {!hasActiveToken && <Tag emphasis="neutral" size="sm">{t('builder_view_share_valid_days')}</Tag>}
                </div>
                <p className="text-xs text-intents-ux-feedbackHighContrastPassive-feedbackColor mb-2">
                  {hasActiveToken
                    ? t('builder_view_share_has_link_desc')
                    : t('builder_view_share_no_link_desc')}
                </p>
                {(() => {
                const buttonState = !appId || isTokensError
                  ? 'unavailable'
                  : isTokensLoading
                  ? 'loading'
                  : createToken.isPending
                  ? 'creating'
                  : hasActiveToken
                  ? copied ? 'copied' : 'copy'
                  : 'create';

                const buttonProps = {
                  create:      { text: t('builder_view_share_btn_create'),   icon: <LinkIcon className="size-5" />,      disabled: false,  onClick: handleCreateShareLink },
                  creating:    { text: t('builder_view_share_btn_creating'), icon: undefined,                            disabled: true,   onClick: undefined },
                  loading:     { text: t('builder_common_loading'),          icon: undefined,                            disabled: true,   onClick: undefined },
                  copy:        { text: t('builder_view_share_btn_copy'),     icon: <CopyIcon className="size-5" />,      disabled: false,  onClick: handleCopyShareLink },
                  copied:      { text: t('builder_common_copied'),            icon: <CheckmarkIcon className="size-5" />, disabled: false,  onClick: handleCopyShareLink },
                  unavailable: { text: t('builder_view_share_btn_create'),   icon: <LinkIcon className="size-5" />,      disabled: true,   onClick: undefined },
                }[buttonState];

                return (
                  <Button
                    design="secondary"
                    size="sm"
                    data-testid={hasActiveToken ? 'header-view-share-copy' : 'header-view-share-create'}
                    className="w-full"
                    {...buttonProps}
                  />
                );
              })()}
                {hasActiveToken && (
                  <p
                    className="text-xs text-intents-ux-feedbackHighContrastPassive-feedbackColor mt-1"
                    data-testid="header-view-share-expiry"
                  >
                    {t('builder_manageplan_expires', {
                      date: new Date(activeToken.expiresAt).toLocaleString(
                        undefined,
                        {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }
                      ),
                    })}
                  </p>
                )}
              </div>

              {/* Error states */}
              {!hasActiveToken && isTokensError && (
                <p
                  className="text-xs text-intents-ux-feedbackHighContrastCritical-feedbackColor px-2 mt-1"
                  data-testid="header-view-share-error"
                >
                  {t('builder_view_share_error_load')}
                </p>
              )}
              {!hasActiveToken && createToken.isError && (
                <p
                  className="text-xs text-intents-ux-feedbackHighContrastCritical-feedbackColor px-2 mt-1"
                  data-testid="header-view-share-create-error"
                >
                  {t('builder_view_share_error_create')}
                </p>
              )}
              {copyError && (
                <p
                  className="text-xs text-intents-ux-feedbackHighContrastCritical-feedbackColor px-2 mt-1"
                  data-testid="header-view-share-copy-error"
                >
                  {t('builder_view_share_error_copy')}
                </p>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
