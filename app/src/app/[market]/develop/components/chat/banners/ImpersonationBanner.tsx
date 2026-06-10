'use client';

import { useTranslations } from '@/hooks/useTranslations';
import ChatBanner from '@/lib/ChatBanner';

interface ImpersonationBannerProps {
  onClose: () => void;
}

export default function ImpersonationBanner({ onClose }: ImpersonationBannerProps) {
  const t = useTranslations();

  return (
    <ChatBanner variant="internal" onClose={onClose}>
      {t('builder_chat_impersonation_banner_message')}
    </ChatBanner>
  );
}
