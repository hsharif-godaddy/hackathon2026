'use client';

import { QRCodeSVG } from 'qrcode.react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SegmentedController,
  SegmentedControllerItem,
} from '@airo-ux/pattern-library/_vendor/segmented-controller';
import Button from '@ux/button';
import FieldFrame from '@ux/field-frame';
import AlertIcon from '@ux/icon/alert';
import CheckmarkIcon from '@ux/icon/checkmark';
import ChevronDownIcon from '@ux/icon/chevron-down';
import ClockIcon from '@ux/icon/clock';
import CopyIcon from '@ux/icon/copy';
import LinkIcon from '@ux/icon/link';
import LockedIcon from '@ux/icon/locked';
import ShowIcon from '@ux/icon/show';
import WindowNewIcon from '@ux/icon/window-new';
import WorldIcon from '@ux/icon/world';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextEntry from '@ux/text-entry';

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
import { cn } from '@/lib/utils';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { logClickEvent } from '@/utils/instrumentation';
import { withPreviewParam } from '@/utils/previewUrl';
import { hasBeenPublished } from '@/utils/site';

type SegmentId = 'published' | 'preview';
type PreviewLinkType = 'public' | 'private';

const PUBLIC_LINK_DAYS = 7;

type TranslateFn = (key: string, values?: Record<string, unknown>) => string;

function getPreviewLinkOptions(t: TranslateFn) {
  return [
    {
      value: 'private' as const,
      label: t('builder_share_link_access_private_label'),
      icon: LockedIcon,
    },
    {
      value: 'public' as const,
      label: t('builder_share_link_access_public_label'),
      icon: WorldIcon,
    },
  ];
}

/**
 * Pick the URL we copy to the clipboard for a given share token.
 */
function resolveShareUrl(
  token: Pick<ShareToken, 'token' | 'shareUrl'>,
  origin: string = typeof window === 'undefined' ? '' : window.location.origin
): string {
  if (!token.shareUrl) {
    logger.warn('share-link.resolveShareUrl.fallback', { shareTokenSuffix: token.token.slice(-4) });
  }
  return token.shareUrl ?? `${origin}?airoShareToken=${token.token}`;
}

interface HelperTextProps {
  children: string;
}

function HelperText({ children }: HelperTextProps) {
  return <text.p size={-1} text={children} />;
}

function LoadingSpinner({ testId }: { testId?: string }) {
  return (
    <div className="flex items-center justify-center py-2" data-testid={testId}>
      <Spinner />
    </div>
  );
}

interface UrlActionsSectionProps {
  inputId: string;
  url: string;
  copied: boolean;
  onCopy: () => void;
  onOpen: () => void;
  copyLabel: string;
  copiedLabel: string;
  openLabel: string;
}

function UrlActionsSection({ inputId, url, copied, onCopy, onOpen, copyLabel, copiedLabel, openLabel }: UrlActionsSectionProps) {
  return (
    <FieldFrame stretch data-testid="share-link-input">
      <TextEntry
        id={inputId}
        value={url}
        visualSize="sm"
        readOnly
        stretch
        className="[&_.ux-text-entry-field]:truncate"
      />
      <div className="flex items-center gap-0.5 pe-0.5">
        <IconButton
          icon={copied ? <CheckmarkIcon className="size-2" /> : <CopyIcon className="size-2" />}
          label={copied ? copiedLabel : copyLabel}
          onClick={onCopy}
          type="button"
          size="sm"
          inverted
          showLabelWhenActive={false}
          data-testid="share-link-copy"
        />
        <IconButton
          icon={<WindowNewIcon className="size-2" />}
          label={openLabel}
          onClick={onOpen}
          type="button"
          size="sm"
          inverted
          showLabelWhenActive={false}
          data-testid="share-link-open"
        />
      </div>
    </FieldFrame>
  );
}

interface QRSectionProps {
  url: string;
  caption: string;
}

function QRSection({ url, caption }: QRSectionProps) {
  const qrUrl = useMemo(() => {
    try {
      const tagged = new URL(url);
      tagged.searchParams.set('ref', 'qr');
      return tagged.toString();
    } catch {
      return url;
    }
  }, [url]);

  return (
    <div className="flex items-center gap-1 mt-1">
      <text.span as="caption" size={-1} emphasis="passive" className="text-center" text={caption} />
      <QRCodeSVG
        value={qrUrl}
        size={128}
        level="M"
        className="shrink-0"
        data-testid="share-link-qr"
      />
    </div>
  );
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function formatTimeRemaining(expiresAt: number, t: TranslateFn, now: number = Date.now()): string | null {
  const remaining = expiresAt - now;
  if (remaining <= 0) return null;

  if (remaining >= MS_PER_DAY) {
    return t('builder_share_link_expires_days', { count: Math.floor(remaining / MS_PER_DAY) });
  }
  if (remaining >= MS_PER_HOUR) {
    return t('builder_share_link_expires_hours', { count: Math.floor(remaining / MS_PER_HOUR) });
  }
  return t('builder_share_link_expires_mins', { count: Math.max(1, Math.floor(remaining / MS_PER_MINUTE)) });
}

interface TokenExpiryStatusProps {
  expiresAt: number;
  onExpired?: () => void;
  t: TranslateFn;
}

function TokenExpiryStatus({ expiresAt, onExpired, t }: TokenExpiryStatusProps) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (expiresAt - Date.now() <= 0) {
      onExpired?.();
      return;
    }

    let id: ReturnType<typeof setTimeout>;

    function tick() {
      const current = Date.now();
      setNow(current);
      const remaining = expiresAt - current;
      if (remaining <= 0) {
        onExpired?.();
        return;
      }
      const cadence = remaining >= MS_PER_DAY ? MS_PER_HOUR : MS_PER_MINUTE;
      id = setTimeout(tick, Math.min(remaining, cadence));
    }

    const firstRemaining = expiresAt - Date.now();
    const firstCadence = firstRemaining >= MS_PER_DAY ? MS_PER_HOUR : MS_PER_MINUTE;
    id = setTimeout(tick, Math.min(firstRemaining, firstCadence));
    return () => clearTimeout(id);
  }, [expiresAt, onExpired]);

  const label = formatTimeRemaining(expiresAt, t, now);
  if (!label) return null;

  return (
    <div
      className="flex items-center gap-1 rounded-md bg-intents-ux-boxLowContrast-backgroundColor px-2 py-1"
      data-testid="share-link-token-expiry"
    >
      <ClockIcon className="size-2.5 shrink-0 opacity-60" />
      <text.span size={-1} text={label} />
    </div>
  );
}

interface PreviewLinkDropdownProps {
  value: PreviewLinkType;
  onChange: (value: PreviewLinkType) => void;
  t: TranslateFn;
}

function PreviewLinkDropdown({ value, onChange, t }: PreviewLinkDropdownProps) {
  const [open, setOpen] = useState(false);
  const options = getPreviewLinkOptions(t);
  const selected = options.find((option) => option.value === value)
    ?? options[0];

  function optionClick(optionValue: PreviewLinkType) {
    return function selectOption() {
      onChange(optionValue);
      setOpen(false);
    };
  }

  return (
    <div className="w-full" data-testid="share-link-access-level">
      <text.span as="label" size={-2} text={t('builder_share_link_who_can_access')} />
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-1 rounded-md border border-border mt-0.5 px-2 py-1',
              'text-left text-sm hover:bg-intents-ux-boxHighContrast-backgroundColor/10',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            aria-expanded={open}
            data-testid="share-link-access-level-trigger"
          >
            <selected.icon className="size-2.5 shrink-0" />
            <text.span size={-1} className="flex-1" text={selected.label} />
            <ChevronDownIcon className="size-2.5 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] rounded-md p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                'flex w-full items-center gap-1 rounded-md p-1 text-left transition-colors',
                'hover:bg-intents-ux-boxLowContrast-backgroundColor',
                'focus:outline-none focus-visible:bg-intents-ux-boxLowContrast-backgroundColor',
                value === option.value && 'bg-intents-ux-boxHighContrast-backgroundColor/5',
              )}
              onClick={optionClick(option.value)}
              data-testid={`share-link-access-level-${option.value}`}
            >
              <option.icon className="size-2.5 shrink-0" />
              <text.span size={-1} text={option.label} className="flex-1 min-w-0" />
              {value === option.value && <CheckmarkIcon className="size-2.5 shrink-0" />}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface PublishedContentProps {
  url: string;
  helperText: string;
  isLoading: boolean;
  copied: boolean;
  onCopy: () => void;
  onOpen: () => void;
  showQR: boolean;
  t: TranslateFn;
}

function ContentWrapper({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <div data-testid={testId} className="flex w-full min-w-0 flex-col gap-1">
      {children}
    </div>
  );
}

function PublishedContent({ url, helperText, isLoading, copied, onCopy, onOpen, showQR, t }: PublishedContentProps) {
  return (
    <ContentWrapper testId="share-link-published-content">
      <HelperText>{helperText}</HelperText>
      <hr className="w-full my-1" />

      {isLoading ? (
        <LoadingSpinner testId="share-link-published-loading" />
      ) : (
        <>
          <UrlActionsSection
            inputId="published-url"
            url={url}
            copied={copied}
            onCopy={onCopy}
            onOpen={onOpen}
            copyLabel={t('builder_share_link_copy')}
            copiedLabel={t('builder_share_link_copied')}
            openLabel={t('builder_common_open_new_tab')}
          />
          {url && showQR && <QRSection url={url} caption={t('builder_share_link_qr_text')} />}
        </>
      )}
    </ContentWrapper>
  );
}

interface PreviewContentProps {
  helperText: string;
  linkType: PreviewLinkType;
  onLinkTypeChange: (value: PreviewLinkType) => void;
  url: string;
  copied: boolean;
  onCopy: () => void;
  onOpen: () => void;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
  isShareLinksEnabled: boolean;
  showQR: boolean;
  tokenExpiresAt: number | undefined;
  onTokenExpired?: () => void;
  t: TranslateFn;
}

function PreviewContent({
  helperText,
  linkType,
  onLinkTypeChange,
  url,
  copied,
  onCopy,
  onOpen,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  isShareLinksEnabled,
  showQR,
  tokenExpiresAt,
  onTokenExpired,
  t,
}: PreviewContentProps) {
  return (
    <ContentWrapper testId="share-link-preview-content">
      <HelperText>{helperText}</HelperText>
      {isShareLinksEnabled && <PreviewLinkDropdown value={linkType} onChange={onLinkTypeChange} t={t} />}
      {linkType === 'public' && tokenExpiresAt && (
        <TokenExpiryStatus expiresAt={tokenExpiresAt} onExpired={onTokenExpired} t={t} />
      )}
      <hr className="w-full my-1" />

      {isLoading && <LoadingSpinner testId="share-link-preview-loading" />}

      {!isLoading && isError && (
        <div className="flex items-start justify-center gap-1" data-testid="share-link-error-state">
          <AlertIcon className="text-intents-ux-feedbackHighContrastCritical-feedbackColor shrink-0" />
          <span>
            <text.span size={-1} text={errorMessage} />
            {' '}
            <Button
              design="inline"
              size="sm"
              text={t('builder_common_try_again')}
              onClick={onRetry}
            />
          </span>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <UrlActionsSection
            inputId="preview-url"
            url={url}
            copied={copied}
            onCopy={onCopy}
            onOpen={onOpen}
            copyLabel={t('builder_share_link_copy')}
            copiedLabel={t('builder_share_link_copied')}
            openLabel={t('builder_common_open_new_tab')}
          />
          {url && showQR && <QRSection url={url} caption={t('builder_share_link_qr_text')} />}
        </>
      )}
    </ContentWrapper>
  );
}

interface ShareLinkProps {
  location?: string;
}

export default function ShareLink({ location = 'develop' }: ShareLinkProps) {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);
  const [open, setOpen] = useState(false);
  const [segment, setSegment] = useState<SegmentId>('preview');
  const [previewLinkType, setPreviewLinkType] = useState<PreviewLinkType>('private');
  const [copied, setCopied] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const site = useDevelopPageStore((state) => state.site);
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const previewUrl = site?.preview_url;
  const publishedUrl = site?.published_url;
  const isPublished = hasBeenPublished(site);
  const isShareLinksEnabled = !!useSwitchboard('appbuilder-share-links');
  const isPreviewHeaderEnabled = useSwitchboard('appbuilder-preview-header') === true;

  const {
    data: tokens = [],
    isLoading: isTokensLoading,
    isError: isTokensError,
    refetch: refetchTokens,
  } = useShareTokens(appId, {
    enabled: !!appId && isShareLinksEnabled && open,
  });
  const createToken = useCreateShareToken();

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setCopied(false);
      setCreateError(false);
      setRetryCount(0);
      setTokenExpired(false);
      setPreviewLinkType('private');
      setSegment(isPublished ? 'published' : 'preview');
    }
    prevOpenRef.current = open;
  }, [open, isPublished]);

  const [tokenExpired, setTokenExpired] = useState(false);
  useEffect(() => {
    if (tokenExpired) setTokenExpired(false);
  }, [tokens]);  
  const activeToken = useMemo(
    () => {
      if (tokenExpired) return undefined;
      return tokens.find((token) => token.expiresAt > Date.now());
    },
    [tokens, tokenExpired]
  );

  const sessionUrl = previewUrl ?? '';
  const shareUrl = activeToken ? resolveShareUrl(activeToken) : '';

  const isPublishedSection = isPublished && segment === 'published';
  const isPreviewPublic = previewLinkType === 'public';

  const displayUrl = useMemo(() => {
    if (isPublishedSection) return publishedUrl ?? '';
    return isPreviewPublic ? shareUrl : sessionUrl;
  }, [isPublishedSection, publishedUrl, isPreviewPublic, shareUrl, sessionUrl]);

  const { changesSincePublish, isLoading: isSyncLoading, isError: isSyncError } =
    usePublishSyncState({
      appId,
      enabled: !!appId && isPublished && open,
    });

  const isDisabled = !previewUrl && !isPublished;
  const isPreviewError = isPreviewPublic && (isTokensError || createError);
  const isPreviewLoading = isPreviewPublic && !isPreviewError && !activeToken;

  const logEvent = (eventName: string, payload?: Record<string, unknown>) => {
    try {
      logClickEvent(eventName, { ...clickContext, ...payload })();
    } catch (err) {
      logger.warn('share-link.clickLogFailure', {
        event: eventName,
        message: err instanceof Error ? err.message : 'Unknown instrumentation error',
      });
    }
  };

  useEffect(() => {
    if (!open || !isPreviewPublic || !isShareLinksEnabled || !appId || isPublishedSection) return;
    if (isTokensError || createError) return;
    if (activeToken || isTokensLoading || createToken.isPending) return;

    let cancelled = false;

    async function createLink() {
      setCreateError(false);
      try {
        await createToken.mutateAsync({ appId, expiresInDays: PUBLIC_LINK_DAYS });
      } catch (err) {
        if (cancelled) return;
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        const httpStatus = err instanceof ShareTokenError ? err.status : undefined;
        logger.warn('share-link.publicPreview.createError', {
          message: errorMessage,
          status: httpStatus,
          appId,
        });

        if (httpStatus === 409) {
          try {
            const { data } = await refetchTokens();
            if (!cancelled && !data?.some((tk) => tk.expiresAt > Date.now())) {
              setCreateError(true);
            }
          } catch {
            if (!cancelled) setCreateError(true);
          }
        } else {
          setCreateError(true);
        }
      }
    }

    createLink();

    return () => { cancelled = true; };
  }, [open, isPreviewPublic, isShareLinksEnabled, appId, isPublishedSection, activeToken, isTokensLoading, createToken.isPending, createToken.mutateAsync, refetchTokens, retryCount]);

  const handleRetry = () => {
    setCreateError(false);
    logEvent(`${location}.share_link.retry`);
    if (isTokensError) {
      refetchTokens();
    } else {
      setRetryCount((c) => c + 1);
    }
  };

  const handleCopy = async () => {
    if (!displayUrl) return;
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      logEvent(`${location}.share_link.copy`, { type: isPublishedSection ? 'published' : previewLinkType });
    } catch (err) {
      logger.warn('share-link.copy.failure', {
        message: err instanceof Error ? err.message : 'Clipboard API unavailable',
      });
    }
  };

  const handleOpen = () => {
    if (!displayUrl) return;
    logEvent(`${location}.share_link.open_url`, { type: isPublishedSection ? 'published' : previewLinkType });
    const openUrl = !isPublishedSection && isPreviewHeaderEnabled
      ? withPreviewParam(displayUrl)
      : displayUrl;
    window.open(openUrl, '_blank', 'noopener,noreferrer');
  };

  const handleLinkTypeChange = (value: PreviewLinkType) => {
    setPreviewLinkType(value);
    setCopied(false);
    setCreateError(false);
    logEvent(`${location}.share_link.tab_switch`, { tab: value });
  };

  const handleSegmentChange = (value: string) => {
    setSegment(value as SegmentId);
    setCopied(false);
    logEvent(`${location}.share_link.tab_switch`, { tab: value });
  };

  const getPublishedSyncText = (): string => {
    if (isSyncLoading) return '\u2026';
    if (isSyncError) return t('builder_share_link_published_last_version');
    if (changesSincePublish === 0) return t('builder_share_link_published_in_sync');
    return t('builder_share_link_published_stale', { count: changesSincePublish });
  };

  const getPreviewHelperText = (): string => {
    if (!isPublished) return t('builder_share_link_preview_latest');
    if (isSyncLoading) return '\u2026';
    if (isSyncError || changesSincePublish > 0) return t('builder_share_link_preview_unpublished');
    return t('builder_share_link_preview_matches');
  };

  const getPreviewErrorMessage = (): string => {
    if (isTokensError) return t('builder_share_link_error_load');
    return t('builder_share_link_error_create');
  };

  const previewContent = (
    <PreviewContent
      helperText={getPreviewHelperText()}
      linkType={previewLinkType}
      onLinkTypeChange={handleLinkTypeChange}
      url={displayUrl}
      copied={copied}
      onCopy={handleCopy}
      onOpen={handleOpen}
      isLoading={isPreviewLoading}
      isError={isPreviewError}
      errorMessage={getPreviewErrorMessage()}
      onRetry={handleRetry}
      isShareLinksEnabled={isShareLinksEnabled}
      showQR={!isMobile}
      tokenExpiresAt={activeToken?.expiresAt}
      onTokenExpired={() => setTokenExpired(true)}
      t={t}
    />
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          icon={<LinkIcon className="size-2.5 rtl:scale-x-[-1]" />}
          label={t('builder_share_link_tooltip')}
          showLabelWhenActive={false}
          type="button"
          onClick={() => {
            setOpen((wasOpen) => {
              if (!wasOpen) {
                logEvent(`${location}.share_link.open`);
              }
              return !wasOpen;
            });
          }}
          disabled={isDisabled}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid="share-link-button"
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-[320px] min-w-0 flex-col gap-0.5 px-3 py-2"
        data-testid="share-link-popover"
      >
        {!isPublished && (
          <text.span as="title" size={-2} text={t('builder_common_preview')} />
        )}
        {isPublished ? (
          <>
            <SegmentedController
              aria-label={t('builder_share_link_segment_label')}
              value={segment}
              onSelectionChange={handleSegmentChange}
              data-testid="share-link-segment"
              className={cn('mt-1.5 mb-1.5 self-start', isPublished && 'mt-0')}
            >
              <SegmentedControllerItem
                value="published"
                icon={<WorldIcon className="size-2" />}
              >
                {t('builder_common_published')}
              </SegmentedControllerItem>
              <SegmentedControllerItem
                value="preview"
                icon={<ShowIcon className="size-2" />}
              >
                {t('builder_common_preview')}
              </SegmentedControllerItem>
            </SegmentedController>

            {segment === 'published' ? (
              <PublishedContent
                url={publishedUrl ?? ''}
                helperText={getPublishedSyncText()}
                isLoading={isSyncLoading}
                copied={copied}
                onCopy={handleCopy}
                onOpen={handleOpen}
                showQR={!isMobile}
                t={t}
              />
            ) : (
              previewContent
            )}
          </>
        ) : (
          previewContent
        )}
      </PopoverContent>
    </Popover>
  );
}
