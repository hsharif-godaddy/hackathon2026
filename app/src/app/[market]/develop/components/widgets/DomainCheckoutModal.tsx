'use client'

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import Box from '@ux/box';
import Modal from '@ux/modal';
import Spinner from '@ux/spinner';

import { shimReactInternals } from '@/utils/reactCompat';

// DomainPurchaseWidget keeps its own inline copy of this dynamic-import + data-inert
// workaround — mirror changes there until it adopts this module.
const DynamicCheckout: ComponentType<any> = dynamic(
  async () => {
    shimReactInternals();
    const mod = await import('@px/checkouts');
    return mod.Checkout;
  },
  { ssr: false }
);

export interface DomainCheckoutModalProps {
  /** SAPI basket GUID returned by the add-to-cart call. */
  basketId: string;
  /** Modal title (already-translated string). */
  title: string;
  /** Express Checkout completed successfully. */
  onPurchaseSuccess: (order: any) => void;
  /** Express Checkout reported an error. */
  onError: (error: { name: string; message?: string; reasonCode?: string }) => void;
  /** User dismissed the modal. */
  onClose: () => void;
}

/** Express Checkout (`@px/checkouts` ExpressCart) in a `@ux/modal`, opened given a basketId. */
export default function DomainCheckoutModal({
  basketId,
  title,
  onPurchaseSuccess,
  onError,
  onClose,
}: DomainCheckoutModalProps) {
  // The checkout iframe (@ux/modal → @ux/disrupt → react-focus-lock) can leave a data-inert
  // counter stuck on document.body after unmount, killing keyboard input; clear it a frame
  // after close/success so React's unmount runs first.
  function clearInert(): void {
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        document.body.removeAttribute('data-inert');
      });
    }
  }

  function handleClose(): void {
    onClose();
    clearInert();
  }

  function handleSuccess(order: any): void {
    clearInert();
    onPurchaseSuccess(order);
  }

  return (
    <Modal onClose={handleClose} title={title} className="domain-purchase-checkout-modal">
      <Box orientation="vertical" gap="md" className="p-4">
        <DynamicCheckout
          id="domain-checkout"
          appKey="airo-abuilder"
          basketId={basketId}
          checkoutName="ExpressCart"
          loadingSpinner={
            <Box className="flex items-center justify-center p-8">
              <Spinner />
            </Box>
          }
          onPurchaseSuccess={handleSuccess}
          onError={onError}
        />
      </Box>
    </Modal>
  );
}
