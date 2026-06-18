import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ── Types ──────────────────────────────────────────────────────────────────

export type IntentCategory =
  | 'Sales'
  | 'Refund'
  | 'Publishing'
  | 'DNS/Domain'
  | 'Email/Forms'
  | 'SEO'
  | 'Account'
  | 'Technical'
  | 'Other';

export interface ClassificationResult {
  fileId: string;
  fileName: string;
  intent: IntentCategory;
  subIntent: string;
  summary: string;
  rootCause: string | null;
  sentiment: 'positive' | 'neutral' | 'negative';
  resolved: boolean;
  appId: string | null;
  ciecTicket: string | null;
  classifiedAt: string;
}

interface ClassifyRequest {
  fileId: string;
  fileName: string;
  transcriptText?: string;
  downloadUrl?: string;
}

// ── Anthropic classification ───────────────────────────────────────────────

const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
const ANTHROPIC_KEY = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? '';
const MODEL = 'claude-opus-4-6';

const CLASSIFY_SYSTEM = `You are an expert at categorizing L1 customer support transcripts for GoDaddy's Airo App Builder product.

Your job: read a support transcript and extract structured classification data.

Intent categories (pick the SINGLE best fit):
- Sales: pricing, plan comparisons, upgrade inquiries, new purchase questions
- Refund: refund requests, billing disputes, cancellations, chargeback-related
- Publishing: issues publishing the website, domain connection during publish
- DNS/Domain: DNS records, custom domains, CNAME/A records, domain propagation
- Email/Forms: email setup, form submissions, contact forms, email forwarding
- SEO: search engine visibility, sitemap, meta tags, Google indexing
- Account: account access, login, password, SSO, account management
- Technical: app errors, builder crashes, AI agent failures, performance issues
- Other: anything that doesn't fit the above

Respond ONLY with a valid JSON object matching this schema — no markdown, no explanation:
{
  "intent": "<one of the categories above>",
  "subIntent": "<specific issue in 5 words or less>",
  "summary": "<one sentence summary of the customer issue>",
  "rootCause": "<the specific root cause if identifiable, otherwise null>",
  "sentiment": "<positive|neutral|negative>",
  "resolved": <true|false>,
  "appId": "<app ID string if mentioned in transcript, otherwise null>",
  "ciecTicket": "<CIEC ticket key if mentioned e.g. CIEC-1234, otherwise null>"
}`;

async function classifyWithClaude(transcriptText: string): Promise<ClassificationResult | null> {
  const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system: CLASSIFY_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Please classify this support transcript:\n\n${transcriptText.slice(0, 12000)}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic classify ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = await res.json() as { content: Array<{ type: string; text?: string }> };
  const text = body.content.find(function isText(c) { return c.type === 'text'; })?.text ?? '';

  try {
    return JSON.parse(text) as ClassificationResult;
  } catch {
    throw new Error(`Invalid JSON from classifier: ${text.slice(0, 100)}`);
  }
}

async function fetchTranscriptText(downloadUrl: string): Promise<string> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Download ${res.status}: ${downloadUrl.slice(0, 80)}`);
  return res.text();
}

// ── Route ──────────────────────────────────────────────────────────────────

export const POST = withAuth(async function classifyTranscript(request: NextRequest) {
  if (!ANTHROPIC_KEY) {
    return NextResponse.json(
      { error: 'Anthropic API key not configured. Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY.' },
      { status: 503 }
    );
  }

  const body = (await request.json()) as ClassifyRequest;
  const { fileId, fileName, transcriptText, downloadUrl } = body;

  if (!fileId || !fileName) {
    return NextResponse.json({ error: 'fileId and fileName are required' }, { status: 400 });
  }

  if (!transcriptText && !downloadUrl) {
    return NextResponse.json(
      { error: 'Provide either transcriptText or downloadUrl' },
      { status: 400 }
    );
  }

  try {
    let text = transcriptText ?? '';
    if (!text && downloadUrl) {
      text = await fetchTranscriptText(downloadUrl);
    }

    if (!text.trim()) {
      return NextResponse.json({ error: 'Transcript is empty' }, { status: 422 });
    }

    const classification = await classifyWithClaude(text);
    if (!classification) {
      return NextResponse.json({ error: 'Classification returned empty result' }, { status: 502 });
    }

    const result: ClassificationResult = {
      ...classification,
      fileId,
      fileName,
      classifiedAt: new Date().toISOString(),
    };

    logger.info('supportplane.classify.success', {
      fileId,
      intent: result.intent,
      sentiment: result.sentiment,
    });

    return NextResponse.json(result);
  } catch (err) {
    logger.error('supportplane.classify.error', { fileId, fileName }, { error: err as Error });
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 }
    );
  }
});
