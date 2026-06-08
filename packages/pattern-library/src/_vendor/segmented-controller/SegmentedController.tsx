// Temporary vendor: starting point is a copy of the SegmentedController
// proposed in godaddy/antares PR #187 (head SHA 50c6640).
// https://github.com/godaddy/antares/pull/187
//
// Upstream source: packages/@godaddy/antares/components/segmented-controller/src/index.tsx
//
// Build-shape adaptations (behavior unchanged):
//   - cx (cva) -> classNames (already a runtime dep here)
//   - CSS Modules -> plain BEM in ./styles.css
//   - #components/{layout/flex,button,icon} -> public @godaddy/antares barrel
//
// Behavioral / visual divergences (catalogued in ./README.md > "Local
// divergences from upstream"): zero inter-segment gap, square padding
// when icon-only, ResizeObserver guard, empty-string handling for
// value/defaultValue. Each divergence is also marked inline at the
// call site with a "Local divergence" comment.
//
// When PR #187 ships in @godaddy/antares, delete this folder and replace consumer
// imports with `import { SegmentedController } from '@godaddy/antares'`.
import { Button, Flex, type FlexOwnProps, Icon } from '@godaddy/antares';
import text from '@ux/text';
import Tooltip from '@ux/tooltip';
import classNames from 'classnames';
import React, {
  createContext,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type Key as RACKey,
  SelectionIndicator as RACSelectionIndicator,
  ToggleButton as RACToggleButton,
  ToggleButtonGroup as RACToggleButtonGroup,
  type ToggleButtonGroupProps as RACToggleButtonGroupProps,
  type ToggleButtonProps as RACToggleButtonProps,
  useLocale,
} from 'react-aria-components';

import { prefersReducedMotion, useHorizontalScroll } from './useHorizontalScroll';

const ROOT_CLASS = 'airo-vendor-segmented-controller';
const LABEL_SIZE_BY_CONTROLLER_SIZE = {
  sm: -2,
  md: -1,
  lg: 0,
} as const;
const styles = {
  container: ROOT_CLASS,
  item: `${ROOT_CLASS}__item`,
  indicator: `${ROOT_CLASS}__indicator`,
  label: `${ROOT_CLASS}__label`,
  labelHidden: `${ROOT_CLASS}__label--hidden`,
  content: `${ROOT_CLASS}__content`,
  itemContent: `${ROOT_CLASS}__item-content`,
  scrollButtons: `${ROOT_CLASS}__scroll-buttons`,
  scrollBtn: `${ROOT_CLASS}__scroll-btn`,
  mirror: `${ROOT_CLASS}__mirror`,
} as const;

interface SegmentedControllerContextValue {
  collapseInactive: boolean;
  labelSize: (typeof LABEL_SIZE_BY_CONTROLLER_SIZE)[keyof typeof LABEL_SIZE_BY_CONTROLLER_SIZE];
  selectedValue: string | undefined;
}

const SegmentedControllerContext = createContext<SegmentedControllerContextValue>({
  collapseInactive: false,
  labelSize: LABEL_SIZE_BY_CONTROLLER_SIZE.md,
  selectedValue: undefined,
});

/**
 * Props for {@link SegmentedControllerItem}. Extends React Aria's
 * `ToggleButtonProps` (minus `id`, which the controller assigns from `value`)
 * and the antares `Flex` styling props.
 */
export interface SegmentedControllerItemProps
  extends Omit<RACToggleButtonProps, 'id'>,
    Omit<FlexOwnProps, 'as'> {
  /**
   * The value of the segment.
   *
   * This value is also forwarded to the underlying toggle button as its DOM `id`,
   * so it must be unique within a given `SegmentedController` and safe to use as
   * an HTML `id` (for example, do not include whitespace).
   */
  value: string;

  /**
   * Optional leading icon. Required when the parent `SegmentedController` has
   * `collapseInactive` set; without it, the segment cannot collapse and the label stays visible.
   */
  icon?: ReactNode;

  /** Additional class names applied to the item element. */
  className?: string;

  /**
   * The segment's label (or arbitrary content when `icon` is not provided).
   * In `collapseInactive` mode this also drives the tooltip text shown on hover/focus.
   */
  children?: ReactNode;
}

/**
 * An individual segment within a {@link SegmentedController}.
 *
 * @example
 * ```tsx
 * <SegmentedController aria-label="View" defaultValue="day">
 *   <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
 *   <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
 * </SegmentedController>
 * ```
 */
export function SegmentedControllerItem(props: SegmentedControllerItemProps) {
  const { className, children, value, icon, ref: forwardedRef, ...rest } = props as
    SegmentedControllerItemProps & { ref?: Ref<HTMLButtonElement | null> };
  const { collapseInactive, labelSize, selectedValue } = useContext(SegmentedControllerContext);

  const isSelected = selectedValue === value;
  const canCollapse = collapseInactive && icon !== undefined;
  const showLabel = !canCollapse || isSelected;
  const tooltipDisabled = !canCollapse || isSelected;
  const tooltipAnchorRef = useRef<HTMLButtonElement | null>(null);
  // React 19 delivers a consumer-forwarded `ref` as a prop. This component also
  // assigns its own `tooltipAnchorRef` to the underlying button (for tooltip
  // positioning), so merge the two — otherwise the consumer ref would be
  // silently clobbered. Radix `PopoverAnchor asChild` relies on this to anchor
  // a popover to the button (see SettingsMenu in airo-app-builder).
  const setAnchorRef = useCallback(
    function setAnchorRef(node: HTMLButtonElement | null) {
      tooltipAnchorRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        (forwardedRef as MutableRefObject<HTMLButtonElement | null>).current = node;
      }
    },
    [forwardedRef],
  );
  const [isTooltipOpen, setTooltipOpen] = useState(false);

  if (process.env.NODE_ENV !== 'production' && collapseInactive && icon === undefined) {
    // Surface the misuse loudly in dev — render path falls back to showing the label.
    console.warn(
      `[airo-vendor:SegmentedController] SegmentedControllerItem (value="${value}") requires an "icon" prop when the parent SegmentedController has "collapseInactive" set. The label will remain visible for this item.`,
    );
  }

  const handleFocus = useCallback(
    function handleFocus(e: Parameters<NonNullable<RACToggleButtonProps['onFocus']>>[0]) {
      // Honor `prefers-reduced-motion` per WCAG 2.3.3 — animation can trigger
      // vestibular issues. Local divergence from upstream antares — see file
      // header.
      e.target.scrollIntoView({
        inline: 'nearest',
        block: 'nearest',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
      if (!tooltipDisabled) setTooltipOpen(true);
      rest.onFocus?.(e);
    },
    [rest.onFocus, tooltipDisabled],
  );

  const handleBlur = useCallback(
    function handleBlur(e: Parameters<NonNullable<RACToggleButtonProps['onBlur']>>[0]) {
      setTooltipOpen(false);
      rest.onBlur?.(e);
    },
    [rest.onBlur],
  );

  const handleHoverStart = useCallback(
    function handleHoverStart(
      e: Parameters<NonNullable<RACToggleButtonProps['onHoverStart']>>[0],
    ) {
      if (!tooltipDisabled) setTooltipOpen(true);
      rest.onHoverStart?.(e);
    },
    [rest.onHoverStart, tooltipDisabled],
  );

  const handleHoverEnd = useCallback(
    function handleHoverEnd(e: Parameters<NonNullable<RACToggleButtonProps['onHoverEnd']>>[0]) {
      setTooltipOpen(false);
      rest.onHoverEnd?.(e);
    },
    [rest.onHoverEnd],
  );

  useEffect(
    function closeTooltip() {
      if (tooltipDisabled) setTooltipOpen(false);
    },
    [tooltipDisabled],
  );

  // When the label is collapsed via CSS (width: 0; opacity: 0), some browsers
  // may stop announcing its text. Provide a stable accessible name via aria-label
  // when both the children are a plain string and we're in collapse mode.
  const fallbackAriaLabel =
    canCollapse && !rest['aria-label'] && typeof children === 'string'
      ? children
      : rest['aria-label'];

  const button = (
    <Flex
      as={RACToggleButton}
      {...rest}
      ref={setAnchorRef}
      id={value}
      alignItems="center"
      onBlur={handleBlur}
      onFocus={handleFocus}
      onHoverEnd={handleHoverEnd}
      onHoverStart={handleHoverStart}
      aria-label={fallbackAriaLabel}
      className={classNames(styles.item, className)}
    >
      <Flex as={RACSelectionIndicator} className={styles.indicator} />
      <span className={styles.itemContent}>
        {icon !== undefined ? (
          <>
            {icon}
            {children !== undefined ? (
              <text.span
                as="label"
                size={labelSize}
                className={classNames(styles.label, !showLabel && styles.labelHidden)}
              >
                {children}
              </text.span>
            ) : null}
          </>
        ) : typeof children === 'string' || typeof children === 'number' ? (
          // Wrap textual children in `.label` so they're treated as a real label
          // (regular inline padding), not as an icon-only segment. Element
          // children (e.g. a bare <Icon> in the IconOnly pattern) stay unwrapped
          // so the `:not(:has(.label))` square-padding rule still applies to them.
          <text.span as="label" size={labelSize} className={styles.label}>
            {children}
          </text.span>
        ) : (
          children
        )}
      </span>
    </Flex>
  );

  if (!canCollapse) return button;

  return (
    <>
      {button}
      <Tooltip
        anchorRef={tooltipAnchorRef}
        open={isTooltipOpen && !tooltipDisabled}
        strategy="fixed"
        portalElem={typeof document !== 'undefined' ? document.body : undefined}
      >
        {children}
      </Tooltip>
    </>
  );
}

/**
 * Props for {@link SegmentedController}. Extends React Aria's
 * `ToggleButtonGroupProps` (minus the multi-selection `onSelectionChange`,
 * replaced by a single-string variant below) and the antares `Flex`
 * styling props.
 */
export interface SegmentedControllerProps
  extends Omit<RACToggleButtonGroupProps, 'onSelectionChange'>,
    Omit<FlexOwnProps, 'as'> {
  /** The size of the segmented controller. */
  size?: 'sm' | 'md' | 'lg';

  /** Additional class names applied to the root element. */
  className?: string;

  /** The initial selected value. (uncontrolled) */
  defaultValue?: string;

  /** The selected value. (controlled) */
  value?: string;

  /** Handler that is called when the selection changes. */
  onSelectionChange?: (value: string) => void;

  /** Whether the segmented controller is disabled. */
  isDisabled?: boolean;

  /**
   * When true, only the currently-selected segment shows its label; other
   * segments collapse to their icon and surface their label via tooltip on
   * hover/focus. Each `SegmentedControllerItem` must supply an `icon` prop.
   * The container also reserves a `min-width` sized to the worst-case label
   * state so its outer footprint stays stable as selection changes; buttons
   * center inside the reserved width.
   *
   * **Pair with `defaultValue` (or `value`) when using `collapseInactive`.**
   * If neither is set, the underlying React Aria `ToggleButtonGroup` mounts
   * with no selection, and this component will render every segment as
   * collapsed (icon-only) until the user selects one. The `Basic` story
   * works without `defaultValue` because it doesn't use `collapseInactive`.
   * @default false
   */
  collapseInactive?: boolean;

  /** The segmented controller items. */
  children?: ReactNode;
}

/**
 * A segmented controller lets users switch between 2+ related views or
 * categories within the same context. Single-selection only.
 *
 * @example
 * ```tsx
 * <SegmentedController aria-label="View" defaultValue="day">
 *   <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
 *   <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
 *   <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
 * </SegmentedController>
 * ```
 */
export function SegmentedController(props: SegmentedControllerProps) {
  const {
    size = 'md',
    className,
    children,
    defaultValue,
    value,
    onSelectionChange,
    isDisabled,
    collapseInactive = false,
    ...rest
  } = props;
  const { direction } = useLocale();
  const {
    containerRef,
    scrollButtonsRef,
    hasOverflow,
    canScrollPrev,
    canScrollNext,
    scrollPrev,
    scrollNext,
  } = useHorizontalScroll({ isRTL: direction === 'rtl' });

  const [internalSelected, setInternalSelected] = useState<string | undefined>(
    value ?? defaultValue,
  );
  const labelSize = LABEL_SIZE_BY_CONTROLLER_SIZE[size];
  const selectedValue = value ?? internalSelected;

  const handleSelectionChange = useCallback(
    function handleSelectionChange(values: Set<RACKey>) {
      // Upstream uses `.at(0)`; this repo's tsconfig targets ES2020 lib so use
      // index access instead. Same behavior for the always-single selection.
      const selected = String(Array.from(values)[0]);
      setInternalSelected(selected);
      onSelectionChange?.(selected);
    },
    [onSelectionChange],
  );

  // For min-width reservation: extract the per-item info we need to render the hidden mirror.
  const measureItems = useMemo(
    function extractItems() {
      if (!collapseInactive) return null;
      const out: { value: string; icon: ReactNode; label: ReactNode }[] = [];
      for (const child of React.Children.toArray(children)) {
        if (!React.isValidElement(child) || child.type !== SegmentedControllerItem) continue;
        const p = child.props as SegmentedControllerItemProps;
        if (p.icon === undefined) continue; // skip items the warning already flagged
        out.push({ value: p.value, icon: p.icon, label: p.children });
      }
      return out;
    },
    [children, collapseInactive],
  );

  const mirrorRef = useRef<HTMLDivElement>(null);
  const [minWidth, setMinWidth] = useState<number | null>(null);
  const selectedMeasureIndex =
    measureItems?.findIndex(function selected(item) {
      return item.value === selectedValue;
    }) ?? -1;
  const selectedPosition =
    measureItems && selectedMeasureIndex >= 0
      ? selectedMeasureIndex === 0
        ? 'first'
        : selectedMeasureIndex === measureItems.length - 1
          ? 'last'
          : 'middle'
      : undefined;

  useEffect(
    function measureFixedWidth() {
      if (!measureItems || !mirrorRef.current || !containerRef.current) {
        setMinWidth(null);
        return;
      }

      const visible = containerRef.current;
      const mirror = mirrorRef.current;
      const items = measureItems; // capture so the inner closure has a non-null reference

      function compute() {
        const widths = items.map(function measure(item) {
          const expanded = mirror
            .querySelector<HTMLElement>(
              `[data-measure="expanded"][data-value="${CSS.escape(item.value)}"]`,
            )
            ?.getBoundingClientRect().width ?? 0;
          const collapsed = mirror
            .querySelector<HTMLElement>(
              `[data-measure="collapsed"][data-value="${CSS.escape(item.value)}"]`,
            )
            ?.getBoundingClientRect().width ?? 0;
          return { expanded, collapsed };
        });
        const sumCollapsed = widths.reduce(function sum(total, width) {
          return total + width.collapsed;
        }, 0);
        let maxSelectedWidth = 0;
        for (const width of widths) {
          const selectedWidth = sumCollapsed - width.collapsed + width.expanded;
          if (selectedWidth > maxSelectedWidth) maxSelectedWidth = selectedWidth;
        }

        const cs = getComputedStyle(visible);
        const gap = Number.parseFloat(cs.columnGap || cs.gap || '0') || 0;
        const n = items.length;
        setMinWidth(maxSelectedWidth + Math.max(0, n - 1) * gap);
      }

      compute();
      // Compute once on mount; if the host environment lacks ResizeObserver
      // (older browsers, constrained webviews), fall back to that single
      // measurement instead of crashing on construction. Matches the guard
      // used elsewhere in this repo (e.g. PanelChrome.tsx).
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(compute);
      ro.observe(mirror);
      return function cleanup() {
        ro.disconnect();
      };
    },
    [labelSize, measureItems, containerRef],
  );

  const ctx = useMemo(
    function buildCtx() {
      return { collapseInactive, labelSize, selectedValue };
    },
    [collapseInactive, labelSize, selectedValue],
  );

  return (
    <SegmentedControllerContext.Provider value={ctx}>
      <Flex
        // `dir` defaults to the locale-derived direction from `useLocale()`,
        // but stays before `{...rest}` so consumers can override it
        // explicitly (e.g. `<SegmentedController dir="ltr" />` in an RTL
        // page). Local divergence from upstream antares — see file header.
        dir={direction}
        {...rest}
        display="inline-flex"
        as={RACToggleButtonGroup}
        // `value`/`defaultValue` are typed as `string`, so `''` is a valid
        // segment key. Use explicit `!== undefined` checks instead of the
        // upstream truthy-test so an empty-string key isn't treated as
        // unset. Local divergence from upstream antares — see file header.
        defaultSelectedKeys={defaultValue !== undefined ? [defaultValue] : undefined}
        onSelectionChange={handleSelectionChange}
        disallowEmptySelection
        selectionMode="single"
        isDisabled={isDisabled}
        selectedKeys={value !== undefined ? [value] : undefined}
        data-size={size}
        data-collapse-inactive={collapseInactive || undefined}
        data-collapse-selected-position={selectedPosition}
        className={classNames(styles.container, className)}
      >
        {/*
         * Local divergence from upstream antares PR #187: `gap` is "0" (not
         * "xs") so segments sit flush against each other. Restore to `gap="xs"`
         * if/when reverting to upstream's `@godaddy/antares` `SegmentedController`.
         */}
        <Flex
          ref={containerRef}
          gap="0"
          padding="0"
          // Only become a horizontal scroll/clip container when segments actually
          // overflow. `overflow-x: auto` establishes a clipping box even with no
          // scroll, which makes floating-ui's overflow detection (altBoundary)
          // treat the content edge as the tooltip boundary — pushing the last
          // segment's tooltip inward even when the viewport has room. Gating the
          // overflow on real overflow keeps edge tooltips centered.
          data-overflow={hasOverflow || undefined}
          className={styles.content}
          style={minWidth != null ? { minWidth: `${minWidth}px` } : undefined}
        >
          {children}
        </Flex>

        {hasOverflow ? (
          <Flex className={styles.scrollButtons} ref={scrollButtonsRef}>
            <Button
              size="md"
              aria-label="Scroll previous"
              onPress={scrollPrev}
              className={styles.scrollBtn}
              isDisabled={!canScrollPrev}
            >
              <Icon icon="chevron-left" />
            </Button>
            <Button
              size="md"
              aria-label="Scroll next"
              onPress={scrollNext}
              className={styles.scrollBtn}
              isDisabled={!canScrollNext}
            >
              <Icon icon="chevron-right" />
            </Button>
          </Flex>
        ) : null}

        {measureItems ? (
          <div ref={mirrorRef} aria-hidden="true" className={styles.mirror}>
            {measureItems.map(function expanded(item) {
              return (
                <Flex
                  as="span"
                  key={`e-${item.value}`}
                  alignItems="center"
                  gap="xs"
                  className={styles.item}
                  data-measure="expanded"
                  data-value={item.value}
                >
                  {item.icon}
                  <text.span as="label" size={labelSize} className={styles.label}>
                    {item.label}
                  </text.span>
                </Flex>
              );
            })}
            {measureItems.map(function collapsed(item) {
              return (
                <Flex
                  as="span"
                  key={`c-${item.value}`}
                  alignItems="center"
                  gap="xs"
                  className={styles.item}
                  data-measure="collapsed"
                  data-value={item.value}
                >
                  {item.icon}
                </Flex>
              );
            })}
          </div>
        ) : null}
      </Flex>
    </SegmentedControllerContext.Provider>
  );
}
