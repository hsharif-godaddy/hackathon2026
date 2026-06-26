/**
 * Function calling tools for AI Chat
 * Allows the AI to query the L1 transcripts database
 */

import { logger } from './logger';
import { getStore } from '@/lib/supportplane/store';
import { InsightsClient, type InsightRow } from '@/lib/supportplane/store/insights-client';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export const TRANSCRIPT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'query_transcripts',
      description: 'Query the L1 transcripts database. Returns aggregate statistics about transcripts including counts, sentiment, resolution status, categories, and tags.',
      parameters: {
        type: 'object',
        properties: {
          days_back: {
            type: 'number',
            description: 'Number of days to look back (e.g., 3 for last 3 days, 7 for last week)',
          },
          group_by: {
            type: 'string',
            enum: ['category', 'tags', 'sentiment', 'agent_name', 'interaction_status', 'friction_point', 'sub_intent', 'issue_resolution', 'customer_sentiment'],
            description: 'Field to group results by. friction_point, sub_intent, issue_resolution, and customer_sentiment are extracted from the raw_data JSON field.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default 10)',
          },
        },
        required: ['days_back', 'group_by'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_friction_points',
      description: 'Get the top friction points (pain points) from transcripts based on AI-generated tags. Returns tag frequency counts.',
      parameters: {
        type: 'object',
        properties: {
          days_back: {
            type: 'number',
            description: 'Number of days to look back (e.g., 3 for last 3 days)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of friction points to return (default 10)',
          },
        },
        required: ['days_back'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transcript_stats',
      description: 'Get overall statistics about transcripts in a time period',
      parameters: {
        type: 'object',
        properties: {
          days_back: {
            type: 'number',
            description: 'Number of days to look back',
          },
        },
        required: ['days_back'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_transcripts',
      description: 'Search transcripts by text content, category, tags, friction_point, or date range. Returns matching transcripts with their summaries, sentiment, and metadata. Use this to find specific conversations or topics.',
      parameters: {
        type: 'object',
        properties: {
          text_search: {
            type: 'string',
            description: 'Free-text search across conversation summaries and full transcripts (e.g., "billing", "domain not working", "publish failed")',
          },
          category: {
            type: 'string',
            description: 'Filter by intent category (e.g., "Billing", "Technical Support")',
          },
          friction_point: {
            type: 'string',
            description: 'Filter by friction point from raw_data (e.g., "publish_failure", "domain_confusion")',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by AI-generated tags (returns transcripts matching ANY of these tags)',
          },
          interaction_status: {
            type: 'string',
            description: 'Filter by status (e.g., "resolved", "unresolved", "escalated")',
          },
          days_back: {
            type: 'number',
            description: 'Number of days to look back (default 30)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of transcripts to return (default 5, max 20)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transcript_detail',
      description: 'Get the full details of a specific transcript by its interaction_id. Returns the full transcript text, conversation summary, sentiment, tags, raw_data fields, and all metadata. Use this after search_transcripts to dive into a specific conversation.',
      parameters: {
        type: 'object',
        properties: {
          interaction_id: {
            type: 'string',
            description: 'The interaction_id of the transcript to retrieve',
          },
        },
        required: ['interaction_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_insights',
      description: 'Query derived insights (bugs, features, or patterns) from the AI-powered analysis. Returns insights sorted by occurrence count, business impact, or recency. Use this to answer questions about known bugs, requested features, or identified usage patterns.',
      parameters: {
        type: 'object',
        properties: {
          insight_type: {
            type: 'string',
            enum: ['BUG', 'FEATURE', 'PATTERN'],
            description: 'Type of insight: BUG (detected bugs/issues), FEATURE (feature requests from customers), or PATTERN (recurring usage/behavior patterns)',
          },
          sort_by: {
            type: 'string',
            enum: ['occurrence_count', 'business_impact_score', 'last_updated'],
            description: 'How to sort results (default: occurrence_count)',
          },
          product_line: {
            type: 'string',
            description: 'Optional filter by product line (e.g., "Airo App Builder", "Websites + Marketing")',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of insights to return (default 10, max 50)',
          },
        },
        required: ['insight_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_impact_insights',
      description: 'Get the highest business-impact insights of a given type. These represent the most critical bugs, most-requested features, or most impactful patterns that should be prioritized.',
      parameters: {
        type: 'object',
        properties: {
          insight_type: {
            type: 'string',
            enum: ['BUG', 'FEATURE', 'PATTERN'],
            description: 'Type of insight to retrieve',
          },
          limit: {
            type: 'number',
            description: 'Number of top-impact insights to return (default 5)',
          },
        },
        required: ['insight_type'],
      },
    },
  },
];

const GROUP_FIELDS = {
  agent_name: 'agent_name',
  category: 'category',
  interaction_status: 'interaction_status',
  sentiment: 'sentiment_score',
} as const;

const RAW_DATA_FIELDS = [
  'friction_point',
  'sub_intent',
  'issue_resolution',
  'customer_sentiment',
] as const;

type ValidGroupBy = keyof typeof GROUP_FIELDS | 'tags' | typeof RAW_DATA_FIELDS[number];

function readDaysBack(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 365) {
    throw new Error('Invalid days_back: expected integer in range 1-365');
  }
  return value as number;
}

function readLimit(value: unknown, fallback = 10): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new Error('Invalid limit: expected integer in range 1-100');
  }
  return value as number;
}

function readGroupBy(value: unknown): ValidGroupBy {
  const validValues = [
    'tags',
    'category',
    'sentiment',
    'agent_name',
    'interaction_status',
    'friction_point',
    'sub_intent',
    'issue_resolution',
    'customer_sentiment',
  ];

  if (validValues.includes(value as string)) {
    return value as ValidGroupBy;
  }
  throw new Error(`Invalid group_by: expected one of ${validValues.join(', ')}`);
}

/**
 * Execute a tool call and return results
 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, any>
): Promise<string> {
  try {
    logger.info('chat.tool.execute', { toolName, args });

    switch (toolName) {
      case 'query_transcripts':
        return await queryTranscripts(args);

      case 'get_friction_points':
        return await getFrictionPoints(args);

      case 'get_transcript_stats':
        return await getTranscriptStats(args);

      case 'search_transcripts':
        return await searchTranscripts(args);

      case 'get_transcript_detail':
        return await getTranscriptDetail(args);

      case 'query_insights':
        return await queryInsights(args);

      case 'get_top_impact_insights':
        return await getTopImpactInsights(args);

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (error) {
    logger.error('chat.tool.error', { toolName }, { error: error as Error });
    return `Error executing ${toolName}: ${error instanceof Error ? error.message : 'unknown error'}`;
  }
}

/**
 * Query transcripts with grouping
 */
async function queryTranscripts(args: {
  days_back?: number;
  group_by?: string;
  limit?: number;
}): Promise<string> {
  const days_back = readDaysBack(args.days_back);
  const group_by = readGroupBy(args.group_by);
  const limit = readLimit(args.limit, 10);
  const results = await getStore().queryGrouped(days_back, group_by, limit);

  if (results.length === 0) {
    return `No data found for the last ${days_back} days grouped by ${group_by}`;
  }

  return JSON.stringify(results, null, 2);
}

/**
 * Get top friction points from AI tags
 */
async function getFrictionPoints(args: {
  days_back?: number;
  limit?: number;
}): Promise<string> {
  const days_back = readDaysBack(args.days_back);
  const limit = readLimit(args.limit, 10);
  const results = await getStore().getFriction(days_back, limit);

  if (results.length === 0) {
    return `No friction points found in the last ${days_back} days. This may mean:\n- No transcripts have been tagged yet\n- No transcripts exist in this time period\n- Run the "Generate Tags" feature to analyze transcripts`;
  }

  return JSON.stringify(results, null, 2);
}

/**
 * Get overall transcript statistics
 */
async function getTranscriptStats(args: { days_back?: number }): Promise<string> {
  const days_back = readDaysBack(args.days_back);
  const result = await getStore().getStats(days_back);

  return JSON.stringify(result, null, 2);
}

/**
 * Search transcripts by text, category, tags, or other filters
 */
async function searchTranscripts(args: {
  text_search?: string;
  category?: string;
  friction_point?: string;
  tags?: string[];
  interaction_status?: string;
  days_back?: number;
  limit?: number;
}): Promise<string> {
  const days_back: number = args.days_back && Number.isInteger(args.days_back) && args.days_back >= 1 && args.days_back <= 365
    ? args.days_back
    : 30;
  const limit: number = args.limit && Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 20
    ? args.limit
    : 5;

  const startDate: Date = new Date();
  startDate.setDate(startDate.getDate() - days_back);

  const filter: Record<string, unknown> = {
    start_date: startDate.toISOString(),
    limit,
  };

  if (args.text_search?.trim()) {
    filter.text_search = args.text_search.trim();
  }
  if (args.category?.trim()) {
    filter.category = args.category.trim();
  }
  if (args.friction_point?.trim()) {
    filter.friction_point = args.friction_point.trim();
  }
  if (args.tags && args.tags.length > 0) {
    filter.tags = args.tags;
  }
  if (args.interaction_status?.trim()) {
    filter.interaction_status = args.interaction_status.trim();
  }

  const results = await getStore().queryTranscripts(filter as any);

  if (results.length === 0) {
    return `No transcripts found matching your criteria in the last ${days_back} days.`;
  }

  const summary = results.map((t: any) => ({
    interaction_id: t.interaction_id,
    created_at: t.created_at,
    category: t.category || 'N/A',
    conversation_summary: t.conversation_summary || '(no summary)',
    sentiment_score: t.sentiment_score,
    interaction_status: t.interaction_status || 'N/A',
    tags: typeof t.tags === 'string' ? JSON.parse(t.tags || '[]') : (t.tags || []),
    agent_name: t.agent_name || 'N/A',
    friction_point: typeof t.raw_data === 'object' ? t.raw_data?.friction_point : undefined,
    sub_intent: typeof t.raw_data === 'object' ? t.raw_data?.sub_intent : undefined,
  }));

  return JSON.stringify({ count: results.length, transcripts: summary }, null, 2);
}

const insightsClient: InsightsClient = new InsightsClient();

/**
 * Get full details of a specific transcript
 */
async function getTranscriptDetail(args: { interaction_id?: string }): Promise<string> {
  if (!args.interaction_id?.trim()) {
    return JSON.stringify({ error: 'interaction_id is required' });
  }

  const transcript = await getStore().getTranscriptById(args.interaction_id.trim());

  if (!transcript) {
    return JSON.stringify({ error: `No transcript found with interaction_id: ${args.interaction_id}` });
  }

  const rawData: Record<string, unknown> = typeof transcript.raw_data === 'string'
    ? JSON.parse(transcript.raw_data || '{}')
    : (transcript.raw_data || {});

  const detail: Record<string, unknown> = {
    interaction_id: transcript.interaction_id,
    created_at: transcript.created_at,
    category: transcript.category,
    conversation_summary: transcript.conversation_summary,
    full_transcript: transcript.full_transcript,
    sentiment_score: transcript.sentiment_score,
    interaction_status: transcript.interaction_status,
    resolution_time_seconds: transcript.resolution_time_seconds,
    agent_name: transcript.agent_name,
    tags: typeof transcript.tags === 'string' ? JSON.parse(transcript.tags || '[]') : (transcript.tags || []),
    friction_point: rawData.friction_point,
    sub_intent: rawData.sub_intent,
    issue_resolution: rawData.issue_resolution,
    customer_sentiment: rawData.customer_sentiment,
    preventable_contact: rawData.preventable_contact,
    potential_preventative_action: rawData.potential_preventative_action,
    actionable_improvement_opportunity: rawData.actionable_improvement_opportunity,
    inbound_volume_driver: rawData.inbound_volume_driver,
  };

  return JSON.stringify(detail, null, 2);
}

/**
 * Query derived insights (bugs, features, patterns)
 */
async function queryInsights(args: {
  insight_type?: string;
  sort_by?: string;
  product_line?: string;
  limit?: number;
}): Promise<string> {
  const validTypes: string[] = ['BUG', 'FEATURE', 'PATTERN'];
  const insightType: string = validTypes.includes(args.insight_type || '')
    ? args.insight_type!
    : 'BUG';

  const validSorts: string[] = ['occurrence_count', 'business_impact_score', 'last_updated'];
  const sortBy: 'occurrence_count' | 'business_impact_score' | 'last_updated' = validSorts.includes(args.sort_by || '')
    ? (args.sort_by as 'occurrence_count' | 'business_impact_score' | 'last_updated')
    : 'occurrence_count';

  const limit: number = args.limit && Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 50
    ? args.limit
    : 10;

  const results: InsightRow[] = await insightsClient.queryInsightsByType(
    insightType as 'BUG' | 'FEATURE' | 'PATTERN',
    { sortBy, limit, productLine: args.product_line }
  );

  if (results.length === 0) {
    return `No ${insightType.toLowerCase()} insights found.`;
  }

  const formatted = results.map((row: InsightRow) => ({
    insight_key: row.insight_key,
    title: row.insight_title,
    description: row.insight_description,
    occurrence_count: row.occurrence_count,
    business_impact_score: row.business_impact_score,
    preventable_rate: row.preventable_rate,
    resolution_rate: row.resolution_rate,
    recommended_action: row.recommended_action,
    product_line: row.product_line,
    related_tags: row.related_tags,
    cluster_keywords: row.cluster_keywords,
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    trend: row.trend,
    root_cause_analysis: row.root_cause_analysis,
    sample_transcript_ids: row.sample_transcript_ids?.slice(0, 3),
  }));

  return JSON.stringify({ type: insightType, count: results.length, insights: formatted }, null, 2);
}

/**
 * Get highest business-impact insights
 */
async function getTopImpactInsights(args: {
  insight_type?: string;
  limit?: number;
}): Promise<string> {
  const validTypes: string[] = ['BUG', 'FEATURE', 'PATTERN'];
  const insightType: string = validTypes.includes(args.insight_type || '')
    ? args.insight_type!
    : 'BUG';

  const limit: number = args.limit && Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 20
    ? args.limit
    : 5;

  const results: InsightRow[] = await insightsClient.queryTopImpactInsights(
    insightType as 'BUG' | 'FEATURE' | 'PATTERN',
    limit
  );

  if (results.length === 0) {
    return `No high-impact ${insightType.toLowerCase()} insights found.`;
  }

  const formatted = results.map((row: InsightRow) => ({
    title: row.insight_title,
    description: row.insight_description,
    business_impact_score: row.business_impact_score,
    occurrence_count: row.occurrence_count,
    preventable_rate: row.preventable_rate,
    recommended_action: row.recommended_action,
    product_line: row.product_line,
    cluster_keywords: row.cluster_keywords,
    root_cause_analysis: row.root_cause_analysis,
    sample_transcript_ids: row.sample_transcript_ids?.slice(0, 3),
  }));

  return JSON.stringify({ type: insightType, count: results.length, top_impact_insights: formatted }, null, 2);
}
