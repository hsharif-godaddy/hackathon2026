import { createContext } from 'react';

import { type UrlValidator, isSafeHref, isSafeImgSrc } from './urlGuard';

/**
 * Internal context that lets `UserMessage.Image` request the parent
 * `UserMessage`'s lightbox modal. Outside a `UserMessage`, the context value
 * is `null`; consumers that render `UserMessage.Image` stand-alone keep
 * their `onClick` handler as the only opening path.
 */
export type UserMessageLightboxContextValue = {
  openLightbox: (item: { src: string; alt?: string }) => void;
} | null;

export const UserMessageLightboxContext = createContext<UserMessageLightboxContextValue>(null);

/**
 * URL-handling policy for every compound tile inside a `UserMessage`.
 * Lives in a separate context from {@link UserMessageLightboxContext} so
 * `UserMessage.File` can read the `href` validator without subscribing to
 * a lightbox handler it never uses (and vice-versa for `Image`).
 *
 * Both validators default to the library baselines from SECURITY.md §3.1
 * (`isSafeImgSrc` / `isSafeHref`) so a stand-alone tile rendered outside
 * a `UserMessage` still has a safe default — the root-level props are a
 * consumer-override seam, not the only line of defense.
 */
export type UserMessageUrlPolicyContextValue = {
  validateSrc: UrlValidator;
  validateHref: UrlValidator;
};

export const UserMessageUrlPolicyContext = createContext<UserMessageUrlPolicyContextValue>({
  validateSrc: isSafeImgSrc,
  validateHref: isSafeHref,
});

/**
 * Layout mode for a `UserMessage.Gallery`. `strip` is the default
 * horizontal scrolling "hero + thumbs" row used for image-only galleries.
 * `list` is the vertical `@ux/list-item` stack used when any file tiles
 * are present — mixing images and files in the same strip looked cramped
 * in the Figma exploration because files need a readable filename next
 * to the icon, not underneath it.
 *
 * When the mode is `list`, `UserMessage.Image` and `UserMessage.File`
 * render through `@ux/list-item` with a fixed-size media slot instead of
 * their freestanding card-tile chrome.
 */
export type UserMessageGalleryLayout = 'strip' | 'list';

/**
 * Internal context set by `UserMessage.Gallery` so its tile children know
 * which layout mode to render. Outside a gallery (the tile used as a
 * standalone preview), the context falls back to `strip`, which is the
 * original free-standing tile chrome.
 */
export const UserMessageGalleryContext = createContext<UserMessageGalleryLayout>('strip');
