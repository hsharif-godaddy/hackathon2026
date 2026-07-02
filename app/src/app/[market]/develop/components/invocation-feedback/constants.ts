export const invocationFeedbackIconClass = 'w-2 h-2';

export const INVOCATION_FEEDBACK_FLYOUT_HEIGHT_FLAG = 'airo-builder-flyout-height';

export const INLINE_FEEDBACK_FREE_TEXT_FLAG = 'appbuilder-inline-feedback-free-text';

// Flag to enable/disable per-message inline customer feedback functionality in the application
export const PER_MESSAGE_FEEDBACK_FLAG = 'appbuilder-per-message-feedback';

// Flag for enabling artifact type inline customer feedback functionality in the application
export const ARTIFACT_TYPE_FEEDBACK_FLAG = 'appbuilder-artifact-type-feedback';

// Flag for enabling the task completion inline customer feedback banner.
export const TASK_COMPLETION_FEEDBACK_BANNER_FLAG = 'appbuilder-agent-work-feedback-banner';

// Flag for displaying the app generation feedback banner. (legacy one, only for first file edit )
export const APP_GENERATION_FEEDBACK_BANNER_FLAG = 'appbuilder-app-generation-feedback-banner';

export const invocationFeedbackActionIconClass = 'h-2.5 w-2.5 shrink-0 opacity-80';

export const invocationFeedbackPanelHeaderClass =
  'mb-1 flex items-start justify-between gap-2 px-1 py-0.5 my-[4px] min-h-[22px]';

/** Mirrors header inset so content spacing matches top and bottom card edges. */
export const invocationFeedbackPanelBodyClass = 'px-1 pt-1 pb-1 mb-[4px]';

/** Other form: no top inset so the input can use the chip body’s top padding. */
export const invocationFeedbackPanelBodyOtherClass = 'px-1 pt-0 pb-1 mb-[4px]';

/** When Other opens without a prior chip layout measurement (e.g. agent-work). */
export const invocationFeedbackPanelBodyFallbackMinClass = 'min-h-[5rem]';
