// Temporary vendor: starting point is a copy of the SegmentedController
// proposed in godaddy/antares PR #187 (head SHA 50c6640).
// https://github.com/godaddy/antares/pull/187
//
// Upstream source: packages/@godaddy/antares/components/segmented-controller/src/index.tsx
//
// Build-shape adaptations (behavior unchanged):
//   - cx (cva) -> classNames (already a runtime dep here)
//   - CSS Modules -> plain BEM in ./styles.css
//   - #components/{layout/flex,button,icon,tooltip} -> public @godaddy/antares barrel
//
// Behavioral / visual divergences (catalogued in ./README.md > "Local
// divergences from upstream"): zero inter-segment gap, square padding
// when icon-only, ResizeObserver guard, empty-string handling for
// value/defaultValue. Each divergence is also marked inline at the
// call site with a "Local divergence" comment.
//
// When PR #187 ships in @godaddy/antares, delete this folder and replace consumer
// imports with `import { SegmentedController } from '@godaddy/antares'`.
import { Button, Flex, type FlexOwnProps, Icon, Tooltip, TooltipTrigger } from '@godaddy/antares';
import classNames from 'classnames';
import React, {
  createContext,
  type ReactNode,
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
const styles = {
  container: ROOT_CLASS,
  item: `${ROOT_CLASS}__item`,
  indicator: `${ROOT_CLASS}__indicator`,
  label: `${ROOT_CLASS}__label`,
  labelHidden: `${ROOT_CLASS}__label--hidden`,
  content: `${ROOT_CLASS}__content`,
  scrollButtons: `${ROOT_CLASS}__scroll-buttons`,
  scrollBtn: `${ROOT_CLASS}__scroll-btn`,
  mirror: `${ROOT_CLASS}__mirror`,
} as const;

interface SegmentedControllerContextValue {
  collapseInactive: boolean;
  selectedValue: string | undefined;
}

const SegmentedControllerContext = createContext<SegmentedControllerContextValue>({
  collapseInactive: false,
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
  const { className, children, value, icon, ...rest } = props;
  const { collapseInactive, selectedValue } = useContext(SegmentedControllerContext);

  const isSelected = selectedValue === value;
  const canCollapse = collapseInactive && icon !== undefined;
  const showLabel = !canCollapse || isSelected;
  const tooltipDisabled = !canCollapse || isSelected;

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
      rest.onFocus?.(e);
    },
    [rest.onFocus],
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
      id={value}
      alignItems="center"
      onFocus={handleFocus}
      aria-label={fallbackAriaLabel}
      className={classNames(styles.item, className)}
    >
      <Flex as={RACSelectionIndicator} className={styles.indicator} />
      {icon !== undefined ? (
        <>
          {icon}
          {children !== undefined ? (
            <span className={classNames(styles.label, !showLabel && styles.labelHidden)}>
              {children}
            </span>
          ) : null}
        </>
      ) : (
        children
      )}
    </Flex>
  );

  if (!canCollapse) return button;

  return (
    <TooltipTrigger isDisabled={tooltipDisabled} delay={150}>
      {button}
      <Tooltip placement="bottom">{children}</Tooltip>
    </TooltipTrigger>
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
        let sumCollapsed = 0;
        let maxDelta = 0;
        for (const item of items) {
          const sel = (state: 'expanded' | 'collapsed') =>
            mirror.querySelector<HTMLElement>(
              `[data-measure="${state}"][data-value="${CSS.escape(item.value)}"]`,
            );
          const eW = sel('expanded')?.getBoundingClientRect().width ?? 0;
          const cW = sel('collapsed')?.getBoundingClientRect().width ?? 0;
          sumCollapsed += cW;
          const delta = eW - cW;
          if (delta > maxDelta) maxDelta = delta;
        }

        const cs = getComputedStyle(visible);
        const gap = Number.parseFloat(cs.columnGap || cs.gap || '0') || 0;
        const padInline =
          (Number.parseFloat(cs.paddingInlineStart || cs.paddingLeft || '0') || 0) +
          (Number.parseFloat(cs.paddingInlineEnd || cs.paddingRight || '0') || 0);
        const n = items.length;
        setMinWidth(sumCollapsed + maxDelta + Math.max(0, n - 1) * gap + padInline);
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
    [measureItems, containerRef],
  );

  const ctx = useMemo(
    function buildCtx() {
      return { collapseInactive, selectedValue };
    },
    [collapseInactive, selectedValue],
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
          padding="xs"
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
                  <span className={styles.label}>{item.label}</span>
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
