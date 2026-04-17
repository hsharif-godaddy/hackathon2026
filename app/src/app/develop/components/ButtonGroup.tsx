'use client';

import clsx from 'clsx';
import { motion } from 'framer-motion';
import { useCallback, useMemo } from 'react';
import { createContext, forwardRef, useContext, useId, useRef, useState } from 'react';
import Tooltip from '@ux/tooltip';

interface ButtonGroupContextValue {
  value?: string;
  onChange?: (value: string) => void;
  groupId: string;
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
  'data-eid'?: string;
}

function ButtonGroupRoot({ value, onChange, children, className, 'data-eid': dataEid }: ButtonGroupProps) {
  const groupId = useId();
  const contextValue = useMemo(() => ({ value, onChange, groupId }), [value, onChange, groupId]);

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

const ButtonGroupItem = forwardRef<HTMLButtonElement, ButtonGroupItemProps>(function ButtonGroupItem(
  { value, icon, label, disabled, showLabelAlways = false, onClick, tooltipDescription = null, 'data-eid': dataEid, className: extraClassName, ...rest },
  forwardedRef
) {
  const context = useButtonGroupContext();
  const [showTooltip, setShowTooltip] = useState(false);
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
  const shouldShowLabel = label && (showLabelAlways || isActive);

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
    <Tooltip anchorRef={internalRef} portalElem={document.body}>
      <div className="flex flex-col gap-0 p-1">
        <div className="text-sm font-bold leading-none">{label}</div>
        {tooltipDescription && <div className="text-sm font-thin">{tooltipDescription}</div>}
      </div>
    </Tooltip>
  );

  return (
    <button
      type="button"
      role={isControlled ? "radio" : undefined}
      aria-checked={isControlled ? isActive : undefined}
      aria-label={label}
      disabled={disabled}
      onClick={handleClick}
      data-eid={dataEid}
      ref={setRefs}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      aria-haspopup={showTooltip}
      {...rest}
      className={clsx(
        'relative flex items-center gap-1 p-1 rounded-xmd transition-colors duration-200',
        {
          'text-intents-ux-boxHighContrast-foregroundColor': isActive,
          'bg-intents-ux-boxLowContrast-backgroundColor': !isActive && !disabled,
          'opacity-25 pointer-events-none': disabled,
          'cursor-pointer': !disabled,
        },
        extraClassName
      )}
    >
      {isActive && isControlled && context?.groupId && (
        <motion.div
          layoutId={`${context.groupId}-bubble`}
          className="absolute inset-0 bg-intents-ux-boxHighContrast-backgroundColor rounded-xmd shadow-md"
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 30,
          }}
        />
      )}
      <span className="relative flex items-center size-2.5">{icon}</span>
      {shouldShowLabel && (
        showLabelAlways ? (
          <span className="relative text-xs font-medium whitespace-nowrap">
            {label}
          </span>
        ) : (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="relative text-sm font-medium whitespace-nowrap"
          >
            {label}
          </motion.span>
        )
      )}
      {!isActive && showTooltip && tooltipComponent}
    </button>
  );
});

export const ButtonGroup = Object.assign(ButtonGroupRoot, {
  Item: ButtonGroupItem,
});