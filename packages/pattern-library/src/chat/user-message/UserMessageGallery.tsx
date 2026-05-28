import Box from '@ux/box';
import classnames from 'classnames';
import { Children, type HTMLAttributes, isValidElement } from 'react';

import { UserMessageFile } from './UserMessageFile';
import { UserMessageGalleryContext, type UserMessageGalleryLayout } from './context';

/**
 * Props for `UserMessage.Gallery`, the layout region for images and files
 * rendered above the text portion of a user message bubble.
 */
export interface UserMessageGalleryProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Accessible name for the gallery group. Defaults to
   * `"Attached files"`. Localize or tailor the copy to match your
   * product's vocabulary (e.g. `"Uploaded images"`).
   *
   * @default 'Attached files'
   */
  ariaLabel?: string;
  /**
   * Force a particular gallery layout. Defaults to auto-detection from the
   * children: images-only galleries render as a horizontal "hero + thumbs"
   * scroll strip, and galleries containing any `UserMessage.File` render
   * as a vertical `@ux/list-item` stack so filenames have room to breathe.
   * Override when the default heuristic disagrees with your product's
   * visual intent (e.g. always list).
   */
  layout?: UserMessageGalleryLayout;
}

const DEFAULT_GALLERY_LABEL = 'Attached files';

/**
 * Auto-detect the layout mode from the gallery's children. Galleries that
 * contain any `UserMessage.File` tile flip to the list layout — whether
 * they're files-only or mixed images + files. The list reads cleaner when
 * a filename and its icon are on the same row, and the Figma file-upload
 * exploration treats the list as the canonical mixed-content view.
 */
function detectLayout(children: unknown): UserMessageGalleryLayout {
  let hasFile = false;
  Children.forEach(children, (child) => {
    if (hasFile) return;
    if (isValidElement(child) && child.type === UserMessageFile) {
      hasFile = true;
    }
  });
  return hasFile ? 'list' : 'strip';
}

/**
 * `UserMessage.Gallery` lays out 1–N media tiles (`UserMessage.Image`,
 * `UserMessage.File`) above the bubble's text. The layout adapts to the
 * tile mix:
 *
 * - **Image-only** galleries render as a horizontal "hero + thumbs" scroll
 *   strip. The first tile (hero) caps at 75% of the gallery width; the
 *   others share the hero's block-size as their max-height.
 * - **Mixed / file-bearing** galleries render as a vertical
 *   `@ux/list-item` stack so a filename can sit next to its file-type
 *   icon without squeezing the text under a square tile.
 *
 * Consumers can force a specific layout via the `layout` prop.
 *
 * The group carries `role="group"` with an accessible name so assistive
 * tech announces it as a discrete sub-region of the message.
 */
export function UserMessageGallery({
  children,
  className,
  ariaLabel,
  layout: layoutProp,
  'aria-label': ariaLabelAttribute,
  ...rest
}: UserMessageGalleryProps) {
  const itemCount = Children.count(children);
  const isSingle = itemCount === 1;
  const layout = layoutProp ?? detectLayout(children);
  const accessibleName = ariaLabelAttribute ?? ariaLabel ?? DEFAULT_GALLERY_LABEL;

  const galleryClassName = classnames(
    'airo-chat-user-message__gallery',
    `airo-chat-user-message__gallery--${layout}`,
    {
      'airo-chat-user-message__gallery--single': isSingle && layout === 'strip',
    },
    className,
  );

  // The list layout renders inside a single `<Box elevation="card">` so the
  // stacked `@ux/list-item` rows read as flush slats of one card surface
  // rather than a column of disconnected tiles. Padding / gap are omitted
  // (no `blockPadding` / `inlinePadding` / `gap` props) so the slats sit
  // edge-to-edge, and the list-mode CSS clips the inner rows to the
  // card's rounded corners. The strip layout keeps its plain `<div>`
  // wrapper — the row is meant to feel like a scroll strip, not a card.
  if (layout === 'list') {
    return (
      <UserMessageGalleryContext.Provider value={layout}>
        <Box
          {...rest}
          elevation="card"
          orientation="vertical"
          // biome-ignore lint/a11y/useSemanticElements: `role="group"` with an aria-label is the correct ARIA pattern for a labeled sub-region of content. The lint rule suggests `<fieldset>`, but `<fieldset>` is specifically for grouping form controls, not content tiles — it would be semantically wrong here.
          role="group"
          aria-label={accessibleName}
          className={galleryClassName}
        >
          {children}
        </Box>
      </UserMessageGalleryContext.Provider>
    );
  }

  return (
    <UserMessageGalleryContext.Provider value={layout}>
      <div
        {...rest}
        // biome-ignore lint/a11y/useSemanticElements: `role="group"` with an aria-label is the correct ARIA pattern for a labeled sub-region of content. The lint rule suggests `<fieldset>`, but `<fieldset>` is specifically for grouping form controls, not content tiles — it would be semantically wrong here.
        role="group"
        aria-label={accessibleName}
        className={galleryClassName}
      >
        {children}
      </div>
    </UserMessageGalleryContext.Provider>
  );
}
