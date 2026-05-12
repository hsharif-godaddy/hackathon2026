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
  app_publish_flag: boolean | null;
  publish_url: string | null;
  cln_create_utc_ts: string;
}
