'use client';

import { type ReactElement, type ReactNode, useEffect, useState } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useTranslations } from '@/hooks/useTranslations';
import { type WhatsNewModalDevice } from '@/lib/whats-new-modal-state';
import WhatsNewModal, { type WhatsNewModalItem } from './WhatsNewModal';

interface AiroControlsWhatsNewModalProps {
  open: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

export default function AiroControlsWhatsNewModal({
  open,
  onClose,
  onComplete,
}: AiroControlsWhatsNewModalProps): ReactElement | null {
  const t: ReturnType<typeof useTranslations> = useTranslations();
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const isMobile: boolean = useIsMobile();
  const device: WhatsNewModalDevice = isMobile ? 'mobile' : 'desktop';

  useEffect((): void => {
    if (open) setActiveIndex(0);
  }, [isMobile, open]);

  const desktopItems: WhatsNewModalItem[] = [
    {
      id: 'toolbar',
      label: t('builder_whats_new_toolbar_label', undefined, 'Toolbar'),
      title: t('builder_whats_new_toolbar_title', undefined, 'Tools where you need them'),
      body: t(
        'builder_whats_new_toolbar_body',
        undefined,
        'The dynamic toolbar knows what you’re working on and shows relevant actions for your project.'
      ),
    },
    {
      id: 'tabs',
      label: t('builder_whats_new_tabs_label', undefined, 'Tabs'),
      title: t('builder_whats_new_tabs_title', undefined, 'Tabs to switch workspaces'),
      body: t(
        'builder_whats_new_tabs_body',
        {
          b: (chunks: ReactNode): ReactElement => <strong className="font-bold">{chunks}</strong>,
        },
        'Project navigation is now organized into <b>Tabs</b>. Use <b>Cmd+O</b> to search and open new ones.'
      ),
    },
    {
      id: 'floating-chat',
      label: t('builder_whats_new_floating_chat_label', undefined, 'Floating Chat'),
      title: t('builder_whats_new_floating_chat_title', undefined, 'Chat moves with you'),
      body: t(
        'builder_whats_new_floating_chat_body',
        undefined,
        'Move the chat anywhere on the page and keep the conversation going.'
      ),
    },
    {
      id: 'edit',
      label: t('builder_whats_new_edit_label', undefined, 'Edit'),
      title: t('builder_whats_new_edit_title', undefined, 'Edit mode for inline control'),
      body: t(
        'builder_whats_new_edit_body',
        {
          b: (chunks: ReactNode): ReactElement => <strong className="font-bold">{chunks}</strong>,
        },
        'Use <b>Edit</b> mode to select text or images and make direct changes.'
      ),
    },
    {
      id: 'annotation',
      label: t('builder_whats_new_annotation_label', undefined, 'Annotation'),
      title: t('builder_whats_new_annotation_title', undefined, 'Select areas to edit'),
      body: t(
        'builder_whats_new_annotation_body',
        {
          b: (chunks: ReactNode): ReactElement => <strong className="font-bold">{chunks}</strong>,
        },
        'Use the <b>Select</b> tool to drag and highlight elements, then tell Airo what to change.'
      ),
    },
  ];
  const mobileItems: WhatsNewModalItem[] = [
    {
      id: 'mobile-switcher',
      label: t('builder_whats_new_mobile_switcher_label', undefined, 'Switcher'),
      title: t('builder_whats_new_mobile_switcher_title', undefined, 'Switch between tasks'),
      body: t(
        'builder_whats_new_mobile_switcher_body',
        {
          b: (chunks: ReactNode): ReactElement => <strong className="font-bold">{chunks}</strong>,
        },
        'Tap the <b>Switcher</b> to move between your working canvas, brand styles, domains, and more.'
      ),
    },
    {
      id: 'mobile-chat',
      label: t('builder_whats_new_mobile_chat_label', undefined, 'Chat'),
      title: t('builder_whats_new_mobile_chat_title', undefined, 'Chat stays with you'),
      body: t(
        'builder_whats_new_mobile_chat_body',
        {
          b: (chunks: ReactNode): ReactElement => <strong className="font-bold">{chunks}</strong>,
        },
        'Tap <b>Chat</b> to open and close the conversation, or move it anywhere you want.'
      ),
    },
    {
      id: 'mobile-edit',
      label: t('builder_whats_new_edit_label', undefined, 'Edit'),
      title: t('builder_whats_new_edit_title', undefined, 'Edit mode for inline control'),
      body: t(
        'builder_whats_new_edit_body',
        {
          b: (chunks: ReactNode): ReactElement => <strong className="font-bold">{chunks}</strong>,
        },
        'Use <b>Edit</b> mode to select text or images and make direct changes.'
      ),
    },
  ];
  const items: WhatsNewModalItem[] = isMobile ? mobileItems : desktopItems;

  const nextItem: WhatsNewModalItem | undefined = items[activeIndex + 1];
  const nextLabel: string = nextItem
    ? t('builder_whats_new_next_feature', { feature: nextItem.label }, `Next: ${nextItem.label}`)
    : t('builder_whats_new_got_it', undefined, 'Got it');

  return (
    <WhatsNewModal
      open={open}
      device={device}
      title={t('builder_whats_new_title', undefined, 'Explore new Airo controls')}
      items={items}
      activeIndex={activeIndex}
      nextLabel={nextLabel}
      closeLabel={t('builder_common_close', undefined, 'Close')}
      onActiveIndexChange={setActiveIndex}
      onClose={onClose}
      onComplete={onComplete}
    />
  );
}
