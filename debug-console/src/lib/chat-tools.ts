/**
 * Function calling tools for AI Chat
 * Allows the AI to query the L1 transcripts database
 */

import { getL1TranscriptsDb } from './l1-transcript-db';
import { logger } from './logger';

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
            enum: ['category', 'tags', 'sentiment', 'agent_name', 'interaction_status'],
            description: 'Field to group results by',
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
];

const GROUP_FIELDS = {
  agent_name: 'agent_name',
  category: 'category',
  interaction_status: 'interaction_status',
  sentiment: 'sentiment_score',
} as const;

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

function readGroupBy(value: unknown): keyof typeof GROUP_FIELDS | 'tags' {
  if (
    value === 'tags' ||
    value === 'category' ||
    value === 'sentiment' ||
    value === 'agent_name' ||
    value === 'interaction_status'
  ) {
    return value;
  }
  throw new Error('Invalid group_by');
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
  const db = getL1TranscriptsDb();
  const days_back = readDaysBack(args.days_back);
  const group_by = readGroupBy(args.group_by);
  const limit = readLimit(args.limit, 10);

  let query = '';

  if (group_by === 'tags') {
    // Special handling for tags (JSON array)
    query = `
      WITH tag_expanded AS (
        SELECT
          json_each.value as tag,
          interaction_id,
          sentiment_score,
          interaction_status
        FROM l1_transcripts, json_each(l1_transcripts.tags)
        WHERE created_at >= datetime('now', '-' || @days_back || ' days')
          AND tags IS NOT NULL
      )
      SELECT
        tag,
        COUNT(*) as count,
        AVG(COALESCE(sentiment_score, 0)) as avg_sentiment,
        SUM(CASE WHEN interaction_status = 'unresolved' THEN 1 ELSE 0 END) as unresolved_count
      FROM tag_expanded
      GROUP BY tag
      ORDER BY count DESC
      LIMIT @limit
    `;
  } else {
    const groupField = GROUP_FIELDS[group_by];
    query = `
      SELECT
        ${groupField} as field_value,
        COUNT(*) as count,
        AVG(COALESCE(sentiment_score, 0)) as avg_sentiment,
        AVG(COALESCE(resolution_time_seconds, 0)) as avg_duration,
        SUM(CASE WHEN interaction_status = 'unresolved' THEN 1 ELSE 0 END) as unresolved_count
      FROM l1_transcripts
      WHERE created_at >= datetime('now', '-' || @days_back || ' days')
        AND ${groupField} IS NOT NULL
      GROUP BY ${groupField}
      ORDER BY count DESC
      LIMIT @limit
    `;
  }

  const results = db.prepare(query).all({ days_back, limit });

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
  const db = getL1TranscriptsDb();
  const days_back = readDaysBack(args.days_back);
  const limit = readLimit(args.limit, 10);

  const query = `
    WITH tag_expanded AS (
      SELECT
        json_each.value as tag,
        interaction_id,
        sentiment_score,
        interaction_status,
        resolution_time_seconds
      FROM l1_transcripts, json_each(l1_transcripts.tags)
      WHERE created_at >= datetime('now', '-' || @days_back || ' days')
        AND tags IS NOT NULL
    )
    SELECT
      tag as friction_point,
      COUNT(*) as occurrences,
      AVG(COALESCE(sentiment_score, 0)) as avg_sentiment,
      AVG(COALESCE(resolution_time_seconds, 0)) as avg_resolution_time,
      SUM(CASE WHEN interaction_status = 'unresolved' THEN 1 ELSE 0 END) as unresolved_count,
      ROUND(SUM(CASE WHEN interaction_status = 'unresolved' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as unresolved_rate
    FROM tag_expanded
    GROUP BY tag
    ORDER BY occurrences DESC, unresolved_rate DESC, avg_sentiment ASC
    LIMIT @limit
  `;

  const results = db.prepare(query).all({ days_back, limit });

  if (results.length === 0) {
    return `No friction points found in the last ${days_back} days. This may mean:\n- No transcripts have been tagged yet\n- No transcripts exist in this time period\n- Run the "Generate Tags" feature to analyze transcripts`;
  }

  return JSON.stringify(results, null, 2);
}

/**
 * Get overall transcript statistics
 */
async function getTranscriptStats(args: { days_back?: number }): Promise<string> {
  const db = getL1TranscriptsDb();
  const days_back = readDaysBack(args.days_back);

  const query = `
    SELECT
      COUNT(*) as total_transcripts,
      COUNT(CASE WHEN tags IS NOT NULL THEN 1 END) as tagged_transcripts,
      COUNT(CASE WHEN tags IS NULL THEN 1 END) as untagged_transcripts,
      AVG(COALESCE(sentiment_score, 0)) as avg_sentiment,
      AVG(COALESCE(resolution_time_seconds, 0)) as avg_resolution_time,
      SUM(CASE WHEN interaction_status = 'unresolved' THEN 1 ELSE 0 END) as unresolved_count,
      ROUND(SUM(CASE WHEN interaction_status = 'unresolved' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as unresolved_rate
    FROM l1_transcripts
    WHERE created_at >= datetime('now', '-' || @days_back || ' days')
  `;

  const result = db.prepare(query).get({ days_back });

  return JSON.stringify(result, null, 2);
}
