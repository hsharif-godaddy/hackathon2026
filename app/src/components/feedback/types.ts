export interface FeedbackConfig {
  pk: string;
  title: string;
  fields: {
    id: string;
    type: 'radio' | 'mtext' | 'boolean';
    label: string;
    options?: string[];
    required?: boolean;
    hint?: string;
  }[];
  onlyOneResponseAllowed: boolean;
}

export interface FeedbackBaseProps {
  onClose: () => void;
  /** If not provided Growl is used and onClose is invoked. */
  onSubmitSuccess?: (res: any) => void;
  /** If not provided Growl is used. */
  onSubmitError?: (err: any) => void;
  textOverrides?: {
    modalTitle?: string;
    submitButton?: string;
    cancelButton?: string;
    onInitError?: string;
    onSubmitSuccess?: string;
    onSubmitError?: string;
  };
  eids?: { submitButton?: string; cancelButton?: string };
}

export interface FeedbackFormProps extends FeedbackBaseProps {
  config: FeedbackConfig;
}

export interface FeedbackProps extends FeedbackBaseProps {
  feedbackId: string;
  /** If not provided Growl is used and onClose is invoked. */
  onInitError?: (err: any) => void;
}
