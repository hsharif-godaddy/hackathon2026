'use client';

import { useEffect, useRef, useState } from 'react';
import CheckmarkIcon from '@ux/icon/checkmark';
import CopyIcon from '@ux/icon/copy';
import Modal from '@ux/modal';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import IconButton from '@/app/develop/components/IconButton';
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
  const showFirstPublishCongrats = useDevelopPageStore(
    (state) => state.getPublishState(appId).showFirstPublishCongrats
  );
  const setShowFirstPublishCongrats = useDevelopPageStore((state) => state.setShowFirstPublishCongrats);

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
      <div>
        <text.label size={-1} htmlFor='BuilderFirstPublishInput' as='label'>
          {t('builder_domain_title')}
        </text.label>
        <div className='relative'>
          <TextInput
            id='BuilderFirstPublishInput'
            value={displayDomain}
            readOnly
            label={null}
          />
          <div className='absolute right-[6px] top-1/2 -translate-y-1/2 flex gap-0.5 items-center'>
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
          </div>
        </div>
      </div>
    </Modal>
  );
}
