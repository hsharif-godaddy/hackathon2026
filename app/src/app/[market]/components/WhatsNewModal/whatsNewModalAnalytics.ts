import { type WhatsNewModalDevice } from '@/lib/whats-new-modal-state';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';
import { type WhatsNewModalItem } from './WhatsNewModal';

export type WhatsNewModalCloseMethod = 'button' | 'escape';

const WHATS_NEW_MODAL_VIEW_EID: string = 'develop.whats_new_modal.view';
const WHATS_NEW_MODAL_TAB_EID: string = 'develop.whats_new_modal.tab';
const WHATS_NEW_MODAL_CLOSE_EID: string = 'develop.whats_new_modal.close';
const WHATS_NEW_MODAL_NEXT_EID: string = 'develop.whats_new_modal.next';
const WHATS_NEW_MODAL_GOT_IT_EID: string = 'develop.whats_new_modal.got_it';

function stepAnalyticsProps(
  device: WhatsNewModalDevice,
  item: WhatsNewModalItem,
  index: number
): Record<string, string | number> {
  return { device, step: item.id, stepIndex: index };
}

function stepChangeAnalyticsProps(
  device: WhatsNewModalDevice,
  fromItem: WhatsNewModalItem,
  fromIndex: number,
  toItem: WhatsNewModalItem,
  toIndex: number
): Record<string, string | number> {
  return {
    device,
    fromStep: fromItem.id,
    fromIndex,
    toStep: toItem.id,
    toIndex,
  };
}

export function logWhatsNewModalImpression(
  device: WhatsNewModalDevice,
  item: WhatsNewModalItem,
  index: number
): void {
  logImpressionEvent(WHATS_NEW_MODAL_VIEW_EID, stepAnalyticsProps(device, item, index))();
}

export function logWhatsNewModalTabClick(
  device: WhatsNewModalDevice,
  fromItem: WhatsNewModalItem,
  fromIndex: number,
  toItem: WhatsNewModalItem,
  toIndex: number
): void {
  logClickEvent(
    WHATS_NEW_MODAL_TAB_EID,
    stepChangeAnalyticsProps(device, fromItem, fromIndex, toItem, toIndex)
  )();
}

export function logWhatsNewModalCloseClick(
  device: WhatsNewModalDevice,
  item: WhatsNewModalItem,
  index: number,
  method: WhatsNewModalCloseMethod
): void {
  logClickEvent(WHATS_NEW_MODAL_CLOSE_EID, {
    ...stepAnalyticsProps(device, item, index),
    method,
  })();
}

export function logWhatsNewModalNextClick(
  device: WhatsNewModalDevice,
  fromItem: WhatsNewModalItem,
  fromIndex: number,
  toItem: WhatsNewModalItem,
  toIndex: number
): void {
  logClickEvent(
    WHATS_NEW_MODAL_NEXT_EID,
    stepChangeAnalyticsProps(device, fromItem, fromIndex, toItem, toIndex)
  )();
}

export function logWhatsNewModalGotItClick(
  device: WhatsNewModalDevice,
  item: WhatsNewModalItem,
  index: number
): void {
  logClickEvent(WHATS_NEW_MODAL_GOT_IT_EID, stepAnalyticsProps(device, item, index))();
}
