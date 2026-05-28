import Box from '@ux/box';
import Modal from '@ux/modal';
import text from '@ux/text';
import classnames from 'classnames';
import { type HTMLAttributes, type ReactNode, useCallback, useId, useMemo, useState } from 'react';

import { UserMessageFile } from './UserMessageFile';
import { UserMessageGallery } from './UserMessageGallery';
import { UserMessageImage } from './UserMessageImage';
import { UserMessageLightboxContext, UserMessageUrlPolicyContext } from './context';
import { type UrlValidator, isSafeHref, isSafeImgSrc } from './urlGuard';

const DEFAULT_ARIA_LABEL = 'You said';
const DEFAULT_LIGHTBOX_CLOSE_LABEL = 'Close image preview';
const DEFAULT_LIGHTBOX_FALLBACK_LABEL = 'Image preview';

type LightboxItem = { src: string; alt?: string };

/**
 * Props for `UserMessage`, the right-aligned chat bubble used for the
 * end-user's turn in the conversation.
 */
export interface UserMessageProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /**
   * Message contents. A plain string renders through `@ux/text` as a single
   * paragraph — the most common shape. Nodes pass through unchanged, so
   * consumers can layer in `<UserMessage.Gallery>` (above the text) or
   * custom text markup when needed.
   */
  children?: ReactNode;
  /**
   * Accessible name for the message group. Defaults to `"You said"` so
   * screen-reader users hear a clear turn label even before the visible
   * content. Localize via this prop, or pass a native `aria-label` attribute
   * for compatibility.
   *
   * @default 'You said'
   */
  ariaLabel?: string;
  /**
   * Accessible label for the lightbox close button. Defaults to
   * `"Close image preview"`.
   *
   * @default 'Close image preview'
   */
  lightboxCloseLabel?: string;
  /**
   * Predicate used to validate every `UserMessage.Image` `src` before it
   * reaches an `<img>` DOM sink (both thumbnail and lightbox). Return
   * `true` to allow the URL, `false` to skip rendering the `<img>` while
   * keeping the tile's accessible name intact. Flows down via context to
   * every `UserMessage.Image` inside this message, so the thumbnail and
   * the lightbox preview share a single policy.
   *
   * Defaults to the library's scheme allow-list from `SECURITY.md §3.1`:
   * `http:` and `https:` (plus relative / fragment URLs, which inherit
   * `https:` from the parse root). `javascript:`, `data:`, `vbscript:`,
   * `file:`, and `blob:` are all rejected by default.
   *
   * This is a *policy hook*, not a sanitizer — `@airo-ux/pattern-library` ships a
   * safe baseline because an XSS sink with no default is worse than a
   * working default consumers can widen or tighten. A stricter consumer
   * CSP is the right place to narrow this further; a consumer that
   * legitimately needs to pass `data:image/svg+xml` (e.g. from an
   * in-house SVG factory) can widen it here. The raw default predicate
   * is re-exported as `isSafeImgSrc` so it can be composed.
   *
   * @default isSafeImgSrc
   */
  validateSrc?: UrlValidator;
  /**
   * Predicate used to validate every `UserMessage.File` `href` before it
   * reaches an `<a href>` DOM sink. See `validateSrc` — same contract,
   * different sink. Defaults to the library's default `isSafeHref`
   * predicate, which allows `http:`, `https:`, `mailto:`, `tel:`, `sms:`,
   * and relative / fragment URLs.
   *
   * Flows down to every `UserMessage.File` child via the gallery
   * context; a per-file `validateHref` prop still wins over this.
   *
   * @default isSafeHref
   */
  validateHref?: UrlValidator;
}

/**
 * `UserMessage` renders the end-user's turn as a right-aligned chat bubble.
 * The block follows the `@ux/card` surface conventions (elevated card with
 * padding) but squares the bubble's block-end / inline-end corner so the
 * tail visually points at the user's avatar. The block-end / inline-start
 * edge of an agent bubble mirrors this treatment on the opposite side.
 *
 * Compound slots:
 * - `<UserMessage.Gallery>` — media region above the text (1–N tiles).
 * - `<UserMessage.Image>` — image tile; clicking opens a shared lightbox.
 * - `<UserMessage.File>` — uploaded-file tile with an icon + filename.
 *
 * The lightbox modal is owned by the root `UserMessage` and shared across
 * every `UserMessage.Image` inside. Clicking an image sets the current
 * lightbox item; clicking outside, pressing `Escape`, or tapping the close
 * control resets it.
 *
 * @example
 * <UserMessage>
 *   <UserMessage.Gallery>
 *     <UserMessage.Image src="/photos/hero.jpg" alt="Landing page hero" />
 *     <UserMessage.File name="requirements.pdf" icon="document" />
 *   </UserMessage.Gallery>
 *   Can you use these as the reference for the design?
 * </UserMessage>
 */
function UserMessageRoot({
  children,
  ariaLabel,
  'aria-label': ariaLabelAttribute,
  lightboxCloseLabel,
  validateSrc = isSafeImgSrc,
  validateHref = isSafeHref,
  className,
  ...rest
}: UserMessageProps) {
  const [lightboxItem, setLightboxItem] = useState<LightboxItem | null>(null);
  const captionId = useId();

  const openLightbox = useCallback((item: LightboxItem) => {
    setLightboxItem(item);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxItem(null);
  }, []);

  const lightboxContextValue = useMemo(() => ({ openLightbox }), [openLightbox]);

  const urlPolicyValue = useMemo(
    () => ({ validateSrc, validateHref }),
    [validateSrc, validateHref],
  );

  const accessibleName = ariaLabelAttribute ?? ariaLabel ?? DEFAULT_ARIA_LABEL;
  const closeLabel = lightboxCloseLabel ?? DEFAULT_LIGHTBOX_CLOSE_LABEL;
  const caption = lightboxItem?.alt?.trim() ?? '';
  // Belt-and-suspenders: the `Image` tile also validates before calling
  // `openLightbox`, but re-checking here means a bypass through the
  // context (e.g. a consumer that reaches into our private API) still
  // can't reach an `<img src>` sink with an unsafe scheme.
  const lightboxSrcIsSafe = lightboxItem ? validateSrc(lightboxItem.src) : false;

  const renderedChildren =
    typeof children === 'string' ? (
      <text.p as="paragraph" className="airo-chat-user-message__text">
        {children}
      </text.p>
    ) : (
      children
    );

  return (
    <UserMessageUrlPolicyContext.Provider value={urlPolicyValue}>
      <UserMessageLightboxContext.Provider value={lightboxContextValue}>
        <article
          {...rest}
          aria-label={accessibleName}
          className={classnames('airo-chat-user-message', className)}
        >
          <Box
            elevation="card"
            blockPadding="md"
            inlinePadding="md"
            orientation="vertical"
            gap="sm"
            className="airo-chat-user-message__bubble"
          >
            {renderedChildren}
          </Box>
        </article>
        {/*
         * `@ux/modal` treats a falsy `title` at runtime by skipping the
         * TextLockup title row entirely and moving the close button onto the
         * description slot (see `@ux/modal/src/index.jsx`). We use that
         * built-in behavior — passing `title={null}` instead of a visible
         * heading — so the preview reads as "image + filename caption"
         * rather than "image with redundant 'Image preview' header".
         *
         * A dialog still needs an accessible name, and with no title there
         * is no labelled element in the header. We forward `aria-labelledby`
         * through the modal's `...rest` spread so the outer `role="dialog"`
         * Box points at the caption paragraph we render below the image.
         *
         * `@ux/modal`'s outer Box bakes in `blockPadding='xl' inlinePadding='xl'`
         * with no public escape hatch (the docs explicitly note "No styles
         * can be overridden directly, it must be done through the theme"),
         * so the image carries the modal's own padding. Per the "remove
         * image padding only if possible without an override" constraint,
         * we leave the modal padding alone and add `lg` inline + block
         * padding around the caption paragraph via our own `<Box>` wrapper
         * so the caption reads as a distinct label row rather than bumping
         * flush against the image.
         */}
        <Modal
          show={lightboxItem !== null}
          onClose={closeLightbox}
          // `ModalProps['title']` is typed `string | ReactNode`; `null` is a
          // valid `ReactNode`, which both (a) satisfies the type without any
          // `any` cast, and (b) triggers Modal's own falsy-title runtime
          // branch that elides the TextLockup title row entirely — exactly
          // the behavior we want per the block comment above.
          title={null}
          ariaLabels={{ close: closeLabel }}
          aria-labelledby={caption ? captionId : undefined}
          aria-label={caption ? undefined : DEFAULT_LIGHTBOX_FALLBACK_LABEL}
          className="airo-chat-user-message__lightbox"
        >
          {lightboxItem && lightboxSrcIsSafe ? (
            <img
              src={lightboxItem.src}
              alt={lightboxItem.alt ?? ''}
              className="airo-chat-user-message__lightbox-img"
            />
          ) : null}
          {caption ? (
            <Box blockPadding="lg" inlinePadding="lg">
              <text.p
                as="paragraph"
                id={captionId}
                className="airo-chat-user-message__lightbox-caption"
              >
                {caption}
              </text.p>
            </Box>
          ) : null}
        </Modal>
      </UserMessageLightboxContext.Provider>
    </UserMessageUrlPolicyContext.Provider>
  );
}

/**
 * Public API: `UserMessage` plus its compound `Gallery`, `Image`, and
 * `File` slots. Attached after declaration so all names resolve to the
 * correct functions while keeping the file tree-shakeable.
 */
export const UserMessage = Object.assign(UserMessageRoot, {
  Gallery: UserMessageGallery,
  Image: UserMessageImage,
  File: UserMessageFile,
});
