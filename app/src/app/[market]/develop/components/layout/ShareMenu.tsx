'use client';

import { useMemo, useState } from 'react';
import Button from '@ux/button';
import CopyIcon from '@ux/icon/copy';
import ShareIcon from '@ux/icon/share';
import Spinner from '@ux/spinner';

import IconButton from '@/app/[market]/develop/components/IconButton';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import type { ShareToken } from '@/hooks/useShareTokens';
import { useCreateShareToken, useShareTokens } from '@/hooks/useShareTokens';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { logClickEvent } from '@/utils/instrumentation';

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
  origin: string = typeof window === 'undefined' ? '' : window.location.origin,
): string {
  return token.shareUrl ?? `${origin}?airoShareToken=${token.token}`;
}

interface ShareMenuProps {
  location?: string;
}

/**
 * Top-toolbar Share button with a popover that lets the customer create a
 * 7-day public share link or copy an existing active one. Hides itself when
 * the appbuilder-share-links Switchboard flag is off.
 *
 * Same data source as the Settings → Share panel ([SharePanel.tsx]); React
 * Query keeps both surfaces in sync.
 */
export default function ShareMenu({ location = 'develop' }: ShareMenuProps) {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const isShareLinksEnabled = useSwitchboard('appbuilder-share-links');

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const {
    data: tokens = [],
    isLoading,
    isError: isTokensError,
  } = useShareTokens(appId, {
    enabled: !!appId && !!isShareLinksEnabled && open,
  });
  const createToken = useCreateShareToken();

  const activeToken = useMemo(
    () => tokens.find((token) => token.expiresAt > Date.now()),
    [tokens],
  );
  const hasActiveToken = !!activeToken;

  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);

  if (!isShareLinksEnabled) return null;

  const handleCreate = async () => {
    if (!appId || hasActiveToken) return;
    try {
      await createToken.mutateAsync({ appId, expiresInDays: 7 });
      // No explicit refetch() — useCreateShareToken's onSuccess already
      // calls queryClient.invalidateQueries on shareTokenKeys.list(appId),
      // which triggers an automatic background refetch.
    } catch {
      // Mutation error surfaced via createToken.isError below; nothing to do here
      return;
    }
    // logClickEvent in its own try/catch so an instrumentation failure
    // is logged at warn (not silently swallowed by the mutation catch
    // above). Aligned with the clipboard error pattern in handleCopy.
    try {
      logClickEvent(`${location}.header.share.create`, clickContext)();
    } catch (err) {
      logger.warn('share.menu.create.clickLogFailure', {
        message: err instanceof Error ? err.message : 'Unknown instrumentation error',
      });
    }
  };

  const handleCopy = () => {
    if (!activeToken) return;
    const shareUrl = resolveShareUrl(activeToken);
    // clipboard.writeText rejects on permission denied / non-HTTPS / not
    // focused; without a catch the rejection floats up as unhandled. Server-
    // side 409 already prevents duplicate-creation; this is just to make the
    // failure observable.
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => {
        logger.warn('share.menu.copy.failure', {
          message: err instanceof Error ? err.message : 'Unknown clipboard error',
        });
      });
    // logClickEvent in its own try/catch — this lives outside the .catch()
    // on the clipboard Promise, so a synchronous throw here would propagate
    // out of onClick and prevent setCopied from firing. Match the pattern
    // in handleCreate.
    try {
      logClickEvent(`${location}.header.share.copy`, clickContext)();
    } catch (err) {
      logger.warn('share.menu.copy.clickLogFailure', {
        message: err instanceof Error ? err.message : 'Unknown instrumentation error',
      });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          icon={<ShareIcon className="size-2.5" />}
          label={t('builder_settings_share_title')}
          showLabelWhenActive={false}
          active={open}
          onClick={() => {
            // Match the handleCreate / handleCopy pattern: an instrumentation
            // throw must not propagate out of onClick (which would suppress
            // Radix's popover-toggle wiring on this asChild trigger).
            try {
              logClickEvent(`${location}.header.share.open`, clickContext)();
            } catch (err) {
              logger.warn('share.menu.open.clickLogFailure', {
                message: err instanceof Error ? err.message : 'Unknown instrumentation error',
              });
            }
          }}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid="header-share-button"
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-3">
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold">
            {t('builder_settings_share_title')}
          </div>
          <div className="text-xs">
            {t('builder_settings_share_description')}
          </div>

          {hasActiveToken ? (
            <>
              <Button
                design="primary"
                size="sm"
                icon={<CopyIcon />}
                text={
                  copied ? t('builder_common_copied') : t('builder_settings_share_copy')
                }
                onClick={handleCopy}
                data-testid="header-share-copy-button"
                className="w-full"
              />
              <div className="text-xs">
                {t('builder_settings_share_expires')}:{' '}
                {new Date(activeToken.expiresAt).toLocaleString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </>
          ) : (
            <Button
              design="primary"
              size="sm"
              icon={createToken.isPending || isLoading ? <Spinner size="sm" /> : <ShareIcon />}
              text={t('builder_settings_share_create')}
              onClick={handleCreate}
              // Disabled when:
              //   - mutation is in flight, OR
              //   - appId hasn't resolved yet, OR
              //   - tokens query is loading (would race the server's 409
              //     guard — without the list, hasActiveToken can't be
              //     trusted), OR
              //   - tokens query failed (same reason — we'd treat the
              //     empty default as "no active token" and likely hit a
              //     server 409 on a token that already exists. The error
              //     banner below explains the state to the user.)
              disabled={
                createToken.isPending || !appId || isLoading || isTokensError
              }
              data-testid="header-share-create-button"
              className="w-full"
            />
          )}

          {/* Surface tokens-list fetch errors so a user with an existing
              active token (whose list fetch failed) doesn't see the Create
              button enabled and then hit the server-side 409 with no
              explanation. */}
          {isTokensError && (
            <div className="text-xs" data-testid="header-share-tokens-error">
              {t('builder_settings_share_error')}
            </div>
          )}
          {createToken.isError && (
            <div className="text-xs">
              {t('builder_settings_share_create_error')}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
