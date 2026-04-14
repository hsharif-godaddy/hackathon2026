'use client';

import Button from '@ux/button';
import XIcon from '@ux/icon/x';

import { getParentOrigin } from '@/components/security/allowed-frame-ancestors';
import { useIsEmbedded } from '@/hooks/useIsEmbedded';
import { generateClickEID } from '@/utils/instrumentation';

interface IframeCloseButtonProps {
  location?: string;
}

/**
 * Close button that is only rendered when the app is embedded in an iframe.
 * Sends a postMessage to the parent window to request dismissal.
 * The target origin is resolved from the actual parent frame origin.
 */
export default function IframeCloseButton({ location = 'unknown' }: IframeCloseButtonProps) {
  const isEmbedded = useIsEmbedded();

  if (!isEmbedded) return null;

  const handleClose = () => {
    const parentOrigin = getParentOrigin();
    if (!parentOrigin) return;

    window.parent.postMessage(
      { action: 'close', sender: 'airo-hq' },
      parentOrigin
    );
  };

  return (
    <Button
      design="tertiary"
      className="!text-current"
      size="sm"
      icon={<XIcon className="size-2" />}
      onClick={handleClose}
      data-eid={generateClickEID(`${location}.iframe_close.button`)}
      data-testid="iframe-close-button"
      aria-label="Close"
    />
  );
}
