'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import CheckmarkIcon from '@ux/icon/checkmark';
import CopyIcon from '@ux/icon/copy';
import WindowNewIcon from '@ux/icon/window-new';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import IconButton from '@/app/[market]/develop/components/IconButton';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { usePublishSyncState } from '@/hooks/usePublishSyncState';
import type { ShareToken } from '@/hooks/useShareTokens';
import { ShareTokenError, useCreateShareToken, useShareTokens } from '@/hooks/useShareTokens';
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

type TranslationFn = (key: string, values?: Record<string, unknown>, fallback?: string) => string;

/**
 * Get the share label with countdown based on token expiry.
 * Shows "Share this link for X days/hours/mins" format.
 *
 * Exported for unit testing.
 */
export function getShareLabel(token: ShareToken | undefined, t: TranslationFn): string {
  if (!token) {
    return t('builder_view_share_link_label_days', { count: 7 });
  }
  const msRemaining = token.expiresAt - Date.now();
  if (msRemaining <= 0) {
    return t('builder_view_share_link_label_mins', { count: 0 });
  }

  const ONE_MINUTE = 1000 * 60;
  const ONE_HOUR = ONE_MINUTE * 60;
  const ONE_DAY = ONE_HOUR * 24;

  // Use >= thresholds for unit selection, floor for display value (clamp at 1 for non-expired)
  if (msRemaining >= ONE_DAY) {
    const daysRemaining = Math.max(1, Math.floor(msRemaining / ONE_DAY));
    return daysRemaining === 1
      ? t('builder_view_share_link_label_day')
      : t('builder_view_share_link_label_days', { count: daysRemaining });
  }
  if (msRemaining >= ONE_HOUR) {
    const hoursRemaining = Math.max(1, Math.floor(msRemaining / ONE_HOUR));
    return hoursRemaining === 1
      ? t('builder_view_share_link_label_hour')
      : t('builder_view_share_link_label_hours', { count: hoursRemaining });
  }
  const minsRemaining = Math.max(1, Math.floor(msRemaining / ONE_MINUTE));
  return minsRemaining === 1
    ? t('builder_view_share_link_label_min')
    : t('builder_view_share_link_label_mins', { count: minsRemaining });
}

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
  const [createError, setCreateError] = useState(false);
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

  // Share tokens - fetch when popover opens
  const {
    data: tokens = [],
    isError: isTokensError,
    refetch: refetchTokens,
  } = useShareTokens(appId, {
    enabled: !!appId && !!isShareLinksEnabled && open,
  });
  const createToken = useCreateShareToken();

  // Reset error state when popover opens
  useEffect(() => {
    if (open) {
      setCopyError(false);
      setCreateError(false);
    }
  }, [open]);

  const activeToken = useMemo(
    () => tokens.find((token) => token.expiresAt > Date.now()),
    [tokens]
  );
  const hasActiveToken = !!activeToken;

  // Cosmetic URL preview (before token exists)
  const cosmeticUrl = useMemo(() => {
    if (!previewUrl) return '';
    try {
      const url = new URL(previewUrl);
      return `${url.origin}/...`;
    } catch {
      return previewUrl;
    }
  }, [previewUrl]);

  // Actual share URL (when token exists)
  const shareUrl = useMemo(
    () => (activeToken ? resolveShareUrl(activeToken) : cosmeticUrl),
    [activeToken, cosmeticUrl]
  );

  // Publish sync state
  const { changesSincePublish, isLoading: isSyncLoading, isError: isSyncError } =
    usePublishSyncState({
      appId,
      enabled: !!appId && isPublished && open,
    });

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

  /**
   * Handle copy button click with lazy token creation.
   * If no token exists, creates one first, then copies.
   */
  const handleCopyClick = async () => {
    if (!appId) return;
    setCopyError(false);
    setCreateError(false);

    let tokenToCopy = activeToken;

    // Lazy token creation: create if none exists
    if (!tokenToCopy) {
      try {
        const result = await createToken.mutateAsync({ appId, expiresInDays: 7 });
        tokenToCopy = result;
        try {
          logClickEvent('develop.header.view_share.create', clickContext)();
        } catch (err) {
          logger.warn('domain-menu.share-create.clickLogFailure', {
            message: err instanceof Error ? err.message : 'Unknown instrumentation error',
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        const httpStatus = err instanceof ShareTokenError ? err.status : undefined;
        logger.warn('domain-menu.share-create.mutationError', {
          message: errorMessage,
          status: httpStatus,
          appId,
        });

        // Handle 409 conflict: token already exists (race condition or stale cache)
        // Refetch tokens and try to copy the existing one
        if (httpStatus === 409) {
          logger.info('domain-menu.share-create.conflict-recovery', { appId });
          try {
            const { data: refreshedTokens } = await refetchTokens();
            const existingToken = refreshedTokens?.find((t) => t.expiresAt > Date.now());
            if (existingToken) {
              tokenToCopy = existingToken;
            } else {
              setCreateError(true);
              return;
            }
          } catch {
            setCreateError(true);
            return;
          }
        } else {
          setCreateError(true);
          return;
        }
      }
    }

    // Copy to clipboard
    const urlToCopy = resolveShareUrl(tokenToCopy);
    try {
      await navigator.clipboard.writeText(urlToCopy);
      setCopied(true);
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      try {
        logClickEvent('develop.header.view_share.copy', clickContext)();
      } catch (err) {
        logger.warn('domain-menu.share-copy.clickLogFailure', {
          message: err instanceof Error ? err.message : 'Unknown instrumentation error',
        });
      }
    } catch (err) {
      logger.warn('domain-menu.share-copy.failure', {
        message: err instanceof Error ? err.message : 'Clipboard API unavailable',
      });
      setCopyError(true);
    }
  };

  const getPublishedHelperText = (): string => {
    if (isSyncLoading) {
      return '...';
    }
    if (isSyncError) {
      return t('builder_view_share_published_status_unavailable');
    }
    if (changesSincePublish === 0) {
      return t('builder_view_share_published_no_changes');
    }
    return t('builder_view_share_published_stale', { count: changesSincePublish });
  };

  // Copy button state machine
  const getCopyButtonState = (): 'ready' | 'creating' | 'copied' | 'idle' => {
    if (createToken.isPending) return 'creating';
    if (copied) return 'copied';
    if (hasActiveToken) return 'idle';
    return 'ready';
  };

  const copyButtonState = getCopyButtonState();

  // Error message for TextInput (don't disable button - error message is enough feedback)
  const getErrorMessage = (): string | undefined => {
    if (isTokensError) return t('builder_view_share_error_load');
    if (createError) return t('builder_view_share_error_create');
    if (copyError) return t('builder_view_share_error_copy');
    return undefined;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          icon={<WindowNewIcon className="size-2.5 rtl:scale-x-[-1]" />}
          label={t('builder_view_share_tooltip')}
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
          {/* Preview Site */}
          {previewUrl && (
            <button
              type="button"
              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-intents-ux-boxLowContrast-backgroundColor transition-colors cursor-pointer"
              onClick={handlePreviewClick}
              data-testid="header-view-share-preview"
            >
              <span className="flex items-center justify-between">
                <text.div as="action" size={0}>{t('builder_view_share_preview')}</text.div>
                <WindowNewIcon className="size-2 text-intents-ux-feedbackHighContrastPassive-feedbackColor" />
              </span>
              <span className="text-xs text-intents-ux-feedbackHighContrastPassive-feedbackColor block">
                {t('builder_view_share_preview_desc')}
              </span>
            </button>
          )}

          {/* Share Publicly Section - gated by feature flag */}
          {isShareLinksEnabled && (
            <div className="flex flex-col gap-0.5 px-2 pt-0 pb-1.5">
              <text.label
                size={-2}
                emphasis="passive"
                htmlFor="share-link-input"
                as="label"
                data-testid="header-view-share-countdown"
              >
                {getShareLabel(activeToken, t)}
              </text.label>
              <div className="relative">
                <TextInput
                  label={null}
                  id="share-link-input"
                  value={shareUrl}
                  visualSize="sm"
                  readOnly
                  className="[&_#share-link-input]:!w-[80%] [&_#share-link-input]:!ps-1"
                  data-testid="header-view-share-input"
                />
                <div className="absolute end-[5px] top-1/2 -translate-y-1/2 flex gap-0.5 items-center">
                  <IconButton
                    icon={
                      copyButtonState === 'creating' ? (
                        <Spinner size="sm" />
                      ) : copyButtonState === 'copied' ? (
                        <CheckmarkIcon className="size-2" />
                      ) : (
                        <CopyIcon className="size-2" />
                      )
                    }
                    onClick={handleCopyClick}
                    disabled={copyButtonState === 'creating'}
                    label={t('builder_common_copy_clipboard')}
                    size="sm"
                    inverted
                    showLabelWhenActive={false}
                    data-testid="header-view-share-copy"
                  />
                </div>
              </div>
              {getErrorMessage() && (
                <span
                  className="text-xs text-intents-ux-feedbackHighContrastCritical-feedbackColor mt-1 block"
                  data-testid="header-view-share-error"
                >
                  {getErrorMessage()}
                </span>
              )}
            </div>
          )}

          {/* See Published Site - only shown when published */}
          {isPublished && (
            <>
              <Separator className="my-1" />
              <button
                type="button"
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-intents-ux-boxLowContrast-backgroundColor transition-colors cursor-pointer"
                onClick={handlePublishedClick}
                data-testid="header-view-share-published"
              >
                <span className="flex items-center justify-between">
                  <text.div as="action" size={0}>{t('builder_view_share_published')}</text.div>
                  <WindowNewIcon className="size-2 text-intents-ux-feedbackHighContrastPassive-feedbackColor" />
                </span>
                <span className="text-xs text-intents-ux-feedbackHighContrastPassive-feedbackColor block">
                  {getPublishedHelperText()}
                </span>
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
