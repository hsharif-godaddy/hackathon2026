/**
 * Database Schema and Types
 *
 * This module contains TypeScript interface definitions AND database schema management.
 * It provides both type definitions for TypeScript and database creation functions.
 */

import type { Database } from 'better-sqlite3';
import { Logger } from '../logging/index.js';
import type { SyncStrategy } from '../types/git-remote.js';
import { SocialPlatform, PostState } from '../types/social.js';

export type { SyncStrategy };

const logger = Logger.create({ service: 'database-schema' });

// ==================================================================================
// TypeScript Interface Definitions
// ==================================================================================

export interface App {
  id: string;
  name: string;
  path: string;
  port: number;
  socketPath?: string; // Preview supervisor connection path (TCP URL or Unix socket path)
  publishSupervisorPath?: string; // Publish supervisor connection path (TCP URL) for V4 unified job
  previewUrl?: string; // Full URL for preview (e.g., https://site-id.preview.example.com)
  initialPrompt?: string;
  templateVersion?: string; // Template version (v8)
  subscriptionId?: string; // Subscription ID from main app
  customerId?: string; // Customer ID from main app
  status: 'creating' | 'created' | 'error';
  publishedUrl: string | null; // Published site URL (set after successful publish)
  initialBuildComplete?: boolean; // True when first git commit has been made
  createdAt: Date;
  updatedAt: Date;
  // Extended properties for AI name generation
  aiGeneratedName?: string;
  nameSuggested?: boolean;
  originalName?: string;
}

export interface CreateAppRequest {
  name: string;
  initialPrompt?: string;
  siteId?: string;
}

export interface UpdateAppRequest {
  name?: string;
}

export interface FileContext {
  id: string;
  appPath: string;
  filePath: string;
  lastModified: number;
  lastRead: number;
  modificationCount: number;
  readCount: number;
  fileSize: number;
  tokenCount: number;
  contentHash: string;
  actualFileModTime: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunningProcess {
  id: string;
  appId: string;
  pid: number;
  port: number;
  startedAt: Date;
  status: 'running' | 'stopped' | 'crashed';
}

export interface Conversation {
  id: string;
  appId: string;
  agentId: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  sender: 'user' | 'agent';
  content: string;
  messageType?: 'status' | 'tool_result' | 'error';
  toolCalls?: ToolCall[];
  segments?: MessageSegment[];
  metadata?: Record<string, any>;
  contextAttachments?: Array<{
    type: string;
    data: any;
    metadata?: Record<string, any>;
    persistence?: 'save' | 'ephemeral';
    renderStrategy?: 'before_prompt' | 'after_prompt' | 'replace_prompt' | 'hidden';
  }>;
  origin: 'support' | 'customer';
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  toolName: string;
  toolArgs: unknown;
  toolResult?: unknown;
  error?: string;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  status: 'running' | 'success' | 'error';
}

export interface MessageSegment {
  id: string;
  type: 'content' | 'tool_call';
  content?: string;
  tool_call?: ToolCall;
  timestamp: Date;
}


export interface Memory {
  id: string;
  appId: string;
  key: string;
  value: string; // JSON-serialized value
  valueType: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  searchText?: string | undefined; // Extracted searchable text for vector database
  createdAt: Date;
  updatedAt: Date;
}

/**
 * OAuth token storage with AES-256-GCM encryption
 * Stores encrypted access and refresh tokens for OAuth2 flows
 */
export interface OAuthToken {
  id: string;
  appId: string;
  provider: string;
  scopes: string;
  accessTokenEncrypted: string;
  accessTokenIv: string;
  accessTokenTag: string;
  refreshTokenEncrypted?: string;
  refreshTokenIv?: string;
  refreshTokenTag?: string;
  expiresAt: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Conversation summary for incremental summarization
 * Stores summaries that replace ranges of messages
 */
export interface ConversationSummary {
  id: string;
  appId: string;
  conversationId?: string; // nullable for multi-conversation summaries
  summaryText: string;
  messageRangeStart: string; // message ID
  messageRangeEnd: string; // message ID
  messageCount: number;
  originalTokenCount: number;
  summaryTokenCount: number;
  modelUsed: string;
  operationLog?: string; // cumulative log of operations that survives compression
  incrementalUpdateCount?: number; // track how many times summary has been incrementally updated
  lastFullSummarizationAt?: Date; // when summary was last regenerated from scratch
  createdAt: Date;
}

/**
 * Git remote configuration
 * Stores metadata for git remote sync (GitHub, GitLab, Bitbucket)
 * Tokens are NOT stored here - they're in secrets API
 */
export interface GitRemoteConfig {
  id: string;
  appId: string;
  remoteName: string;
  provider: string;
  repoUrl: string;
  defaultBranch: string;
  lastSyncAt: number | null;
  syncEnabled: boolean;
  syncStrategy: SyncStrategy;
  createdAt: Date;
  updatedAt: Date;
}

export type AppCommerceBindingStatus =
  | 'business_bound'
  | 'store_bound'
  // Reserved for async flows that bind a store before channel ensure completes.
  | 'channel_pending'
  | 'channel_ready'
  | 'invalid';

export type AppCommerceBindingSource =
  | 'user_selected'
  | 'tool_setup'
  | 'tool_discovery'
  | 'tool_channel_ensure'
  | 'migration'
  | 'env_fallback'
  | 'unknown';

/**
 * Durable AppBuilder-owned relationship between an app and Commerce resources.
 *
 * Rows are sparse: no row means Commerce has not been configured for the app.
 * Do not treat this as a mirror of GoDaddy Commerce data; it is the current
 * target AppBuilder should work against.
 *
 * Optional fields support partial update construction; nulls represent
 * intentionally cleared or unavailable persisted values.
 */
export interface AppCommerceBinding {
  appId: string;
  businessId?: string | null;
  businessName?: string | null;
  storeId?: string | null;
  storeName?: string | null;
  storeUrl?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  defaultLocationId?: string | null;
  status: AppCommerceBindingStatus;
  source: AppCommerceBindingSource;
  lastVerifiedAt?: Date | null;
  verificationError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AppCommerceBindingEventType =
  | 'selected_business'
  | 'selected_store'
  | 'created_store'
  | 'ensured_channel'
  | 'cleared_binding'
  | 'verified'
  | 'verification_failed';

export type AppCommerceBindingActorType = 'agent' | 'user' | 'system' | 'migration';

export interface AppCommerceBindingEvent {
  id: string;
  appId: string;
  eventType: AppCommerceBindingEventType;
  previousBusinessId?: string | null;
  previousStoreId?: string | null;
  previousChannelId?: string | null;
  nextBusinessId?: string | null;
  nextStoreId?: string | null;
  nextChannelId?: string | null;
  actorType: AppCommerceBindingActorType;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Share token for public preview access
 * Allows time-limited access to preview apps without authentication
 * Tokens are cryptographically secure and expire after 7 days
 */
/**
 * Share token purpose. Determines who can mint, with what TTL cap, and how the
 * one-active-token-per-app guard scopes itself.
 *
 * - 'user': UI-driven preview share (default). 1h–7d TTL, gated by replaceActive.
 * - 'archive_snapshot': pre-archive screenshot capture from hosting. Cert2s callers
 *   only, fixed 15-minute TTL, lives in its own one-active slot (so a UI-issued
 *   user link and an archive snapshot can coexist).
 */
export type ShareTokenPurpose = 'user' | 'archive_snapshot';

export interface ShareToken {
  token: string;
  appId: string;
  expiresAt: number; // Unix timestamp (milliseconds)
  purpose: ShareTokenPurpose;
  createdAt: Date;
  firstUsedAt: Date | null; // Track first access only
}

/**
 * Social platform association
 * Stores connections between apps and social media accounts
 */
export interface SocialAssociation {
  id: string;
  appId: string;
  socialId: string;
  platform: SocialPlatform;
  createdAt: Date;
}

/**
 * Social media post
 * Stores publish attempts and results for social media posts
 */
export interface SocialPost {
  id: string;
  appId: string;
  associationId: string | null;
  platform: string;
  state: PostState;
  payload: string; // JSON string
  externalResponse: string | null; // JSON string
  externalId: string | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  campaignId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SeoQualityTriggeredBy = 'publish' | 'manual';

/**
 * SEO quality snapshot stored per publish or manual trigger.
 * score: 0-100 site-wide average; is_baseline: true for the first snapshot.
 */
export interface SeoQualityScore {
  id: string;
  appId: string;
  score: number;
  pageScores: string;      // JSON: Record<path, number>
  missingElements: string; // JSON: Record<path, string[]>
  triggeredBy: SeoQualityTriggeredBy;
  isBaseline: boolean;
  createdAt: Date;
}

/**
 * Route type for dynamic content routes
 */
export type RouteType = 'blog' | 'landing_page';

/**
 * Generic route configuration
 * Stores dynamic routes for various content types (blog, landing pages, etc.)
 */
export interface Route {
  id: string;
  appId: string;
  routeType: RouteType; // 'blog', 'landing_page'
  pathPrefix: string; // "blog", "news", "articles", "landing", etc.
  isDefault: boolean; // For canonical URL generation within route type
  createdAt: Date;
}

/**
 * Blog post
 * Stores blog posts with markdown content
 */
export interface BlogPost {
  id: string;
  appId: string;
  campaignId: string | null;
  slug: string;
  title: string;
  summary: string | null;
  contentMarkdown: string; // Markdown content
  featuredImage: string | null;
  tags: string[] | null; // Array of tag strings (parsed from JSON storage)
  published: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Raw `app_metadata` row as stored in SQLite (metadata is a JSON string,
 * timestamps are plain strings — hence snake_case + no Date objects).
 * Callers never consume this directly; AppMetadataRepository.merge() parses
 * the metadata blob and returns the AppMetadata type from @airo/shared.
 */
export interface AppMetadataRow {
  app_id: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

// SimpleCampaign types
//
// "SimpleCampaign" intentionally collapses the campaign + activation/flight into a
// single object (per the 2026-06-10 data-model review). This naming leaves room for
// a future richer campaign structure that rolls up under a parent MarketingPlan
// without having to rename this model.
// Domain enums. These are the single source of truth for the allowed values; the
// evolving ones (status, content type/status, utm_medium) seed small lookup tables
// that the DB foreign-keys against — so the value set can change with a code-only
// edit (re-seed) instead of a CHECK-constraint table rebuild, which SQLite cannot do
// in place.
export enum SimpleCampaignStatus {
  Draft = 'draft',
  Ready = 'ready',
  Scheduled = 'scheduled',
  Active = 'active',
  Completed = 'completed',
  Archived = 'archived',
}
export enum SimpleCampaignContentType {
  LandingPage = 'landing-page',
  Banner = 'banner',
  Blog = 'blog',
  Social = 'social',
  Email = 'email',
  Ad = 'ad',
}
export enum SimpleCampaignContentStatus {
  Draft = 'draft',
  Scheduled = 'scheduled',
  Published = 'published',
  Failed = 'failed',
}

// Who authored a campaign artifact — a customer action or the agent/automation.
export enum CampaignActor {
  User = 'user',
  Agent = 'agent',
}

// UTM attribution vocabularies (Unified C2 Traffic Attribution Model).
// These live on the marketing_utm table (keyed by the target content row), NOT on the
// campaign or the campaign-content row: UTM applies to any marketing content (even
// outside a campaign), and a single piece of content fans out per platform — so
// utm_source/utm_medium are per target.
//
// utm_medium is a closed channel-class vocabulary → backed by the utm_medium lookup
// table (DB foreign key). utm_source is intentionally an enum ONLY, with NO lookup
// table / FK: the seo-offsite-<placement> family is dynamic (placements are minted at
// the channel adapter, not known up front), so a closed FK set would reject otherwise
// valid values. utm_source is validated at the channel adapter layer instead.
export enum UtmMedium {
  Cpc = 'cpc',
  PaidSocial = 'paid_social',
  OrganicSocial = 'organic_social',
  Email = 'email',
  Blog = 'blog',
  Seo = 'seo',
  Aeo = 'aeo',
  Geo = 'geo',
  Referral = 'referral',
  Display = 'display',
  Video = 'video',
}
export enum UtmSource {
  GoogleAds = 'google-ads',
  BingAds = 'bing-ads',
  MetaAds = 'meta-ads',
  LinkedInAds = 'linkedin-ads',
  TikTokAds = 'tiktok-ads',
  PinterestAds = 'pinterest-ads',
  YelpAds = 'yelp-ads',
  Facebook = 'facebook',
  Instagram = 'instagram',
  X = 'x',
  LinkedIn = 'linkedin',
  TikTok = 'tiktok',
  YouTube = 'youtube',
  Pinterest = 'pinterest',
  GemEmail = 'gem-email',
  BlogWm = 'blog-wm',
  BlogMwp = 'blog-mwp',
  BlogStatic = 'blog-static',
  BlogAab = 'blog-aab',
  SeoOnsite = 'seo-onsite',
}

export interface SimpleCampaign {
  id: string;
  appId: string;
  // Placeholder for a future MarketingPlan parent so simple campaigns can become its
  // children later. Nullable; no FK yet (the marketing_plan table does not exist).
  marketingPlanId: string | null;
  name: string;
  status: SimpleCampaignStatus;
  offer: string | null;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  launchedAt: string | null;
  completedAt: string | null;
  createdBy: CampaignActor | null;
  updatedBy: CampaignActor | null;
  createdAt: string;
  updatedAt: string;
}

// Campaign content is a reference/tracking layer — a thin projection over the real
// content (blog_posts, social_posts, app source, …) surfacing only what the campaign
// card needs. contentRefId points to the content location; full content stays in its
// system of record.
export interface SimpleCampaignContent {
  id: string;
  simpleCampaignId: string;
  assetType: SimpleCampaignContentType;
  contentRefId: string | null;
  title: string;
  scheduledDate: string | null;
  status: SimpleCampaignContentStatus;
  contentPreview: string | null;
  imageUrl: string | null;
  createdBy: CampaignActor | null;
  createdAt: string;
}

// marketing_utm records the UTM attribution for one published target (a blog post,
// a per-platform social post, a future ad/email). It exists independent of campaigns
// — utm_campaign/simple_campaign_id are only populated when the target is part of a
// campaign. utm_campaign is the HMAC of simpleCampaignId hashed with the global
// UTM_SALT (see campaign-utm-signer) — one stable value per campaign, no per-row salt.
export interface UTMAttributionParams {
  id: string;
  contentRefId: string; // references the target content row id (social_posts.id, blog_posts.id, …)
  simpleCampaignId: string | null;
  utmSource: UtmSource | null;
  utmMedium: UtmMedium | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  createdAt: string;
  updatedAt: string;
}

// ==================================================================================
// Database Schema Management Functions
// ==================================================================================

/**
 * Create the seo_quality_scores table — RUBICON-143.
 */
function createSeoQualityScoresTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seo_quality_scores (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      page_scores TEXT NOT NULL,
      missing_elements TEXT NOT NULL,
      triggered_by TEXT NOT NULL CHECK(triggered_by IN ('publish','manual')),
      is_baseline BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Initialize the complete database schema
 */
export function initializeSchema(db: Database): void {
  // Configure database settings
  configureDatabaseSettings(db);

  // Create all tables
  // Note: Table creation happens before migrations for new installations
  // All table creation uses IF NOT EXISTS, ensuring idempotency
  // Migrations handle schema evolution for existing databases
  createAppsTable(db);
  createRunningProcessesTable(db);
  createConversationsTable(db);
  createConversationMessagesTable(db);

  createFileContextTable(db);
  createMemoryTable(db);
  createAppMetadataTable(db);
  createImportJobsTable(db);
  createDbImportJobsTable(db);
  createConversationSummariesTable(db);
  createGitRemoteConfigTable(db);
  createShareTokensTable(db);
  createAppCommerceBindingsTable(db);
  createAppCommerceBindingEventsTable(db);
  createDkimOnboardingTable(db);
  createSeoQualityScoresTable(db);
  // Bring any pre-merge campaign tables up to the current column shape (data-preserving)
  // BEFORE the create* + index calls below, which assume the current columns.
  migrateCampaignTablesToCurrentSchema(db);
  createSimpleCampaignTable(db);
  createSimpleCampaignContentTable(db);
  createMarketingUtmTable(db);

  // Apply migrations BEFORE creating indexes (migrations may alter schema)
  // Note: oauth_tokens and social tables creation moved to migrations
  applyMigrations(db);

  // Create all indexes (after migrations complete)
  createIndexes(db);

  // Create all triggers
  createTriggers(db);

  // Create file context indexes after migrations (in case table was created during migration)
  createFileContextIndexes(db);
}

/**
 * Configure database settings and pragmas
 */
function configureDatabaseSettings(db: Database): void {
  db.exec('PRAGMA journal_mode = WAL');
  // NORMAL is safe with WAL mode and avoids the per-write fsync overhead of FULL
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA cache_size = 1000');
  db.exec('PRAGMA mmap_size = 0');
  db.exec('PRAGMA temp_store = FILE');
  db.exec('PRAGMA soft_heap_limit = 134217728');
  db.exec('PRAGMA hard_heap_limit = 268435456');
  db.exec('PRAGMA foreign_keys = ON');
}

/**
 * Create the apps table
 */
function createAppsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 5000,
      socket_path TEXT,
      publish_supervisor_path TEXT,
      preview_url TEXT,
      initial_prompt TEXT,
      template_version TEXT,
      subscription_id TEXT,
      customer_id TEXT,
      status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating', 'created', 'error')),
      initial_build_complete BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Create the running_processes table for tracking dev servers
 */
function createRunningProcessesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS running_processes (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      pid INTEGER NOT NULL,
      port INTEGER NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'running',
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the conversations table
 */
function createConversationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the conversation_messages table
 */
function createConversationMessagesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender TEXT NOT NULL CHECK(sender IN ('user', 'agent')),
      content TEXT NOT NULL,
      message_type TEXT,
      tool_calls TEXT, -- JSON string
      segments TEXT,   -- JSON string
      metadata TEXT,   -- JSON string
      context_attachments TEXT, -- JSON string for generic context attachments
      origin TEXT NOT NULL DEFAULT 'customer' CHECK(origin IN ('support', 'customer')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);
}


/**
 * Create the file_context table for tracking hot files state
 */
function createFileContextTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_context (
      id TEXT PRIMARY KEY,
      app_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      last_modified INTEGER NOT NULL,
      last_read INTEGER NOT NULL,
      modification_count INTEGER NOT NULL DEFAULT 0,
      read_count INTEGER NOT NULL DEFAULT 0,
      file_size INTEGER NOT NULL DEFAULT 0,
      token_count INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT NOT NULL,
      actual_file_mod_time INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(app_path, file_path)
    )
  `);
}

/**
 * Create the memory table for hierarchical key-value storage
 */
function createMemoryTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      value_type TEXT NOT NULL CHECK(value_type IN ('string', 'number', 'boolean', 'object', 'array', 'null')),
      search_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(app_id, key),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the app_metadata table — one JSON metadata object per app.
 *
 * Keyed by app_id (siteId). Intentionally NOT a foreign key to `apps`: PaaS apps
 * have no `apps` row but always have a siteId, and must still carry metadata.
 */
function createAppMetadataTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      app_id TEXT PRIMARY KEY,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP -- set explicitly by AppMetadataRepository.merge()'s upsert (no trigger)
    )
  `);
}

/**
 * Create the import_jobs table for tracking zip import progress
 *
 * This table tracks the status of zip file imports, including validation errors,
 * build output, and progress through the import pipeline.
 *
 * FUTURE OPTIMIZATION: Create dedicated createEmptyAppContainer() method to skip
 * template installation, eliminating double npm install. Track in technical debt.
 */
function createImportJobsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
        'pending', 'creating_container', 'extracting', 'validating',
        'copying', 'installing', 'building', 'committing', 'pushing',
        'pulling', 'restarting', 'completed', 'failed'
      )),
      source_type TEXT NOT NULL DEFAULT 'zip' CHECK(source_type IN ('zip', 'git_pull', 'git_push')),
      zip_file_name TEXT,
      zip_file_size INTEGER,
      git_url TEXT,
      git_branch TEXT,
      git_commit_hash TEXT,
      extracted_path TEXT,
      detected_package_manager TEXT CHECK(detected_package_manager IN ('npm', 'yarn', 'pnpm')),
      has_build_script BOOLEAN,
      has_dev_script BOOLEAN,
      validation_errors TEXT,
      install_output TEXT,
      build_output TEXT,
      error_message TEXT,
      error_stage TEXT,
      diagnose_snapshot_path TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);

  // Run table-specific migrations after creation
  // This handles existing databases that were created with old schema
  migrateImportJobsNullableColumns(db);
}

/**
 * Create the db_import_jobs table for tracking database import progress
 *
 * This table tracks the status of SQL file imports into app MySQL databases,
 * including progress metrics, error details, and timing information.
 * Separate from import_jobs (code import) to avoid schema bloat.
 */
function createDbImportJobsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS db_import_jobs (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
        'pending', 'validating', 'dropping_tables', 'importing', 'completed', 'failed'
      )),
      file_name TEXT,
      file_size INTEGER,
      tables_dropped INTEGER,
      tables_imported INTEGER,
      statements_executed INTEGER DEFAULT 0,
      statements_total INTEGER,
      bytes_processed INTEGER DEFAULT 0,
      progress_updated_at DATETIME,
      error_message TEXT,
      error_stage TEXT,
      error_code TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the conversation_summaries table for incremental summarization
 */
function createConversationSummariesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      conversation_id TEXT,
      summary_text TEXT NOT NULL,
      message_range_start TEXT NOT NULL,
      message_range_end TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      original_token_count INTEGER NOT NULL,
      summary_token_count INTEGER NOT NULL,
      model_used TEXT NOT NULL,
      operation_log TEXT,
      incremental_update_count INTEGER DEFAULT 0,
      -- last_full_summarization_at: Set to CURRENT_TIMESTAMP for initial summaries
      -- because they represent a complete "full" summarization of the conversation at that point.
      -- This is updated when summaries are regenerated from scratch after N incremental updates.
      last_full_summarization_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the git_remote_config table for git remote sync metadata
 * Tokens are NOT stored in this table - they're in secrets API
 */
function createGitRemoteConfigTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS git_remote_config (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      remote_name TEXT NOT NULL DEFAULT 'origin',
      provider TEXT NOT NULL DEFAULT 'github',
      repo_url TEXT NOT NULL,
      default_branch TEXT DEFAULT 'main',
      last_sync_at INTEGER,
      sync_enabled BOOLEAN DEFAULT TRUE,
      sync_strategy TEXT NOT NULL DEFAULT 'manual' CHECK(sync_strategy IN ('on_commit', 'on_publish', 'manual')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(app_id, remote_name),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the share_tokens table for shareable preview links
 * Stores time-limited tokens for public preview access without authentication
 */
function createShareTokensTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS share_tokens (
      token TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      first_used_at DATETIME,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the app_commerce_bindings table.
 *
 * This stores AppBuilder's selected Commerce target per app. It is intentionally
 * sparse: apps without commerce have no row.
 */
function createAppCommerceBindingsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_commerce_bindings (
      app_id TEXT PRIMARY KEY,
      business_id TEXT,
      business_name TEXT,
      store_id TEXT,
      store_name TEXT,
      store_url TEXT,
      channel_id TEXT,
      channel_name TEXT,
      default_location_id TEXT,
      status TEXT NOT NULL CHECK(status IN (
        'business_bound',
        'store_bound',
        'channel_pending',
        'channel_ready',
        'invalid'
      )),
      source TEXT NOT NULL DEFAULT 'unknown' CHECK(source IN (
        'user_selected',
        'tool_setup',
        'tool_discovery',
        'tool_channel_ensure',
        'migration',
        'env_fallback',
        'unknown'
      )),
      last_verified_at DATETIME,
      verification_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      CHECK (
        status != 'business_bound'
        OR business_id IS NOT NULL
      ),
      CHECK (
        status NOT IN ('store_bound', 'channel_pending', 'channel_ready')
        OR store_id IS NOT NULL
      ),
      CHECK (
        status != 'channel_ready'
        OR (store_id IS NOT NULL AND channel_id IS NOT NULL)
      )
    )
  `);
}

/**
 * Create the app_commerce_binding_events table for audit/debug history.
 */
function createAppCommerceBindingEventsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_commerce_binding_events (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN (
        'selected_business',
        'selected_store',
        'created_store',
        'ensured_channel',
        'cleared_binding',
        'verified',
        'verification_failed'
      )),
      previous_business_id TEXT,
      previous_store_id TEXT,
      previous_channel_id TEXT,
      next_business_id TEXT,
      next_store_id TEXT,
      next_channel_id TEXT,
      actor_type TEXT NOT NULL CHECK(actor_type IN ('agent', 'user', 'system', 'migration')),
      reason TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the dkim_onboarding table for durable DKIM onboarding state per (app, domain)
 */
function createDkimOnboardingTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dkim_onboarding (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'failed')),
      execution_arn TEXT,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- UNIQUE(app_id, domain) also serves as the app_id-prefix index (no separate index needed).
      UNIQUE(app_id, domain),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the social_associations table for social platform connections
 * Stores connections between apps and social media accounts
 */
function createSocialAssociationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_associations (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      social_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('FACEBOOK', 'INSTAGRAM', 'GOOGLE_BUSINESS_PROFILE', 'TIKTOK', 'YELP', 'WHATSAPP')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(app_id, social_id),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    )
  `);
}

/**
 * Create the social_posts table for social media publish records
 * Stores publish attempts and results for social media posts
 */
function createSocialPostsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      association_id TEXT,
      platform TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('SCHEDULED', 'PUBLISHED', 'FAILED')),
      payload TEXT NOT NULL,
      external_response TEXT,
      external_id TEXT,
      scheduled_at DATETIME,
      completed_at DATETIME,
      campaign_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (association_id) REFERENCES social_associations(id) ON DELETE SET NULL
    )
  `);
}

/**
 * Create dynamic routes table (replaces blog_routes)
 * Supports multiple content types: blog, landing pages
 */
function createRoutesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      route_type TEXT NOT NULL CHECK(route_type IN ('blog', 'landing_page')),
      path_prefix TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      UNIQUE(app_id, route_type, path_prefix)
    )
  `);
}

/**
 * Create blog posts table
 */
function createBlogPostsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      campaign_id TEXT,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      content_markdown TEXT NOT NULL,
      featured_image TEXT,
      tags TEXT,
      published INTEGER DEFAULT 0,
      published_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES simple_campaign(id) ON DELETE SET NULL,
      UNIQUE(app_id, slug)
    )
  `);
}

/**
 * Bring campaign tables from a PRE-MERGE build up to the current schema **without losing
 * data** (the feature ran in prod behind a flag, so these tables may hold real rows).
 * Earlier iterations used different column names — `campaign_id` (→ `simple_campaign_id`),
 * `external_ref`/`external_id` (→ `content_ref_id`) — carried a per-row `salt_id` (now a
 * global static salt), and predated `marketing_plan_id`. We rename/add/drop columns in
 * place (ALTER TABLE), preserving rows, rather than dropping the tables.
 *
 * Notes:
 * - Runs BEFORE the create* calls so the columns are current before createIndexes().
 * - Idempotent: every step is guarded on the actual current columns, so it is a no-op on
 *   a fresh DB (tables absent) and on a current DB (already migrated).
 * - The intermediate enum lookup tables (simple_campaign_status, …) are intentionally
 *   LEFT in place: a column in an older build may still FOREIGN KEY them, and dropping
 *   would require a full table rebuild. They are harmless (current code neither reads nor
 *   writes them); only the abandoned plural tables (never used) are dropped.
 */
function migrateCampaignTablesToCurrentSchema(db: Database): void {
  const tableExists = (name: string): boolean =>
    !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  const columns = (table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

  // simple_campaign: add the marketing_plan_id placeholder if an older build omitted it.
  if (tableExists('simple_campaign')) {
    const cols: string[] = columns('simple_campaign');
    if (!cols.includes('marketing_plan_id')) {
      db.exec(`ALTER TABLE simple_campaign ADD COLUMN marketing_plan_id TEXT`);
      logger.info('database.migration.campaign-schema.add-marketing-plan-id', {});
    }
  }

  // simple_campaign_content: rename old columns to the current names (rows preserved).
  if (tableExists('simple_campaign_content')) {
    const cols: string[] = columns('simple_campaign_content');
    if (cols.includes('campaign_id') && !cols.includes('simple_campaign_id')) {
      db.exec(`ALTER TABLE simple_campaign_content RENAME COLUMN campaign_id TO simple_campaign_id`);
    }
    if (cols.includes('external_ref') && !cols.includes('content_ref_id')) {
      db.exec(`ALTER TABLE simple_campaign_content RENAME COLUMN external_ref TO content_ref_id`);
    }
  }

  // marketing_utm: rename old columns and drop the obsolete per-row salt_id.
  if (tableExists('marketing_utm')) {
    const cols: string[] = columns('marketing_utm');
    if (cols.includes('external_id') && !cols.includes('content_ref_id')) {
      db.exec(`ALTER TABLE marketing_utm RENAME COLUMN external_id TO content_ref_id`);
    }
    if (cols.includes('campaign_id') && !cols.includes('simple_campaign_id')) {
      db.exec(`ALTER TABLE marketing_utm RENAME COLUMN campaign_id TO simple_campaign_id`);
    }
    if (columns('marketing_utm').includes('salt_id')) {
      db.exec(`ALTER TABLE marketing_utm DROP COLUMN salt_id`);
    }
  }

  // Drop the abandoned plural tables from the earliest naming attempt (no FK refs, never
  // used by current code). IF EXISTS keeps this a no-op everywhere else.
  for (const table of ['simple_campaigns', 'simple_campaign_assets']) {
    if (tableExists(table)) {
      db.exec(`DROP TABLE ${table}`);
      logger.info('database.migration.campaign-schema.drop-legacy-table', { table });
    }
  }
}

/**
 * Create the simple_campaign table for marketing campaign records.
 * See the SimpleCampaign interface for why this is "simple" (campaign + activation
 * collapsed into one object, leaving room for a future MarketingPlan parent).
 *
 * Enum columns (status here, asset_type/status on content, utm_medium on utm) are plain
 * TEXT validated in the app layer against the TS enums — NOT a DB CHECK or lookup table.
 * SQLite can't alter a CHECK in place and a lookup would force a migration to add a
 * value, so the enum stays the single source of truth and adding a value is code-only.
 * created_at/updated_at/status are set by the app layer (no DB defaults). No ON DELETE
 * CASCADE on app_id: the SQLite DB is per-app, so deleting the app drops the whole file.
 */
function createSimpleCampaignTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS simple_campaign (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      marketing_plan_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      offer TEXT,
      goal TEXT,
      start_date DATETIME,
      end_date DATETIME,
      launched_at DATETIME,
      completed_at DATETIME,
      created_by TEXT CHECK(created_by IS NULL OR created_by IN ('user', 'agent')),
      updated_by TEXT CHECK(updated_by IS NULL OR updated_by IN ('user', 'agent')),
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (app_id) REFERENCES apps(id)
    )
  `);
}

/**
 * simple_campaign_content is a reference/tracking layer — it does NOT store content.
 * Actual content lives elsewhere by asset_type:
 *   - blog:         blog_posts table (content_markdown column)
 *   - social:       social_posts table (payload column)
 *   - landing-page: app source files (committed via git)
 *   - banner:       app source files (committed via git)
 *   - email/ad:     future — external service TBD
 * content_ref_id points to the content location (post ID, slug, file path, etc.).
 * asset_type/status are plain TEXT validated in the app layer (see the enum note on
 * createSimpleCampaignTable); created_at is app-set (no DB default). The
 * simple_campaign_id FK keeps ON DELETE CASCADE so deleting one campaign removes its
 * content rows.
 */
function createSimpleCampaignContentTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS simple_campaign_content (
      id TEXT PRIMARY KEY,
      simple_campaign_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      content_ref_id TEXT,
      title TEXT NOT NULL,
      scheduled_date DATETIME,
      status TEXT NOT NULL,
      content_preview TEXT,
      image_url TEXT,
      created_by TEXT CHECK(created_by IS NULL OR created_by IN ('user', 'agent')),
      created_at DATETIME NOT NULL,
      FOREIGN KEY (simple_campaign_id) REFERENCES simple_campaign(id) ON DELETE CASCADE
    )
  `);
}

/**
 * marketing_utm holds UTM attribution per published target (a blog post, a
 * per-platform social post, a future ad/email). It is independent of campaigns:
 * utm_source/utm_medium are always set, while simple_campaign_id/utm_campaign are
 * populated only when the target belongs to a campaign. utm_campaign is the HMAC of
 * simpleCampaignId hashed with the global UTM_SALT (see utils/campaign-utm-signer) —
 * one stable value per campaign, with no per-row salt to store. content_ref_id is a
 * polymorphic reference to the target content row (social_posts.id, blog_posts.id, …)
 * — not a hard FK since it spans tables. utm_source/utm_medium are plain TEXT validated
 * in the app layer (utm_medium against the enum; utm_source's seo-offsite-<placement>
 * family is dynamic). created_at/updated_at are app-set (no DB default).
 */
function createMarketingUtmTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketing_utm (
      id TEXT PRIMARY KEY,
      content_ref_id TEXT NOT NULL,
      simple_campaign_id TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_content TEXT,
      utm_term TEXT,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (simple_campaign_id) REFERENCES simple_campaign(id) ON DELETE SET NULL
    )
  `);
}

/**
 * Create all database indexes for efficient queries
 */
function createIndexes(db: Database): void {
  // Apps table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_apps_created_at ON apps(created_at)
  `);

  // Running processes table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_running_processes_app_id ON running_processes(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_running_processes_pid ON running_processes(pid)
  `);

  // Conversations table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_app_id ON conversations(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at)
  `);

  // Conversation messages table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(conversation_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at ON conversation_messages(created_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_origin ON conversation_messages(conversation_id, origin)
  `);

  // Memory table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_app_id ON memory(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(key)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory(created_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_updated_at ON memory(updated_at)
  `);

  // OAuth tokens table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_app ON oauth_tokens(app_id, provider)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expiry ON oauth_tokens(expires_at)
  `);

  // Import jobs table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_import_jobs_app_id ON import_jobs(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs(created_at)
  `);

  // DB import jobs table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_db_import_jobs_app_id ON db_import_jobs(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_db_import_jobs_status ON db_import_jobs(status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_db_import_jobs_created_at ON db_import_jobs(created_at)
  `);

  // Conversation summaries table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_app_id ON conversation_summaries(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_conversation_id ON conversation_summaries(conversation_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_message_range ON conversation_summaries(message_range_start, message_range_end)
  `);

  // Git remote config table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_git_remote_config_app_id ON git_remote_config(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_git_remote_config_provider ON git_remote_config(provider)
  `);

  // Composite index for efficient findByAppAndRemote queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_git_remote_config_app_remote ON git_remote_config(app_id, remote_name)
  `);

  // Social associations table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_associations_app_id ON social_associations(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_associations_app_platform ON social_associations(app_id, platform)
  `);

  // Social posts table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_app_id ON social_posts(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_app_state ON social_posts(app_id, state)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_association_id ON social_posts(association_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts(platform)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled_at ON social_posts(scheduled_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_campaign_id ON social_posts(campaign_id)
  `);

  // Routes table indexes (generic for all route types)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_routes_app_id ON routes(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_routes_app_type ON routes(app_id, route_type)
  `);

  // Blog posts table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_blog_posts_app_id ON blog_posts(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(app_id, slug)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(app_id, published, published_at DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_blog_posts_campaign_id ON blog_posts(campaign_id)
  `);

  // Simple campaign table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_simple_campaign_app_id ON simple_campaign(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_simple_campaign_status ON simple_campaign(status)
  `);

  // Simple campaign content table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_simple_campaign_content_simple_campaign_id ON simple_campaign_content(simple_campaign_id)
  `);

  // Marketing UTM table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_marketing_utm_content_ref_id ON marketing_utm(content_ref_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_marketing_utm_simple_campaign_id ON marketing_utm(simple_campaign_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_marketing_utm_utm_campaign ON marketing_utm(utm_campaign)
  `);

  // Share tokens table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_share_tokens_app_id ON share_tokens(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_share_tokens_expires_at ON share_tokens(expires_at)
  `);

  // App Commerce bindings table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_app_commerce_bindings_business_id ON app_commerce_bindings(business_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_app_commerce_bindings_store_id ON app_commerce_bindings(store_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_app_commerce_bindings_status ON app_commerce_bindings(status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_app_commerce_binding_events_app_created
    ON app_commerce_binding_events(app_id, created_at DESC)
  `);

  // DKIM onboarding: no separate app_id index needed — UNIQUE(app_id, domain)
  // already provides a composite index whose leftmost prefix covers app_id lookups.

  // seo_quality_scores table indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_seo_quality_scores_app_id ON seo_quality_scores(app_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_seo_quality_scores_created_at ON seo_quality_scores(app_id, created_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_seo_quality_scores_baseline ON seo_quality_scores(app_id, is_baseline)
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_quality_scores_one_baseline
    ON seo_quality_scores(app_id) WHERE is_baseline = TRUE
  `);
}

/**
 * Create indexes specifically for file_context table
 * Called after migrations to ensure table exists
 */
function createFileContextIndexes(db: Database): void {
  try {
    // Check if file_context table exists before creating indexes
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='file_context'
    `).get();

    if (tableExists) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_file_context_app_path ON file_context(app_path)
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_file_context_last_read ON file_context(last_read)
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_file_context_modification_count ON file_context(modification_count)
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_file_context_read_count ON file_context(read_count)
      `);
    }
  } catch (err) {
    // Indexes might fail to create, that's okay for now
    logger.warn('database.schema.index-creation-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Create all database triggers
 */
function createTriggers(db: Database): void {
  // Trigger to automatically update updated_at on apps
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_apps_updated_at
    AFTER UPDATE ON apps
    FOR EACH ROW
    BEGIN
      UPDATE apps SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Trigger to automatically update conversations updated_at when messages are added
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_conversations_updated_at
    AFTER INSERT ON conversation_messages
    FOR EACH ROW
    BEGIN
      UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.conversation_id;
    END
  `);

  // Trigger to automatically update updated_at on memory
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_memory_updated_at
    AFTER UPDATE ON memory
    FOR EACH ROW
    BEGIN
      UPDATE memory SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Trigger to automatically update updated_at on import_jobs
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_import_jobs_updated_at
    AFTER UPDATE ON import_jobs
    FOR EACH ROW
    BEGIN
      UPDATE import_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Trigger to automatically update updated_at on db_import_jobs
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_db_import_jobs_updated_at
    AFTER UPDATE ON db_import_jobs
    FOR EACH ROW
    BEGIN
      UPDATE db_import_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Trigger to automatically update updated_at on git_remote_config
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_git_remote_config_updated_at
    AFTER UPDATE ON git_remote_config
    FOR EACH ROW
    BEGIN
      UPDATE git_remote_config SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Trigger to automatically update updated_at on social_posts
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_social_posts_updated_at
    AFTER UPDATE ON social_posts
    FOR EACH ROW
    BEGIN
      UPDATE social_posts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Trigger to automatically update updated_at on app_commerce_bindings
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_app_commerce_bindings_updated_at
    AFTER UPDATE ON app_commerce_bindings
    FOR EACH ROW
    BEGIN
      UPDATE app_commerce_bindings SET updated_at = CURRENT_TIMESTAMP WHERE app_id = NEW.app_id;
    END
  `);

  // Safety net: repository UPDATEs already set updated_at = CURRENT_TIMESTAMP explicitly;
  // this trigger guarantees the column stays fresh for any future UPDATE that omits it.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_dkim_onboarding_updated_at
    AFTER UPDATE ON dkim_onboarding
    FOR EACH ROW
    BEGIN
      UPDATE dkim_onboarding SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);
}

/**
 * Migration: Update source_type CHECK constraint to replace 'git' with 'git_pull' and 'git_push'
 *
 * SQLite doesn't support ALTER COLUMN, so we need to recreate the table.
 * This is safe because we copy all data and use a transaction.
 * Note: We intentionally do NOT migrate existing git data - it will be discarded.
 *
 * @param db - Database instance
 */
const MIGRATION_PROBE_APP_ID = '__migration_probe_app__';

/** App row used only by import_jobs migration probe inserts (satisfies FK). */
function ensureMigrationProbeApp(db: Database): void {
  db.prepare(`
    INSERT OR IGNORE INTO apps (id, name, path, port, status)
    VALUES (?, 'Migration Probe', '/migration-probe', 3000, 'created')
  `).run(MIGRATION_PROBE_APP_ID);
}

/** Remove probe rows so they are not copied into recovered databases. */
function cleanupMigrationProbeRows(db: Database): void {
  db.prepare(`
    DELETE FROM import_jobs
    WHERE id IN ('__test_constraint__', '__test_status_constraint__')
       OR app_id = ?
  `).run(MIGRATION_PROBE_APP_ID);
  db.prepare(`DELETE FROM apps WHERE id = ?`).run(MIGRATION_PROBE_APP_ID);
}

function migrateSourceTypeConstraint(db: Database): void {
  try {
    ensureMigrationProbeApp(db);
    try {
    // Check current constraint by trying to insert a git_pull value
    const testStmt = db.prepare(`
      INSERT INTO import_jobs (id, app_id, status, source_type)
      VALUES ('__test_constraint__', ?, 'pending', 'git_pull')
    `);

    try {
      testStmt.run(MIGRATION_PROBE_APP_ID);
      // If we get here, constraint already allows git_pull - clean up and return
      db.prepare(`DELETE FROM import_jobs WHERE id = '__test_constraint__'`).run();
      logger.info('database.migration.source-type-constraint.skipped', {
        reason: 'Constraint already allows git_pull/git_push',
      });
      return;
    } catch {
      // Constraint violation expected - need to migrate
      logger.info('database.migration.source-type-constraint.start', {
        reason: 'Updating CHECK constraint to replace git with git_pull and git_push',
      });
    }

    // SQLite requires table recreation to modify CHECK constraint.
    // Note: existing git data is NOT preserved - only zip import data is migrated.
    // Wrapped in db.transaction() so any mid-script failure auto-rolls-back —
    // a hand-rolled `db.exec("BEGIN; …; COMMIT")` would leave the connection
    // sitting on an open transaction (orphan tx → SQLITE_LOCKED on every
    // subsequent wal_checkpoint, and writes lost on close).
    db.transaction(() => {
      db.exec(`
      -- Create new table with updated constraint (no 'git', only 'zip', 'git_pull', 'git_push')
      CREATE TABLE import_jobs_new (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
          'pending', 'creating_container', 'extracting', 'validating',
          'copying', 'installing', 'building', 'committing', 'pushing',
          'pulling', 'restarting', 'completed', 'failed'
        )),
        source_type TEXT NOT NULL DEFAULT 'zip' CHECK(source_type IN ('zip', 'git_pull', 'git_push')),
        zip_file_name TEXT,
        zip_file_size INTEGER,
        git_url TEXT,
        git_branch TEXT,
        git_commit_hash TEXT,
        extracted_path TEXT,
        detected_package_manager TEXT CHECK(detected_package_manager IN ('npm', 'yarn', 'pnpm')),
        has_build_script BOOLEAN,
        has_dev_script BOOLEAN,
        validation_errors TEXT,
        install_output TEXT,
        build_output TEXT,
        error_message TEXT,
        error_stage TEXT,
        diagnose_snapshot_path TEXT,
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
      );

      -- Copy only zip import data (discard all git data as requested)
      INSERT INTO import_jobs_new (
        id, app_id, status, source_type, zip_file_name, zip_file_size,
        git_url, git_branch, git_commit_hash, extracted_path, detected_package_manager,
        has_build_script, has_dev_script, validation_errors, install_output, build_output,
        error_message, error_stage, diagnose_snapshot_path, started_at, completed_at,
        created_at, updated_at
      )
      SELECT
        id, app_id, status, source_type, zip_file_name, zip_file_size,
        git_url, git_branch, git_commit_hash, extracted_path, detected_package_manager,
        has_build_script, has_dev_script, validation_errors, install_output, build_output,
        error_message, error_stage, diagnose_snapshot_path, started_at, completed_at,
        created_at, updated_at
      FROM import_jobs WHERE source_type = 'zip';

      -- Drop old table and rename new one
      DROP TABLE import_jobs;
      ALTER TABLE import_jobs_new RENAME TO import_jobs;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_import_jobs_app_id ON import_jobs(app_id);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs(created_at);
    `);
    })();

    logger.info('database.migration.source-type-constraint.success', {
      message: 'Successfully updated source_type CHECK constraint (git data discarded)',
    });
    } finally {
      cleanupMigrationProbeRows(db);
    }
  } catch (err) {
    logger.error('database.migration.source-type-constraint.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't throw - migration failures shouldn't break app startup
  }
}

/**
 * Migration: Update status CHECK constraint to add 'pushing' and 'pulling' statuses
 *
 * SQLite doesn't support ALTER COLUMN, so we need to recreate the table. The
 * recreation is wrapped in `db.transaction()`, which copies all rows atomically.
 *
 * 1. Transaction rollback: The table recreation is wrapped in `db.transaction()`,
 *    which guarantees ROLLBACK on throw via better-sqlite3's C API. **Do not**
 *    revert to `db.exec("BEGIN; ...; COMMIT")` — when a statement inside an exec
 *    script throws after BEGIN, better-sqlite3 leaves the connection holding an
 *    orphan transaction (SQLITE_LOCKED on every subsequent wal_checkpoint, writes
 *    silently lost on close). See PR #4150.
 *
 * 2. Concurrent migration safety: The test-insert-delete check is not atomic, but
 *    SQLite's file-level locking prevents concurrent writes to the same database.
 *    If multiple instances attempt migration simultaneously, one will succeed and
 *    others will either skip (constraint already updated) or fail safely (caught).
 *
 * 3. Error handling: Errors are caught and logged but not re-thrown, matching the
 *    pattern used by all other migrations in this file. This ensures migration
 *    failures don't prevent app startup. The trade-off is that failed migrations
 *    require manual investigation via logs.
 *
 * @param db - Database instance
 */
function migrateImportJobsStatusConstraint(db: Database): void {
  try {
    // Check if import_jobs table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='import_jobs'
    `).get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info('database.migration.status-constraint.skipped', {
        reason: 'import_jobs table does not exist yet',
      });
      return;
    }

    ensureMigrationProbeApp(db);
    try {
    // Check current constraint by trying to insert a 'pushing' status value.
    // Note: This test-insert-delete approach is not atomic, but SQLite's file-level
    // locking prevents concurrent writes. See function JSDoc for details.
    const testStmt = db.prepare(`
      INSERT INTO import_jobs (id, app_id, status, source_type)
      VALUES ('__test_status_constraint__', ?, 'pushing', 'zip')
    `);

    try {
      testStmt.run(MIGRATION_PROBE_APP_ID);
      // If we get here, constraint already allows 'pushing' - clean up and return
      db.prepare(`DELETE FROM import_jobs WHERE id = '__test_status_constraint__'`).run();
      logger.info('database.migration.status-constraint.skipped', {
        reason: 'Constraint already allows pushing/pulling statuses',
      });
      return;
    } catch {
      // Constraint violation expected - need to migrate
      logger.info('database.migration.status-constraint.start', {
        reason: 'Updating CHECK constraint to add pushing and pulling statuses',
      });
    }

    // SQLite requires table recreation to modify CHECK constraint.
    // Wrapped in db.transaction() so any mid-script failure auto-rolls-back —
    // see migrateSourceTypeConstraint for the orphan-transaction hazard this avoids.
    db.transaction(() => {
      db.exec(`
      -- Create new table with updated status constraint (includes pushing and pulling)
      CREATE TABLE import_jobs_new (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
          'pending', 'creating_container', 'extracting', 'validating',
          'copying', 'installing', 'building', 'committing', 'pushing',
          'pulling', 'restarting', 'completed', 'failed'
        )),
        source_type TEXT NOT NULL DEFAULT 'zip' CHECK(source_type IN ('zip', 'git_pull', 'git_push')),
        zip_file_name TEXT,
        zip_file_size INTEGER,
        git_url TEXT,
        git_branch TEXT,
        git_commit_hash TEXT,
        extracted_path TEXT,
        detected_package_manager TEXT CHECK(detected_package_manager IN ('npm', 'yarn', 'pnpm')),
        has_build_script BOOLEAN,
        has_dev_script BOOLEAN,
        validation_errors TEXT,
        install_output TEXT,
        build_output TEXT,
        error_message TEXT,
        error_stage TEXT,
        diagnose_snapshot_path TEXT,
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
      );

      -- Copy all existing data (preserves everything unlike migrateSourceTypeConstraint
      -- which filters by source_type='zip'). All data is preserved here because this
      -- migration only relaxes the CHECK constraint to add new status values - it doesn't
      -- change data semantics or invalidate existing records.
      INSERT INTO import_jobs_new (
        id, app_id, status, source_type, zip_file_name, zip_file_size,
        git_url, git_branch, git_commit_hash, extracted_path, detected_package_manager,
        has_build_script, has_dev_script, validation_errors, install_output, build_output,
        error_message, error_stage, diagnose_snapshot_path, started_at, completed_at,
        created_at, updated_at
      )
      SELECT
        id, app_id, status, source_type, zip_file_name, zip_file_size,
        git_url, git_branch, git_commit_hash, extracted_path, detected_package_manager,
        has_build_script, has_dev_script, validation_errors, install_output, build_output,
        error_message, error_stage, diagnose_snapshot_path, started_at, completed_at,
        created_at, updated_at
      FROM import_jobs;

      -- Drop old table and rename new one
      DROP TABLE import_jobs;
      ALTER TABLE import_jobs_new RENAME TO import_jobs;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_import_jobs_app_id ON import_jobs(app_id);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs(created_at);
    `);
    })();

    logger.info('database.migration.status-constraint.success', {
      message: 'Successfully updated status CHECK constraint to include pushing and pulling',
    });
    } finally {
      cleanupMigrationProbeRows(db);
    }
  } catch (err) {
    // Error handling: Log and continue (don't throw). db.transaction() above
    // guarantees rollback on throw, so the database is consistent; check logs
    // for 'database.migration.status-constraint.failed' to detect and resolve
    // migration failures.
    logger.error('database.migration.status-constraint.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Apply migrations for existing databases
 * This handles adding new columns to existing tables without breaking existing data
 */
function applyMigrations(db: Database): void {

  // Add path column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN path TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add template_version column if it doesn't exist
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN template_version TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Ensure file_context table exists and has all required columns
  // This migration ensures compatibility with existing databases
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_context (
        id TEXT PRIMARY KEY,
        app_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        last_modified INTEGER NOT NULL,
        last_read INTEGER NOT NULL,
        modification_count INTEGER NOT NULL DEFAULT 0,
        read_count INTEGER NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT NOT NULL,
        actual_file_mod_time INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(app_path, file_path)
      )
    `);
  } catch (err) {
    // Table might already exist, that's fine
  }

  // Add missing columns to existing file_context table if they don't exist
  const fileContextColumns = [
    'ALTER TABLE file_context ADD COLUMN last_modified INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN last_read INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN modification_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN read_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE file_context ADD COLUMN content_hash TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE file_context ADD COLUMN actual_file_mod_time INTEGER',
    'ALTER TABLE file_context ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP',
    'ALTER TABLE file_context ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'
  ];

  for (const columnSql of fileContextColumns) {
    try {
      db.exec(columnSql);
    } catch (err) {
      // Column might already exist, that's fine
    }
  }

  // Add port column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN port INTEGER NOT NULL DEFAULT 5000`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add initial_prompt column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN initial_prompt TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add status column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating', 'created', 'error'))`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add initial_build_complete column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN initial_build_complete BOOLEAN DEFAULT FALSE`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add socket_path column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN socket_path TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add publish_supervisor_path column if it doesn't exist (for V4 unified job architecture)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN publish_supervisor_path TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add preview_url column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN preview_url TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add published_url column if it doesn't exist (for V4 unified job architecture)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN published_url TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Create oauth_tokens table if it doesn't exist (added in PR #646)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'godaddy',
        scopes TEXT NOT NULL,
        access_token_encrypted TEXT NOT NULL,
        access_token_iv TEXT NOT NULL,
        access_token_tag TEXT NOT NULL,
        refresh_token_encrypted TEXT,
        refresh_token_iv TEXT,
        refresh_token_tag TEXT,
        expires_at INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(app_id, provider)
      )
    `);
  } catch (err) {
    // Table might already exist, that's fine
  }

  // Create social_associations table if it doesn't exist
  createSocialAssociationsTable(db);

  // Create social_posts table if it doesn't exist
  createSocialPostsTable(db);

  // Create routes and blog posts tables if they don't exist
  createRoutesTable(db);
  createBlogPostsTable(db);

  // Add subscription_id column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN subscription_id TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add customer_id column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE apps ADD COLUMN customer_id TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add context_attachments column if it doesn't exist (for generic context attachments)
  try {
    db.exec(`ALTER TABLE conversation_messages ADD COLUMN context_attachments TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add origin column to track support vs customer message visibility
  try {
    db.exec(`ALTER TABLE conversation_messages ADD COLUMN origin TEXT NOT NULL DEFAULT 'customer' CHECK(origin IN ('support', 'customer'))`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add git import columns to import_jobs table if they don't exist
  try {
    db.exec(`ALTER TABLE import_jobs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'zip' CHECK(source_type IN ('zip', 'git'))`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  try {
    db.exec(`ALTER TABLE import_jobs ADD COLUMN git_url TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  try {
    db.exec(`ALTER TABLE import_jobs ADD COLUMN git_branch TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  try {
    db.exec(`ALTER TABLE import_jobs ADD COLUMN git_commit_hash TEXT`);
  } catch (err) {
    // Column might already exist, that's fine
  }

  // Add operation_log column to conversation_summaries if it doesn't exist
  migrateSummariesOperationLog(db);

  // Add quality tracking columns to conversation_summaries if they don't exist
  migrateSummariesQualityTracking(db);

  // Migrate source_type CHECK constraint to include git_pull and git_push (remove unused 'git')
  migrateSourceTypeConstraint(db);

  // Migrate status CHECK constraint to include pushing and pulling statuses
  migrateImportJobsStatusConstraint(db);

  migrateImportJobsDiagnoseSnapshotPath(db);

  // Add purpose column to share_tokens for archive-snapshot share tokens
  migrateShareTokensPurpose(db);

  // Create AppBuilder Commerce binding tables for existing databases
  createAppCommerceBindingsTable(db);
  createAppCommerceBindingEventsTable(db);

  // Create seo_quality_scores table for existing databases — RUBICON-143
  createSeoQualityScoresTable(db);

  // Add sync_strategy column to git_remote_config
  migrateGitRemoteConfigSyncStrategy(db);

  // Strip oversized finalResult blobs from conversation_messages metadata
  stripFinalResultBloat(db);
}

/**
 * Migration: Add diagnose_snapshot_path for failed-import file context.
 */
function migrateImportJobsDiagnoseSnapshotPath(db: Database): void {
  try {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='import_jobs'`)
      .get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info('database.migration.import-jobs-diagnose-snapshot.skipped', {
        reason: 'import_jobs table does not exist yet',
      });
      return;
    }

    const columnInfo = db
      .prepare(`SELECT name FROM pragma_table_info('import_jobs') WHERE name = 'diagnose_snapshot_path'`)
      .get() as { name: string } | undefined;

    if (columnInfo) {
      logger.info('database.migration.import-jobs-diagnose-snapshot.skipped', {
        reason: 'diagnose_snapshot_path column already exists',
      });
      return;
    }

    logger.info('database.migration.import-jobs-diagnose-snapshot.start', {
      reason: 'Adding diagnose_snapshot_path for failed-import diagnose context',
    });

    db.exec(`ALTER TABLE import_jobs ADD COLUMN diagnose_snapshot_path TEXT`);

    logger.info('database.migration.import-jobs-diagnose-snapshot.complete');
  } catch (error) {
    logger.error('database.migration.import-jobs-diagnose-snapshot.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - migration failures shouldn't break app startup
  }
}

/**
 * Migration: Add purpose column to share_tokens.
 *
 * Distinguishes UI-issued share links ('user') from system-issued archive
 * snapshot tokens ('archive_snapshot'). The one-active-token-per-app guard is
 * scoped per (app_id, purpose) at the route layer so the two can coexist.
 *
 * Existing rows backfill to 'user' via the column DEFAULT — preserves UI
 * behavior on upgrade.
 */
function migrateShareTokensPurpose(db: Database): void {
  try {
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='share_tokens'
    `).get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info('database.migration.share-tokens-purpose.skipped', {
        reason: 'share_tokens table does not exist yet',
      });
      return;
    }

    const columnInfo = db.prepare(`
      SELECT name FROM pragma_table_info('share_tokens') WHERE name = 'purpose'
    `).get() as { name: string } | undefined;

    if (columnInfo) {
      logger.info('database.migration.share-tokens-purpose.skipped', {
        reason: 'purpose column already exists',
      });
      return;
    }

    logger.info('database.migration.share-tokens-purpose.start', {
      reason: 'Adding purpose column for archive snapshot share tokens',
    });

    db.exec(`ALTER TABLE share_tokens ADD COLUMN purpose TEXT NOT NULL DEFAULT 'user'`);

    logger.info('database.migration.share-tokens-purpose.complete', {
      success: true,
    });
  } catch (err) {
    logger.error('database.migration.share-tokens-purpose.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Migration: Remove NOT NULL constraints from zip_file_name and zip_file_size
 *
 * These columns must be nullable because git imports don't populate them.
 * This migration handles existing databases that were created with NOT NULL constraints.
 *
 * @param db - Database instance
 */
function migrateImportJobsNullableColumns(db: Database): void {
  try {
    // Check if import_jobs table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='import_jobs'
    `).get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info('database.migration.import-jobs-nullable-zip-columns.skipped', {
        reason: 'import_jobs table does not exist yet',
      });
      return;
    }

    // Check if columns exist with NOT NULL constraints using PRAGMA table_info
    const columnInfo = db.prepare(`
      SELECT name, "notnull" FROM pragma_table_info('import_jobs')
      WHERE name IN ('zip_file_name', 'zip_file_size')
    `).all() as Array<{ name: string; notnull: number }>;

    logger.info('database.migration.import-jobs-nullable-zip-columns.check', {
      columnsFound: columnInfo.length,
      columns: columnInfo,
    });

    // Check if any columns have NOT NULL constraint (notnull = 1)
    const hasNotNullConstraint = columnInfo.some(col => col.notnull === 1);

    if (!hasNotNullConstraint) {
      logger.info('database.migration.import-jobs-nullable-zip-columns.skipped', {
        reason: 'Columns are already nullable',
        columnsFound: columnInfo.length,
      });
      return;
    }

    if (columnInfo.length !== 2) {
      logger.warn('database.migration.import-jobs-nullable-zip-columns.skipped', {
        reason: 'Expected 2 columns but found different count',
        columnsFound: columnInfo.length,
        columns: columnInfo,
      });
      return;
    }

    logger.info('database.migration.import-jobs-nullable-zip-columns.start', {
      reason: 'Removing NOT NULL constraints from zip_file_name and zip_file_size for git import compatibility',
      columnsToMigrate: columnInfo,
    });

    // Step 1: Rename old columns with NOT NULL constraints
    db.exec(`ALTER TABLE import_jobs RENAME COLUMN zip_file_name TO zip_file_name_old`);
    db.exec(`ALTER TABLE import_jobs RENAME COLUMN zip_file_size TO zip_file_size_old`);

    // Step 2: Add new nullable columns
    db.exec(`ALTER TABLE import_jobs ADD COLUMN zip_file_name TEXT`);
    db.exec(`ALTER TABLE import_jobs ADD COLUMN zip_file_size INTEGER`);

    // Step 3: Copy data from old to new columns for all existing rows
    db.exec(`UPDATE import_jobs SET zip_file_name = zip_file_name_old, zip_file_size = zip_file_size_old`);

    // Step 4: Drop old columns (requires SQLite 3.35.0+)
    db.exec(`ALTER TABLE import_jobs DROP COLUMN zip_file_name_old`);
    db.exec(`ALTER TABLE import_jobs DROP COLUMN zip_file_size_old`);

    logger.info('database.migration.import-jobs-nullable-zip-columns.complete', {
      success: true,
      migrated: true,
    });
  } catch (err) {
    logger.error('database.migration.import-jobs-nullable-zip-columns.failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Don't throw - migration failures shouldn't break app startup
  }
}

/**
 * Migrate conversation_summaries table to add operation_log column
 * This column stores a cumulative log of operations that survives compression
 *
 * NOTE: This migration is more robust than the standard try/catch pattern used
 * elsewhere in applyMigrations(). It explicitly checks for column existence
 * using pragma_table_info before attempting the ALTER TABLE, providing better
 * error isolation and clearer logging. The try/catch at the end handles
 * unexpected errors without breaking app startup.
 */
function migrateSummariesOperationLog(db: Database): void {
  try {
    // Check if conversation_summaries table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'
    `).get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info('database.migration.summaries-operation-log.skipped', {
        reason: 'conversation_summaries table does not exist yet',
      });
      return;
    }

    // Check if operation_log column already exists
    const columnInfo = db.prepare(`
      SELECT name FROM pragma_table_info('conversation_summaries')
      WHERE name = 'operation_log'
    `).get() as { name: string } | undefined;

    if (columnInfo) {
      logger.info('database.migration.summaries-operation-log.skipped', {
        reason: 'operation_log column already exists',
      });
      return;
    }

    logger.info('database.migration.summaries-operation-log.start', {
      reason: 'Adding operation_log column for cumulative operation tracking',
    });

    // Add operation_log column
    db.exec(`ALTER TABLE conversation_summaries ADD COLUMN operation_log TEXT`);

    logger.info('database.migration.summaries-operation-log.complete', {
      success: true,
      migrated: true,
    });
  } catch (err) {
    logger.error('database.migration.summaries-operation-log.failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Don't throw - migration failures shouldn't break app startup
  }
}

/**
 * Migration: Add quality tracking fields to conversation_summaries
 *
 * Adds incremental_update_count and last_full_summarization_at columns
 * to track summary quality and trigger re-summarization when needed.
 *
 * Quality tracking prevents summary degradation by:
 * - Counting incremental updates (re-summarization after 10 updates)
 * - Recording when summary was last fully regenerated from scratch
 *
 * @param db - Database instance
 */
function migrateSummariesQualityTracking(db: Database): void {
  try {
    // Check if conversation_summaries table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'
    `).get() as { name: string } | undefined;

    if (!tableExists) {
      logger.info('database.migration.summaries-quality-tracking.skipped', {
        reason: 'conversation_summaries table does not exist yet',
      });
      return;
    }

    // Check if columns already exist
    const columns = db.prepare(`
      SELECT name FROM pragma_table_info('conversation_summaries')
    `).all() as Array<{ name: string }>;

    const columnNames = columns.map(c => c.name);
    const needsUpdateCount = !columnNames.includes('incremental_update_count');
    const needsFullSummarizationAt = !columnNames.includes('last_full_summarization_at');

    if (!needsUpdateCount && !needsFullSummarizationAt) {
      logger.info('database.migration.summaries-quality-tracking.skipped', {
        reason: 'quality tracking columns already exist',
      });
      return;
    }

    logger.info('database.migration.summaries-quality-tracking.start', {
      addingUpdateCount: needsUpdateCount,
      addingFullSummarizationAt: needsFullSummarizationAt,
    });

    if (needsUpdateCount) {
      db.exec(`ALTER TABLE conversation_summaries ADD COLUMN incremental_update_count INTEGER DEFAULT 0`);
    }

    if (needsFullSummarizationAt) {
      // SQLite doesn't allow non-constant defaults in ALTER TABLE, so we add the column
      // without a default and update existing rows to set the timestamp to created_at
      db.exec(`ALTER TABLE conversation_summaries ADD COLUMN last_full_summarization_at DATETIME`);

      // For existing summaries, set last_full_summarization_at to created_at
      // (treating existing summaries as if they were "fully" summarized at creation time)
      db.exec(`
        UPDATE conversation_summaries
        SET last_full_summarization_at = created_at
        WHERE last_full_summarization_at IS NULL
      `);
    }

    logger.info('database.migration.summaries-quality-tracking.complete', {
      success: true,
      columnsAdded: {
        updateCount: needsUpdateCount,
        fullSummarizationAt: needsFullSummarizationAt,
      },
    });
  } catch (err) {
    logger.error('database.migration.summaries-quality-tracking.failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Don't throw - migration failures shouldn't break app startup
  }
}

function migrateGitRemoteConfigSyncStrategy(db: Database): void {
  try {
    db.exec(`ALTER TABLE git_remote_config ADD COLUMN sync_strategy TEXT NOT NULL DEFAULT 'manual' CHECK(sync_strategy IN ('on_commit', 'on_publish', 'manual'))`);
    logger.info('database.migration.git-remote-sync-strategy.success');
  } catch {
    // Column already exists
  }
}

/**
 * Migration: Strip oversized finalResult blobs from conversation_messages metadata.
 *
 * The writer previously stored the full AI SDK result object (steps, tool calls,
 * tool results, file contents) in metadata.finalResult. Only finalResult.finishReason
 * is ever read back. On busy databases this accumulated hundreds of MB that were
 * loaded into memory on every context-rebuild, causing OOM crashes.
 *
 * This migration rewrites existing rows to keep only { finishReason } when present,
 * or removes finalResult entirely when there is no finishReason to preserve.
 *
 * Idempotent: the length(> 100) guard skips rows that are already minimal.
 */
function stripFinalResultBloat(db: Database): void {
  try {
    const hasBloat = db.prepare(`
      SELECT 1 FROM conversation_messages
      WHERE metadata IS NOT NULL
        AND json_type(metadata, '$.finalResult') = 'object'
        AND length(json_extract(metadata, '$.finalResult')) > 100
      LIMIT 1
    `).get();

    if (!hasBloat) {
      logger.info('database.migration.strip-final-result.skipped', { reason: 'no oversized finalResult rows' });
      return;
    }

    logger.info('database.migration.strip-final-result.start');

    const migrate = db.transaction(() => {
      const withFinishReason = db.prepare(`
        UPDATE conversation_messages
        SET metadata = json_set(
          json_remove(metadata, '$.finalResult'),
          '$.finalResult',
          json_object('finishReason', json_extract(metadata, '$.finalResult.finishReason'))
        )
        WHERE metadata IS NOT NULL
          AND json_type(metadata, '$.finalResult') = 'object'
          AND json_extract(metadata, '$.finalResult.finishReason') IS NOT NULL
          AND length(json_extract(metadata, '$.finalResult')) > 100
      `).run();

      const withoutFinishReason = db.prepare(`
        UPDATE conversation_messages
        SET metadata = json_remove(metadata, '$.finalResult')
        WHERE metadata IS NOT NULL
          AND json_type(metadata, '$.finalResult') = 'object'
          AND json_extract(metadata, '$.finalResult.finishReason') IS NULL
          AND length(json_extract(metadata, '$.finalResult')) > 100
      `).run();

      return { withFinishReason: withFinishReason.changes, withoutFinishReason: withoutFinishReason.changes };
    });

    const result = migrate();
    logger.info('database.migration.strip-final-result.complete', result);
  } catch (err) {
    logger.error('database.migration.strip-final-result.failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Don't throw - migration failures shouldn't break app startup
  }
}

/**
 * Initialize a test database with the complete schema
 * This is a convenience function for tests that need a clean database
 */
export function initializeTestDatabase(db: Database): void {
  initializeSchema(db);
}

/**
 * Get the schema version for migration tracking
 */
export function getSchemaVersion(): string {
  return '1.0.0';
}
