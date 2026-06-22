import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { callGoCode, isGoCodeConfigured } from '@/lib/gocode-client';
import { logger } from '@/lib/logger';
import { queryTranscripts as queryTranscriptRows } from '@/lib/l1-transcript-db';

export const dynamic = 'force-dynamic';

// ── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AskRequest {
  question: string;
  history?: ChatMessage[];
}

// OpenAI-compatible message types (GoCaaS uses this format)
interface OaiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OaiMessage {
  role: string;
  content: string | null;
  tool_calls?: OaiToolCall[];
}

interface OaiResponse {
  choices: Array<{
    finish_reason: string;
    message: OaiMessage;
  }>;
}

// Model name as understood by GoCaaS — mirrors what agents/ uses.
const MODEL = process.env.GOCAAS_MODEL ?? 'claude-opus-4-6';

const SYSTEM_PROMPT = `You are an AI support assistant for the Airo App Builder (AAB) team at GoDaddy. \
You help support engineers quickly find information about on-call schedules, escalation procedures, \
incident response, common operational tasks, and L1 customer support transcripts. Be concise and actionable. \
Always include relevant URLs, channel names, or contact handles when referencing resources.

When asked about customer issues or support history, use the query_l1_transcripts tool to search for relevant \
past interactions. This can help identify patterns, recurring issues, or previous resolutions.

---
## ON-CALL SCHEDULE

On-call schedule: https://godaddy.service-now.com/now/sow/schedules/params/selected-group/925f19f62b6b6a102aa1f2356e91bf18

To find who is currently on call, visit the link above. The schedule rotates weekly.

---
## KEY RESOURCES

- **Debug Console**: https://console.airo-builder.godaddy.com
- **CIEC Tickets** (open incidents): https://godaddy-corp.atlassian.net/issues/?filter=103469
- **AABSP Tickets** (customer feedback): https://godaddy-corp.atlassian.net/jira/software/projects/AABSP/boards
- **Care Escalation Portal**: https://care.support.secureserver.net/servicedesk/customer/portal/20/group/1366/create/2982
- **L1 Transcripts**: https://secureservernet.sharepoint.com/sites/CareServices/Shared%20Documents/Forms/AllItems.aspx

---
## SLACK CHANNELS

- **#airo-builder-sre** — SRE team channel for infrastructure/operational issues
- **#airo-builder-dev** — Developer channel for product/feature questions
- **#airo-app-builder-prod-alerts** — Production alerts (PagerDuty, monitors)
- **#airo-feedback** — Customer feedback and feature requests
- **#goc** — GoDaddy Operations Center for broader GoDaddy incidents

---
## KEY CONTACTS / HANDLES

- **@aab-feedback-escalate** — Escalate urgent customer feedback
- **@partners-v2-workflows** — Partners and workflow-related escalations

---
## INCIDENT RESPONSE

### Severity Levels
- **SEV1** — Complete outage or data loss affecting all customers. Page on-call immediately via PagerDuty. Post in #airo-app-builder-prod-alerts and #goc.
- **SEV2** — Partial outage or significant degradation affecting many customers. Alert on-call via Slack in #airo-builder-sre. Page if no response within 15 minutes.
- **SEV3** — Minor degradation or isolated issue. Create CIEC ticket and post in #airo-builder-sre.

### Incident Response Steps
1. Identify and confirm the issue using the Debug Console: https://console.airo-builder.godaddy.com
2. Check #airo-app-builder-prod-alerts for related alerts
3. Check open CIEC tickets: https://godaddy-corp.atlassian.net/issues/?filter=103469
4. Page or contact the on-call engineer (see schedule above)
5. Create or update the CIEC ticket with findings
6. If customer-facing, use Care Escalation Portal to open a support ticket
7. Post updates in #airo-builder-sre every 30 minutes during active incidents
8. Write a post-mortem for SEV1/SEV2 incidents within 48 hours

---
## CREDIT GRANTS

To grant service credits to affected customers:
1. Verify the customer was impacted (check CIEC ticket or Debug Console logs)
2. Determine credit amount based on downtime duration and plan tier
3. Submit credit request via the Care Escalation Portal with justification
4. Tag @aab-feedback-escalate in #airo-feedback for awareness

Credit approval authority:
- Up to $50: Support engineer can self-approve via Care portal
- $50–$500: Requires manager approval
- Over $500: Requires Director approval

---
## DOMAIN AND DNS ISSUES

### Custom Domain Not Connecting
1. Verify domain is added in the Airo console: https://console.airo-builder.godaddy.com
2. Check DNS propagation (can take up to 48 hours for new records)
3. Verify CNAME record points to the correct Airo endpoint

### SSL Certificate Issues
1. Confirm the CNAME is correctly configured and propagated
2. Certificate provisioning is automatic after DNS validates — allow up to 1 hour
3. If stuck, restart certificate provisioning via Debug Console > Domain Settings > Reissue Certificate

---
## QUICK REFERENCE

| Task | Link / Command |
|------|---------------|
| Who's on call? | https://godaddy.service-now.com/now/sow/schedules/params/selected-group/925f19f62b6b6a102aa1f2356e91bf18 |
| Debug Console | https://console.airo-builder.godaddy.com |
| Open CIEC tickets | https://godaddy-corp.atlassian.net/issues/?filter=103469 |
| AABSP board | https://godaddy-corp.atlassian.net/jira/software/projects/AABSP/boards |
| Care escalation | https://care.support.secureserver.net/servicedesk/customer/portal/20/group/1366/create/2982 |
| L1 Transcripts | https://secureservernet.sharepoint.com/sites/CareServices |
| Production alerts | #airo-app-builder-prod-alerts |
| SRE channel | #airo-builder-sre |

---
## RESPONSE FORMAT

At the very end of every response, on its own line, include 2–3 short follow-up questions a support engineer might naturally ask next. Use exactly this format and nothing else on that line:

SUGGEST:["question 1","question 2","question 3"]

Do not label, explain, or mention this line. It must be the final line of your response.
`;

// OpenAI-compatible tool definitions (function calling format)
const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_jira_tickets',
      description:
        'Search live Jira tickets across CIEC (incidents/escalations) and AABSP (customer feedback) boards. ' +
        'Use this whenever the user asks about open tickets, current incidents, or wants to know what is actively being worked on.',
      parameters: {
        type: 'object',
        properties: {
          jql: {
            type: 'string',
            description:
              'JQL query. Examples: "project = CIEC AND status = \\"In Progress\\"", "project = AABSP AND labels = AAB-App ORDER BY created DESC". ' +
              'Omit to get all open CIEC tickets.',
          },
          limit: {
            type: 'number',
            description: 'Max results to return (default 10, max 25).',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_jira_ticket',
      description: 'Get full details of a specific Jira ticket by its key, e.g. CIEC-1234 or AABSP-42.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Jira ticket key, e.g. CIEC-1234 or AABSP-42' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_oncall',
      description:
        'Get the current on-call engineer for the AAB team from ServiceNow. ' +
        'Use this whenever the user asks who is on call right now.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_l1_transcripts',
      description:
        'Query L1 customer support transcript history by appId, shopperId, customerId, tags, domain, sentiment, or text search. ' +
        'Returns matching transcripts with conversation summaries, tags, and metadata. ' +
        'Use this to search for past customer interactions, identify patterns, or find examples of similar issues.',
      parameters: {
        type: 'object',
        properties: {
          app_id: {
            type: 'string',
            description: 'Filter by application ID',
          },
          shopper_id: {
            type: 'string',
            description: 'Filter by shopper/customer ID',
          },
          customer_id: {
            type: 'string',
            description: 'Filter by customer ID',
          },
          interaction_id: {
            type: 'string',
            description: 'Filter by specific interaction ID',
          },
          domain: {
            type: 'string',
            description: 'Filter by domain name',
          },
          category: {
            type: 'string',
            description: 'Filter by category (e.g., technical, billing)',
          },
          subcategory: {
            type: 'string',
            description: 'Filter by subcategory',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by tags (e.g., ["billing", "domain_setup"])',
          },
          sub_intent: {
            type: 'string',
            description: 'Filter by sub-intent from raw_data',
          },
          friction_point: {
            type: 'string',
            description: 'Filter by friction point from raw_data',
          },
          interaction_status: {
            type: 'string',
            description: 'Filter by status (e.g., resolved, escalated)',
          },
          interaction_type: {
            type: 'string',
            description: 'Filter by type (e.g., chat, phone, email)',
          },
          agent_name: {
            type: 'string',
            description: 'Filter by support agent name',
          },
          language: {
            type: 'string',
            description: 'Filter by language code (e.g., en, es)',
          },
          min_sentiment: {
            type: 'number',
            description: 'Filter by minimum sentiment score (-1.0 to 1.0)',
          },
          max_sentiment: {
            type: 'number',
            description: 'Filter by maximum sentiment score (-1.0 to 1.0)',
          },
          text_search: {
            type: 'string',
            description: 'Full-text search in conversation summaries and transcripts',
          },
          start_date: {
            type: 'string',
            description: 'Filter by start date (ISO format YYYY-MM-DD)',
          },
          end_date: {
            type: 'string',
            description: 'Filter by end date (ISO format YYYY-MM-DD)',
          },
          limit: {
            type: 'number',
            description: 'Max results to return (default 10, max 50)',
          },
        },
        required: [],
      },
    },
  },
];

// ── Jira OAuth 2.0 (NSA client_credentials — same as fanout-lambda) ────────
// Auth flow: POST clientId+clientSecret to auth.atlassian.com → 60-min Bearer.
// Then hit api.atlassian.com/ex/jira/<cloudId>/rest/api/3/... (NOT the tenant URL).
// Secret shape matches fanout: JIRA_CLIENT_ID + JIRA_CLIENT_SECRET env vars.

const JIRA_TOKEN_URL = process.env.JIRA_OAUTH_TOKEN_URL ?? 'https://auth.atlassian.com/oauth/token';
const JIRA_EXPIRY_MARGIN_MS = 60_000;

let jiraToken: string | null = null;
let jiraTokenExpiresAt = 0;

async function getJiraToken(): Promise<string> {
  if (jiraToken && jiraTokenExpiresAt - Date.now() > JIRA_EXPIRY_MARGIN_MS) {
    return jiraToken;
  }

  const clientId = process.env.JIRA_CLIENT_ID ?? '';
  const clientSecret = process.env.JIRA_CLIENT_SECRET ?? '';

  if (!clientId || !clientSecret) {
    throw new Error('Jira not configured. Set JIRA_CLIENT_ID and JIRA_CLIENT_SECRET.');
  }

  const res = await fetch(JIRA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Jira OAuth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Jira OAuth response missing access_token');

  const expiresInMs = (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000;
  jiraToken = data.access_token;
  jiraTokenExpiresAt = Date.now() + expiresInMs;
  return jiraToken;
}

function jiraBase(): string {
  const cloudId = process.env.JIRA_CLOUD_ID ?? '';
  if (cloudId) return `https://api.atlassian.com/ex/jira/${cloudId}`;
  // Fallback: direct tenant URL with Basic Auth (personal API token path)
  return process.env.JIRA_BASE_URL ?? 'https://godaddy-corp.atlassian.net';
}

async function jiraFetch(url: string): Promise<Response> {
  const cloudId = process.env.JIRA_CLOUD_ID ?? '';

  if (cloudId) {
    // NSA OAuth2 path (service account — same as fanout)
    let token: string;
    try { token = await getJiraToken(); } catch { throw new Error('Jira NSA token fetch failed. Check JIRA_CLIENT_ID / JIRA_CLIENT_SECRET.'); }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    // Single 401 re-mint, matching fanout pattern
    if (res.status === 401) {
      jiraToken = null;
      jiraTokenExpiresAt = 0;
      const fresh = await getJiraToken();
      return fetch(url, {
        headers: { Authorization: `Bearer ${fresh}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
    }
    return res;
  }

  // Personal API token path (Basic Auth) — used when JIRA_CLOUD_ID not set
  const email = process.env.JIRA_EMAIL ?? '';
  const apiToken = process.env.JIRA_API_TOKEN ?? '';
  if (!email || !apiToken) throw new Error('Jira not configured. Set JIRA_CLOUD_ID+JIRA_CLIENT_ID+JIRA_CLIENT_SECRET (NSA) or JIRA_EMAIL+JIRA_API_TOKEN (personal token).');
  return fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
}

// ── Tool implementations ───────────────────────────────────────────────────

async function searchJiraTickets(jql?: string, limit = 10): Promise<string> {
  const effectiveJql = jql ?? 'project in (CIEC, AABSP) AND statusCategory != Done ORDER BY updated DESC';
  const url = `${jiraBase()}/rest/api/3/search/jql?jql=${encodeURIComponent(effectiveJql)}&maxResults=${Math.min(limit, 25)}&fields=summary,status,priority,assignee,created,updated,project,labels`;

  const res = await jiraFetch(url);
  if (!res.ok) throw new Error(`Jira search ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = await res.json() as { issues?: unknown[] };
  return JSON.stringify(body.issues ?? [], null, 2);
}

async function getJiraTicket(key: string): Promise<string> {
  const url = `${jiraBase()}/rest/api/3/issue/${encodeURIComponent(key)}`;
  const res = await jiraFetch(url);
  if (!res.ok) throw new Error(`Jira ticket ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return JSON.stringify(await res.json(), null, 2);
}

async function getOnCall(): Promise<string> {
  const instance = process.env.SERVICENOW_INSTANCE;
  const user = process.env.SERVICENOW_USER;
  const password = process.env.SERVICENOW_PASSWORD;
  const groupId = process.env.SERVICENOW_GROUP_ID ?? '925f19f62b6b6a102aa1f2356e91bf18';

  if (!instance || !user || !password) {
    return 'ServiceNow is not configured. Set SERVICENOW_INSTANCE, SERVICENOW_USER, and SERVICENOW_PASSWORD.';
  }

  const dateTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const url = `https://${instance}/api/now/on_call_rota/whoisoncall?group_ids=${groupId}&date_time=${encodeURIComponent(dateTime)}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    },
  });

  if (!res.ok) throw new Error(`ServiceNow ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return JSON.stringify(await res.json(), null, 2);
}

async function queryL1Transcripts(params: {
  app_id?: string;
  shopper_id?: string;
  customer_id?: string;
  interaction_id?: string;
  domain?: string;
  category?: string;
  subcategory?: string;
  tags?: string[];
  sub_intent?: string;
  friction_point?: string;
  interaction_status?: string;
  interaction_type?: string;
  agent_name?: string;
  language?: string;
  min_sentiment?: number;
  max_sentiment?: number;
  text_search?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
}): Promise<string> {
  try {
    const limit = Math.min(params.limit ?? 10, 50);
    const rows = (await queryTranscriptRows({
      app_id: params.app_id,
      category: params.category,
      customer_id: params.customer_id,
      end_date: params.end_date,
      friction_point: params.friction_point,
      interaction_id: params.interaction_id,
      interaction_status: params.interaction_status,
      shopper_id: params.shopper_id,
      start_date: params.start_date,
      sub_intent: params.sub_intent,
      tags: params.tags,
      text_search: params.text_search,
    }))
      .filter((row) => !params.domain || (row.domain || '').includes(params.domain))
      .filter((row) => !params.subcategory || row.subcategory === params.subcategory)
      .filter((row) => !params.interaction_type || row.interaction_type === params.interaction_type)
      .filter((row) => !params.agent_name || (row.agent_name || '').includes(params.agent_name))
      .filter((row) => !params.language || row.language === params.language)
      .filter((row) => params.min_sentiment === undefined || Number(row.sentiment_score || 0) >= params.min_sentiment)
      .filter((row) => params.max_sentiment === undefined || Number(row.sentiment_score || 0) <= params.max_sentiment)
      .slice(0, limit);

    // Format results with parsed tags
    const results = rows.map(row => ({
      ...row,
      tags: Array.isArray(row.tags)
        ? row.tags
        : row.tags
          ? JSON.parse(row.tags)
          : [],
    }));

    return JSON.stringify({
      count: results.length,
      transcripts: results,
    }, null, 2);
  } catch (err) {
    logger.error('query_l1_transcripts.error', {}, { error: err as Error });
    return JSON.stringify({
      error: err instanceof Error ? err.message : 'Unknown error',
      count: 0,
      transcripts: [],
    });
  }
}

async function dispatchTool(name: string, argsJson: string): Promise<string> {
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return `Invalid tool arguments: ${argsJson}`;
  }

  switch (name) {
    case 'search_jira_tickets':
      return searchJiraTickets(input.jql as string | undefined, input.limit as number | undefined);
    case 'get_jira_ticket':
      return getJiraTicket(input.key as string);
    case 'get_oncall':
      return getOnCall();
    case 'query_l1_transcripts':
      return queryL1Transcripts({
        app_id: input.app_id as string | undefined,
        shopper_id: input.shopper_id as string | undefined,
        customer_id: input.customer_id as string | undefined,
        interaction_id: input.interaction_id as string | undefined,
        domain: input.domain as string | undefined,
        category: input.category as string | undefined,
        subcategory: input.subcategory as string | undefined,
        tags: input.tags as string[] | undefined,
        sub_intent: input.sub_intent as string | undefined,
        friction_point: input.friction_point as string | undefined,
        interaction_status: input.interaction_status as string | undefined,
        interaction_type: input.interaction_type as string | undefined,
        agent_name: input.agent_name as string | undefined,
        language: input.language as string | undefined,
        min_sentiment: input.min_sentiment as number | undefined,
        max_sentiment: input.max_sentiment as number | undefined,
        text_search: input.text_search as string | undefined,
        start_date: input.start_date as string | undefined,
        end_date: input.end_date as string | undefined,
        limit: input.limit as number | undefined,
      });
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Route handler ──────────────────────────────────────────────────────────

export const POST = withAuth(async function supportplaneAsk(request: NextRequest) {
  if (!isGoCodeConfigured()) {
    return NextResponse.json(
      { error: 'AI not configured. Set OPENAI_API_KEY or enable GOCODE_USE_S2S_AUTH=true.' },
      { status: 503 }
    );
  }

  const body = (await request.json()) as AskRequest;
  const { question, history = [] } = body;

  if (!question?.trim()) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  // OpenAI message format: system as first message
  const messages: unknown[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(function toMsg(m: ChatMessage) { return { role: m.role, content: m.content }; }),
    { role: 'user', content: question },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(payload: object): void {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }

      try {
        while (true) {
          const resp = await callGoCode({
            messages: messages as any,
            model: MODEL,
            max_tokens: 2048,
            temperature: 0.7,
            tools: TOOLS,
          }) as OaiResponse;
          const choice = resp.choices[0];
          if (!choice) break;

          const msg = choice.message;

          // Emit any text content
          if (msg.content) send({ text: msg.content });

          // Done — no tool calls
          if (choice.finish_reason !== 'tool_calls' || !msg.tool_calls?.length) break;

          // Append assistant message with tool_calls
          messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });

          // Execute each tool call and collect results
          const toolResults: unknown[] = [];
          for (const tc of msg.tool_calls) {
            const label =
              tc.function.name === 'get_jira_ticket'
                ? `Fetching ticket…`
                : tc.function.name === 'search_jira_tickets'
                ? 'Searching Jira (CIEC + AABSP)…'
                : tc.function.name === 'query_l1_transcripts'
                ? 'Searching L1 transcripts…'
                : 'Checking ServiceNow…';

            send({ status: label });

            let result: string;
            try {
              result = await dispatchTool(tc.function.name, tc.function.arguments);
            } catch (err) {
              result = `Error: ${err instanceof Error ? err.message : String(err)}`;
            }

            // OpenAI tool result format
            toolResults.push({ role: 'tool', tool_call_id: tc.id, content: result });
          }

          // Append tool results as individual messages
          messages.push(...toolResults);
        }
      } catch (err) {
        logger.error('supportplane.ask.error', {}, { error: err as Error });
        send({ error: err instanceof Error ? err.message : 'Unknown error' });
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});
