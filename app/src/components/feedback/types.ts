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
  origin?: string;
}

export interface FeedbackProps extends FeedbackBaseProps {
  feedbackId: string;
  /** If not provided Growl is used and onClose is invoked. */
  onInitError?: (err: any) => void;
  origin?: string;
  /** Skip category selection and open directly to this step. */
  initialStep?: FeedbackCategory;
}

// Multi-step feedback dialog types
export type FeedbackCategory = 'support' | 'issue' | 'feedback';
export type FeedbackStep = 'category' | FeedbackCategory;

export interface SupportFormData {
  topics: string[];
  description: string;
  followUp: boolean;
}

export interface IssueFormData {
  topics: string[];
  description: string;
  followUp: boolean;
}

export interface ShareFeedbackFormData {
  rating: number | null;
  topics: string[];
  comment: string;
  customerConsent: boolean;
}

export interface FeedbackStorePayload {
  app_id: string | null;
  feedback_text: string | null;
  consent_flag: boolean | null;
  rating: number | null;
}

export interface DiagnosticContext {
  currentAppId: string | null;
  previewUrl: string | undefined;
  publishedUrl: string | undefined;
  fullStoryUrl: string | null;
  subscriptionInfo: string;
  isInternalUser: boolean;
  isImpersonating: boolean;
  shopperId: string | undefined;
  experimentsLine?: string;
}
