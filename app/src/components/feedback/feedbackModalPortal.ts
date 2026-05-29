const FEEDBACK_MODAL_PORTAL_ID = 'feedback-modal-portal';

let portal: HTMLElement | undefined;

export function getFeedbackModalPortal(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;

  if (portal?.isConnected) return portal;

  portal = document.getElementById(FEEDBACK_MODAL_PORTAL_ID) as HTMLElement | null ?? undefined;
  if (!portal) {
    portal = document.createElement('div');
    portal.id = FEEDBACK_MODAL_PORTAL_ID;
    document.body.appendChild(portal);
  }

  return portal;
}
