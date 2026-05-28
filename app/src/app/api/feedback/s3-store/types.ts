/** Row shape written to S3 as Parquet for Athena / Redshift Spectrum. */
export interface FeedbackS3Record {
  feedback_id: string;
  customer_id: string | null;
  app_id: string | null;
  feedback_utc_ts: string;
  feedback_text: string | null;
  consent_flag: boolean | null;
  rating: number | null;
  plan_type_name: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  total_credit_cnt: number | null;
  available_credit_cnt: number | null;
  feedback_topic_list: string | null;
  feedback_origin_name: string | null;
  /**
   * Feedback dialog category — one of 'issue' | 'support' | 'feedback'.
   * Drives which Slack Block Kit builder the fanout Lambda invokes
   * (buildBugReportBlocks / buildSupportRequestBlocks / buildFeedbackBlocks).
   * Distinct from `feedback_origin_name` which captures the UI surface
   * (e.g. 'first-publish-banner') the dialog opened from.
   */
  feedback_category: string | null;
  app_publish_flag: boolean | null;
  /**
   * Hive-partition-friendly published URL — populated only when
   * `app_publish_flag` is true. Predates the fanout-lambda Slack work and
   * stays as the analytics column.
   */
  publish_url: string | null;
  cln_create_utc_ts: string;
  // ---- Fanout Lambda enrichment fields (added 2026-05) ----
  // Optional UTF8 / BOOLEAN columns the BFF populates so the fanout Lambda
  // can rebuild DiagnosticContext + the Slack Block Kit message. Schema
  // version stays at 1; legacy rows without these fields render as blanks
  // (graceful migration). All optional in the parquet schema.
  /** Product surface label at submit time (e.g. 'first-publish-banner'). */
  origin: string | null;
  /** Pre-rendered "exp1=A, exp2=B" line from Hivemind cohorts. */
  experiments_line: string | null;
  /**
   * Preview URL captured at submit time. Passed through unchanged from
   * `DiagnosticContext.previewUrl` — note the BFF does NOT mint a share
   * token here (the prior name `preview_url_with_token` implied that, but
   * it was never accurate). Renamed to drop the misleading suffix.
   */
  preview_url: string | null;
  /**
   * Live published URL passed straight through from DiagnosticContext —
   * separate from `publish_url` because that field is gated on
   * `app_publish_flag === true` and used as a Hive partition key. The
   * Slack message format expects the raw URL whenever the UI had it,
   * regardless of the publish-flag analytics gate.
   */
  published_url_full: string | null;
  /** FullStory session URL the UI captured at submit time. */
  full_story_url: string | null;
  /** Pre-rendered subscription summary string (e.g. 'Pro Annual / Active'). */
  subscription_info: string | null;
  // ---- Customer profile fields (added 2026-05) ----
  // Populated best-effort by the BFF via fetchCustomerProfile (Profile API)
  // so the fanout Lambda can build a CRM case body that matches the legacy
  // BFF shape — Saideep Kilaru / skilaru@godaddy.com / phone, not raw IDs.
  // All optional: profile fetch failure does not block parquet write; Lambda
  // gracefully falls back to (customer_id / null / null / null) when fields
  // are missing. shopper_id is always available from the JWT.
  shopper_id: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  /**
   * Per-submission Switchboard gate (`appbuilder-fanout-via-lambda`). The BFF
   * resolves the flag at submit time and stamps the boolean here so the
   * fanout Lambda can decide whether to take ownership of Slack/CRM/
   * investigator dispatch without needing its own switchboard client + IAM.
   *
   * `true`  → Lambda owns Slack/CRM/investigator dispatch (UI skipped them).
   * `false` → BFF/UI already dispatched (legacy flow); Lambda no-ops on read.
   * `null`  → flag couldn't be resolved (system failure during submit). Lambda
   *           treats anything other than strict `true` as no-op, so we fail
   *           safely closed (no doubled Slack messages, no missed CRM cases).
   */
  fanout_via_lambda: boolean | null;
}
