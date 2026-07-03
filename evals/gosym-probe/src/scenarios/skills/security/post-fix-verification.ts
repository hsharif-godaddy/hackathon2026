import { createSecurityScenario }
  from './create-security-scenario.js';
import { mockAuthToken } from '../../../clients/aab-client.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

// Mirrors the message the Security tab sends when "Ask Airo to Fix" is clicked.
const SECURITY_FIX_MESSAGE = `Fix my selected Security Vulnerabilities.

Please fix the following issues found in the security scan:

1. [high] src/app/api/route.ts line 42 - eval() with user-controlled input (SAST): Replace eval() with a safe alternative

After fixing these issues, verify that they have been resolved.`;

// Realistic Next.js App Router route with eval() on line 42 — seeded as the SAST vulnerability.
const SEEDED_FILE_PATH = 'src/app/api/route.ts';
const SEEDED_FILE_CONTENT = `import { type NextRequest, NextResponse } from 'next/server';

// Debug endpoint — evaluates arbitrary JS server-side.
// Intended for development only; must not be deployed to production.

interface EvalRequest {
  expression: string;
  context?: Record<string, unknown>;
}

interface EvalResponse {
  result?: unknown;
  error?: string;
  durationMs?: number;
}

function buildContextScript(ctx: Record<string, unknown> | undefined): string {
  if (!ctx) return '';
  return (
    Object.entries(ctx)
      .map(([k, v]) => \`const \${k} = \${JSON.stringify(v)};\`)
      .join('\\n') + '\\n'
  );
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<EvalResponse>> {
  const start = performance.now();
  const body = (await request.json()) as EvalRequest;

  if (!body.expression || typeof body.expression !== 'string') {
    return NextResponse.json(
      { error: 'expression must be a non-empty string' },
      { status: 400 },
    );
  }

  try {
    const script = buildContextScript(body.context) + body.expression;
    // eslint-disable-next-line no-eval
    const result = eval(script); // SAST: eval() with user-controlled input
    return NextResponse.json({ result, durationMs: performance.now() - start });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
`;

export function postFixVerificationScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  agentsBaseUrl?: string,
): Scenario {
  return createSecurityScenario(
    {
      name: 'security-post-fix-verification',
      staticFirstMessage: SECURITY_FIX_MESSAGE,
      goals: [
        {
          description: 'Agent addresses the reported security vulnerabilities (dependency upgrades or code fixes)',
          assertion: 'positive',
        },
        {
          description: 'Agent calls security__runSecurityVerification as its final step after completing fix work',
          assertion: 'positive',
        },
        {
          description: 'Agent reports how many issues remain and how many were resolved based on the scan result',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT skip the verification step and simply claim the issues are fixed without running the scan',
          assertion: 'negative',
        },
      ],
      expectedTools: [
        { tool: 'security__runSecurityVerification', called: true },
      ],
      trials: 3,
      afterProvision: agentsBaseUrl
        ? async (appId: string): Promise<void> => {
            const token = mockAuthToken({ siteId: appId });
            const res = await fetch(`${agentsBaseUrl}/apps/${appId}/files/write`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ path: SEEDED_FILE_PATH, content: SEEDED_FILE_CONTENT }),
              signal: AbortSignal.timeout(15_000),
            });
            if (!res.ok) {
              throw new Error(
                `[post-fix-verification] Failed to seed vulnerability file: HTTP ${res.status}`,
              );
            }
          }
        : undefined,
    },
    gocode,
    ctrlPlane,
  );
}
