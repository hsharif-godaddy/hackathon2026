/**
 * LLM synthesis for derived insights
 * Uses GoCode (GoCaaS) to generate titles, descriptions, and business cases
 */

import type { Cluster } from './clustering';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';
import { callGoCode } from '../gocode-client';

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

  const prompt = `Generate a concise bug title (5-7 words) for an Airo App Builder PLATFORM issue from these customer friction points:

${sampleVerbiage.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

Focus on bugs in the Airo App Builder editor, publishing system, authentication, or platform features - NOT bugs in customers' websites.
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

  const prompt = `Synthesize a bug description (2-3 sentences) for an Airo App Builder PLATFORM issue from these customer reports:

${sampleVerbiage.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

Focus on what's broken in the Airo App Builder platform (editor, publishing, auth, AI features) - NOT issues with customers' individual websites.
Explain what's broken in the platform and how it impacts users building sites.
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

  const prompt = `Generate a concise feature request title (5-7 words) for Airo App Builder PLATFORM from these customer requests:

${sampleVerbiage.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

Focus on features customers want in the Airo App Builder platform itself (editor improvements, new AI capabilities, publishing features) - NOT features for their individual websites.
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

  const prompt = `Synthesize a feature request description (2-3 sentences) for Airo App Builder PLATFORM from these customer requests:

${sampleVerbiage.map((v, i) => `${i + 1}. "${v}"`).join('\n')}

Focus on what customers want added to the Airo App Builder platform itself (editor features, AI capabilities, publishing improvements) - NOT features for their individual websites.
Explain what platform feature is being requested and why it would help users.
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
