'use client';

// Replace with @godaddy/antares SegmentedController once it supports the
// componentAiro data-partial correctly.

import {
  Children,
  type ComponentPropsWithoutRef,
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ChevronLeftIcon from '@ux/icon/chevron-left';
import ChevronRightIcon from '@ux/icon/chevron-right';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';

export type SegmentedControllerRadiogroupProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onChange' | 'role'
>;

export type SegmentedControllerWrapperProps = Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'onChange'>;

export interface SegmentedControllerProps<TValue extends string = string> {
  children: ReactNode;
  className?: string;
  onSelectionChange: (value: TValue) => void;
  radiogroupProps?: SegmentedControllerRadiogroupProps;
  value: TValue;
  wrapperProps?: SegmentedControllerWrapperProps;
}

export interface SegmentedControllerItemProps {
  children: ReactNode;
  className?: string;
  value: string;
}

interface SegmentedControllerContextValue {
  onRadioKeyDown: (e: KeyboardEvent<HTMLButtonElement>, segmentValue: string) => void;
  onSelectionChange: (value: string) => void;
  value: string;
}

const SegmentedControllerContext = createContext<SegmentedControllerContextValue | null>(null);

function useSegmentedControllerContext(component: string): SegmentedControllerContextValue {
  const ctx = useContext(SegmentedControllerContext);
  if (!ctx) {
    throw new Error(`${component} must be used within SegmentedController`);
  }
  return ctx;
}

export function SegmentedControllerItem({ children, className, value }: SegmentedControllerItemProps) {
  const { onRadioKeyDown, onSelectionChange, value: selected } = useSegmentedControllerContext(
    'SegmentedControllerItem',
  );
  const isSelected = selected === value;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      tabIndex={isSelected ? 0 : -1}
      data-segment-value={value}
      onKeyDown={function keyDown(e) {
        onRadioKeyDown(e, value);
      }}
      onClick={function selectSegment() {
        onSelectionChange(value);
      }}
      className={cn(
        'shrink-0 rounded-2xl border border-solid px-1.5 py-0.5 transition-colors cursor-pointer',
        isSelected
          ? 'border-ai bg-intents-ux-actionControlChosen-backgroundColor text-intents-ux-actionControlChosen-foregroundColor'
          : 'border-intents-ux-actionControl-borderColor bg-transparent text-intents-ux-actionControl-foregroundColor hover:bg-intents-ux-actionControlHovered-backgroundColor',
        className,
      )}
    >
      <text.span as="action" size={-1} className="flex gap-1 items-center">{children}</text.span>
    </button>
  );
}

interface SegmentedScrollChevronProps {
  ariaLabel: string;
  disabled: boolean;
  icon: ReactNode;
  onPress: () => void;
}

function SegmentedScrollChevron({ ariaLabel, disabled, icon, onPress }: SegmentedScrollChevronProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={function clickScrollChevron() {
        onPress();
      }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md p-1 transition-opacity',
        'bg-intents-ux-actionControl-backgroundColor text-intents-ux-actionControl-foregroundColor',
        'hover:text-intents-ux-actionControlHovered-foregroundColor',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 cursor-pointer',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      {icon}
    </button>
  );
}

export function SegmentedController<TValue extends string = string>({
  children,
  className,
  onSelectionChange,
  radiogroupProps,
  value,
  wrapperProps,
}: SegmentedControllerProps<TValue>) {
  const {
    className: radiogroupClassName,
    onScroll: radiogroupOnScroll,
    ...restRadiogroup
  } = radiogroupProps ?? {};
  const { className: wrapperClassNameFromProps, ...restWrapper } = wrapperProps ?? {};
  const t = useTranslations();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const [overflowing, setOverflowing] = useState(false);

  const itemCount = useMemo(
    function countItems() {
      return Children.toArray(children).filter(Boolean).length;
    },
    [children],
  );

  const syncScrollEdges = useCallback(function syncScrollEdges() {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const { clientWidth, scrollLeft, scrollWidth } = el;
    const maxScroll = scrollWidth - clientWidth;
    const nextOverflow = scrollWidth > clientWidth + 1;
    setOverflowing(nextOverflow);
    setEdge({
      left: scrollLeft > 1,
      right: scrollLeft < maxScroll - 1,
    });
  }, []);

  useLayoutEffect(
    function afterLayout() {
      syncScrollEdges();
    },
    [itemCount, syncScrollEdges, value],
  );

  useEffect(
    function observeScroller() {
      const viewport = scrollRef.current;
      const content = contentRef.current;
      if (!viewport || !content) {
        return undefined;
      }
      const ro = new ResizeObserver(function onTrackResize() {
        syncScrollEdges();
      });
      ro.observe(viewport);
      ro.observe(content);
      return function disconnectScrollerObservers() {
        ro.disconnect();
      };
    },
    [syncScrollEdges, itemCount],
  );

  useLayoutEffect(
    function scrollSelectedIntoView() {
      const root = scrollRef.current;
      if (!root) {
        return;
      }
      const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value;
      const selectedEl = root.querySelector(`[data-segment-value="${escaped}"]`);
      if (selectedEl && typeof selectedEl.scrollIntoView === 'function') {
        selectedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
      requestAnimationFrame(syncScrollEdges);
    },
    [syncScrollEdges, value],
  );

  // Values always originate from SegmentedControllerItem value props, so the
  // cast from string → TValue is safe. One internal cast instead of N call-site casts.
  const handleChange = useCallback(
    function adapt(v: string) {
      onSelectionChange(v as TValue);
    },
    [onSelectionChange],
  );

  const onRadioKeyDown = useCallback(
    function radioKeyDown(e: KeyboardEvent<HTMLButtonElement>, segmentValue: string) {
      const root = scrollRef.current;
      if (!root) {
        return;
      }
      const isNavKey =
        e.key === 'ArrowRight' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowUp' ||
        e.key === 'Home' ||
        e.key === 'End';
      if (!isNavKey) {
        return;
      }
      const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-segment-value]')];
      const values = buttons
        .map((b) => b.getAttribute('data-segment-value'))
        .filter((v): v is string => v != null && v.length > 0);
      const ix = values.indexOf(segmentValue);
      if (ix < 0) {
        return;
      }
      let nextIx = ix;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (values.length <= 1) {
          return;
        }
        nextIx = (ix + 1) % values.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (values.length <= 1) {
          return;
        }
        nextIx = (ix - 1 + values.length) % values.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        if (values.length <= 1) {
          return;
        }
        nextIx = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        if (values.length <= 1) {
          return;
        }
        nextIx = values.length - 1;
      }
      const nextValue = values[nextIx];
      if (nextValue === undefined) {
        return;
      }
      handleChange(nextValue);
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(nextValue) : nextValue;
      requestAnimationFrame(function focusAfterPaint() {
        requestAnimationFrame(function focusRadio() {
          root.querySelector<HTMLButtonElement>(`[data-segment-value="${escaped}"]`)?.focus();
        });
      });
    },
    [handleChange],
  );

  const ctx = useMemo(
    function buildContext() {
      return { onRadioKeyDown, onSelectionChange: handleChange, value };
    },
    [onRadioKeyDown, handleChange, value],
  );

  const scrollByPage = useCallback(function scrollByPage(dir: -1 | 1) {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const delta = Math.max(el.clientWidth * 0.65, 48) * dir;
    el.scrollBy({ behavior: 'smooth', left: delta });
  }, []);

  const scrollLeftLabel = t(
    'builder_common_back',
    undefined,
    'Scroll to previous segments',
  );
  const scrollRightLabel = t(
    'builder_common_next',
    undefined,
    'Scroll to more segments',
  );

  return (
    <div
      {...restWrapper}
      className={cn(
        'flex min-h-0 min-w-0 items-center gap-0.5 rounded-full p-0.5',
        'bg-intents-ux-actionControl-backgroundColor',
        wrapperClassNameFromProps,
        className,
      )}
    >
      <div
        {...restRadiogroup}
        ref={scrollRef}
        role="radiogroup"
        className={cn(
          'min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden',
          '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0',
          radiogroupClassName,
        )}
        onScroll={function radiogroupScroll(e) {
          syncScrollEdges();
          radiogroupOnScroll?.(e);
        }}
      >
        <div ref={contentRef} className="flex w-max min-w-0 flex-nowrap items-stretch gap-0.5">
          <SegmentedControllerContext.Provider value={ctx}>{children}</SegmentedControllerContext.Provider>
        </div>
      </div>
      {overflowing ? (
        <div className="flex shrink-0 items-center gap-0">
          <SegmentedScrollChevron
            ariaLabel={scrollLeftLabel}
            disabled={!edge.left}
            icon={<ChevronLeftIcon className="size-2" title={scrollLeftLabel} />}
            onPress={function scrollPrev() {
              scrollByPage(-1);
            }}
          />
          <SegmentedScrollChevron
            ariaLabel={scrollRightLabel}
            disabled={!edge.right}
            icon={<ChevronRightIcon className="size-2" title={scrollRightLabel} />}
            onPress={function scrollNext() {
              scrollByPage(1);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
