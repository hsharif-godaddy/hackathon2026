import Box from '@ux/box';
import AsyncIcon from '@ux/icon/async-icon.js';
import classnames from 'classnames';
import type { HTMLAttributes, JSX, ReactNode } from 'react';

// Temporary vendor — see `src/_vendor/segmented-controller/README.md`. When
// antares ships PR #187, swap this import back to `@godaddy/antares` (antares
// auto-loads its own CSS) and drop the matching `@import` line from
// `src/surfaces/builder-chat-footer/styles.css`.
import { SegmentedController, SegmentedControllerItem } from '../../_vendor/segmented-controller';

const DEFAULT_SECTIONS_ARIA_LABEL = 'Chat panel sections';

// ─── Section descriptor ───────────────────────────────────────────────────

/**
 * Describes a single segment in the chat footer's
 * `SegmentedController`. Maps directly to a `@godaddy/antares`
 * `SegmentedControllerItem` plus a leading `AsyncIcon`.
 */
export interface BuilderChatFooterSection {
  /** Stable identifier — echoed back via `onSectionChange`. */
  id: string;
  /** Visible segment label. */
  label: string;
  /** `@ux/icon/async-icon` icon name shown to the left of the label. */
  icon: string;
}

/**
 * Default chat footer sections — chat, media, history, analytics,
 * settings. Provided as a convenience for the canonical layout;
 * consumers can pass their own ordered list (or omit the
 * `Sections` sub-component entirely and put any other content in the
 * footer's children slot).
 */
export const DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS: BuilderChatFooterSection[] = [
  { id: 'chat', label: 'Chat', icon: 'conversations' },
  { id: 'media', label: 'Media', icon: 'image' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'analytics', label: 'Analytics', icon: 'graph' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

// ─── Sections sub-component ───────────────────────────────────────────────

/** Props for {@link BuilderChatFooterSections}. */
export interface BuilderChatFooterSectionsProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'children'> {
  /** Ordered list of segments. Pass `[]` to render nothing. */
  sections: BuilderChatFooterSection[];
  /**
   * Controlled active section id. Pair with `onSectionChange`, or use
   * `defaultActiveSectionId` for uncontrolled mode.
   *
   * @see {@link BuilderChatFooterSectionsProps.defaultActiveSectionId}
   * @see {@link BuilderChatFooterSectionsProps.onSectionChange}
   */
  activeSectionId?: string;
  /**
   * Initial active section id in uncontrolled mode. Defaults to
   * `sections[0]?.id`.
   *
   * @see {@link BuilderChatFooterSectionsProps.activeSectionId}
   * @see {@link BuilderChatFooterSectionsProps.onSectionChange}
   */
  defaultActiveSectionId?: string;
  /**
   * Fires when the user selects a different segment.
   *
   * @see {@link BuilderChatFooterSectionsProps.activeSectionId}
   * @see {@link BuilderChatFooterSectionsProps.defaultActiveSectionId}
   */
  onSectionChange?: (id: string) => void;
  /** Accessible label for the `SegmentedController`. @default "Chat panel sections" */
  ariaLabel?: string;
  /**
   * When `true`, inactive segments collapse to their icon and surface
   * their label as a tooltip on hover/focus. The container reserves the
   * worst-case label width so the outer footprint stays stable as
   * selection changes.
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
 * Default footer content — `@godaddy/antares` `SegmentedController`
 * with the canonical chat / media / history / analytics / settings
 * layout. antares owns focus management, keyboard navigation, and the
 * sliding active indicator.
 *
 * Standard HTML attributes (`id`, `data-*`, etc.) forward to the
 * wrapping `<div>`.
 *
 * @example
 * ```tsx
 * <BuilderChatFooter.Sections
 *   sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS}
 *   defaultActiveSectionId="chat"
 *   onSectionChange={setSection}
 *   data-testid="chat-footer-sections"
 * />
 * ```
 */
export function BuilderChatFooterSections({
  sections,
  activeSectionId,
  defaultActiveSectionId,
  onSectionChange,
  ariaLabel = DEFAULT_SECTIONS_ARIA_LABEL,
  collapseInactive = false,
  className,
  ...rest
}: BuilderChatFooterSectionsProps): JSX.Element | null {
  if (sections.length === 0) return null;
  const effectiveDefault = defaultActiveSectionId ?? sections[0]?.id;
  return (
    <div {...rest} className={classnames('airo-surfaces-builder-chat-footer__sections', className)}>
      <SegmentedController
        aria-label={ariaLabel}
        size="sm"
        collapseInactive={collapseInactive}
        {...(activeSectionId !== undefined
          ? { value: activeSectionId }
          : { defaultValue: effectiveDefault })}
        onSelectionChange={onSectionChange}
        className="airo-surfaces-builder-chat-footer__segmented"
      >
        {sections.map((section) => (
          <SegmentedControllerItem
            key={section.id}
            value={section.id}
            // The vendored item handles icon + label layout, so the
            // previous Box wrapper isn't needed. The label string also
            // doubles as the tooltip text when `collapseInactive` is on
            // and this segment is inactive.
            icon={<AsyncIcon icon={section.icon} />}
          >
            {section.label}
          </SegmentedControllerItem>
        ))}
      </SegmentedController>
    </div>
  );
}

// ─── Main BuilderChatFooter ───────────────────────────────────────────────

/** Props for {@link BuilderChatFooter}. */
export interface BuilderChatFooterProps extends HTMLAttributes<HTMLElement> {
  /**
   * Footer content. Pass `<BuilderChatFooter.Sections />` for the
   * default segmented-control example, or any other node — the slot
   * is fully open.
   */
  children?: ReactNode;
}

/**
 * Centered footer band that sits below a chat composer
 * (`PromptBox` / `PromptStage`). The single content slot is
 * fully open — pass any node — and the canonical default is
 * `<BuilderChatFooter.Sections />`, an antares `SegmentedController`
 * with chat / media / history / analytics / settings.
 *
 * Designed to render as a sibling **below** the raised composer
 * surface (typically a `FloatingFooter` wrapping the `PromptBox` /
 * `PromptStage`), not nested inside it. The band has no background of
 * its own so it reads as part of the page canvas behind the elevated
 * composer card. See the README's "Place outside the raised composer
 * surface" gotcha for the layout rationale.
 *
 * @example
 * ```tsx
 * <BuilderChatFooter>
 *   <BuilderChatFooter.Sections
 *     sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS}
 *     defaultActiveSectionId="chat"
 *     onSectionChange={setSection}
 *   />
 * </BuilderChatFooter>
 * ```
 */
export function BuilderChatFooter({
  children,
  className,
  ...rest
}: BuilderChatFooterProps): JSX.Element {
  return (
    <Box
      orientation="horizontal"
      displayType="flex"
      blockAlignChildren="center"
      inlineAlignChildren="center"
      {...rest}
      className={classnames('airo-surfaces-builder-chat-footer', className)}
    >
      {children}
    </Box>
  );
}

BuilderChatFooter.Sections = BuilderChatFooterSections;
