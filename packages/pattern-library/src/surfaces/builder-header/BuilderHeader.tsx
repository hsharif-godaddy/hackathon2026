import Box, { box } from '@ux/box';
import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import Tag from '@ux/tag';
import classnames from 'classnames';
import { type HTMLAttributes, type JSX, type ReactNode, useState } from 'react';

// Temporary vendor — see `src/_vendor/segmented-controller/README.md`. When
// antares ships PR #187, swap this import back to `@godaddy/antares` (antares
// auto-loads its own CSS) and drop the matching `@import` line from
// `src/surfaces/builder-header/styles.css`.
import { SegmentedController, SegmentedControllerItem } from '../../_vendor/segmented-controller';
import { AiroWordmark } from '../airo-wordmark';

const DEFAULT_GODADDY_ARIA_LABEL = 'GoDaddy';
const DEFAULT_AIRO_ARIA_LABEL = 'Airo';
const DEFAULT_BETA_LABEL = 'Beta';
const DEFAULT_SECTIONS_ARIA_LABEL = 'Builder sections';
const DEFAULT_PUBLISH_LABEL = 'Publish';
const DEFAULT_SHARE_LABEL = 'Share';
const DEFAULT_REFRESH_LABEL = 'Refresh';
const DEFAULT_DESKTOP_LABEL = 'Switch to desktop view';
const DEFAULT_MOBILE_LABEL = 'Switch to mobile view';
const DEFAULT_USER_LABEL = 'User menu';

// ─── Section descriptor ───────────────────────────────────────────────────

/**
 * Describes a single segment in the builder header's center
 * `SegmentedController`. Maps directly to a `@godaddy/antares`
 * `SegmentedControllerItem` plus a leading `AsyncIcon`.
 */
export interface BuilderHeaderSection {
  /** Stable identifier — echoed back via `onSectionChange`. */
  id: string;
  /** Visible segment label. */
  label: string;
  /** `@ux/icon/async-icon` icon name shown to the left of the label. */
  icon: string;
}

/**
 * Default builder section list — palette, preview, edit, code, domains.
 * Provided as a convenience for the canonical builder layout; consumers
 * can pass their own ordered list.
 */
export const DEFAULT_BUILDER_SECTIONS: BuilderHeaderSection[] = [
  { id: 'brand', label: 'Logo & brand', icon: 'color-palette' },
  { id: 'preview', label: 'Preview', icon: 'website' },
  { id: 'edit', label: 'Edit', icon: 'wand' },
  { id: 'code', label: 'Code', icon: 'code' },
  { id: 'domains', label: 'Domains', icon: 'domain' },
];

// ─── Brand cluster (leading) ──────────────────────────────────────────────

/** Props for {@link BuilderHeaderBrand}. */
export interface BuilderHeaderBrandProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * Override for the GoDaddy logo node. Defaults to the official
   * `gd-the-go` `AsyncIcon` mark; pass a different brand asset (custom
   * wordmark, partner co-branding, etc.) to override.
   */
  godaddyLogo?: ReactNode;
  /**
   * Override for the Airo logo node. Defaults to the inline Airo wordmark.
   */
  airoLogo?: ReactNode;
  /** When `true`, renders a "Beta" tag after the Airo wordmark. @default true */
  showBetaTag?: boolean;
  /** Visible text for the Beta tag. @default "Beta" */
  betaLabel?: string;
  /** Accessible label for the GoDaddy logo image. @default "GoDaddy" */
  godaddyAriaLabel?: string;
  /** Accessible label for the Airo logo image. @default "Airo" */
  airoAriaLabel?: string;
}

/**
 * Leading brand cluster: GoDaddy logo + Airo logo + optional "Beta" tag.
 * Defaults can be replaced individually via the `godaddyLogo` / `airoLogo`
 * slots so consumers swap in their own brand assets without rebuilding
 * the cluster.
 *
 * @example
 * ```tsx
 * // Default cluster (GoDaddy "Go" mark + Airo wordmark + Beta tag)
 * <BuilderHeader.Brand />
 *
 * // Replace one piece without rebuilding the cluster
 * <BuilderHeader.Brand
 *   godaddyLogo={<MyBrandMark />}
 *   showBetaTag={false}
 * />
 * ```
 */
export function BuilderHeaderBrand({
  godaddyLogo,
  airoLogo,
  showBetaTag = true,
  betaLabel = DEFAULT_BETA_LABEL,
  godaddyAriaLabel = DEFAULT_GODADDY_ARIA_LABEL,
  airoAriaLabel = DEFAULT_AIRO_ARIA_LABEL,
  className,
  ...rest
}: BuilderHeaderBrandProps): JSX.Element {
  return (
    <Box
      orientation="horizontal"
      displayType="flex"
      inlineAlignChildren="center"
      gap="sm"
      {...rest}
      className={classnames('airo-surfaces-builder-header__brand', className)}
    >
      {godaddyLogo ?? <GoDaddyWordmark ariaLabel={godaddyAriaLabel} />}
      {airoLogo ?? <AiroWordmark ariaLabel={airoAriaLabel} />}
      {showBetaTag && betaLabel != null ? (
        <Tag size="sm" emphasis="highlight">
          {betaLabel}
        </Tag>
      ) : null}
    </Box>
  );
}

// ─── Sections cluster (center) ────────────────────────────────────────────

/** Props for {@link BuilderHeaderSections}. */
export interface BuilderHeaderSectionsProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'children'> {
  /** Ordered list of segments. Pass `[]` to render nothing. */
  sections: BuilderHeaderSection[];
  /**
   * Controlled active section id. Pair with `onSectionChange` for full
   * control, or use `defaultActiveSectionId` for uncontrolled mode.
   *
   * @see {@link BuilderHeaderSectionsProps.defaultActiveSectionId}
   * @see {@link BuilderHeaderSectionsProps.onSectionChange}
   */
  activeSectionId?: string;
  /**
   * Initial active section id in uncontrolled mode. Defaults to
   * `sections[0]?.id`.
   *
   * @see {@link BuilderHeaderSectionsProps.activeSectionId}
   * @see {@link BuilderHeaderSectionsProps.onSectionChange}
   */
  defaultActiveSectionId?: string;
  /**
   * Fires when the user selects a different segment.
   *
   * @see {@link BuilderHeaderSectionsProps.activeSectionId}
   * @see {@link BuilderHeaderSectionsProps.defaultActiveSectionId}
   */
  onSectionChange?: (id: string) => void;
  /** Accessible label for the `SegmentedController`. @default "Builder sections" */
  ariaLabel?: string;
  /**
   * When `true`, inactive segments collapse to their icon and surface
   * their label as a tooltip on hover/focus, so the row reads as a
   * compact icon strip with a single expanded label for the active
   * section. The container reserves the worst-case label width so the
   * outer footprint stays stable as selection changes.
   *
   * Defaults to `false` — every segment stays fully expanded with both
   * icon and label visible at all times. Set to `true` to enable the
   * compact strip behavior.
   *
   * @default false
   */
  collapseInactive?: boolean;
}

/**
 * Center cluster — `@godaddy/antares` `SegmentedController` showing
 * sections of the builder app (palette, preview, edit, code, domains by
 * default). antares owns focus management, keyboard navigation, and the
 * sliding active indicator.
 *
 * Standard HTML attributes (`id`, `data-*`, etc.) forward to the
 * wrapping `<div>` so the section row is addressable for tests and
 * instrumentation.
 *
 * @example
 * ```tsx
 * <BuilderHeader.Sections
 *   sections={DEFAULT_BUILDER_SECTIONS}
 *   defaultActiveSectionId="edit"
 *   onSectionChange={setSection}
 *   data-testid="builder-sections"
 * />
 * ```
 */
export function BuilderHeaderSections({
  sections,
  activeSectionId,
  defaultActiveSectionId,
  onSectionChange,
  ariaLabel = DEFAULT_SECTIONS_ARIA_LABEL,
  collapseInactive = false,
  className,
  ...rest
}: BuilderHeaderSectionsProps): JSX.Element | null {
  if (sections.length === 0) return null;
  const effectiveDefault = defaultActiveSectionId ?? sections[0]?.id;
  return (
    <div {...rest} className={classnames('airo-surfaces-builder-header__sections', className)}>
      <SegmentedController
        aria-label={ariaLabel}
        size="md"
        collapseInactive={collapseInactive}
        {...(activeSectionId !== undefined
          ? { value: activeSectionId }
          : { defaultValue: effectiveDefault })}
        onSelectionChange={onSectionChange}
        className="airo-surfaces-builder-header__segmented"
      >
        {sections.map((section) => (
          <SegmentedControllerItem
            key={section.id}
            value={section.id}
            // The vendored item handles icon + label layout (icon-leading
            // flex with internal gap), so the previous Box wrapper isn't
            // needed. The label string also doubles as the tooltip text
            // when `collapseInactive` is on and this segment is inactive.
            icon={<AsyncIcon icon={section.icon} />}
          >
            {section.label}
          </SegmentedControllerItem>
        ))}
      </SegmentedController>
    </div>
  );
}

// ─── Actions cluster (trailing) ───────────────────────────────────────────

/** Device toggle value for the device-switcher button. */
export type BuilderHeaderDevice = 'desktop' | 'mobile';

/** Props for {@link BuilderHeaderActions}. */
export interface BuilderHeaderActionsProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * Controlled device-toggle value. Pair with `onDeviceChange`.
   *
   * @see {@link BuilderHeaderActionsProps.defaultDevice}
   * @see {@link BuilderHeaderActionsProps.onDeviceChange}
   */
  device?: BuilderHeaderDevice;
  /**
   * Initial device value when uncontrolled. @default 'desktop'
   *
   * @see {@link BuilderHeaderActionsProps.device}
   * @see {@link BuilderHeaderActionsProps.onDeviceChange}
   */
  defaultDevice?: BuilderHeaderDevice;
  /**
   * Fires when the user toggles the device button.
   *
   * @see {@link BuilderHeaderActionsProps.device}
   * @see {@link BuilderHeaderActionsProps.defaultDevice}
   */
  onDeviceChange?: (device: BuilderHeaderDevice) => void;
  /** Click handler for the refresh button. */
  onRefresh?: () => void;
  /** Click handler for the share button. */
  onShare?: () => void;
  /** Click handler for the publish primary button. */
  onPublish?: () => void;
  /** Click handler for the user menu trigger. */
  onUserClick?: () => void;
  /** Accessible label for refresh. @default "Refresh" */
  refreshLabel?: string;
  /** Accessible label for the device toggle when current view is mobile. @default "Switch to desktop view" */
  desktopLabel?: string;
  /** Accessible label for the device toggle when current view is desktop. @default "Switch to mobile view" */
  mobileLabel?: string;
  /** Accessible label for share. @default "Share" */
  shareLabel?: string;
  /** Visible text for the publish primary button. @default "Publish" */
  publishLabel?: string;
  /** Accessible label for the user menu trigger. @default "User menu" */
  userLabel?: string;
  /**
   * When `true`, forces the refresh button to render even without an
   * `onRefresh` handler. When `false`, hides it. The implicit default
   * — shown only when `onRefresh` is provided — avoids rendering an
   * enabled button that does nothing on click.
   *
   * @default Boolean(onRefresh)
   */
  showRefresh?: boolean;
  /**
   * When `false`, hides the device toggle.
   *
   * @default true
   */
  showDevice?: boolean;
  /**
   * When `true`, forces the share button to render even without an
   * `onShare` handler. When `false`, hides it. The implicit default
   * — shown only when `onShare` is provided — avoids rendering an
   * enabled button that does nothing on click.
   *
   * @default Boolean(onShare)
   */
  showShare?: boolean;
  /**
   * When `true`, forces the publish primary button to render even
   * without an `onPublish` handler. When `false`, hides it. The
   * implicit default — shown only when `onPublish` is provided —
   * avoids rendering an enabled button that does nothing on click.
   *
   * @default Boolean(onPublish)
   */
  showPublish?: boolean;
  /**
   * When `true`, forces the user menu trigger to render even without
   * an `onUserClick` handler. When `false`, hides it. The implicit
   * default — shown only when `onUserClick` is provided — avoids
   * rendering an enabled button that does nothing on click.
   *
   * @default Boolean(onUserClick)
   */
  showUser?: boolean;
}

/**
 * Trailing cluster — refresh, device toggle, share, publish, user.
 * Rendered inside a `sm`-padded card-like surface (no border) so the
 * group reads as a single grouped affordance against the page canvas.
 *
 * The device button toggles between `desktop` and `mobile`. State is
 * controlled via `device` + `onDeviceChange` or uncontrolled with
 * `defaultDevice`.
 *
 * @example
 * ```tsx
 * <BuilderHeader.Actions
 *   onPublish={publish}
 *   onShare={share}
 *   onRefresh={reload}
 *   onUserClick={openUserMenu}
 *   onDeviceChange={setPreviewDevice}
 *   showRefresh={false}
 * />
 * ```
 */
export function BuilderHeaderActions({
  device,
  defaultDevice = 'desktop',
  onDeviceChange,
  onRefresh,
  onShare,
  onPublish,
  onUserClick,
  refreshLabel = DEFAULT_REFRESH_LABEL,
  desktopLabel = DEFAULT_DESKTOP_LABEL,
  mobileLabel = DEFAULT_MOBILE_LABEL,
  shareLabel = DEFAULT_SHARE_LABEL,
  publishLabel = DEFAULT_PUBLISH_LABEL,
  userLabel = DEFAULT_USER_LABEL,
  showRefresh,
  showDevice = true,
  showShare,
  showPublish,
  showUser,
  className,
  ...rest
}: BuilderHeaderActionsProps): JSX.Element {
  const isDeviceControlled = device !== undefined;
  const [internalDevice, setInternalDevice] = useState<BuilderHeaderDevice>(defaultDevice);
  const currentDevice = isDeviceControlled ? device : internalDevice;
  // Buttons whose only behavior is the consumer's handler default to
  // hidden when no handler is provided — rendering an enabled button
  // that does nothing on click is a worse default than not rendering
  // it at all. An explicit `showX={true}` still forces the button so
  // a consumer can stage UI before the handler is wired. The device
  // toggle is exempt: it has internal state (icon flip) that's
  // meaningful even without `onDeviceChange`.
  const renderRefresh = showRefresh ?? Boolean(onRefresh);
  const renderShare = showShare ?? Boolean(onShare);
  const renderPublish = showPublish ?? Boolean(onPublish);
  const renderUser = showUser ?? Boolean(onUserClick);

  const toggleDevice = () => {
    const next: BuilderHeaderDevice = currentDevice === 'desktop' ? 'mobile' : 'desktop';
    if (!isDeviceControlled) setInternalDevice(next);
    onDeviceChange?.(next);
  };

  return (
    <Box
      orientation="horizontal"
      displayType="flex"
      inlineAlignChildren="center"
      inlinePadding="sm"
      blockPadding="sm"
      gap="sm"
      {...rest}
      className={classnames('airo-surfaces-builder-header__actions', className)}
    >
      {renderRefresh && (
        <Button
          design="tertiary"
          size="small"
          icon={<AsyncIcon icon="refresh" />}
          aria-label={refreshLabel}
          onClick={onRefresh}
        />
      )}
      {showDevice && (
        <Button
          design="tertiary"
          size="small"
          icon={<AsyncIcon icon={currentDevice === 'desktop' ? 'desktop' : 'mobile-phone'} />}
          aria-label={currentDevice === 'desktop' ? mobileLabel : desktopLabel}
          onClick={toggleDevice}
        />
      )}
      {renderShare && (
        <Button
          design="tertiary"
          size="small"
          icon={<AsyncIcon icon="share" />}
          aria-label={shareLabel}
          onClick={onShare}
        />
      )}
      {renderPublish && (
        // `data-partial="componentAiro"` paints the publish button with the
        // Airo partial theme (purple accent) — anchors the publish CTA to
        // the Airo brand without changing the rest of the header chrome.
        <span data-partial="componentAiro">
          <Button design="primary" size="small" text={publishLabel} onClick={onPublish} />
        </span>
      )}
      {renderUser && (
        <Button
          design="tertiary"
          size="small"
          icon={<AsyncIcon icon="user" />}
          aria-label={userLabel}
          onClick={onUserClick}
        />
      )}
    </Box>
  );
}

// ─── Main BuilderHeader ───────────────────────────────────────────────────

/** Props for {@link BuilderHeader}. */
export interface BuilderHeaderProps extends HTMLAttributes<HTMLElement> {
  /**
   * Leading cluster — typically the brand mark (GoDaddy + Airo + Beta
   * tag). Pass `<BuilderHeader.Brand />` for the default, swap in a
   * custom node, or pass `null` to render nothing.
   */
  leading?: ReactNode;
  /**
   * Center cluster — typically a `SegmentedController` for app sections.
   * Pass `<BuilderHeader.Sections />` for the default, swap in a custom
   * node, or pass `null` to render nothing.
   */
  center?: ReactNode;
  /**
   * Trailing cluster — typically `<BuilderHeader.Actions />` (refresh,
   * device, share, publish, user). Swap in a custom node or pass `null`
   * to render nothing.
   */
  trailing?: ReactNode;
}

/**
 * Top-level builder app header. A horizontal strip with three
 * configurable clusters:
 *
 * - **Leading** — brand mark (GoDaddy + Airo + Beta tag).
 * - **Center** — section switcher (`SegmentedController`).
 * - **Trailing** — action group (refresh, device, share, publish, user).
 *
 * Renders with `lg` inline padding and `sm` block padding on desktop
 * with no background, so the page canvas shows through. **Future:**
 * the contents will collapse into a hamburger menu on narrow
 * viewports — the responsive logic is not wired up yet, and no
 * breakpoint is in place today.
 *
 * @example
 * ```tsx
 * <BuilderHeader
 *   leading={<BuilderHeader.Brand />}
 *   center={
 *     <BuilderHeader.Sections
 *       sections={DEFAULT_BUILDER_SECTIONS}
 *       defaultActiveSectionId="edit"
 *       onSectionChange={setSection}
 *     />
 *   }
 *   trailing={
 *     <BuilderHeader.Actions
 *       onPublish={publish}
 *       onShare={share}
 *       onRefresh={reload}
 *       onUserClick={openUserMenu}
 *     />
 *   }
 * />
 * ```
 */
export function BuilderHeader({
  leading,
  center,
  trailing,
  className,
  ...rest
}: BuilderHeaderProps): JSX.Element {
  return (
    // `box.header` renders a semantic `<header>` element so assistive tech
    // identifies the page-header landmark without consumers adding `role`
    // manually. Box-level layout props still flow through unchanged.
    <box.header
      orientation="horizontal"
      displayType="flex"
      inlineAlignChildren="center"
      inlinePadding="lg"
      blockPadding="sm"
      {...rest}
      className={classnames('airo-surfaces-builder-header', className)}
    >
      <div className="airo-surfaces-builder-header__leading">{leading}</div>
      <div className="airo-surfaces-builder-header__center">{center}</div>
      <div className="airo-surfaces-builder-header__trailing">{trailing}</div>
    </box.header>
  );
}

BuilderHeader.Brand = BuilderHeaderBrand;
BuilderHeader.Sections = BuilderHeaderSections;
BuilderHeader.Actions = BuilderHeaderActions;

// ─── Brand wordmarks ──────────────────────────────────────────────────────

interface WordmarkProps {
  ariaLabel: string;
}

/**
 * GoDaddy "Go" logomark — the official `gd-the-go` icon from `@ux/icon`.
 * Consumers can swap in a different brand asset (full wordmark, partner
 * co-branding, etc.) via `BuilderHeaderBrandProps#godaddyLogo`.
 */
function GoDaddyWordmark({ ariaLabel }: WordmarkProps): JSX.Element {
  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className="airo-surfaces-builder-header__godaddy-wordmark"
    >
      <AsyncIcon icon="gd-the-go" />
    </span>
  );
}
