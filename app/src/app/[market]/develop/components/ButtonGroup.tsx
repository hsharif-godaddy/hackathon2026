'use client';

import clsx from 'clsx';
import { AnimatePresence, type HTMLMotionProps, motion } from 'framer-motion';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import Tooltip from '@ux/tooltip';

type ButtonGroupRole = 'radiogroup' | 'group';

interface ButtonGroupContextValue {
  value?: string;
  onChange?: (value: string) => void;
  groupId: string;
  role: ButtonGroupRole;
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
  /**
   * ARIA role for the container. Use 'radiogroup' (default) when items are
   * mutually exclusive selections; use 'group' when items are a visual cluster
   * of independent buttons. Items only get role="radio" + aria-checked when
   * the container is a radiogroup.
   */
  role?: ButtonGroupRole;
  'data-eid'?: string;
}

function ButtonGroupRoot({ value, onChange, children, className, role = 'radiogroup', 'data-eid': dataEid }: ButtonGroupProps) {
  const groupId = useId();

  const contextValue = useMemo(
    () => ({ value, onChange, groupId, role }),
    [value, onChange, groupId, role]
  );

  return (
    <ButtonGroupContext.Provider value={contextValue}>
      <div
        role={role}
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

interface ButtonGroupItemProps extends Omit<HTMLMotionProps<'button'>, 'onClick' | 'ref' | 'layout' | 'transition' | 'initial' | 'exit'> {
  value?: string;
  icon?: React.ReactNode;
  label?: string;
  disabled?: boolean;
  onClick?: () => void;
  /** When true, label stays visible for inactive items (e.g. header view toggles). */
  showLabelAlways?: boolean;
  /** Optional trailing adornment (e.g. a background-activity spinner) rendered to the right of the label. */
  adornment?: React.ReactNode;
  /** Optional badge (e.g. a notification dot) overhanging the top-right corner of the button. */
  cornerBadge?: React.ReactNode;
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
    adornment,
    cornerBadge,
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

  const button = (
    <motion.button
      type="button"
      role={isControlled && context?.role === 'radiogroup' ? "radio" : undefined}
      aria-checked={isControlled && context?.role === 'radiogroup' ? isActive : undefined}
      aria-label={label}
      disabled={disabled}
      onClick={handleClick}
      data-eid={dataEid}
      ref={setRefs}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      layout
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
      {icon && <span className="flex items-center size-2.5">{icon}</span>}
      {label && showLabelAlways ? (
        <span className={clsx('text-sm font-medium whitespace-nowrap', icon && 'ml-1')}>{label}</span>
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
      {adornment && <span className="ml-1 flex shrink-0 items-center">{adornment}</span>}
      {!isActive && showTooltip && tooltipComponent}
    </motion.button>
  );

  if (!cornerBadge) {
    return button;
  }

  return (
    <span className="relative inline-flex shrink-0">
      {button}
      <span className="pointer-events-none absolute -right-px -top-px z-9 flex items-center">
        {cornerBadge}
      </span>
    </span>
  );
});

export const ButtonGroup = Object.assign(ButtonGroupRoot, {
  Item: ButtonGroupItem,
});
