import { SubscriptionPlan, SubscriptionStatus } from '@/types/credits';

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
  plan_type_name: SubscriptionPlan | null;
  subscription_id: string | null;
  subscription_status: SubscriptionStatus | null;
  total_credit_cnt: number | null;
  available_credit_cnt: number | null;
  /** JSON array of topic strings; client sends sorted/deduped JSON, server re-normalizes. */
  feedback_topic_list?: string | null;
  /** Product surface or entry context label at submit time. */
  feedback_origin_name?: string | null;
  /** Feedback dialog category — 'issue' | 'support' | 'feedback'. */
  feedback_category?: string | null;
  /** Matches `hasBeenPublished(site)` at submit time. */
  app_publish_flag?: boolean | null;
  /** Public site URL when `app_publish_flag` is true; otherwise null. */
  publish_url?: string | null;
  // ---- Fanout-Lambda enrichment fields (BFF → parquet → Lambda) ----
  // The UI sends these so the Lambda can rebuild DiagnosticContext + the
  // Slack Block Kit message identically to what the UI used to render.
  // All optional; missing fields render as blanks for legacy submitters.
  /** Pre-rendered "exp1=A, exp2=B" line from Hivemind cohorts. */
  experiments_line?: string | null;
  /** Preview URL (BFF will inject share-token before parquet write). */
  preview_url?: string | null;
  /** Live published URL (separate from publish_url Hive partition column). */
  published_url_full?: string | null;
  /** FullStory session URL captured at submit time. */
  full_story_url?: string | null;
  /** Pre-rendered subscription summary string. */
  subscription_info?: string | null;
}

export interface DiagnosticContext {
  currentAppId: string | null;
  previewUrl: string | undefined;
  publishedUrl: string | undefined;
  fullStoryUrl: string | null;
  subscriptionInfo: string;
  planType: SubscriptionPlan | null;
  subscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  totalCredits: number | null;
  availableCredits: number | null;
  isInternalUser: boolean;
  isImpersonating: boolean;
  shopperId: string | undefined;
  experimentsLine?: string;
  /** Customer (shopper) account ID for the debug-console "Details" deep-link. */
  customerId?: string;
  /** Parquet-row UUID for the debug-console "Details" deep-link. Lambda path only. */
  feedbackUuid?: string;
}
