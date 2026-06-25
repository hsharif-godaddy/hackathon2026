export const invocationFeedbackIconClass = 'w-2 h-2';

export const INVOCATION_FEEDBACK_FLYOUT_HEIGHT_FLAG = 'airo-builder-flyout-height';

export const invocationFeedbackActionIconClass = 'h-2.5 w-2.5 shrink-0 opacity-80';

export const invocationFeedbackPanelHeaderClass =
  'mb-1 flex items-start justify-between gap-2 px-1 py-0.5 my-[4px] min-h-[22px]';

/** Mirrors header inset so content spacing matches top and bottom card edges. */
export const invocationFeedbackPanelBodyClass = 'px-1 pt-1 pb-1 mb-[4px]';

/** Other form: no top inset so the input can use the chip body’s top padding. */
export const invocationFeedbackPanelBodyOtherClass = 'px-1 pt-0 pb-1 mb-[4px]';

/** When Other opens without a prior chip layout measurement (e.g. agent-work). */
export const invocationFeedbackPanelBodyFallbackMinClass = 'min-h-[5rem]';
