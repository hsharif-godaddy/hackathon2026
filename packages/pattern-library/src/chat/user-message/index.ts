export { UserMessage } from './UserMessage';
export type { UserMessageProps } from './UserMessage';
export { UserMessageGallery } from './UserMessageGallery';
export type { UserMessageGalleryProps } from './UserMessageGallery';
export { UserMessageImage } from './UserMessageImage';
export type { UserMessageImageProps } from './UserMessageImage';
export { UserMessageFile } from './UserMessageFile';
export type { UserMessageFileProps } from './UserMessageFile';
// URL-guard building blocks. Re-exported so consumers can compose the
// library default with their own policy (e.g. "library default OR
// `data:image/svg+xml;base64,` from my known-safe SVG factory") and pass
// the result to `UserMessage`'s `validateSrc` / `validateHref` props.
export { isSafeImgSrc, isSafeHref } from './urlGuard';
export type { UrlValidator } from './urlGuard';
