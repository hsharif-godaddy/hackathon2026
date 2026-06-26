import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { withAuth } from '@/lib/api-auth';
import { callGoCode } from '@/lib/gocode-client';
import { logger } from '@/lib/logger';
import { buildDynamoClient, getSpEnv } from '@/lib/supportplane/store/config';

export const dynamic = 'force-dynamic';

const MODEL: string = process.env.GOCAAS_MODEL ?? 'claude-opus-4-6';
const CACHE_TABLE: string = `airo-builde-supportplane-insights-${getSpEnv()}`;
const CACHE_TTL_DAYS: number = 7;

let dynamoClient: DynamoDBDocumentClient | null = null;

function getDynamo(): DynamoDBDocumentClient {
  if (!dynamoClient) {
    dynamoClient = buildDynamoClient();
  }
  return dynamoClient;
}

function buildCacheKey(insights: AnalyzeCellRequest['insights'], quadrant: string): string {
  const titles: string = insights
    .map(i => i.insight_title)
    .sort()
    .join('|');
  const hash: string = crypto.createHash('sha256').update(`${quadrant}::${titles}`).digest('hex').slice(0, 16);
  return `HEATMAP_CELL#${hash}`;
}

interface AnalyzeCellRequest {
  insights: Array<{
    insight_title: string;
    insight_description: string;
    recommended_action?: string;
    occurrence_count: number;
    resolution_rate: number;
    preventable_rate: number;
    business_impact_score: number;
    product_line?: string;
    insight_type: 'bug' | 'feature' | 'pattern';
  }>;
  quadrant: string;
  totalContacts: number;
  preventableContacts: number;
}

interface RootCauseAnalysis {
  root_causes: Array<{
    category: string;
    description: string;
    affected_issues_count: number;
    preventable_contacts: number;
    platform_area: string;
  }>;
  tags_to_root_causes: Array<{
    tag: string;
    root_cause_category: string;
    frequency: number;
  }>;
  platform_recommendations: Array<{
    area: string;
    recommendation: string;
    impact: string;
    affected_issues: number;
    repo_areas: string[];
  }>;
  agent_improvements: Array<{
    improvement: string;
    rationale: string;
    affected_issues: number;
  }>;
  codebase_areas: Array<{
    area: string;
    issue_count: number;
    suggested_changes: string;
  }>;
  summary: string;
}

interface GoCodeResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
}

async function handler(request: NextRequest): Promise<NextResponse> {
  try {
    const body: AnalyzeCellRequest = await request.json();
    const { insights, quadrant, totalContacts, preventableContacts } = body;

    if (!insights || insights.length === 0) {
      return NextResponse.json(
        { error: 'No insights provided' },
        { status: 400 }
      );
    }

    const cacheKey: string = buildCacheKey(insights, quadrant);

    // Check DynamoDB cache first
    try {
      const cached = await getDynamo().send(new GetCommand({
        TableName: CACHE_TABLE,
        Key: { insight_key: cacheKey, created_at: 'cached' },
      }));

      if (cached.Item?.analysis && cached.Item?.expires_at > new Date().toISOString()) {
        logger.info('insights.analyze_cell.cache_hit', { quadrant, cache_key: cacheKey });
        return NextResponse.json({ analysis: cached.Item.analysis });
      }
    } catch (cacheErr) {
      logger.warn('insights.analyze_cell.cache_read_failed', {
        error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
      });
    }

    logger.info('insights.analyze_cell.start', {
      insight_count: insights.length,
      quadrant,
      total_contacts: totalContacts,
      preventable_contacts: preventableContacts,
      cache_key: cacheKey,
    });

    // Build the analysis prompt with platform context
    const analysisPrompt: string = buildAnalysisPrompt(insights, quadrant, totalContacts, preventableContacts);

    // Call GoCaaS for analysis with extended timeout
    const response: GoCodeResponse = await callGoCode({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: analysisPrompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 4096,
      timeout_ms: 60000,
    });

    const responseText: string = response.choices[0]?.message?.content || '';

    if (!responseText) {
      logger.error('insights.analyze_cell.empty_response', { quadrant });
      return NextResponse.json(
        { error: 'Empty response from AI' },
        { status: 500 }
      );
    }

    // Parse the JSON response
    const analysis: RootCauseAnalysis = JSON.parse(responseText);

    // Store in DynamoDB cache
    const expiresAt: Date = new Date();
    expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);

    try {
      await getDynamo().send(new PutCommand({
        TableName: CACHE_TABLE,
        Item: {
          insight_key: cacheKey,
          created_at: 'cached',
          insight_type: 'HEATMAP_CELL',
          quadrant,
          analysis,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        },
      }));
      logger.info('insights.analyze_cell.cache_stored', { cache_key: cacheKey });
    } catch (cacheErr) {
      logger.warn('insights.analyze_cell.cache_write_failed', {
        error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
      });
    }

    logger.info('insights.analyze_cell.success', {
      quadrant,
      root_causes_count: analysis.root_causes.length,
      recommendations_count: analysis.platform_recommendations.length,
    });

    return NextResponse.json({ analysis });
  } catch (error) {
    logger.error('insights.analyze_cell.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze insights' },
      { status: 500 }
    );
  }
}

export const POST = withAuth(handler);

function buildAnalysisPrompt(
  insights: AnalyzeCellRequest['insights'],
  quadrant: string,
  totalContacts: number,
  preventableContacts: number
): string {
  const insightsSummary: string = insights.map((insight, idx) => {
    return `
### Issue ${idx + 1}: ${insight.insight_title}
- Type: ${insight.insight_type}
- Description: ${insight.insight_description}
- Recommended Action: ${insight.recommended_action || 'N/A'}
- Occurrences: ${insight.occurrence_count}
- Resolution Rate: ${(insight.resolution_rate * 100).toFixed(0)}%
- Preventable Rate: ${(insight.preventable_rate * 100).toFixed(0)}%
- Impact Score: ${insight.business_impact_score.toFixed(1)}
- Product Line: ${insight.product_line || 'N/A'}
`;
  }).join('\n');

  return `You are analyzing customer support issues for **Airo Builder**, a GoDaddy product that allows customers to build websites using AI agents. Your goal is to identify root causes and provide actionable recommendations to improve the platform and reduce customer pain points.

# Platform Context

## Airo Builder Architecture
- **Frontend (app/)**: Next.js BFF + builder UI where users interact with the AI agent, edit their site, manage domains, and publish
- **Backend (agents/)**: Express API with AI agents, SQLite database, SSE streaming for chat
- **Publishing Flow (container-scripts/)**: Handles site deployment, domain configuration, SSL setup
- **Local Dev Environment**: dev-supervisor, local-control-plane for testing

## Common User Journey Pain Points
1. **Creation Flow**: Initial site generation via AI chat, understanding what the agent can/cannot do
2. **Editing Experience**: Visual editing, component manipulation, understanding edit vs chat modes
3. **Publishing Flow**: Domain connection, DNS configuration, SSL certificate provisioning, deploy status
4. **Agent Capabilities**: AI understanding user intent, generating appropriate responses, handling edge cases
5. **Error Handling**: Clear error messages, recovery paths, debugging failed operations

## Known Technical Areas
- **agents/src/skills/**: AI agent skill definitions and prompts
- **app/src/**: Frontend code including chat interface, editor, publish flow UI
- **container-scripts/**: Publish and deploy logic
- **Agent prompting**: How the AI interprets user requests and generates responses
- **Database schema**: App metadata, user preferences, configuration
- **Domain/DNS integration**: Third-party APIs, GoDaddy domain services
- **Error surfacing**: Logs, user-facing error messages, recovery suggestions

# Analysis Task

Analyze the following ${insights.length} issues from the **${quadrant}** quadrant:
- Total support contacts: ${totalContacts}
- Preventable contacts: ${preventableContacts}

${insightsSummary}

# Required Output (JSON only, no markdown)

Provide your analysis as a JSON object with this exact structure:

\`\`\`json
{
  "root_causes": [
    {
      "category": "string (e.g., 'publish-flow-errors', 'agent-understanding', 'domain-configuration')",
      "description": "string (detailed explanation of the root cause)",
      "affected_issues_count": number,
      "preventable_contacts": number,
      "platform_area": "string (which part of platform: 'frontend', 'backend', 'agent', 'publish', 'infrastructure')"
    }
  ],
  "tags_to_root_causes": [
    {
      "tag": "string (extracted from issue titles/descriptions)",
      "root_cause_category": "string (maps to a root_cause category above)",
      "frequency": number
    }
  ],
  "platform_recommendations": [
    {
      "area": "string (e.g., 'Agent Prompting', 'Error Messages', 'Publish Flow UI')",
      "recommendation": "string (specific actionable recommendation)",
      "impact": "string (expected impact on support volume and user experience)",
      "affected_issues": number,
      "repo_areas": ["string (specific code areas like 'agents/src/skills/', 'app/src/pages/publish/')"]
    }
  ],
  "agent_improvements": [
    {
      "improvement": "string (specific agent behavior or prompt improvement)",
      "rationale": "string (why this would help)",
      "affected_issues": number
    }
  ],
  "codebase_areas": [
    {
      "area": "string (specific module/directory)",
      "issue_count": number,
      "suggested_changes": "string (what to change/improve)"
    }
  ],
  "summary": "string (2-3 sentence executive summary focusing on platform improvements)"
}
\`\`\`

# Analysis Guidelines

1. **Root Causes**: Identify 3-7 distinct root causes. Look for patterns across issues. Consider:
   - Is this an agent understanding/prompting issue?
   - Is this a UX/UI clarity issue?
   - Is this a technical limitation or error?
   - Is this a missing feature or capability?

2. **Tags Mapping**: Extract common tags from issue titles/descriptions and map them to root causes. This helps see patterns.

3. **Platform Recommendations**: Focus on actionable improvements to:
   - Agent prompts and skills (agents/src/skills/)
   - UI/UX flows (app/src/)
   - Error handling and messaging
   - Publishing/deployment logic (container-scripts/)
   - Documentation or in-product guidance

4. **Agent Improvements**: Specific changes to how the AI agent behaves or responds

5. **Codebase Areas**: Map issues to specific directories/modules in the airo-app-builder repo

6. **Summary**: Focus on the biggest opportunities to reduce support burden

Return ONLY the JSON object, no additional text or markdown formatting.`;
}
