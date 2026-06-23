import type { ReactElement } from 'react';

// The 4px purple selection ring — and its sweeping shimmer — is drawn by the
// `.selected-thumbnail-shimmer-border::before` rule in globals.scss (a pseudo
// element is required for the masked gradient). This layer adds the tinted fill.
const SELECTED_OVERLAY_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(128, 90, 213, 0.2)',
};

/**
 * Selection treatment for a media thumbnail: a tinted overlay with a bold,
 * shimmering purple border. Render inside a `relative` tile when it's selected.
 */
export function SelectedThumbnailOverlay(): ReactElement {
  return (
    <div
      className="selected-thumbnail-shimmer-border absolute inset-0 rounded-md pointer-events-none"
      style={SELECTED_OVERLAY_STYLE}
      data-testid="selected-thumbnail-overlay"
    />
  );
}
