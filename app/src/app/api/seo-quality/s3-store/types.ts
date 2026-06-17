export interface SeoQualityStorePayload {
  app_id: string;
  snapshot_id: string;
  score: number;
  page_scores: string;
  missing_elements: string;
  triggered_by: string;
  is_baseline: boolean;
  captured_utc_ts: string;
  score_delta: number | null;
  affected_pages: number | null;
  is_regression: boolean | null;
}

export interface SeoQualityS3Record {
  snapshot_id: string;
  app_id: string | null;
  score: number;
  page_scores: string | null;
  missing_elements: string | null;
  triggered_by: string | null;
  is_baseline: boolean;
  captured_utc_ts: string;
  cln_create_utc_ts: string;
  score_delta: number | null;
  affected_pages: number | null;
  is_regression: boolean | null;
  shopper_id: string | null;
}
