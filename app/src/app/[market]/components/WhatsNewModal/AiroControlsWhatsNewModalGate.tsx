'use client';

import { type ReactElement, useEffect, useRef, useState } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/request-context';
import {
  normalizeWhatsNewModalState,
  shouldShowWhatsNewModal,
  type WhatsNewModalAction,
  type WhatsNewModalDevice,
  type WhatsNewModalState,
} from '@/lib/whats-new-modal-state';
import AiroControlsWhatsNewModal from './AiroControlsWhatsNewModal';

interface AiroControlsWhatsNewModalGateProps {
  enabled: boolean;
}

const WHATS_NEW_STATE_URL: string = '/api/whats-new/airo-controls';

async function recordWhatsNewAction(
  device: WhatsNewModalDevice,
  action: WhatsNewModalAction
): Promise<void> {
  const response: Response = await fetch(WHATS_NEW_STATE_URL, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, action }),
  });
  if (!response.ok) {
    const statusSuffix: string = response.status ? ` (${response.status})` : '';
    throw new Error(`Failed to update what is new modal state${statusSuffix}`);
  }
}

export default function AiroControlsWhatsNewModalGate({
  enabled,
}: AiroControlsWhatsNewModalGateProps): ReactElement | null {
  const isMobile: boolean = useIsMobile();
  const device: WhatsNewModalDevice = isMobile ? 'mobile' : 'desktop';
  const latestDeviceRef: { current: WhatsNewModalDevice } = useRef<WhatsNewModalDevice>(device);
  const [open, setOpen] = useState<boolean>(false);

  latestDeviceRef.current = device;

  useEffect((): (() => void) | undefined => {
    if (!enabled) return undefined;

    let cancelled: boolean = false;
    void (async (): Promise<void> => {
      const response: Response = await fetch(WHATS_NEW_STATE_URL, { credentials: 'include' });
      if (!response.ok) {
        logger.warn('whats-new.airo-controls.state.fetch.failed', { status: response.status });
        return;
      }

      if (cancelled || latestDeviceRef.current !== device) return;

      const state: WhatsNewModalState = normalizeWhatsNewModalState(await response.json());
      if (
        cancelled ||
        latestDeviceRef.current !== device ||
        !shouldShowWhatsNewModal(state, device)
      ) {
        return;
      }

      try {
        await recordWhatsNewAction(device, 'viewed');
      } catch (error: unknown) {
        logger.warn('whats-new.airo-controls.viewed.update.failed', {
          device,
          error: getErrorMessage(error),
        });
      }

      if (!cancelled && latestDeviceRef.current === device) setOpen(true);
    })().catch((error: unknown): void => {
      logger.warn('whats-new.airo-controls.state.load.failed', { error: getErrorMessage(error) });
    });

    return (): void => {
      cancelled = true;
    };
  }, [device, enabled]);

  return (
    <AiroControlsWhatsNewModal
      open={open}
      onClose={(): void => setOpen(false)}
      onComplete={(): void => {
        void recordWhatsNewAction(device, 'completed').catch((error: unknown): void => {
          logger.warn('whats-new.airo-controls.completed.update.failed', {
            device,
            error: getErrorMessage(error),
          });
        });
      }}
    />
  );
}
