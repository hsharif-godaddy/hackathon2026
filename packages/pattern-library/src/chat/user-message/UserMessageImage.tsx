import ListItem from '@ux/list-item';
import classnames from 'classnames';
import {
  type ImgHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useId,
} from 'react';

import {
  UserMessageGalleryContext,
  UserMessageLightboxContext,
  UserMessageUrlPolicyContext,
} from './context';
import type { UrlValidator } from './urlGuard';

const DEFAULT_IMAGE_BUTTON_LABEL = 'Open image preview';

/**
 * Props for `UserMessage.Image`, the thumbnail tile rendered inside a
 * `UserMessage.Gallery`.
 */
export interface UserMessageImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'onClick'> {
  /**
   * Image URL. Required — the component renders an underlying `<img>` and
   * forwards this as its `src`.
   */
  src: string;
  /**
   * Alternative text for the image. Required even when the image is the
   * only content of the message — a user-authored upload needs an
   * accessible description. Pass an empty string if the image is strictly
   * decorative (rare for user messages).
   */
  alt: string;
  /**
   * Override the default lightbox behavior. When omitted, clicking the
   * tile opens the parent `UserMessage`'s internal lightbox modal with
   * this image. Pass a handler to take over entirely — if the handler
   * calls `event.preventDefault()`, the lightbox does not open.
   */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /**
   * Supply any extra chrome that should render inside the tile but above
   * the image (e.g. a remove button from the parent uploader). Rendered
   * in a corner overlay in the strip layout, or in the list item's
   * `actions` slot in the list layout.
   */
  cornerActions?: ReactNode;
  /**
   * Extra class name appended to the tile root for scoped styling. Prefer
   * authoring a new BEM element under the `airo-chat-user-message`
   * namespace over inline styles.
   */
  className?: string;
  /**
   * Per-tile override for the URL-guard predicate. See the `validateSrc`
   * prop on `UserMessage` for the full contract. When omitted, the tile
   * inherits the parent `UserMessage`'s `validateSrc`; outside a
   * `UserMessage` it falls back to the library default (`isSafeImgSrc`).
   *
   * Set on an individual tile to apply a tighter or more permissive
   * policy for that one image without affecting sibling tiles — useful
   * when one image is known to come from a trusted first-party CDN and
   * a sibling comes from user-authored markdown.
   */
  validateSrc?: UrlValidator;
}

/**
 * `UserMessage.Image` is the image tile inside a `UserMessage.Gallery`.
 *
 * In the default strip layout it renders a real `<button>` styled as a
 * card surface — pressing the tile opens the parent `UserMessage`'s
 * lightbox modal with this image. In the list layout (mixed-content
 * galleries) it renders an `@ux/list-item` whose media slot is a 64px
 * square preview button: the same click contract as the strip tile, just
 * re-homed inside a row so the alt caption sits beside the thumbnail
 * instead of cropped beneath it.
 *
 * When rendered outside a `UserMessage`, the component still renders the
 * tile but disables the default lightbox behavior — consumers are
 * expected to pass their own `onClick` in that case.
 *
 * We use a plain `<button>` (not `@ux/card as="button"`, not the
 * `ListItem` root's `onClick`) because (a) the Card's interactive mode
 * overlays a hidden `<input type="button">` that drops the image's `alt`
 * and empties the accessible name, and (b) `@ux/list-item` suppresses
 * its row `onClick` whenever `actions` are present, so anchoring the
 * lightbox click on the thumbnail keeps it reachable even when a
 * remove-button sits in the actions slot.
 */
export function UserMessageImage({
  src,
  alt,
  onClick,
  cornerActions,
  className,
  validateSrc,
  id,
  ...rest
}: UserMessageImageProps) {
  const lightbox = useContext(UserMessageLightboxContext);
  const urlPolicy = useContext(UserMessageUrlPolicyContext);
  const layout = useContext(UserMessageGalleryContext);
  const generatedId = useId();
  const reactId = id ?? generatedId;
  const accessibleName = alt || DEFAULT_IMAGE_BUTTON_LABEL;
  // Per-tile prop > parent context > library default. The library default
  // lives inside `UserMessageUrlPolicyContext`'s default value, so a tile
  // rendered outside a `UserMessage` still gets the safe baseline.
  const effectiveValidate = validateSrc ?? urlPolicy.validateSrc;
  const srcIsSafe = effectiveValidate(src);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) {
        return;
      }
      // Never route an unsafe `src` into the lightbox modal — the root
      // re-validates there too, but stopping here keeps the user from
      // getting a blank modal that feels broken.
      if (!srcIsSafe) return;
      lightbox?.openLightbox({ src, alt });
    },
    [lightbox, onClick, src, alt, srcIsSafe],
  );

  const thumbnailButton = (
    <button
      type="button"
      onClick={handleClick}
      aria-label={accessibleName}
      className="airo-chat-user-message__image-button"
      // An unsafe scheme leaves the button in the DOM (so the tile keeps
      // its shape and accessible name inside the gallery flow) but marks
      // it non-interactive — pressing the placeholder does nothing, and
      // assistive tech announces it as disabled rather than a broken
      // action.
      disabled={srcIsSafe ? undefined : true}
    >
      {srcIsSafe ? (
        <img
          {...rest}
          src={src}
          // The `<button>` wrapper owns the accessible name via `aria-label`.
          // Keeping the inner `<img>` with `alt=""` + `aria-hidden` avoids
          // screen readers announcing the same name twice.
          alt=""
          aria-hidden="true"
          className="airo-chat-user-message__image-img"
        />
      ) : (
        // Unsafe-scheme placeholder: a same-sized neutral square so the
        // gallery layout doesn't collapse, marked aria-hidden so the
        // wrapping button's aria-label still carries the filename.
        <span
          className="airo-chat-user-message__image-img airo-chat-user-message__image-img--unsafe"
          aria-hidden="true"
        />
      )}
    </button>
  );

  if (layout === 'list') {
    return (
      <ListItem
        id={reactId}
        compact
        actions={cornerActions}
        media={
          <span
            className={classnames(
              'airo-chat-user-message__file-media',
              'airo-chat-user-message__file-media--image',
            )}
          >
            {thumbnailButton}
          </span>
        }
        className={classnames('airo-chat-user-message__image-list-item', className)}
      >
        <span className="airo-chat-user-message__image-caption">{accessibleName}</span>
      </ListItem>
    );
  }

  return (
    <span className={classnames('airo-chat-user-message__image', className)}>
      {thumbnailButton}
      {cornerActions ? (
        <span className="airo-chat-user-message__image-corner" aria-hidden="true">
          {cornerActions}
        </span>
      ) : null}
    </span>
  );
}
