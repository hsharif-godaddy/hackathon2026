'use client';

import clsx from 'clsx';
import { AnimatePresence, type HTMLMotionProps, motion } from 'framer-motion';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import Tooltip from '@ux/tooltip';

interface ButtonGroupContextValue {
  value?: string;
  onChange?: (value: string) => void;
  groupId: string;
  registerActiveWidth: (id: string, width: number) => void;
  registerInactiveWidth: (id: string, width: number) => void;
  unregisterWidths: (id: string) => void;
  maxActiveWidth: number;
  maxInactiveWidth: number;
}

const ButtonGroupContext = createContext<ButtonGroupContextValue | null>(null);

function useButtonGroupContext() {
  const context = useContext(ButtonGroupContext);
  return context;
}

export const SPRING_TRANSITION = { type: 'spring' as const, stiffness: 300, damping: 30 };

interface ButtonGroupProps {
  value?: string;
  onChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  'data-eid'?: string;
}

function ButtonGroupRoot({ value, onChange, children, className, 'data-eid': dataEid }: ButtonGroupProps) {
  const groupId = useId();
  const widthsRef = useRef<Map<string, { active: number; inactive: number }>>(new Map());
  const [maxActiveWidth, setMaxActiveWidth] = useState(0);
  const [maxInactiveWidth, setMaxInactiveWidth] = useState(0);

  const recomputeMax = useCallback(function recompute() {
    let nextActive = 0;
    let nextInactive = 0;
    widthsRef.current.forEach(function pick({ active, inactive }) {
      if (active > nextActive) nextActive = active;
      if (inactive > nextInactive) nextInactive = inactive;
    });
    setMaxActiveWidth(function update(prev) {
      return prev === nextActive ? prev : nextActive;
    });
    setMaxInactiveWidth(function update(prev) {
      return prev === nextInactive ? prev : nextInactive;
    });
  }, []);

  const registerActiveWidth = useCallback(function register(id: string, width: number) {
    const existing = widthsRef.current.get(id);
    if (existing?.active === width) return;
    widthsRef.current.set(id, { active: width, inactive: existing?.inactive ?? 0 });
    recomputeMax();
  }, [recomputeMax]);

  const registerInactiveWidth = useCallback(function register(id: string, width: number) {
    const existing = widthsRef.current.get(id);
    if (existing?.inactive === width) return;
    widthsRef.current.set(id, { active: existing?.active ?? 0, inactive: width });
    recomputeMax();
  }, [recomputeMax]);

  const unregisterWidths = useCallback(function unregister(id: string) {
    if (!widthsRef.current.has(id)) return;
    widthsRef.current.delete(id);
    recomputeMax();
  }, [recomputeMax]);

  const contextValue = useMemo(
    () => ({
      value,
      onChange,
      groupId,
      registerActiveWidth,
      registerInactiveWidth,
      unregisterWidths,
      maxActiveWidth,
      maxInactiveWidth,
    }),
    [
      value,
      onChange,
      groupId,
      registerActiveWidth,
      registerInactiveWidth,
      unregisterWidths,
      maxActiveWidth,
      maxInactiveWidth,
    ]
  );

  return (
    <ButtonGroupContext.Provider value={contextValue}>
      <div
        role="radiogroup"
        className={clsx(
          'relative flex items-center gap-0.5 p-0.5 rounded-lg bg-intents-ux-box-backgroundColor',
          className
        )}
        data-eid={dataEid}
      >
        {children}
      </div>
    </ButtonGroupContext.Provider>
  );
}

interface ButtonGroupItemProps extends Omit<HTMLMotionProps<'button'>, 'onClick' | 'ref' | 'animate' | 'transition' | 'initial' | 'exit'> {
  value?: string;
  icon: React.ReactNode;
  label?: string;
  disabled?: boolean;
  onClick?: () => void;
  /** When true, label stays visible for inactive items (e.g. header view toggles). */
  showLabelAlways?: boolean;
  tooltipDescription?: string | React.ReactNode;
  'data-eid'?: string;
}

const ButtonGroupItem = forwardRef<HTMLButtonElement, ButtonGroupItemProps>(function ButtonGroupItem(
  {
    value,
    icon,
    label,
    disabled,
    onClick,
    showLabelAlways = false,
    tooltipDescription = null,
    'data-eid': dataEid,
    className: extraClassName,
    ...rest
  },
  forwardedRef
) {
  const context = useButtonGroupContext();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const showTooltip = isHovered || isFocused;
  const internalRef = useRef<HTMLButtonElement>(null);
  const activeMeasureRef = useRef<HTMLSpanElement>(null);
  const inactiveMeasureRef = useRef<HTMLSpanElement>(null);
  const internalId = useId();
  const registrationId = value ?? internalId;

  const setRefs = useCallback((element: HTMLButtonElement | null) => {
    internalRef.current = element;
    if (typeof forwardedRef === 'function') {
      forwardedRef(element);
    } else if (forwardedRef) {
      forwardedRef.current = element;
    }
  }, [forwardedRef]);

  const isControlled = context?.value !== undefined && context?.onChange !== undefined;
  const isActive = isControlled && value !== undefined && context!.value === value;
  const isSelectable = value !== undefined;

  const registerActiveWidth = context?.registerActiveWidth;
  const registerInactiveWidth = context?.registerInactiveWidth;
  const unregisterWidths = context?.unregisterWidths;

  useEffect(function measureWidths() {
    if (!isSelectable || !label || !registerActiveWidth || !registerInactiveWidth || !unregisterWidths) return;
    const activeElement = activeMeasureRef.current;
    const inactiveElement = inactiveMeasureRef.current;
    if (!activeElement || !inactiveElement) return;

    const reportActive = function reportActive() {
      registerActiveWidth(registrationId, activeElement.offsetWidth);
    };
    const reportInactive = function reportInactive() {
      registerInactiveWidth(registrationId, inactiveElement.offsetWidth);
    };

    reportActive();
    reportInactive();

    const activeObserver = new ResizeObserver(reportActive);
    const inactiveObserver = new ResizeObserver(reportInactive);
    activeObserver.observe(activeElement);
    inactiveObserver.observe(inactiveElement);

    return function cleanup() {
      activeObserver.disconnect();
      inactiveObserver.disconnect();
      unregisterWidths(registrationId);
    };
  }, [isSelectable, label, registerActiveWidth, registerInactiveWidth, unregisterWidths, registrationId, showLabelAlways]);

  const handleClick = () => {
    if (disabled) return;
    setIsHovered(false);
    setIsFocused(false);

    if (isControlled && context?.onChange && value !== undefined) {
      context.onChange(value);
    } else if (onClick) {
      onClick();
    }
  };

  const tooltipComponent = label && (
    <Tooltip anchorRef={internalRef} portalElem={document.body}>
      <div className="flex flex-col gap-0 p-1">
        <div className="text-sm font-bold leading-none">{label}</div>
        {tooltipDescription && <div className="text-sm font-thin">{tooltipDescription}</div>}
      </div>
    </Tooltip>
  );

  const targetWidth = isActive
    ? (context?.maxActiveWidth || 'auto')
    : (context?.maxInactiveWidth || 'auto');

  return (
    <motion.button
      type="button"
      role={isControlled ? "radio" : undefined}
      aria-checked={isControlled ? isActive : undefined}
      aria-label={label}
      disabled={disabled}
      onClick={handleClick}
      data-eid={dataEid}
      ref={setRefs}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      animate={{ width: targetWidth }}
      transition={SPRING_TRANSITION}
      {...rest}
      className={clsx(
        'relative flex items-center justify-center p-1 rounded-xmd shrink-0 overflow-hidden transition-colors duration-200',
        {
          'bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor shadow-md': isActive,
          'bg-intents-ux-boxLowContrast-backgroundColor': !isActive && !disabled,
          'opacity-25 pointer-events-none': disabled,
          'cursor-pointer': !disabled,
        },
        extraClassName
      )}
    >
      {label && isSelectable && registerActiveWidth && registerInactiveWidth && (
        <>
          <span
            ref={activeMeasureRef}
            aria-hidden
            className="pointer-events-none invisible absolute left-0 top-0 flex items-center p-1 whitespace-nowrap"
          >
            <span className="flex items-center size-2.5">{icon}</span>
            <span className="ml-1 text-sm font-medium">{label}</span>
          </span>
          <span
            ref={inactiveMeasureRef}
            aria-hidden
            className="pointer-events-none invisible absolute left-0 top-0 flex items-center p-1 whitespace-nowrap"
          >
            <span className="flex items-center size-2.5">{icon}</span>
            {showLabelAlways ? (
              <span className="ml-1 text-sm font-medium">{label}</span>
            ) : null}
          </span>
        </>
      )}
      <span className="flex items-center size-2.5">{icon}</span>
      {label && showLabelAlways ? (
        <span className="ml-1 text-sm font-medium whitespace-nowrap">{label}</span>
      ) : (
        <AnimatePresence initial={false}>
          {isActive && label && (
            <motion.span
              key="label"
              initial={{ opacity: 0, width: 0, marginLeft: 0 }}
              animate={{ opacity: 1, width: 'auto', marginLeft: 4 }}
              exit={{ opacity: 0, width: 0, marginLeft: 0 }}
              transition={{ duration: 0.2 }}
              className="text-sm font-medium whitespace-nowrap"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      )}
      {!isActive && showTooltip && tooltipComponent}
    </motion.button>
  );
});

export const ButtonGroup = Object.assign(ButtonGroupRoot, {
  Item: ButtonGroupItem,
});
