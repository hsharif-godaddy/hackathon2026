import Box, { box } from '@ux/box';
import Button from '@ux/button';
import CornerActions from '@ux/corner-actions';
import AsyncIcon from '@ux/icon/async-icon.js';
import Tag from '@ux/tag';
import classnames from 'classnames';
import type { HTMLAttributes, ReactNode } from 'react';

import { AiroWordmark, type AiroWordmarkProps } from '../airo-wordmark';

// Re-export the shared brand SVG so existing imports of
// `{ AiroWordmark }` from this module keep working — the canonical
// definition lives in `src/surfaces/airo-wordmark.tsx` so it doesn't
// drag the full `AiroHeader` implementation graph (and the
// `AiroHeader.Sections = ...` compound-attachment side effect) into
// peer surfaces that only need the wordmark itself.
export { AiroWordmark };
export type { AiroWordmarkProps };

// Temporary vendor — see `src/_vendor/segmented-controller/README.md`. When
// antares ships PR #187, swap this import back to `@godaddy/antares` (antares
// auto-loads its own CSS) and drop the matching `@import` line from
// `src/surfaces/panel-chrome/styles.css`. The vendor stylesheet is bundled
// into the panel-chrome `styles` entry rather than imported here so consumers
// using `@airo-ux/pattern-library/surfaces/panel-chrome/styles` get the segmented-
// controller styles automatically.
import { SegmentedController, SegmentedControllerItem } from '../../_vendor/segmented-controller';

/**
 * A single section descriptor for {@link AiroHeader}. Maps directly to a
 * `@godaddy/antares` `SegmentedControllerItem` — antares owns focus
 * management, keyboard navigation, and ARIA attributes for the control.
 */
export interface AiroHeaderTab {
  /**
   * Stable identifier. Echoed back via `onTabChange` and matched against
   * `activeTabId` / `defaultActiveTabId`. Passed as the `value` key to the
   * underlying `SegmentedControllerItem` — antares/React Aria assigns
   * its own internal DOM ids to the rendered buttons.
   */
  id: string;
  /**
   * Visible label rendered inside the segment.
   */
  label: string;
}

/**
 * Props for the standalone {@link AiroHeaderSections} row component.
 * A subset of {@link AiroHeaderProps} covering only the section-switcher
 * and its action slot — the top row (wordmark, corner actions) is not
 * included here.
 */
export interface AiroHeaderSectionsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /**
   * Ordered list of sections to render as segments.
   * Pass `[]` to render only the action slot with no tab switcher.
   */
  tabs: AiroHeaderTab[];
  /**
   * Controlled active segment id.
   * @see {@link AiroHeaderSectionsProps.defaultActiveTabId}
   * @see {@link AiroHeaderSectionsProps.onTabChange}
   */
  activeTabId?: string;
  /**
   * Initial active segment id in uncontrolled mode.
   * @see {@link AiroHeaderSectionsProps.activeTabId}
   */
  defaultActiveTabId?: string;
  /**
   * Fires when the user selects a different segment.
   * @see {@link AiroHeaderSectionsProps.activeTabId}
   */
  onTabChange?: (id: string) => void;
  /**
   * Header action slot — rendered at the leading edge of the row.
   * Mirrors {@link AiroHeaderProps.action}.
   */
  action?: ReactNode;
  /**
   * Click handler for the default plus button.
   * Mirrors {@link AiroHeaderProps.onActionClick}.
   */
  onActionClick?: () => void;
  /**
   * Accessible label for the default plus button.
   * @default "Add"
   */
  actionLabel?: string;
  /**
   * Accessible label for the `SegmentedController`.
   * @default "Panel sections"
   */
  sectionsAriaLabel?: string;
}

export interface AiroHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /**
   * Ordered list of sections to render as segments in the bottom row of the
   * header. Rendered with `@godaddy/antares` `SegmentedController`.
   */
  tabs: AiroHeaderTab[];
  /**
   * Controlled active segment id. Pair with `onTabChange`.
   *
   * @see {@link AiroHeaderProps.defaultActiveTabId} for the uncontrolled variant.
   * @see {@link AiroHeaderProps.onTabChange}
   */
  activeTabId?: string;
  /**
   * Initial active segment id when uncontrolled. Falls back to the first
   * segment's id when omitted.
   *
   * @see {@link AiroHeaderProps.activeTabId} for the controlled variant.
   */
  defaultActiveTabId?: string;
  /**
   * Fires when the user selects a different segment (click or keyboard).
   * Called with the newly selected `id` string. Deselection is unlikely in
   * normal use — antares's `SegmentedController` behaves like a radio group
   * — but the callback type accepts `string` to match antares's
   * `onSelectionChange` signature. The consumer should treat a repeat call
   * with the current id as a no-op.
   *
   * @see {@link AiroHeaderProps.activeTabId}
   */
  onTabChange?: (id: string) => void;
  /**
   * Whether to render the small "Beta" pill next to the wordmark.
   *
   * @default true
   */
  showBetaTag?: boolean;
  /**
   * Label for the beta pill. Pass `showBetaTag={false}` to hide the pill —
   * passing a string here alone does not force the pill to render.
   *
   * @default "Beta"
   */
  betaLabel?: string;
  /**
   * Corner actions slot. Defaults to the same `@ux/corner-actions` wrapper
   * with expand and close buttons used by `PanelChrome`'s built-in header.
   * Pass `null` to hide them; pass a node to replace them.
   */
  cornerActions?: ReactNode;
  /**
   * Header action slot — rendered inline with the section-switcher on the
   * bottom row of the header, leading the `SegmentedController`. Typical
   * use is a single `@ux/button design="control"` trigger for a
   * primary-affordance action (e.g. a "plus" new-conversation button, or
   * an overflow-menu trigger).
   *
   * Lives on the sections row rather than the top row so that (a) the
   * action reads as part of the section-level affordance set instead of
   * competing with the Airo wordmark lockup, and (b) the top row stays
   * reserved for the surface-level controls owned by `cornerActions`.
   * Sits to the left of the `SegmentedController` — the controller
   * shrinks to fit its segments, leaving the action anchored at the row's
   * leading edge. The slot renders even when `tabs` is empty — the
   * sections row will still mount solely to host the action in that case.
   *
   * - `undefined` (default) → render the built-in plus button when
   *   `onActionClick` is provided, otherwise render nothing.
   * - `null` → never render an action, even if `onActionClick` is provided.
   * - `ReactNode` → replace the default entirely; `onActionClick` and
   *   `actionLabel` are ignored in this case.
   *
   * @see {@link AiroHeaderProps.onActionClick}
   * @see {@link AiroHeaderProps.actionLabel}
   */
  action?: ReactNode;
  /**
   * Click handler for the default plus button. When `action` is `undefined`
   * (the default) and this handler is omitted, no action renders.
   *
   * @see {@link AiroHeaderProps.action}
   */
  onActionClick?: () => void;
  /**
   * Accessible label for the default plus button.
   *
   * @default "Add"
   * @see {@link AiroHeaderProps.action}
   */
  actionLabel?: string;
  /**
   * Close handler for the default corner actions. Ignored when
   * `cornerActions` is overridden.
   */
  onClose?: () => void;
  /**
   * Expand/collapse toggle handler for the default corner actions. Ignored
   * when `cornerActions` is overridden.
   */
  onExpandedToggle?: () => void;
  /**
   * Current expansion state — controls which icon (expand vs collapse) the
   * default corner-actions button shows. Ignored when `cornerActions` is
   * overridden.
   *
   * @default false
   */
  expanded?: boolean;
  /**
   * Accessible label for the default close button.
   *
   * @default "Close"
   */
  closeLabel?: string;
  /**
   * Accessible label for the default expand button.
   *
   * @default "Expand"
   */
  expandLabel?: string;
  /**
   * Accessible label for the default collapse button (shown when
   * `expanded`).
   *
   * @default "Collapse"
   */
  collapseLabel?: string;
  /**
   * Accessible label for the Airo wordmark SVG.
   *
   * @default "Airo"
   */
  wordmarkAriaLabel?: string;
  /**
   * Accessible label for the section-switcher `SegmentedController`. Becomes
   * the control's `aria-label`, which is the accessible name screen readers
   * announce when focus enters the group.
   *
   * @default "Panel sections"
   */
  sectionsAriaLabel?: string;
  /**
   * Whether to render the sections row (tab switcher + action) inside the
   * header. Pass `false` when the row should be placed in a `ChatLayout`
   * `header` slot via `AiroHeader.Sections` so it is constrained to the
   * chat column width rather than the full header width.
   *
   * @default true
   */
  showSections?: boolean;
}

/**
 * Alternate `PanelChrome` header that swaps the default title lockup for
 * the Airo wordmark and adds a section-switcher row below. Sections are
 * rendered with `@godaddy/antares`'s `SegmentedController` (single-selection
 * toggle group with animated selection indicator and keyboard navigation
 * from React Aria). The consumer owns which children are rendered in the
 * surface body for each active section — this component does not render
 * any section panels itself.
 *
 * Designed to be passed into a surface's `header` slot
 * (`<Panel header={...}>`, `<FloatingPanel header={...}>`, etc.). Also
 * available as `Panel.AiroHeader` via dot-notation re-export from
 * `@airo-ux/pattern-library/surfaces/panel`.
 *
 * @example
 * ```tsx
 * const [activeTab, setActiveTab] = useState('chat');
 * const [expanded, setExpanded] = useState(false);
 *
 * <Panel
 *   show={show}
 *   onClose={() => setShow(false)}
 *   expanded={expanded}
 *   onExpandedChange={setExpanded}
 *   header={
 *     <AiroHeader
 *       tabs={[
 *         { id: 'chat', label: 'Chat' },
 *         { id: 'activity', label: 'Activity' },
 *       ]}
 *       activeTabId={activeTab}
 *       onTabChange={setActiveTab}
 *       onActionClick={() => startNewConversation()}
 *       onClose={() => setShow(false)}
 *       onExpandedToggle={() => setExpanded((v) => !v)}
 *       expanded={expanded}
 *     />
 *   }
 * >
 *   {activeTab === 'chat' ? <ChatSurface /> : <ActivityList />}
 * </Panel>
 * ```
 */
/**
 * The sections row from `AiroHeader` as a standalone component. Use this
 * when the row should live inside a `ChatLayout` `header` slot so it is
 * constrained to the chat column's width instead of spanning the full
 * `AiroHeader`.
 *
 * The row keeps the `SegmentedController` centered by using the container's
 * child alignment, while the optional action button is anchored separately
 * at the leading edge with absolute positioning.
 *
 * Accessible as `AiroHeader.Sections` via the compound-component attachment.
 *
 * @example
 * <PanelChrome
 *   header={<AiroHeader tabs={[]} showSections={false} onClose={onClose} />}
 * >
 *   <ChatLayout
 *     header={
 *       <AiroHeader.Sections
 *         tabs={tabs}
 *         activeTabId={activeTab}
 *         onTabChange={setActiveTab}
 *       />
 *     }
 *   >
 *     {messages}
 *   </ChatLayout>
 * </PanelChrome>
 */
export function AiroHeaderSections({
  tabs,
  activeTabId,
  defaultActiveTabId,
  onTabChange,
  action,
  onActionClick,
  actionLabel = 'Add',
  sectionsAriaLabel = 'Panel sections',
  className,
  ...rest
}: AiroHeaderSectionsProps) {
  const effectiveAction =
    action === undefined ? renderDefaultAction({ actionLabel, onActionClick }) : action;
  const effectiveDefault = defaultActiveTabId ?? tabs[0]?.id;

  if (tabs.length === 0 && effectiveAction == null) return null;

  const hasTabs = tabs.length > 0;

  return (
    <Box
      {...rest}
      orientation="horizontal"
      blockAlignChildren={hasTabs ? 'center' : undefined}
      inlineAlignChildren={hasTabs ? 'center' : undefined}
      className={classnames('airo-surfaces-panel-chrome__airo-header-sections', className)}
    >
      {effectiveAction != null && (
        <div
          className={classnames(
            'airo-surfaces-panel-chrome__airo-header-sections-action',
            hasTabs && 'airo-surfaces-panel-chrome__airo-header-sections-action--anchored',
          )}
        >
          {effectiveAction}
        </div>
      )}
      {hasTabs ? (
        <SegmentedController
          aria-label={sectionsAriaLabel}
          size="sm"
          {...(activeTabId !== undefined
            ? { value: activeTabId }
            : { defaultValue: effectiveDefault })}
          onSelectionChange={onTabChange}
          className="airo-surfaces-panel-chrome__airo-header-segmented"
        >
          {tabs.map((tab) => (
            <SegmentedControllerItem key={tab.id} value={tab.id}>
              {tab.label}
            </SegmentedControllerItem>
          ))}
        </SegmentedController>
      ) : null}
    </Box>
  );
}

export function AiroHeader({
  tabs,
  activeTabId,
  defaultActiveTabId,
  onTabChange,
  showBetaTag = true,
  betaLabel = 'Beta',
  cornerActions,
  action,
  onActionClick,
  actionLabel = 'Add',
  onClose,
  onExpandedToggle,
  expanded = false,
  closeLabel = 'Close',
  expandLabel = 'Expand',
  collapseLabel = 'Collapse',
  wordmarkAriaLabel = 'Airo',
  sectionsAriaLabel = 'Panel sections',
  showSections = true,
  className,
  ...rest
}: AiroHeaderProps) {
  const effectiveCornerActions =
    cornerActions === undefined
      ? renderDefaultCornerActions({
          closeLabel,
          onClose,
          expanded,
          expandLabel,
          collapseLabel,
          onExpandedToggle,
        })
      : cornerActions;

  return (
    <Box {...rest} className={classnames('airo-surfaces-panel-chrome__airo-header', className)}>
      <Box
        orientation="horizontal"
        gap="sm"
        blockAlignChildren="spaceBetween"
        inlineAlignChildren="center"
        className="airo-surfaces-panel-chrome__airo-header-top"
      >
        <box.span
          orientation="horizontal"
          displayType="inline-flex"
          inlineAlignChildren="center"
          stretch
          gap="sm"
          className="airo-surfaces-panel-chrome__airo-header-wordmark"
          data-partial="componentAiro"
        >
          <AiroWordmark ariaLabel={wordmarkAriaLabel} />
          {showBetaTag && betaLabel != null ? (
            <Tag size="sm" emphasis="highlight">
              {betaLabel}
            </Tag>
          ) : null}
        </box.span>
        {effectiveCornerActions}
      </Box>

      {showSections ? (
        <AiroHeaderSections
          tabs={tabs}
          activeTabId={activeTabId}
          defaultActiveTabId={defaultActiveTabId}
          onTabChange={onTabChange}
          action={action}
          onActionClick={onActionClick}
          actionLabel={actionLabel}
          sectionsAriaLabel={sectionsAriaLabel}
        />
      ) : null}
    </Box>
  );
}

AiroHeader.Sections = AiroHeaderSections;

interface DefaultCornerActionsArgs {
  closeLabel: string;
  onClose?: () => void;
  expanded: boolean;
  expandLabel: string;
  collapseLabel: string;
  onExpandedToggle?: () => void;
}

/**
 * Renders the same expand + close corner-action pair that `PanelChrome`'s
 * built-in default header uses. Exposed so `AiroHeader` (and any future
 * surface header variant) can share the exact default set without each one
 * re-inlining the buttons.
 *
 * Uses `design="tertiary"` so the corner controls sit one visual step back
 * from the `design="control"` default action button on the sections row.
 * The distinction signals that expand/collapse/close are surface-level
 * chrome while the action is a content-level affordance.
 */
export function renderDefaultCornerActions({
  closeLabel,
  onClose,
  expanded,
  expandLabel,
  collapseLabel,
  onExpandedToggle,
}: DefaultCornerActionsArgs): ReactNode {
  return (
    <CornerActions space="lg">
      <Button
        design="tertiary"
        size="small"
        aria-label={expanded ? collapseLabel : expandLabel}
        onClick={onExpandedToggle}
        icon={<AsyncIcon icon={expanded ? 'editor-smaller' : 'editor-larger'} />}
      />
      <Button
        design="tertiary"
        size="small"
        aria-label={closeLabel}
        onClick={onClose}
        icon={<AsyncIcon icon="x" />}
      />
    </CornerActions>
  );
}

interface DefaultActionArgs {
  actionLabel: string;
  onActionClick?: () => void;
}

/**
 * Default shape for the `action` slot: a single small-control `@ux/button`
 * with the `plus` icon. Returns `null` when no click handler is provided so
 * the slot stays empty by default (consumers must opt in by passing
 * `onActionClick` or a custom `action` node).
 *
 * Uses `design="control"` to read as a primary section-level affordance.
 * The corner actions (expand/collapse + close) use `design="tertiary"` —
 * one step back — since they are surface-management chrome rather than
 * content actions.
 *
 * Factored out so consumers who need a different default (e.g. an ellipsis
 * overflow menu) can replace the slot wholesale via the `action` prop
 * without re-inlining the styling used here.
 */
function renderDefaultAction({ actionLabel, onActionClick }: DefaultActionArgs): ReactNode {
  if (!onActionClick) return null;
  return (
    <Button
      design="control"
      size="small"
      aria-label={actionLabel}
      onClick={onActionClick}
      icon={<AsyncIcon icon="plus" />}
    />
  );
}
