'use client';

import { motion } from 'framer-motion';
import ChevronLeftIcon from '@ux/icon/chevron-left'
import MenuIcon from '@ux/icon/menu'

import IconButton from '@/app/[market]/develop/components/IconButton';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import AppPublish from '@/components/layout/AppPublish';
import IframeCloseButton from '@/components/layout/IframeCloseButton';
import UserMenu from '@/components/layout/UserMenu';
import { useTranslations } from '@/hooks/useTranslations';
import { CommanderLogo } from './CommanderLogo';

const LOCATION = 'develop';

interface CommanderHeaderMobileProps {
  onBack?: () => void;
}

export default function CommanderHeaderMobile({ onBack }: CommanderHeaderMobileProps) {
  const t = useTranslations();
  const appId = useAppIdFromParams();

  return (
    <header data-testid="commander-header" className="flex">
      <motion.div
        className="shrink-0 flex items-center gap-1.5 ps-1.5 py-1.5 md:ps-2.5"
        animate={{ width: 'auto' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {onBack ? (
          <IconButton
            icon={<ChevronLeftIcon className="size-2.5" />}
            label={t('builder_common_back')}
            onClick={onBack}
          />
        ) : (
          <CommanderLogo appId={appId} source="header" />
        )}
      </motion.div>

      <div className="px-1.5 py-1.5 md:px-2.5 grow flex justify-end items-center gap-1">
        <AppPublish location={LOCATION} triggerClassName="!rounded-lg !px-2 !py-1.5 !border-none" />
        <UserMenu location={LOCATION} triggerIcon={<MenuIcon className="size-2.5" />} />
        <IframeCloseButton location={LOCATION} />
      </div>
    </header>
  )
}
