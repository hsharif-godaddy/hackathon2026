/**
 * feedback-db.ts — DynamoDB-backed feedback analytics.
 * All functions are async; signatures are compatible with prior SQLite version.
 */

import { getFeedbackStore } from '@/lib/supportplane/store/feedback-store';

export interface FeedbackSummary {
  totalFeedback: number;
  avgRating: number | null;
  issueCount: number;
  supportCount: number;
  feedbackCount: number;
  uniqueApps: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  dateRange: { from: string | null; to: string | null };
}

export interface TrendPoint {
  date: string;
  count: number;
  avgRating: number | null;
  issueCount: number;
  supportCount: number;
  feedbackCount: number;
}

export interface RatingBucket {
  rating: number;
  count: number;
  pct: number;
}

export interface CategoryBreakdown {
  category: string;
  count: number;
  pct: number;
}

export interface TopicEntry {
  topic: string;
  count: number;
  pct: number;
}

export interface AppEntry {
  appId: string;
  count: number;
  avgRating: number | null;
  issueCount: number;
  issueRate: number | null;
}

export interface HeatmapCell {
  x: string;
  y: number;
  value: number;
}

export interface PeriodStats {
  label: string;
  count: number;
  avgRating: number | null;
  issueCount: number;
  issueRate: number | null;
}

export interface ComparisonResult {
  current: PeriodStats;
  previous: PeriodStats;
  delta: {
    count: number;
    countPct: number | null;
    rating: number | null;
    issueRate: number | null;
  };
}

export interface IngestionStatus {
  totalFiles: number;
  successFiles: number;
  errorFiles: number;
  lastSync: string | null;
  totalRows: number;
  dbPath: string;
}

export interface FeedbackRow {
  feedback_id: string;
  data_source: string | null;
  app_id: string | null;
  customer_id: string | null;
  feedback_utc_ts: string | null;
  feedback_text: string | null;
  rating: number | null;
  feedback_category: string | null;
  feedback_topic_list: string | null;
  plan_type_name: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  total_credit_cnt: number | null;
  available_credit_cnt: number | null;
  feedback_origin_name: string | null;
  app_publish_flag: number | null;
  publish_url: string | null;
  cln_create_utc_ts: string | null;
  full_story_url: string | null;
  shopper_id: string | null;
  device_type: string | null;
  browser_type: string | null;
  page_url: string | null;
  session_id: string | null;
  app_name: string | null;
  app_version: string | null;
}

export interface DataCoverage {
  earliest: string | null;
  latest: string | null;
  totalRows: number;
  monthsCovered: string[];
  athenaRows: number;
  s3OnlyRows: number;
  bothRows: number;
}

export interface IngestionLogEntry {
  id: number;
  s3_url: string;
  source: string;
  status: string;
  rows_written: number;
  error_msg: string | null;
  ingested_at: string;
}

// ── Analytics queries ─────────────────────────────────────────────

export async function getFeedbackSummary(env: string, days?: number): Promise<FeedbackSummary> {
  return getFeedbackStore().getFeedbackSummary(env, days);
}

export async function getFeedbackTrends(
  env: string,
  granularity: 'day' | 'week' | 'month' = 'day',
  days = 30
): Promise<TrendPoint[]> {
  return getFeedbackStore().getFeedbackTrends(env, granularity, days);
}

export async function getRatingDistribution(env: string, appId?: string): Promise<RatingBucket[]> {
  return getFeedbackStore().getRatingDistribution(env, appId);
}

export async function getCategoryBreakdown(env: string): Promise<CategoryBreakdown[]> {
  return getFeedbackStore().getCategoryBreakdown(env);
}

export async function getTopicFrequency(env: string, topN = 20): Promise<TopicEntry[]> {
  return getFeedbackStore().getTopicFrequency(env, topN);
}

export async function getAppLeaderboard(env: string, limit = 20): Promise<AppEntry[]> {
  return getFeedbackStore().getAppLeaderboard(env, limit);
}

export async function getFeedbackHeatmap(
  env: string,
  type: 'hour-of-day' | 'day-of-week' = 'hour-of-day'
): Promise<HeatmapCell[]> {
  return getFeedbackStore().getFeedbackHeatmap(env, type);
}

export async function getWoWComparison(env: string): Promise<ComparisonResult> {
  return getFeedbackStore().getWoWComparison(env);
}

export async function getMoMComparison(env: string): Promise<ComparisonResult> {
  return getFeedbackStore().getMoMComparison(env);
}

export async function getRecentFeedback(
  env: string,
  limit = 50,
  offset = 0,
  filters?: { category?: string; rating?: number; appId?: string; days?: number },
  sort?: { col: string; dir: 'asc' | 'desc' }
): Promise<{ rows: FeedbackRow[]; total: number }> {
  const result = await getFeedbackStore().getRecentFeedback(env, limit, offset, filters, sort);
  return result as unknown as { rows: FeedbackRow[]; total: number };
}

export async function getFeedbackIngestionStatus(): Promise<IngestionStatus> {
  return getFeedbackStore().getFeedbackIngestionStatus();
}

export async function getDataCoverage(env: string): Promise<DataCoverage> {
  return getFeedbackStore().getDataCoverage(env);
}

export async function getIngestionLog(limit = 100): Promise<IngestionLogEntry[]> {
  return getFeedbackStore().getIngestionLog(limit);
}

// ── Ingest writes ─────────────────────────────────────────────────

export async function insertFeedbackAthenaRow(params: unknown[]): Promise<number> {
  return getFeedbackStore().insertFeedbackAthenaRow(params);
}

export async function insertFeedbackS3Row(params: unknown[]): Promise<number> {
  return getFeedbackStore().insertFeedbackS3Row(params);
}

export async function getAlreadyIngestedKeys(): Promise<Set<string>> {
  return getFeedbackStore().getAlreadyIngestedKeys();
}

export async function logIngestionSuccess(
  s3Url: string,
  source: string,
  rowsWritten: number
): Promise<void> {
  return getFeedbackStore().logIngestionSuccess(s3Url, source, rowsWritten);
}

export async function logIngestionError(
  s3Url: string,
  source: string,
  errorMsg: string
): Promise<void> {
  return getFeedbackStore().logIngestionError(s3Url, source, errorMsg);
}

export async function clearFeedbackData(env: string): Promise<void> {
  return getFeedbackStore().clearFeedbackData(env);
}

export async function rebuildFeedbackComposite(env: string): Promise<number> {
  return getFeedbackStore().rebuildFeedbackComposite(env);
}

export async function recomputeDailyStats(env: string, dates?: string[]): Promise<void> {
  return getFeedbackStore().recomputeDailyStats(env, dates);
}
