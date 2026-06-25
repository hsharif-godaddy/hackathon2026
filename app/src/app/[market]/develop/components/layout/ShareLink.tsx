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
import CopyIcon from '@ux/icon/copy';
import LinkIcon from '@ux/icon/link';
import ShowIcon from '@ux/icon/show';
import WindowNewIcon from '@ux/icon/window-new';
import WorldIcon from '@ux/icon/world';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextEntry from '@ux/text-entry';

import IconButton from '@/app/[market]/develop/components/IconButton';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { useAppSsoStatus } from '@/hooks/useAppSsoStatus';
import { usePublishSyncState } from '@/hooks/usePublishSyncState';
import type { ShareToken } from '@/hooks/useShareTokens';
import { ShareTokenError, useCreateShareToken, useShareTokens } from '@/hooks/useShareTokens';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import type { SiteInfo } from '@/lib/control-plane/types';
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

const PUBLIC_LINK_DAYS = 7;

/** Match develop-header share popover: white selected pill, purple border, dark text. */
const SHARE_LINK_SEGMENT_CLASS =
  '[--controller-item-bg-selected:var(--background,#fff)] [--controller-item-border-selected:var(--color-ai,#613EA3)] [--controller-item-fg-selected:var(--foreground,#111)]'

// Upper bound on auto-create POSTs per popover-open (reset on reopen and on
// explicit user retry). Backstop guaranteeing the auto-create effect can never
// hammer POST /api/apps/{id}/share — e.g. an HBI-expired session that 401s the
// level-3 create route would otherwise retry on every network round-trip.
const MAX_AUTO_CREATE_ATTEMPTS = 2;

type TranslateFn = (key: string, values?: Record<string, unknown>) => string;

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

/**
 * Whether a token is the one the popover should surface: an unexpired,
 * user-purpose share link. agents returns all purposes for an app newest-first,
 * so without this filter a freshly-minted 15-min `archive_snapshot` hosting
 * token (mhp-core screenshot capture) would sort ahead of the owner's 7-day
 * link and be displayed with a near-immediate expiry (AIROBUILD-2785). An
 * absent purpose defaults to 'user' (the agents schema default).
 */
function isActiveUserToken(token: ShareToken, now: number = Date.now()): boolean {
  return (token.purpose ?? 'user') === 'user' && token.expiresAt > now;
}

interface StatusTextProps {
  children: string;
  centered?: boolean;
}

function StatusText({ children, centered }: StatusTextProps) {
  return <text.p size={-1} text={children} className={cn(centered && 'text-center')} />;
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
    <div className="flex flex-col items-center gap-1 border border-border p-2 rounded-md">
      <QRCodeSVG
        value={qrUrl}
        size={128}
        level="M"
        className="shrink-0"
        data-testid="share-link-qr"
      />
      <text.span as="caption" size={-1} emphasis="passive" className="text-center" text={caption} />
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

interface PublishedContentProps {
  url: string;
  status: string;
  isLoading: boolean;
  copied: boolean;
  onCopy: () => void;
  onOpen: () => void;
  showQR: boolean;
  t: TranslateFn;
}

function ContentWrapper({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <div data-testid={testId} className="flex w-full min-w-0 flex-col gap-2">
      {children}
    </div>
  );
}

function PublishedContent({ url, status, isLoading, copied, onCopy, onOpen, showQR, t }: PublishedContentProps) {
  return (
    <ContentWrapper testId="share-link-published-content">
      <StatusText centered>{status}</StatusText>
      <hr className="w-full" />

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
  status: string;
  centered?: boolean;
  url: string;
  copied: boolean;
  onCopy: () => void;
  onOpen: () => void;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
  showQR: boolean;
  tokenExpiresAt: number | undefined;
  onTokenExpired?: () => void;
  t: TranslateFn;
}

function ShareAccessInfo({ expiresAt, onExpired, t }: { expiresAt?: number; onExpired?: () => void; t: TranslateFn }) {
  const [now, setNow] = useState(Date.now);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    if (!expiresAt) return;
    if (expiresAt - Date.now() <= 0) {
      onExpiredRef.current?.();
      return;
    }

    let id: ReturnType<typeof setTimeout>;

    function tick() {
      const currentTime = Date.now();
      if (!expiresAt || expiresAt - currentTime <= 0) {
        onExpiredRef.current?.();
        return;
      }
      setNow(currentTime);
      const remaining = expiresAt - currentTime;
      const cadence = remaining >= MS_PER_DAY ? MS_PER_HOUR : MS_PER_MINUTE;
      id = setTimeout(tick, Math.min(remaining, cadence));
    }

    const remaining = expiresAt - Date.now();
    const cadence = remaining >= MS_PER_DAY ? MS_PER_HOUR : MS_PER_MINUTE;
    id = setTimeout(tick, Math.min(remaining, cadence));
    return () => clearTimeout(id);
  }, [expiresAt]);

  const expiryText = expiresAt ? formatTimeRemaining(expiresAt, t, now) : null;
  if (!expiryText) return null;

  return (
    <text.span emphasis="passive" data-testid="share-link-access-info" className="!leading-tight">
      <text.span size={-1} text={t('builder_share_link_anyone_can_access')} />
      <text.span size={-1} text=" · " aria-hidden="true" />
      <text.span size={-1} text={expiryText} />
    </text.span>
  );
}

function PreviewContent({
  status,
  centered,
  url,
  copied,
  onCopy,
  onOpen,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  showQR,
  tokenExpiresAt,
  onTokenExpired,
  t,
}: PreviewContentProps) {
  return (
    <ContentWrapper testId="share-link-preview-content">
      <StatusText centered={centered}>{status}</StatusText>
      <hr className="w-full" />

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
          <div className="flex flex-col gap-0.5">
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
            <ShareAccessInfo expiresAt={tokenExpiresAt} onExpired={onTokenExpired} t={t} />
          </div>
          {url && showQR && <QRSection url={url} caption={t('builder_share_link_qr_text')} />}
        </>
      )}
    </ContentWrapper>
  );
}

interface ShareLinkContentProps {
  appId: string | null | undefined;
  site: SiteInfo | null | undefined;
  isMobile: boolean;
  /** When false, data fetching is paused and state resets are skipped. */
  open: boolean;
  location: string;
}

export function ShareLinkContent({ appId, site, isMobile, open, location }: ShareLinkContentProps) {
  const t = useTranslations();
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);
  const [segment, setSegment] = useState<SegmentId>('preview');
  const [copied, setCopied] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auto-create bookkeeping. Refs (not state) on purpose: they must NOT feed the
  // create effect's dependency array. createToken.isPending used to be a
  // dependency, so calling mutateAsync re-ran the effect mid-request — that
  // re-run is what made the old `cancelled` flag swallow create errors and
  // looped POST /api/apps/{id}/share. isCreatingRef replaces the isPending
  // guard; mountedRef replaces `cancelled` for setState-after-unmount safety.
  const isCreatingRef = useRef(false);
  const createAttemptsRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

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
      setSegment(isPublished ? 'published' : 'preview');
      createAttemptsRef.current = 0;
      isCreatingRef.current = false;
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
      return tokens.find((token) => isActiveUserToken(token));
    },
    [tokens, tokenExpired]
  );

  const shareUrl = activeToken ? resolveShareUrl(activeToken) : '';

  const isPublishedSection = isPublished && segment === 'published';

  const publishedDisplayUrl = publishedUrl ?? '';
  const previewDisplayUrl = isShareLinksEnabled ? shareUrl : (previewUrl ?? '');
  const displayUrl = isPublishedSection ? publishedDisplayUrl : previewDisplayUrl;

  const { changesSincePublish, isLoading: isSyncLoading, isError: isSyncError } =
    usePublishSyncState({
      appId,
      enabled: !!appId && isPublished && open,
    });

  // Auth-at-Edge: share links bypass the customer's IdP by design (anyone
  // with the URL can view the preview without signing in). For ent apps
  // where SSO is required, that contradicts the policy. The gate is on
  // `ssoRequired` itself — NOT on `!ssoConfigured` — because even a fully
  // configured SSO setup doesn't justify a no-auth share link.
  const sso = useAppSsoStatus(appId);
  const isDisabled = (!previewUrl && !isPublished) || sso.ssoRequired;
  const isPreviewError = isTokensError || createError;
  const isPreviewLoading = isShareLinksEnabled && !!appId && !isPreviewError && !activeToken;

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
    if (!open || !isShareLinksEnabled || !appId) return;
    if (isTokensError || createError) return;
    if (activeToken || isTokensLoading || isCreatingRef.current) return;

    // Backstop: never auto-create more than MAX_AUTO_CREATE_ATTEMPTS times per
    // popover-open / retry. The guards above are the normal stop conditions
    // (token minted, error latched, request in flight); this guarantees
    // termination even if a dependency starts churning unexpectedly.
    if (createAttemptsRef.current >= MAX_AUTO_CREATE_ATTEMPTS) {
      setCreateError(true);
      return;
    }

    // In-flight guard via a ref so createToken.isPending stays OUT of the
    // dependency array — that was the root of the loop: when isPending was a
    // dep, mutateAsync flipping it false->true re-ran this effect mid-request,
    // running the cleanup and setting the old `cancelled` flag true BEFORE the
    // rejection was caught, so a failed create (e.g. a level-3 401) was
    // swallowed, createError never latched, and the isPending->false settle
    // re-fired the create on every network round-trip.
    isCreatingRef.current = true;
    createAttemptsRef.current += 1;

    async function createLink() {
      try {
        await createToken.mutateAsync({ appId, expiresInDays: PUBLIC_LINK_DAYS });
        // Success: useCreateShareToken's onSuccess invalidates the list; the
        // refetch makes activeToken truthy and the guards above bail.
      } catch (err) {
        // Gated only on still being mounted (mountedRef), never on a per-run
        // flag — latching createError is what stops the auto-create re-firing.
        if (!mountedRef.current) return;
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        const httpStatus = err instanceof ShareTokenError ? err.status : undefined;
        logger.warn('share-link.publicPreview.createError', {
          message: errorMessage,
          status: httpStatus,
          appId,
        });

        if (httpStatus === 409) {
          // Another caller already minted an active token — converge by
          // refetching instead of surfacing an error.
          try {
            const { data } = await refetchTokens();
            if (mountedRef.current && !data?.some((tk) => isActiveUserToken(tk))) {
              setCreateError(true);
            }
          } catch {
            if (mountedRef.current) setCreateError(true);
          }
        } else {
          // 401 (HBI-expired session on the level-3 create route), 5xx, network:
          // terminal for auto-create. Latch the error so the popover shows the
          // retry affordance instead of an endless spinner.
          setCreateError(true);
        }
      } finally {
        isCreatingRef.current = false;
      }
    }

    createLink();
  }, [open, isShareLinksEnabled, appId, activeToken, isTokensLoading, createToken.mutateAsync, refetchTokens, retryCount]);

  const handleRetry = () => {
    setCreateError(false);
    createAttemptsRef.current = 0;
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
      logEvent(`${location}.share_link.copy`, { type: isPublishedSection ? 'published' : 'preview' });
    } catch (err) {
      logger.warn('share-link.copy.failure', {
        message: err instanceof Error ? err.message : 'Clipboard API unavailable',
      });
    }
  };

  const handleOpen = () => {
    if (!displayUrl) return;
    logEvent(`${location}.share_link.open_url`, { type: isPublishedSection ? 'published' : 'preview' });
    const openUrl = !isPublishedSection && isPreviewHeaderEnabled
      ? withPreviewParam(displayUrl)
      : displayUrl;
    window.open(openUrl, '_blank', 'noopener,noreferrer');
  };

  const handleSegmentChange = (value: string) => {
    setSegment(value as SegmentId);
    setCopied(false);
    logEvent(`${location}.share_link.tab_switch`, { tab: value });
  };

  const getPublishedStatus = (): string => {
    if (isSyncLoading) return '\u2026';
    if (isSyncError) return t('builder_share_link_published_last_version');
    if (changesSincePublish === 0) return t('builder_share_link_published_in_sync');
    return t('builder_share_link_published_stale', { count: changesSincePublish });
  };

  const getPreviewStatus = (): string => {
    if (!isPublished) return t('builder_share_link_preview_latest');
    if (isSyncLoading) return '\u2026';
    if (isSyncError || changesSincePublish > 0) return t('builder_share_link_preview_unpublished');
    return t('builder_share_link_preview_matches');
  };

  const getPreviewErrorMessage = (): string => {
    if (isTokensError) return t('builder_share_link_error_load');
    return t('builder_share_link_error_create');
  };

  const renderPreviewContent = (url: string) => (
    <PreviewContent
      status={getPreviewStatus()}
      centered={isPublished}
      url={url}
      copied={copied}
      onCopy={handleCopy}
      onOpen={handleOpen}
      isLoading={isPreviewLoading}
      isError={isPreviewError}
      errorMessage={getPreviewErrorMessage()}
      onRetry={handleRetry}
      showQR={!isMobile}
      tokenExpiresAt={activeToken?.expiresAt}
      onTokenExpired={() => setTokenExpired(true)}
      t={t}
    />
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5">
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
            className={cn('mt-1.5 mb-1.5 self-center', SHARE_LINK_SEGMENT_CLASS, isPublished && 'mt-0')}
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

          <div className="grid">
            <div
              className={cn(
                'col-start-1 row-start-1 min-w-0',
                segment === 'published' ? 'visible' : 'invisible'
              )}
              aria-hidden={segment !== 'published'}
            >
              <PublishedContent
                url={publishedDisplayUrl}
                status={getPublishedStatus()}
                isLoading={isSyncLoading}
                copied={copied}
                onCopy={handleCopy}
                onOpen={handleOpen}
                showQR={!isMobile}
                t={t}
              />
            </div>
            <div
              className={cn(
                'col-start-1 row-start-1 min-w-0',
                segment === 'preview' ? 'visible' : 'invisible'
              )}
              aria-hidden={segment !== 'preview'}
            >
              {renderPreviewContent(previewDisplayUrl)}
            </div>
          </div>
        </>
      ) : (
        renderPreviewContent(displayUrl)
      )}
    </div>
  );
}

interface ShareLinkProps {
  location?: string;
}

export default function ShareLink({ location = 'develop' }: ShareLinkProps) {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const [open, setOpen] = useState(false);

  const site = useDevelopPageStore((state) => state.site);
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const previewUrl = site?.preview_url;
  const isPublished = hasBeenPublished(site);
  // Auth-at-Edge: same gate as the inner ShareLinkContent component — share
  // links bypass the IdP by design, so ent apps where SSO is required must
  // disable mints regardless of preview/publish state.
  const sso = useAppSsoStatus(appId);
  const isDisabled = (!previewUrl && !isPublished) || sso.ssoRequired;

  const logOpen = () => {
    try {
      logClickEvent(`${location}.share_link.open`, appId ? { appId } : undefined)();
    } catch (err) {
      logger.warn('share-link.clickLogFailure', {
        event: `${location}.share_link.open`,
        message: err instanceof Error ? err.message : 'Unknown instrumentation error',
      });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          icon={<LinkIcon className="size-2.5 rtl:scale-x-[-1]" />}
          label={sso.ssoRequired
            ? t('builder_share_link_disabled_sso_required')
            : t('builder_share_link_tooltip')}
          showLabelWhenActive={false}
          type="button"
          onClick={() => {
            setOpen((wasOpen) => {
              if (!wasOpen) {
                logOpen();
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
        className="flex w-[320px] min-w-0 flex-col gap-0.5 p-2"
        data-testid="share-link-popover"
      >
        <ShareLinkContent
          appId={appId}
          site={site}
          isMobile={isMobile}
          open={open}
          location={location}
        />
      </PopoverContent>
    </Popover>
  );
}
