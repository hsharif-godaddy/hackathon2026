// Vendored from @ux/coachmark (release-2500). Modified to support non-blocking mode (no Disrupt/Spotlight backdrop).
// Upstream package source: @ux/coachmark@2500.11.1
import Box from '@ux/box';
import Button from '@ux/button';
import Disrupt, { type DisruptProps } from '@ux/disrupt';
import Spotlight from '@ux/disrupt/spotlight';
import Popover from '@ux/popover';
import text from '@ux/text';
import classNames from 'classnames';
import React, { useEffect, useMemo, useRef, type ReactNode } from 'react';

import ProductTourContext, { type ProductTourContextValue } from './context';
import { useStep, useTourState } from './hooks';

const UX_COACHMARK_CLASSNAME = 'ux-coachmark';
const canUseDOM = function check() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
};

export interface ProductTourProps {
  children: ReactNode;
  nextMessage: ReactNode;
  prevMessage: ReactNode;
  exitMessage: ReactNode;
  show?: boolean;
  initialStep?: number;
  currentStep?: number;
  onStepChange?: (step: number) => void;
  onClose: () => void;
}

export function ProductTour({
  children,
  nextMessage,
  prevMessage,
  exitMessage,
  show = true,
  initialStep = 0,
  currentStep: controlledStep,
  onStepChange,
  onClose,
}: ProductTourProps) {
  const state = useTourState({ initialStep });
  const contextValue = useMemo<ProductTourContextValue>(
    function setContext() {
      return {
        ...state,
        onClose,
        nextMessage,
        prevMessage,
        exitMessage,
      };
    },
    [exitMessage, nextMessage, onClose, prevMessage, state],
  );

  useEffect(
    function setControlledStep() {
      if (typeof controlledStep === 'number') {
        state.setCurrentStep(controlledStep);
      }
    },
    [controlledStep, state],
  );

  useEffect(
    function resetWhenHidden() {
      if (!show) {
        state.resetTour();
      }
    },
    [show, state],
  );

  useEffect(
    function notifyStepChange() {
      onStepChange?.(state.currentStep);
    },
    [onStepChange, state.currentStep],
  );

  if (!show) return null;

  return <ProductTourContext.Provider value={contextValue}>{children}</ProductTourContext.Provider>;
}

export interface CoachmarkProps extends Omit<DisruptProps, 'onClose'> {
  children?: ReactNode;
  className?: string;
  onClose: () => void;
  anchorId: string;
  show: boolean;
  media?: ReactNode;
  title?: string;
  totalSteps: number;
  currentStep: number;
  description?: string;
  nextMessage: ReactNode;
  prevMessage: ReactNode;
  exitMessage?: ReactNode;
  disableBackdrop?: boolean;
  hideNavigation?: boolean;
  compact?: boolean;
}

export function Coachmark(props: CoachmarkProps) {
  const {
    children,
    className,
    anchorId,
    media,
    title,
    description,
    onClose: _onClose,
    disableBackdrop = true,
    hideNavigation = false,
    compact = false,
    ...rest
  } = props;
  void _onClose;

  const spotlightEl = canUseDOM() ? document.getElementById(anchorId) : null;
  const anchorRef = useRef<HTMLElement | null>(null);
  const { show, currentStep, totalSteps, nextStep, prevStep, nextMessage, prevMessage, onClose } =
    useStep(props);

  useEffect(
    function setAnchor() {
      anchorRef.current = document.getElementById(anchorId);
    },
    [anchorId],
  );

  if (!spotlightEl || !show) return null;

  const actionBar = hideNavigation ? null : (
    <Box
      className={`${UX_COACHMARK_CLASSNAME}-actions`}
      blockAlignChildren="spaceBetween"
      inlineAlignChildren="center"
      orientation="horizontal"
      inlineAlignSelf="end"
      stretch
    >
      {totalSteps ? (
        <text.span as="label">
          {currentStep + 1} / {totalSteps}
        </text.span>
      ) : null}
      <Box gap="sm" inlineAlignChildren="end" orientation="horizontal">
        {prevMessage ? (
          <Button
            text={prevMessage as string | number}
            size="sm"
            onClick={prevStep}
            className={`${UX_COACHMARK_CLASSNAME}-actions--prev`}
          />
        ) : null}
        <Button
          text={nextMessage as string | number}
          design="primary"
          size="sm"
          onClick={nextStep}
          className={`${UX_COACHMARK_CLASSNAME}-actions--next`}
        />
      </Box>
    </Box>
  );

  const popover = (
    <Popover
      triggerRef={anchorRef}
      media={media}
      title={title}
      description={description}
      actions={actionBar}
      onClose={onClose}
      className={classNames(UX_COACHMARK_CLASSNAME, compact && `${UX_COACHMARK_CLASSNAME}--compact`, className)}
      containerPadding={compact ? 'md' : 'lg'}
      gap={compact ? 'sm' : 'md'}
      boundaryElement={disableBackdrop && canUseDOM() ? document.body : undefined}
      {...rest}
    >
      {children}
    </Popover>
  );

  if (disableBackdrop) {
    return popover;
  }

  return (
    <Disrupt
      className={classNames(`${UX_COACHMARK_CLASSNAME}-tour`, className)}
      portalElem={canUseDOM() ? document.body : undefined}
      onClose={onClose}
      focusLock
      fullScreenChildren
    >
      <Spotlight spotlightId={anchorId} container={canUseDOM() ? document.body : undefined} />
      {popover}
    </Disrupt>
  );
}
