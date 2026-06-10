'use client';

import { useEffect, useRef, useState } from 'react';
import Box from '@ux/box';
import CheckmarkIcon from '@ux/icon/checkmark';
import CopyIcon from '@ux/icon/copy';
import Modal from '@ux/modal';
import Spinner from '@ux/spinner';
import text from '@ux/text';

import IconButton from '@/app/[market]/develop/components/IconButton';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { resolveSiteFqdn } from '@/utils/domain';
import { logImpressionEvent } from '@/utils/instrumentation';

export interface FirstPublishCongratsModalProps {
  appId: string;
}

export default function FirstPublishCongratsModal({ appId }: FirstPublishCongratsModalProps) {
  const t = useTranslations();
  const isSecurityScanUiEnabled = useSwitchboard('appbuilder-security-scan-ui') === true;
  const showFirstPublishCongrats = useDevelopPageStore(
    (state) => state.getPublishState(appId).showFirstPublishCongrats
  );
  const setShowFirstPublishCongrats = useDevelopPageStore((state) => state.setShowFirstPublishCongrats);
  const isSecurityAnalysisRunning = useDevelopPageStore(
    (state) => state.publishStates[appId]?.isSecurityAnalysisRunning ?? false
  );

  const site = useSiteStore((state) => state.getSite(appId));
  const fqdn = resolveSiteFqdn(site) || '';
  const isModalOpen = showFirstPublishCongrats && Boolean(fqdn);

  useEffect(() => {
    if (isModalOpen) {
      logImpressionEvent('develop.publish.first_publish_congrats.view')();
    }
  }, [isModalOpen]);

  const [copied, setCopied] = useState(false);
  const copySuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(copySuccessTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showFirstPublishCongrats) {
      setCopied(false);
      clearTimeout(copySuccessTimeoutRef.current);
    }
  }, [showFirstPublishCongrats]);

  useEffect(
    function launchConfettiOnOpen() {
      if (!isModalOpen) {
        return;
      }

      let cancelled = false;

      void import('canvas-confetti')
        .then(function runConfetti(confettiModule) {
          if (cancelled || typeof window === 'undefined') {
            return;
          }
          confettiModule.default({
            particleCount: 125,
            spread: 200,
            origin: { y: 0.65 },
            scalar: 1.5,
          });
        })
        .catch(function ignoreConfettiFailure() {});

      return function cleanupConfetti() {
        cancelled = true;
      };
    },
    [isModalOpen],
  );

  if (!isModalOpen) {
    return null;
  }

  function dismiss() {
    setShowFirstPublishCongrats(appId, false);
  }

  const displayDomain = fqdn.replace(/^https?:\/\//, '');

  const copyDomain = async function copyDomain() {
    try {
      await navigator.clipboard.writeText(fqdn);
      setCopied(true);
      clearTimeout(copySuccessTimeoutRef.current);
      copySuccessTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 10000);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  return (
    <Modal
      title={t('builder_first_publish_congrats_title_v2')}
      onClose={dismiss}
      id="first-publish-congrats-modal"
      description={t('builder_first_publish_congrats_description_v2')}
    >
      <Box orientation='vertical' gap='sm'>
        <text.label size={-1} as='label'>
          {t('builder_domain_title')}
        </text.label>
        <Box
          orientation='horizontal'
          gap='sm'
          inlineAlignChildren='center'
          blockAlignChildren='center'
          inlinePadding='md'
          blockPadding='sm'
          className='rounded-md bg-intents-ux-boxLowContrast-backgroundColor'
        >
          <text.span size={0} className='min-w-0 flex-1'>
            {displayDomain}
          </text.span>
          <IconButton
            icon={
              copied ? (
                <CheckmarkIcon className='size-2.5 text-intents-ux-feedbackHighContrastSuccess-feedbackColor' />
              ) : (
                <CopyIcon className='size-2.5' />
              )
            }
            onClick={copyDomain}
            label={copied ? t('builder_common_copied') : t('builder_common_copy_clipboard')}
            showLabelWhenActive={false}
            inverted
          />
        </Box>

        {isSecurityScanUiEnabled && isSecurityAnalysisRunning && (
          <Box orientation='horizontal' blockAlignChildren='start' gap='sm' className='w-full pt-10'>
            <Spinner size='sm' data-partial='componentAiro' className='shrink-0' />
            <text.p size={-1}>
              {t('builder_security_scan_running_in_progress')}
            </text.p>
          </Box>
        )}
      </Box>
    </Modal>
  );
}
