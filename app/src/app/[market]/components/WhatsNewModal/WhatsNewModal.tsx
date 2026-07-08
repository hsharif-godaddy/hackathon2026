'use client';

import Image from 'next/image';
import { type ReactElement, type ReactNode, useEffect, useRef } from 'react';
import XIcon from '@ux/icon/x';

import { cn } from '@/lib/utils';
import { type WhatsNewModalDevice } from '@/lib/whats-new-modal-state';
import styles from './WhatsNewModal.module.css';
import {
  logWhatsNewModalCloseClick,
  logWhatsNewModalGotItClick,
  logWhatsNewModalImpression,
  logWhatsNewModalNextClick,
  logWhatsNewModalTabClick,
  type WhatsNewModalCloseMethod,
} from './whatsNewModalAnalytics';

const TOOLBAR_PREVIEW_IMAGE_SRC: string = '/images/whats-new-toolbar.png';
const TABS_PREVIEW_IMAGE_SRC: string = '/images/whats-new-tabs.png';
const FLOATING_CHAT_PREVIEW_IMAGE_SRC: string = '/images/whats-new-floating-chat.png';
const EDIT_PREVIEW_IMAGE_SRC: string = '/images/whats-new-edit.png';
const ANNOTATION_PREVIEW_IMAGE_SRC: string = '/images/whats-new-annotation.png';
const MOBILE_SWITCHER_PREVIEW_IMAGE_SRC: string = '/images/whats-new-mobile-switcher.png';
const MOBILE_CHAT_PREVIEW_IMAGE_SRC: string = '/images/whats-new-mobile-chat.png';
const MOBILE_EDIT_PREVIEW_IMAGE_SRC: string = '/images/whats-new-mobile-edit.png';

export type WhatsNewModalItemId =
  | 'toolbar'
  | 'tabs'
  | 'floating-chat'
  | 'edit'
  | 'annotation'
  | 'mobile-switcher'
  | 'mobile-chat'
  | 'mobile-edit';

export interface WhatsNewModalItem {
  id: WhatsNewModalItemId;
  label: string;
  title: string;
  body: ReactNode;
}

interface WhatsNewModalProps {
  open: boolean;
  device: WhatsNewModalDevice;
  title: string;
  items: WhatsNewModalItem[];
  activeIndex: number;
  nextLabel: string;
  closeLabel: string;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
  onComplete?: () => void;
}

const PREVIEW_IMAGE_SRC_BY_ITEM_ID: Record<WhatsNewModalItemId, string> = {
  toolbar: TOOLBAR_PREVIEW_IMAGE_SRC,
  tabs: TABS_PREVIEW_IMAGE_SRC,
  'floating-chat': FLOATING_CHAT_PREVIEW_IMAGE_SRC,
  edit: EDIT_PREVIEW_IMAGE_SRC,
  annotation: ANNOTATION_PREVIEW_IMAGE_SRC,
  'mobile-switcher': MOBILE_SWITCHER_PREVIEW_IMAGE_SRC,
  'mobile-chat': MOBILE_CHAT_PREVIEW_IMAGE_SRC,
  'mobile-edit': MOBILE_EDIT_PREVIEW_IMAGE_SRC,
};

function AiroControlsPreview({ activeItemId }: { activeItemId: WhatsNewModalItemId }): ReactElement {
  const previewImageSrc: string = PREVIEW_IMAGE_SRC_BY_ITEM_ID[activeItemId];

  return (
    <div className="relative h-[260px] w-[510px] max-w-full overflow-hidden bg-intents-ux-boxLowContrast-backgroundColor max-sm:h-[145px] max-sm:w-full">
      <Image
        src={previewImageSrc}
        alt=""
        aria-hidden="true"
        width={510}
        height={260}
        loading="eager"
        unoptimized
        draggable={false}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

export default function WhatsNewModal({
  open,
  device,
  title,
  items,
  activeIndex,
  nextLabel,
  closeLabel,
  onActiveIndexChange,
  onClose,
  onComplete,
}: WhatsNewModalProps): ReactElement | null {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const loggedOpenImpressionRef = useRef<boolean>(false);
  const activeItem: WhatsNewModalItem | undefined = items[activeIndex] ?? items[0];
  const lastIndex: number = items.length - 1;
  const usesNativeModal: boolean =
    typeof HTMLDialogElement !== 'undefined' &&
    typeof HTMLDialogElement.prototype.showModal === 'function';
  const isLastItem: boolean = activeIndex >= lastIndex;

  useEffect((): (() => void) | undefined => {
    const dialog: HTMLDialogElement | null = dialogRef.current;
    if (!open || !dialog) return undefined;
    if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
    return (): void => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
    };
  }, [open]);

  useEffect((): (() => void) | undefined => {
    const dialog: HTMLDialogElement | null = dialogRef.current;
    if (!open || !dialog) return undefined;
    const handleCancel = (event: Event): void => {
      event.preventDefault();
      if (activeItem) {
        logWhatsNewModalCloseClick(device, activeItem, activeIndex, 'escape');
      }
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return (): void => dialog.removeEventListener('cancel', handleCancel);
  }, [activeIndex, activeItem, device, onClose, open]);

  useEffect((): void => {
    if (!open) {
      loggedOpenImpressionRef.current = false;
      return;
    }
    if (loggedOpenImpressionRef.current || !activeItem) return;

    loggedOpenImpressionRef.current = true;
    logWhatsNewModalImpression(device, activeItem, activeIndex);
  }, [activeIndex, activeItem, device, open]);

  if (!open || !activeItem) return null;

  function handleClose(method: WhatsNewModalCloseMethod): void {
    logWhatsNewModalCloseClick(device, activeItem, activeIndex, method);
    onClose();
  }

  function handleTabClick(item: WhatsNewModalItem, index: number): void {
    logWhatsNewModalTabClick(device, activeItem, activeIndex, item, index);
    onActiveIndexChange(index);
  }

  function handleNext(): void {
    const nextItem: WhatsNewModalItem | undefined = items[activeIndex + 1];
    if (isLastItem || !nextItem) {
      logWhatsNewModalGotItClick(device, activeItem, activeIndex);
      onComplete?.();
      onClose();
      return;
    }
    logWhatsNewModalNextClick(device, activeItem, activeIndex, nextItem, activeIndex + 1);
    onActiveIndexChange(activeIndex + 1);
  }

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[1000] bg-intents-ux-boxHighContrastOverlay-backgroundColor"
      />
      <dialog
        ref={dialogRef}
        aria-labelledby="whats-new-modal-title"
        aria-modal="true"
        open={usesNativeModal ? undefined : open}
        role="dialog"
        className={cn(
          styles.dialog,
          'fixed left-1/2 top-1/2 z-[1001] m-0 w-[740px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-visible bg-transparent p-0 text-intents-ux-box-foregroundColor max-sm:w-[calc(100vw-48px)] max-sm:max-w-[358px]'
        )}
      >
        <div className="relative flex h-[440px] max-h-[calc(100dvh-32px)] overflow-hidden rounded-[12px] bg-intents-ux-box-backgroundColor shadow-[0_0_1px_rgba(0,0,0,0.20),0_8px_24px_rgba(0,0,0,0.10),0_12px_16px_rgba(0,0,0,0.07)] max-sm:h-auto max-sm:max-h-[calc(100dvh-32px)] max-sm:flex-col">
          <aside className="flex w-[230px] shrink-0 flex-col gap-[24px] bg-intents-ux-boxLowContrast-backgroundColor p-[24px] max-sm:w-full max-sm:gap-[28px] max-sm:px-[20px] max-sm:pb-[18px] max-sm:pt-[22px]">
            <h2
              id="whats-new-modal-title"
              className="m-0 w-full font-title text-[28px] font-bold leading-[32px] text-intents-ux-box-foregroundColor max-sm:max-w-[calc(100%-48px)]"
            >
              {title}
            </h2>
            <nav
              aria-label={title}
              className="flex w-full flex-col gap-[4px] max-sm:flex-row max-sm:gap-[18px] max-sm:overflow-x-auto"
            >
              {items.map((item: WhatsNewModalItem, index: number): ReactElement => {
                const selected: boolean = index === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={selected ? 'step' : undefined}
                    onClick={(): void => handleTabClick(item, index)}
                    className={cn(
                      'h-[41px] w-full cursor-pointer appearance-none rounded-[8px] px-[16px] py-[12px] text-left font-label text-[14px] leading-[17px] transition-colors focus-visible:outline-none max-sm:h-[31px] max-sm:w-auto max-sm:shrink-0 max-sm:px-[10px] max-sm:py-[7px]',
                      selected
                        ? 'bg-[color-mix(in_srgb,var(--color-ai)_12%,white)] font-semibold text-[var(--color-ai)]'
                        : 'font-medium text-intents-ux-box-foregroundColor hover:bg-intents-ux-actionControlHovered-backgroundColor'
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col bg-intents-ux-box-backgroundColor">
            <AiroControlsPreview activeItemId={activeItem.id} />
            <div className="flex min-h-0 flex-1 flex-col justify-between gap-[16px] p-[20px] max-sm:min-h-[173px]">
              <div className="flex flex-col gap-[8px]">
                <h3
                  className="m-0 font-title text-[22px] font-bold leading-[27.5px] text-intents-ux-box-foregroundColor"
                >
                  {activeItem.title}
                </h3>
                <p
                  className="m-0 font-paragraph text-[13px] leading-[1.5] text-intents-ux-box-foregroundColor"
                >
                  {activeItem.body}
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleNext}
                  className={cn(
                    'flex h-[36px] cursor-pointer appearance-none items-center justify-center rounded-[12px] border px-[16px] font-action text-[14px] font-semibold leading-[17px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai/30',
                    isLastItem
                      ? 'border-intents-ux-boxHighContrast-borderColor bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor hover:opacity-90'
                      : 'border-[#ddd] bg-[#fff] text-[#1a1a1a] hover:bg-[#f5f5f5]'
                  )}
                >
                  {nextLabel}
                </button>
              </div>
            </div>
          </section>

          <button
            type="button"
            aria-label={closeLabel}
            onClick={(): void => handleClose('button')}
            className="absolute right-[16px] top-[16px] flex h-[38px] w-[39px] cursor-pointer appearance-none items-center justify-center rounded-[6px] border border-intents-ux-actionControl-borderColor bg-intents-ux-actionControl-backgroundColor p-[9px] text-intents-ux-actionControl-foregroundColor transition-colors hover:bg-intents-ux-actionControlHovered-backgroundColor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai/30 max-sm:right-[13px] max-sm:top-[12px] max-sm:border-transparent max-sm:bg-transparent"
          >
            <XIcon className="size-5" aria-hidden="true" />
          </button>
        </div>
      </dialog>
    </>
  );
}
