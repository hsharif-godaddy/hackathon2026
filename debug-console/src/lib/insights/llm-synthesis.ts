/**
 * LLM synthesis for derived insights
 * Uses GoCode (GoCaaS) to generate titles, descriptions, and business cases
 */

import type { Cluster } from './clustering';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';
import { callGoCode } from '../gocode-client';

// Airo Builder platform context for insight generation
const AIRO_BUILDER_CONTEXT = `
# Airo Builder Platform Context

Airo Builder is GoDaddy's AI-powered website builder. Key platform areas:

**Frontend (app/)**: Next.js BFF + builder UI
- Chat interface with AI agent
- Visual editor for site customization
- Domain management and connection flow
- Publish flow UI

**Backend (agents/)**: Express API + AI agents
- AI agent skills and prompts (agents/src/skills/)
- SQLite database for app metadata
- SSE streaming for real-time chat

**Publishing (container-scripts/)**: Site deployment
- Domain configuration and DNS setup
- SSL certificate provisioning
- Deploy status and rollback

**Common Pain Points**:
- Agent understanding: AI misinterpreting user intent, generating wrong content
- Editing UX: Confusion between edit mode vs chat mode, unclear how to modify elements
- Publishing: Domain connection errors, DNS propagation delays, SSL issues
- Error handling: Vague error messages, no clear recovery paths
- Performance: Slow generation, timeouts, page load issues

Focus on PLATFORM issues (what's broken in Airo Builder itself), NOT issues with individual customer websites.`;


function extractRawData(transcript: TranscriptRow): Record<string, any> {
  if (!transcript.raw_data) return {};

  // raw_data can be a Record (in-memory) or string (from DB)
  if (typeof transcript.raw_data === 'string') {
    try {
      return JSON.parse(transcript.raw_data);
    } catch {
      return {};
    }
  }

  return transcript.raw_data;
}

/**
 * Generate a concise bug title from cluster
 */
export async function synthesizeBugTitle(cluster: Cluster<TranscriptRow>): Promise<string> {
  const sampleVerbiage: string[] = cluster.items
    .slice(0, 5)
    .map(t => extractRawData(t).friction_point_verbiage)
    .filter(Boolean);

  if (sampleVerbiage.length === 0) {
    return cluster.keywords.slice(0, 5).join(' ');
  }

  const prompt = `${AIRO_BUILDER_CONTEXT}

Generate a concise bug title (5-7 words) for an Airo Builder PLATFORM bug from these customer friction points:

${sampleVerbiage.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

Consider which platform area is affected (agent skills, frontend UI, publishing flow, error handling, performance).
Return only the title, nothing else.`;

  const response = await callGoCode({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 50,
    timeout_ms: 10000,
  });

  const title: string = response.choices[0]?.message?.content?.trim() || cluster.keywords.slice(0, 5).join(' ');
  return title.replace(/^["']|["']$/g, ''); // Strip quotes if present
}

/**
 * Generate a bug description from cluster
 */
export async function synthesizeBugDescription(cluster: Cluster<TranscriptRow>): Promise<string> {
  const sampleVerbiage: string[] = cluster.items
    .slice(0, 5)
    .map(t => extractRawData(t).friction_point_verbiage)
    .filter(Boolean);

  if (sampleVerbiage.length === 0) {
    return 'No description available';
  }

  const prompt = `${AIRO_BUILDER_CONTEXT}

Synthesize a bug description (2-3 sentences) for an Airo Builder PLATFORM bug from these customer reports:

${sampleVerbiage.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

Explain:
1. What's broken in the platform (which area: agents, app UI, publishing, etc.)
2. How it impacts users building sites
3. Potential codebase area (e.g., agents/src/skills/, app/src/, container-scripts/)

Return only the description, nothing else.`;

  const response = await callGoCode({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 200,
    timeout_ms: 10000,
  });

  return response.choices[0]?.message?.content?.trim() || 'Unable to generate description';
}

/**
 * Generate a feature request title from cluster
 */
export async function synthesizeFeatureTitle(cluster: Cluster<TranscriptRow>): Promise<string> {
  const sampleVerbiage: string[] = cluster.items
    .slice(0, 5)
    .map(t => extractRawData(t).friction_point_verbiage)
    .filter(Boolean);

  if (sampleVerbiage.length === 0) {
    return cluster.keywords.slice(0, 5).join(' ');
  }

  const prompt = `${AIRO_BUILDER_CONTEXT}

Generate a concise feature request title (5-7 words) for Airo Builder PLATFORM from these customer requests:

${sampleVerbiage.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

Consider which platform area this feature would enhance (agent capabilities, editor UI, publishing workflow, domain management).
Return only the title, nothing else.`;

  const response = await callGoCode({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 50,
    timeout_ms: 10000,
  });

  const title: string = response.choices[0]?.message?.content?.trim() || cluster.keywords.slice(0, 5).join(' ');
  return title.replace(/^["']|["']$/g, '');
}

/**
 * Generate a feature request description from cluster
 */
export async function synthesizeFeatureDescription(cluster: Cluster<TranscriptRow>): Promise<string> {
  const sampleVerbiage: string[] = cluster.items
    .slice(0, 5)
    .map(t => extractRawData(t).friction_point_verbiage)
    .filter(Boolean);

  if (sampleVerbiage.length === 0) {
    return 'No description available';
  }

  const prompt = `${AIRO_BUILDER_CONTEXT}

Synthesize a feature request description (2-3 sentences) for Airo Builder PLATFORM from these customer requests:

${sampleVerbiage.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

Explain:
1. What platform capability customers are requesting
2. Why it would improve the site-building experience
3. Which platform area it relates to (agents, editor, publishing)

Return only the description, nothing else.`;

  const response = await callGoCode({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 200,
    timeout_ms: 10000,
  });

  return response.choices[0]?.message?.content?.trim() || 'Unable to generate description';
}

/**
 * Generate a business case for a feature request
 */
export async function synthesizeBusinessCase(cluster: Cluster<TranscriptRow>): Promise<string> {
  const sampleVerbiage: string[] = cluster.items
    .slice(0, 5)
    .map(t => extractRawData(t).friction_point_verbiage)
    .filter(Boolean);

  if (sampleVerbiage.length === 0) {
    return 'No business case available';
  }

  const prompt = `Based on these customer feature requests for Airo App Builder PLATFORM:

${sampleVerbiage.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

Write a business case (2-3 sentences) for adding this feature to the Airo App Builder platform, explaining:
1. Customer demand and impact on user satisfaction
2. How it improves the platform's value proposition
3. Competitive positioning or churn risk if not addressed

Focus on platform-level benefits, not individual website features.
Return only the business case, nothing else.`;

  const response = await callGoCode({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 200,
    timeout_ms: 10000,
  });

  return response.choices[0]?.message?.content?.trim() || 'Unable to generate business case';
}

/**
 * Generate "where things went wrong" analysis for PATTERN insights
 * Focuses on both user behavior AND Airo agent behavior
 */
export async function synthesizePatternAnalysis(
  cluster: Cluster<TranscriptRow>
): Promise<{
  summary: string;
  what_went_wrong: Array<{
    issue: string;
    description: string;
    who: 'user' | 'airo-agent' | 'both';
  }>;
  platform_area: string;
} | null> {
  const sampleVerbiage: string[] = cluster.items
    .slice(0, 8)
    .map(t => extractRawData(t).friction_point_verbiage)
    .filter(Boolean);

  const sampleCategories: string[] = cluster.items
    .slice(0, 8)
    .map(t => extractRawData(t).category)
    .filter(Boolean);

  if (sampleVerbiage.length === 0) {
    return null;
  }

  const prompt = `${AIRO_BUILDER_CONTEXT}

This is a PATTERN - a recurring friction point across multiple support contacts.

Analyze these customer support transcripts:

${sampleVerbiage.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

Categories: ${[...new Set(sampleCategories)].join(', ')}

Identify 1-3 things that went wrong focusing on BOTH user behavior AND Airo agent behavior:

**User side**: Did users misunderstand how to use Airo Builder? Did they expect something that doesn't exist?
**Airo agent side**: Did the AI agent misinterpret user intent? Did it give unclear guidance? Did it generate wrong content?
**Both**: Was there a mismatch between what users expected and what Airo delivered?

For each issue, identify:
- What went wrong (short title)
- Detailed explanation (1-2 sentences)
- Who's at fault: "user" (user expectation/understanding issue), "airo-agent" (AI agent behavior issue), or "both" (mismatch)

Return ONLY a JSON object (no markdown, no backticks):
{
  "summary": "2-3 sentence overview of the pattern",
  "what_went_wrong": [
    {
      "issue": "Short title (5-7 words)",
      "description": "What went wrong and why (1-2 sentences)",
      "who": "user|airo-agent|both"
    }
  ],
  "platform_area": "one of: agents|app-ui|publish-flow|error-handling|domain-config|onboarding"
}`;

  try {
    const response = await callGoCode({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 400,
      timeout_ms: 15000,
    });

    const responseText: string = response.choices[0]?.message?.content?.trim() || '';
    if (!responseText) {
      return null;
    }

    const analysis = JSON.parse(responseText);

    if (!analysis.what_went_wrong || !Array.isArray(analysis.what_went_wrong)) {
      return null;
    }

    return analysis;
  } catch (error) {
    console.error('[synthesizePatternAnalysis] Failed:', error);
    return null;
  }
}

/**
 * Generate "where Airo went wrong" analysis for BUG insights
 * Focuses on what the Airo platform/agent did wrong based on actual code and capabilities
 */
export async function synthesizeWhereAiroWentWrong(
  cluster: Cluster<TranscriptRow>,
  insightType: 'BUG' | 'FEATURE'
): Promise<{
  what_airo_did_wrong: Array<{
    issue: string;
    description: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
  platform_area: string;
  codebase_locations: string[];
  technical_details?: string;
} | null> {
  const sampleVerbiage: string[] = cluster.items
    .slice(0, 8)
    .map(t => extractRawData(t).friction_point_verbiage)
    .filter(Boolean);

  const sampleCategories: string[] = cluster.items
    .slice(0, 8)
    .map(t => extractRawData(t).category)
    .filter(Boolean);

  const sampleSubIntents: string[] = cluster.items
    .slice(0, 8)
    .map(t => extractRawData(t).sub_intent)
    .filter(Boolean);

  if (sampleVerbiage.length === 0) {
    return null;
  }

  const typeContext: string = insightType === 'BUG'
    ? 'This is a BUG - something in Airo Builder is broken or not working as intended.'
    : 'This is a FEATURE REQUEST - users want a capability that doesn\'t exist yet in Airo Builder.';

  const prompt = `${AIRO_BUILDER_CONTEXT}

${typeContext}

Analyze these customer support transcripts to identify WHERE AIRO WENT WRONG:

${sampleVerbiage.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

Categories: ${[...new Set(sampleCategories)].join(', ')}
Sub-intents: ${[...new Set(sampleSubIntents)].join(', ')}

Focus on what THE AIRO PLATFORM AND AI AGENT did wrong:
- Did the AI agent misinterpret user intent? (e.g., user asked to edit text but agent regenerated entire page)
- Did the agent generate incorrect content? (e.g., wrong color, bad layout, broken code)
- Did the platform fail? (e.g., publish failed, domain connection broke, error without recovery)
- Did the UI confuse users? (e.g., unclear buttons, hidden features, bad error messages)
- Did agent skills have bugs? (e.g., edit-website skill broke existing content, prompts lacking context)

Identify 1-3 things Airo did wrong:
- What Airo did wrong (short title)
- How Airo's behavior caused the problem (1-2 sentences, simple technical language)
- Likely codebase location where the bug lives (e.g., agents/src/skills/edit-website.ts, app/src/pages/editor/page.tsx)
- Technical details: what's broken in the code (e.g., "edit-website prompt doesn't preserve existing CSS classes when modifying elements")

Confidence level:
- HIGH: Clear pattern across multiple transcripts pointing to same Airo failure
- MEDIUM: Likely Airo issue based on symptoms, but needs code verification
- LOW: Possible Airo issue, could be user error or external factor

Return ONLY a JSON object (no markdown, no backticks):
{
  "what_airo_did_wrong": [
    {
      "issue": "Short title (5-7 words) - what Airo did wrong",
      "description": "How Airo's behavior caused the problem (1-2 sentences)",
      "confidence": "high|medium|low"
    }
  ],
  "platform_area": "one of: agents|app-ui|publish-flow|error-handling|domain-config|database|infrastructure",
  "codebase_locations": ["specific paths like agents/src/skills/edit-website.ts or app/src/pages/publish/index.tsx"],
  "technical_details": "What's broken in the code (e.g., missing validation, agent prompt lacks context, API timeout not handled)"
}`;

  try {
    const response = await callGoCode({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2, // Lower temperature for more focused technical analysis
      max_tokens: 600,
      timeout_ms: 15000,
    });

    const responseText: string = response.choices[0]?.message?.content?.trim() || '';
    if (!responseText) {
      return null;
    }

    // Parse JSON response
    const analysis = JSON.parse(responseText);

    // Validate structure
    if (
      !analysis.what_airo_did_wrong ||
      !Array.isArray(analysis.what_airo_did_wrong) ||
      analysis.what_airo_did_wrong.length === 0
    ) {
      return null;
    }

    return analysis;
  } catch (error) {
    console.error('[synthesizeRootCause] Failed:', error);
    return null;
  }
}

export const synthesizeRootCause = synthesizeWhereAiroWentWrong;
