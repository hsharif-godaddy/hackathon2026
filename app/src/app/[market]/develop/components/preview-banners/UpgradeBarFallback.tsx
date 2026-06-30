'use client';

import React from 'react';
import { FormattedMessage } from 'react-intl';
import Button from '@ux/button';
import text from '@ux/text';

import PreviewBar from '@/app/[market]/develop/components/preview-banners/PreviewBar';
import { useTranslations } from '@/hooks/useTranslations';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { usePaywallStore } from '@/stores/usePaywallStore';
import { generateClickEID, logClickEvent } from '@/utils/instrumentation';

interface UpgradeBarFallbackProps {
  onClose: () => void;
}

export default function UpgradeBarFallback({ onClose }: UpgradeBarFallbackProps): React.ReactElement {
  const t = useTranslations();
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal);

  const handleUpgradeClick = (e: React.MouseEvent): void => {
    e.preventDefault();
    logClickEvent('preview.upgradeBanner.upgrade')();
    openUpgradeModal('preview.upgradeBanner.upgrade', PAYWALL_ITC.UPGRADE);
  };

  const link = (
    <Button
      design="inline"
      size="sm"
      text={t('builder_airoplus_upgrade_link', {}, 'Upgrade now')}
      onClick={handleUpgradeClick}
      data-eid={generateClickEID('preview.upgradeBanner.upgrade')}
      className="!text-intents-ux-boxHighContrast-foregroundColor underline"
    />
  );

  return (
    <PreviewBar onClose={onClose} closeEid={generateClickEID('preview.upgradeBanner.close')}>
      <text.div size={-1} className="truncate grow text-center">
        <FormattedMessage
          id="builder_airoplus_upgrade_message"
          values={{ link }}
        />
      </text.div>
    </PreviewBar>
  );
}
