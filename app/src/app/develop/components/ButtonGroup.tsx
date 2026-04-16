'use client';

import clsx from 'clsx';
import { motion } from 'framer-motion';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Tooltip from '@ux/tooltip';

interface ButtonGroupContextValue {
  value?: string;
  onChange?: (value: string) => void;
  groupId: string;
  uniformActiveItemWidth: boolean;
  maxActiveItemWidth: number;
  reportActiveItemContentWidth: (itemValue: string, width: number | null) => void;
  registerUniformItemElement?: (itemValue: string, el: HTMLButtonElement | null) => void;
}

const ButtonGroupContext = createContext<ButtonGroupContextValue | null>(null);

function useButtonGroupContext() {
  const context = useContext(ButtonGroupContext);
  return context;
}

interface ButtonGroupProps {
  value?: string;
  onChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  uniformActiveItemWidth?: boolean;
  'data-eid'?: string;
}

function ButtonGroupRoot({
  value,
  onChange,
  children,
  className,
  uniformActiveItemWidth = false,
  'data-eid': dataEid,
}: ButtonGroupProps) {
  const groupId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const uniformItemElementsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [activeItemWidths, setActiveItemWidths] = useState<Record<string, number>>({});
  const [uniformPillRect, setUniformPillRect] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });

  const registerUniformItemElement = useCallback((itemValue: string, el: HTMLButtonElement | null) => {
    if (el) {
      uniformItemElementsRef.current.set(itemValue, el);
    } else {
      uniformItemElementsRef.current.delete(itemValue);
    }
  }, []);

  const reportActiveItemContentWidth = useCallback((itemValue: string, width: number | null) => {
    setActiveItemWidths((prev) => {
      if (width === null) {
        if (!(itemValue in prev)) return prev;
        const next = { ...prev };
        delete next[itemValue];
        return next;
      }
      if (prev[itemValue] === width) return prev;
      return { ...prev, [itemValue]: width };
    });
  }, []);

  const maxActiveItemWidth = useMemo(
    () => Math.max(0, ...Object.values(activeItemWidths)),
    [activeItemWidths],
  );

  useLayoutEffect(
    function syncUniformPillGeometry() {
      if (!uniformActiveItemWidth || value === undefined) {
        return;
      }

      const groupEl = groupRef.current;
      const activeEl = uniformItemElementsRef.current.get(value);
      if (!groupEl || !activeEl) {
        return;
      }

      function applyUniformPillRect() {
        const g = groupRef.current;
        const a = uniformItemElementsRef.current.get(value);
        if (!g || !a) {
          return;
        }
        const gr = g.getBoundingClientRect();
        const br = a.getBoundingClientRect();
        const next = {
          left: br.left - gr.left,
          top: br.top - gr.top,
          width: br.width,
          height: br.height,
        };
        if (next.width <= 0 || next.height <= 0) {
          return;
        }
        setUniformPillRect((prev) =>
          prev.left === next.left &&
          prev.top === next.top &&
          prev.width === next.width &&
          prev.height === next.height
            ? prev
            : next,
        );
      }

      applyUniformPillRect();

      const observer = new ResizeObserver(applyUniformPillRect);
      observer.observe(groupEl);
      observer.observe(activeEl);

      return function disconnectUniformPillResizeObservers() {
        observer.disconnect();
      };
    },
    [uniformActiveItemWidth, value, maxActiveItemWidth],
  );

  const contextValue = useMemo(
    () => ({
      value,
      onChange,
      groupId,
      uniformActiveItemWidth,
      maxActiveItemWidth,
      reportActiveItemContentWidth,
      registerUniformItemElement: uniformActiveItemWidth ? registerUniformItemElement : undefined,
    }),
    [
      value,
      onChange,
      groupId,
      uniformActiveItemWidth,
      maxActiveItemWidth,
      reportActiveItemContentWidth,
      registerUniformItemElement,
    ],
  );

  return (
    <ButtonGroupContext.Provider value={contextValue}>
      <div
        ref={groupRef}
        role="radiogroup"
        className={clsx(
          'relative isolate flex items-center gap-0.5 p-0.5 rounded-lg bg-intents-ux-box-backgroundColor',
          className,
        )}
        data-eid={dataEid}
      >
        {children}
        {uniformActiveItemWidth && value !== undefined && uniformPillRect.width > 0 && (
          <motion.div
            layout={false}
            aria-hidden
            className="pointer-events-none absolute z-[10] rounded-xmd bg-intents-ux-boxHighContrast-backgroundColor shadow-md"
            initial={false}
            style={{ opacity: 1 }}
            animate={{
              left: uniformPillRect.left,
              top: uniformPillRect.top,
              width: uniformPillRect.width,
              height: uniformPillRect.height,
            }}
            transition={{
              type: 'spring',
              stiffness: 460,
              damping: 40,
              mass: 0.65,
            }}
          />
        )}
      </div>
    </ButtonGroupContext.Provider>
  );
}

interface ButtonGroupItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  value?: string;
  icon: React.ReactNode;
  label?: string;
  disabled?: boolean;
  showLabelAlways?: boolean;
  onClick?: () => void;
  tooltipDescription?: string | React.ReactNode;
  'data-eid'?: string;
}

const ButtonGroupItem = forwardRef<HTMLButtonElement, ButtonGroupItemProps>(function ButtonGroupItem({
  value,
  icon,
  label,
  disabled,
  showLabelAlways = false,
  onClick,
  tooltipDescription = null,
  'data-eid': dataEid,
  ...rest
}, forwardedRef) {
  const context = useButtonGroupContext();
  const [showTooltip, setShowTooltip] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const mergedRef = useCallback((node: HTMLButtonElement | null) => {
    buttonRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const isControlled = context?.value !== undefined && context?.onChange !== undefined;
  const isActive = isControlled && value !== undefined && context!.value === value;
  const shouldShowLabel = label && (showLabelAlways || isActive);

  const participatesInUniformWidth = Boolean(
    context?.uniformActiveItemWidth &&
      !showLabelAlways &&
      label &&
      value !== undefined &&
      isControlled,
  );

  const registersForUniformPosition = Boolean(
    context?.uniformActiveItemWidth &&
      value !== undefined &&
      isControlled,
  );

  const reportActiveItemContentWidth = context?.reportActiveItemContentWidth;
  const registerUniformItemElement = context?.registerUniformItemElement;

  useLayoutEffect(
    function registerUniformSlot() {
      if (!registersForUniformPosition || value === undefined || !registerUniformItemElement) {
        return;
      }
      registerUniformItemElement(value, buttonRef.current);
      return function unregisterUniformSlot() {
        registerUniformItemElement(value, null);
      };
    },
    [registersForUniformPosition, value, registerUniformItemElement],
  );

  useLayoutEffect(
    function measureActiveItemWidth() {
      if (!participatesInUniformWidth || value === undefined || !reportActiveItemContentWidth) {
        return;
      }

      const el = measureRef.current;
      if (!el) {
        return;
      }

      const measure = () => {
        const node = measureRef.current;
        if (!node) return;
        reportActiveItemContentWidth(value, Math.ceil(node.getBoundingClientRect().width));
      };

      measure();

      const observer = new ResizeObserver(measure);
      observer.observe(el);

      return function cleanup() {
        observer.disconnect();
        reportActiveItemContentWidth(value, null);
      };
    },
    [participatesInUniformWidth, value, reportActiveItemContentWidth],
  );

  const handleClick = () => {
    if (disabled) return;
    setShowTooltip(false);

    if (isControlled && context?.onChange && value !== undefined) {
      context.onChange(value);
    } else if (onClick) {
      onClick();
    }
  };

  const tooltipComponent = label && (
    <Tooltip className="z-50" anchorRef={buttonRef}>
      <div className="flex flex-col gap-0 p-1">
        <div className="text-sm font-bold leading-none">{label}</div>
        {tooltipDescription && <div className="text-sm font-thin">{tooltipDescription}</div>}
      </div>
    </Tooltip>
  );

  const groupMaxActiveItemWidth = context?.maxActiveItemWidth ?? 0;
  const uniformActiveWidth =
    participatesInUniformWidth && isActive && groupMaxActiveItemWidth > 0
      ? groupMaxActiveItemWidth
      : undefined;

  return (
    <button
      type="button"
      role={isControlled ? 'radio' : undefined}
      aria-checked={isControlled ? isActive : undefined}
      aria-label={label}
      disabled={disabled}
      onClick={handleClick}
      data-eid={dataEid}
      ref={mergedRef}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      aria-haspopup={showTooltip}
      {...rest}
      style={uniformActiveWidth !== undefined ? { width: uniformActiveWidth, ...rest.style } : rest.style}
      className={clsx(
        'relative flex items-center gap-1 p-1 rounded-xmd transition-colors duration-200',
        {
          'justify-center': participatesInUniformWidth || uniformActiveWidth !== undefined,
          'text-intents-ux-boxHighContrast-foregroundColor': isActive,
          'bg-intents-ux-boxLowContrast-backgroundColor':
            !isActive && !disabled && !participatesInUniformWidth,
          'bg-transparent': participatesInUniformWidth,
          'opacity-25 pointer-events-none': disabled,
          'cursor-pointer': !disabled,
        },
      )}
    >
      {participatesInUniformWidth && !isActive && !disabled && (
        <span
          className="pointer-events-none absolute inset-0 z-0 rounded-xmd bg-intents-ux-boxLowContrast-backgroundColor"
          aria-hidden
        />
      )}
      {participatesInUniformWidth && (
        <div
          ref={measureRef}
          className="pointer-events-none fixed left-[-9999px] top-0 flex items-center gap-1 p-1"
          aria-hidden
        >
          <span className="flex items-center size-2.5">{icon}</span>
          <span className="text-sm font-medium whitespace-nowrap">{label}</span>
        </div>
      )}
      {isActive &&
        isControlled &&
        context?.groupId &&
        !participatesInUniformWidth && (
          <motion.div
            layoutId={`${context.groupId}-bubble`}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-intents-ux-boxHighContrast-backgroundColor rounded-xmd shadow-md z-10"
            transition={{
              layout: { type: 'tween', ease: 'easeInOut', duration: 0.2 },
              opacity: { duration: 0 },
            }}
          />
        )}
      <span className="relative z-20 flex items-center size-2.5">{icon}</span>
      {shouldShowLabel &&
        (showLabelAlways ? (
          <span className="relative z-20 text-xs font-medium whitespace-nowrap">{label}</span>
        ) : participatesInUniformWidth ? (
          <span className="relative z-20 text-sm font-medium whitespace-nowrap">{label}</span>
        ) : (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="relative z-20 text-sm font-medium whitespace-nowrap"
          >
            {label}
          </motion.span>
        ))}
      {!isActive && showTooltip && tooltipComponent}
    </button>
  );
});

export const ButtonGroup = Object.assign(ButtonGroupRoot, {
  Item: ButtonGroupItem,
});
