import Card from '@ux/card';
import AsyncIcon from '@ux/icon/async-icon.js';
import ListItem from '@ux/list-item';
import text from '@ux/text';
import classnames from 'classnames';
import {
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useId,
} from 'react';

import { UserMessageGalleryContext, UserMessageUrlPolicyContext } from './context';
import type { UrlValidator } from './urlGuard';

/**
 * Fallback icon name for `UserMessage.File` when the filename's extension
 * isn't in `FILE_ICON_MAP`. `@ux/icon` ships an `attachment` icon (a
 * paperclip) but does not ship a generic `file` or `document` icon; the
 * paperclip reads universally as "uploaded file" and is the closest match.
 * When/if `@ux/icon` adds a `file` icon, flip this constant to `'file'`.
 */
const DEFAULT_FILE_ICON = 'attachment';

/**
 * Map a filename extension (lowercased, no dot) to an `@ux/icon` name.
 * Only extensions with a first-party icon are listed — everything else
 * falls back to `DEFAULT_FILE_ICON`. Keep this list focused on the common
 * office/dev/media extensions; exhaustive MIME coverage should come from
 * the icon library, not a hand-maintained lookup.
 */
const FILE_ICON_MAP: Record<string, string> = {
  doc: 'word',
  docx: 'word',
  rtf: 'word',
  odt: 'word',
  xls: 'excel',
  xlsx: 'excel',
  csv: 'excel',
  ods: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  odp: 'powerpoint',
  key: 'powerpoint',
  keynote: 'powerpoint',
  zip: 'archive',
  tar: 'archive',
  tgz: 'archive',
  gz: 'archive',
  rar: 'archive',
  '7z': 'archive',
  mp4: 'video',
  mov: 'video',
  avi: 'video',
  webm: 'video',
  mkv: 'video',
  wmv: 'video',
  m4v: 'video',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  heic: 'image',
  js: 'code',
  cjs: 'code',
  mjs: 'code',
  ts: 'code',
  tsx: 'code',
  jsx: 'code',
  html: 'code',
  htm: 'code',
  css: 'code',
  scss: 'code',
  sass: 'code',
  less: 'code',
  json: 'code',
  xml: 'code',
  yaml: 'code',
  yml: 'code',
  py: 'code',
  rb: 'code',
  java: 'code',
  php: 'code',
  c: 'code',
  cpp: 'code',
  h: 'code',
  hpp: 'code',
  cs: 'code',
  go: 'code',
  rs: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  sql: 'code',
  toml: 'code',
  ini: 'code',
  env: 'code',
};

/**
 * Resolve an `@ux/icon` name from a filename. The extension is taken from
 * the final `.`-segment of the name (case-insensitive); unknown extensions
 * and extensionless names return `DEFAULT_FILE_ICON`.
 */
export function resolveFileIcon(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return DEFAULT_FILE_ICON;
  const ext = name.slice(dot + 1).toLowerCase();
  return FILE_ICON_MAP[ext] ?? DEFAULT_FILE_ICON;
}

/**
 * Props for `UserMessage.File`, the file-thumbnail tile rendered inside a
 * `UserMessage.Gallery`.
 */
export interface UserMessageFileProps
  // `@ux/card` re-types `onChange` as an enhanced form handler, so we omit the
  // native DOM handler here to avoid a structural mismatch when we forward
  // props through to the card wrapper. Consumers who need click-through should
  // use `href` / `target` rather than `onChange`.
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /**
   * Display name for the file, typically the original filename from the
   * user's upload (e.g. `requirements.pdf`). Rendered as the tile's
   * accessible label and its visible caption.
   */
  name: string;
  /**
   * Icon name forwarded to `@ux/icon/async-icon.js`. When omitted, the
   * icon is inferred from the filename's extension via `resolveFileIcon`
   * (e.g. `"word"` for `.docx`, `"excel"` for `.csv`), falling back to
   * `"attachment"` for unknown types. Pass an explicit value to override
   * the heuristic.
   */
  icon?: string;
  /**
   * When set, renders a real `<a>` (or an anchor-backed list item in the
   * list layout) so the file can be opened in a new tab or downloaded.
   * Omit for display-only tiles that carry no click behavior.
   */
  href?: string;
  /**
   * Anchor `target` applied when `href` is set. When `"_blank"`, the
   * component injects `rel="noopener noreferrer"` to close the
   * reverse-tabnabbing hole.
   */
  target?: AnchorHTMLAttributes<HTMLAnchorElement>['target'];
  /**
   * Override the rendered icon entirely. When supplied, `icon` is ignored.
   * Use this slot for custom SVG marks or a small image preview.
   */
  iconSlot?: ReactNode;
  /**
   * Supply any extra chrome that should render inside the card but above
   * the icon (e.g. a remove button from the parent uploader). Rendered
   * via `@ux/card`'s `cornerActions` slot in the strip layout, or
   * forwarded to the list item's `actions` slot in the list layout.
   */
  cornerActions?: ReactNode;
  /**
   * Per-tile override for the `href` URL-guard predicate. See the
   * `validateHref` prop on `UserMessage` for the full contract. When
   * omitted, the tile inherits the parent `UserMessage`'s `validateHref`;
   * outside a `UserMessage` it falls back to the library default
   * (`isSafeHref`).
   *
   * When the predicate returns `false`, the tile is rendered with no
   * `href` — the filename still appears but the click-through is
   * suppressed, matching the library-default rejection for unsafe
   * schemes like `javascript:` / `data:` per SECURITY.md §3.1.
   */
  validateHref?: UrlValidator;
}

/**
 * `UserMessage.File` is the uploaded-file tile inside a
 * `UserMessage.Gallery`. In the default strip layout it renders an
 * `@ux/card` with a large file-type icon above the filename caption; in
 * the list layout (mixed-content galleries) it renders an
 * `@ux/list-item` with the icon tucked into a 64px media square next to
 * a filename row. The file-type icon is inferred from the filename's
 * extension unless the `icon` prop overrides it. When `href` is set, the
 * tile becomes a real anchor so the file can be opened or downloaded;
 * otherwise the tile is a non-interactive surface.
 */
export function UserMessageFile({
  name,
  icon,
  href,
  target,
  iconSlot,
  cornerActions,
  validateHref,
  className,
  id,
  ...rest
}: UserMessageFileProps) {
  const generatedId = useId();
  const reactId = id ?? generatedId;
  const layout = useContext(UserMessageGalleryContext);
  const urlPolicy = useContext(UserMessageUrlPolicyContext);
  const effectiveValidate = validateHref ?? urlPolicy.validateHref;
  // `href === ''` is treated as "no link" same as `href === undefined`:
  // `@ux/list-item`'s anchor renderer treats empty `href` as the current
  // page, which is both useless and a minor UX footgun.
  const hrefIsSafe = typeof href === 'string' && href.length > 0 && effectiveValidate(href);
  const isLink = hrefIsSafe;
  const safeHref = isLink ? href : undefined;
  const safeRel = isLink && target === '_blank' ? 'noopener noreferrer' : undefined;
  const resolvedIcon = icon ?? resolveFileIcon(name);

  if (layout === 'list') {
    // Let `@ux/icon/async-icon.js` fall back to its default `1.5em` (≈ 24px
    // at the 16px root) so the glyph sits inside the 64px media rail with
    // a comfortable margin instead of crowding the padded interior.
    const mediaIcon = iconSlot ?? <AsyncIcon icon={resolvedIcon} />;
    // `@ux/list-item` types its root props as `ComponentProps<'div'>`, so
    // (a) `target` / `rel` aren't in its prop map (even though the runtime
    // spreads them through to the underlying `box.a` when `href` is set),
    // and (b) its `onClick` is typed against `HTMLDivElement | HTMLAnchorElement`,
    // which conflicts with the broader `MouseEventHandler<HTMLDivElement>`
    // that arrives via `...rest`. Forward through an untyped bag so we
    // don't have to bail out on either axis.
    const listItemExtras: Record<string, unknown> = { ...rest };
    if (isLink && target) {
      listItemExtras.target = target;
      if (safeRel) listItemExtras.rel = safeRel;
    }
    return (
      <ListItem
        {...(listItemExtras as Record<string, never>)}
        id={reactId}
        href={safeHref}
        compact
        actions={cornerActions}
        media={
          <span
            className={classnames(
              'airo-chat-user-message__file-media',
              'airo-chat-user-message__file-media--icon',
            )}
            aria-hidden="true"
          >
            {mediaIcon}
          </span>
        }
        className={classnames('airo-chat-user-message__file-list-item', className)}
      >
        <span className="airo-chat-user-message__file-name">{name}</span>
      </ListItem>
    );
  }

  // The `<a>` (not the surrounding `Card`) is the semantic link so `href`,
  // `target`, and `rel` end up on the element that honors them, and screen
  // readers read the filename as the link's accessible name. When the
  // `href` fails the URL guard we render the filename as a plain caption
  // instead — same visual treatment, no clickable sink.
  const caption = isLink ? (
    <a
      href={safeHref}
      target={target}
      rel={safeRel}
      className="airo-chat-user-message__file-name airo-chat-user-message__file-link"
    >
      {name}
    </a>
  ) : (
    <text.span as="label" size={-1} className="airo-chat-user-message__file-name">
      {name}
    </text.span>
  );

  return (
    <Card
      {...rest}
      id={reactId}
      cornerActions={cornerActions}
      className={classnames('airo-chat-user-message__file', className)}
      aria-label={isLink ? undefined : name}
    >
      <span className="airo-chat-user-message__file-icon" aria-hidden="true">
        {iconSlot ?? <AsyncIcon icon={resolvedIcon} />}
      </span>
      {caption}
    </Card>
  );
}
