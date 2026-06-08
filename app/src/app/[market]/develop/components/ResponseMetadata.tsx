'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@ux/button';
import Growl from '@ux/growl';
import CheckIcon from '@ux/icon/checkmark';
import ClipboardIcon from '@ux/icon/copy';
import OkIcon from '@ux/icon/ok';
import RevertIcon from '@ux/icon/revert';

import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import type { InvocationFeedbackTraceIds, SubmitFeedbackResult } from '@/lib/feedback-client';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { generateClickEID, logClickEvent } from '@/utils/instrumentation';
import {
  invocationFeedbackActionIconClass,
  invocationFeedbackCompactButtonClass,
  InvocationFeedbackControls,
  InvocationFeedbackPanel,
  InvocationFeedbackProvider,
  invocationFeedbackVoteFromMetadata,
} from './invocation-feedback';

/** Per-turn footer: completion status, copy/undo/restore, and invocation feedback controls. */
export interface ResponseMetadataProps {
  duration: number;
  content: string;
  usedFreeGrants?: boolean;
  messageId: string;
  /**
   * message metadata from the agent message
   * used to hydrate the thumbs up/down state
   * @see {invocationFeedbackVoteFromMetadata}
   */
  messageMetadata?: Record<string, unknown>;
  traceIds?: InvocationFeedbackTraceIds | null;
  /**
   * When provided, an undo button is rendered next to the copy button. Used
   * on the most recent completed assistant turn. `onUndo` takes precedence
   * over `onRestore`: callers pass at most one.
   */
  onUndo?: () => void;
  /**
   * When provided, a restore button is rendered next to the copy button.
   * Used on older assistant turns — callers bind the target commit hash.
   */
  onRestore?: () => void;
}

export default function ResponseMetadata({
  duration,
  content,
  usedFreeGrants,
  messageId,
  messageMetadata,
  traceIds,
  onUndo,
  onRestore,
}: ResponseMetadataProps) {
  const initialFeedback = invocationFeedbackVoteFromMetadata(messageMetadata);
  const t = useTranslations();
  const appId = useDevelopPageStore((state) => state.currentAppId);
  const isMessageContentEmpty = content.trim() === '';
  // NOTE: This is a switchboard feature flag for per-message feedback.
  const enablePerMessageFeedback =
    (useSwitchboard('appbuilder-per-message-feedback') ?? false) && !isMessageContentEmpty;

  /**
   * Notify the user that the feedback was not saved
   */
    const notifyFeedbackPersistFailed = useCallback(
    function notifyFeedbackPersistFailed(
      reason: NonNullable<SubmitFeedbackResult['reason']>
    ) {
      if (
        reason !== 'http_error' &&
        reason !== 'network_error' &&
        reason !== 'missing_conversation_id' &&
        reason !== 'no_app_id'
      ) {
        return;
      }
      Growl.addGrowlMessage({
        id: `response-feedback-save-failed-${messageId}`,
        title: t('aab_feedback_save_failed_title', undefined, 'Failed to save the feedback'),
        children: t(
          'aab_feedback_save_failed_description',
          undefined,
          'We were unable to save your feedback. Please try again.'
        ),
        emphasis: 'critical',
        lifetime: 3000,
      });
    },
    [messageId, t]
  );
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const [isSectionHovered, setIsSectionHovered] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completedText = usedFreeGrants
    ? t('builder_chat_completed_free')
    : t('builder_chat_completed');

  const successTextClass = usedFreeGrants
    ? 'text-intents-ux-feedbackHighContrastSuccess-feedbackColor'
    : 'text-foreground/50';

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;

    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  };

  const clearCopyTimeout = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useEffect(function cleanupOnUnmount() {
    return function clearOnUnmount() {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const handleCopyResponse = async () => {
    logClickEvent('chat.response_metadata.copy')();
    try {
      await navigator.clipboard.writeText(content);
      setCopiedToClipboard(true);
      clearCopyTimeout();
      timeoutRef.current = setTimeout(() => {
        setCopiedToClipboard(false);
        timeoutRef.current = null;
      }, 5000);
    } catch (err) {
      logger.error('response_metadata.copy.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const iconClass = 'w-2 h-2';

  const metadata = (
    <div className="w-full">
      <div
        className={clsx(
          'mt-1.5 flex w-full items-center justify-between gap-2 rounded-md py-1 text-xs',
          'bg-intents-ux-box-subtle'
        )}
        onMouseEnter={() => setIsSectionHovered(true)}
        onMouseLeave={() => setIsSectionHovered(false)}
      >
        <div
          className="group flex min-w-0 flex-1 cursor-default items-center gap-1"
          data-testid="response-metadata-status"
        >
          <OkIcon
            className={clsx(
              iconClass,
              usedFreeGrants
                ? 'text-intents-ux-feedbackHighContrastSuccess-feedbackColor'
                : 'text-foreground/50'
            )}
          />
          <div
            className={clsx(
              'flex min-w-0 items-center gap-0.5 overflow-hidden',
              successTextClass,
              !usedFreeGrants && 'group-hover:text-foreground'
            )}
          >
            <span className="truncate">{completedText}</span>
            <AnimatePresence>
              {isSectionHovered && (
                <motion.span
                  className="whitespace-nowrap"
                  initial={{ opacity: 0, width: 0, x: -10 }}
                  animate={{ opacity: 1, width: 'auto', x: 0 }}
                  exit={{ opacity: 0, width: 0, x: -10 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  {t('builder_chat_in_duration', { duration: formatDuration(duration) })}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

          <div className="flex h-4 shrink-0 items-center gap-0">
            {enablePerMessageFeedback && <InvocationFeedbackControls />}
            <AnimatePresence>
              <Button
                key="copy"
                type="button"
                design="stateless"
                size="small"
                className={invocationFeedbackCompactButtonClass}
                aria-label={t('builder_common_copy_clipboard')}
                title={t('builder_chat_copy_clipboard')}
                data-eid={generateClickEID('chat.response_metadata.copy')}
                onClick={handleCopyResponse}
                icon={
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                  >
                    {copiedToClipboard ? (
                      <CheckIcon className={invocationFeedbackActionIconClass} />
                    ) : (
                      <ClipboardIcon className={invocationFeedbackActionIconClass} />
                    )}
                  </motion.div>
                }
              />
            </AnimatePresence>
            {onUndo ? (
              <Button
                type="button"
                design="stateless"
                size="small"
                className={invocationFeedbackCompactButtonClass}
                title={t('builder_chat_undo', undefined, 'Undo')}
                aria-label={t('builder_chat_undo', undefined, 'Undo')}
                onClick={onUndo}
                icon={<Undo2 className={invocationFeedbackActionIconClass} />}
              />
            ) : onRestore ? (
              <Button
                type="button"
                design="stateless"
                size="small"
                className={invocationFeedbackCompactButtonClass}
                title={t('builder_chat_restore', undefined, 'Restore')}
                aria-label={t('builder_chat_restore', undefined, 'Restore')}
                onClick={onRestore}
                icon={<RevertIcon className={invocationFeedbackActionIconClass} />}
              />
            ) : null}
          </div>
        </div>

      {enablePerMessageFeedback && <InvocationFeedbackPanel />}
    </div>
  );

  if (!enablePerMessageFeedback) {
    return metadata;
  }

  return (
    <InvocationFeedbackProvider
      appId={appId}
      messageId={messageId}
      initialFeedback={initialFeedback}
      traceIds={traceIds}
      onSubmitFailed={notifyFeedbackPersistFailed}
    >
      {metadata}
    </InvocationFeedbackProvider>
  );
}
