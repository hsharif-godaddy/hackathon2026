import type { IGocodeClient, Message } from '../clients/gocode-client.js';
import type {
  CapturedSite,
  DiscoveredRoute,
  RenderedSignals,
  Tile,
  ViewportName,
} from '../clients/site-capture/types.js';
import { VIEWPORT_ORDER, VIEWPORTS } from '../clients/site-capture/types.js';
import type { Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import { toDataUrl } from '../util/image.js';
import { runCapped } from '../runner/suite-runner.js';
import type { EvalResult, Evaluator } from './evaluator.js';

type RouteVerdict = 'pass' | 'fail';

interface ViewportDetail {
  viewport: ViewportName;
  width: number;
  height: number;
  verdict: RouteVerdict;
  score: number;
  summary: string;
  tileCount: number;
  error?: string;
}

interface RouteDetail {
  path: string;
  url: string;
  status: string;
  httpStatus?: number;
  origin: string;
  reachable: boolean;
  rendered?: RenderedSignals;
  viewports: ViewportDetail[];
  aggregatedScore: number;
}

const VERDICT_SCORE: Record<RouteVerdict, number> = {
  pass: 1,
  fail: 0,
};

const SYSTEM_PROMPT = `You are a QA reviewer inspecting screenshots of a live website page at a specific viewport size.

You will receive:
- ROUTE: the path being inspected.
- VIEWPORT: viewport name and dimensions.
- RENDERED SIGNALS: extracted page metadata (title, h1, headings, body preview).
- SCENARIO GOALS: what the page is supposed to achieve.
- TILES: screenshot images of the page, in top-to-bottom scroll order.

Judge the visual quality of this page at this viewport. Consider:
- Is the page rendered and not blank/broken?
- Does the layout work at this viewport size (no overlapping text, cut-off content)?
- Is there meaningful, coherent content visible?
- Are there obvious visual defects (broken images, placeholder text, massive whitespace)?
- Does the page plausibly satisfy the scenario goals?

Return JSON only, no prose:
{
  "verdict": "pass|fail",
  "score": 0.0-1.0,
  "summary": "one-line explanation (<=140 chars)"
}

Verdict guide:
- "pass": page looks complete and well-rendered at this viewport (may have minor issues).
- "fail": page is blank, broken, or has significant problems that prevent goal completion.`;

function renderedBlock(rendered: RenderedSignals | undefined): string {
  if (!rendered) return '(no rendered signals captured)';
  return [
    rendered.title ? `Title: ${rendered.title}` : null,
    rendered.h1 ? `H1: ${rendered.h1}` : null,
    rendered.headingText ? `Headings: ${rendered.headingText}` : null,
    rendered.bodyPreview
      ? `Body: ${rendered.bodyPreview.slice(0, 2000)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function goalsBlock(scenario: Scenario): string {
  return scenario.goals
    .map((g) => `- ${g.description}`)
    .join('\n');
}

async function buildUserContent(
  route: DiscoveredRoute,
  viewportName: ViewportName,
  rendered: RenderedSignals | undefined,
  tiles: Tile[],
  scenario: Scenario,
): Promise<Exclude<Message['content'], string>> {
  const vp = VIEWPORTS[viewportName];
  const parts: Exclude<Message['content'], string> = [
    {
      type: 'text',
      text: [
        `ROUTE: ${route.path}`,
        `VIEWPORT: ${vp.name} (${vp.width}x${vp.height})`,
        '',
        'RENDERED SIGNALS:',
        renderedBlock(rendered),
        '',
        'SCENARIO GOALS:',
        goalsBlock(scenario),
        '',
        `TILES (${tiles.length} screenshot${tiles.length === 1 ? '' : 's'}, top to bottom):`,
      ].join('\n'),
    },
  ];
  for (const tile of tiles) {
    try {
      parts.push({
        type: 'image_url',
        image_url: { url: await toDataUrl(tile.path), detail: 'low' },
      });
    } catch (err) {
      parts.push({
        type: 'text',
        text: `[tile failed to encode: ${err instanceof Error ? err.message : 'unknown'}]`,
      });
    }
  }
  return parts;
}

function stripCodeFences(s: string): string {
  const fenced = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return s.trim();
}

interface ParsedViewport {
  verdict: RouteVerdict;
  score: number;
  summary: string;
}

function mapToRouteVerdict(raw: string | undefined): RouteVerdict {
  if (raw === 'pass' || raw === 'ok') return 'pass';
  return 'fail';
}

function parseViewportResponse(
  raw: string
): ParsedViewport {
  const fallback: ParsedViewport = {
    verdict: 'fail',
    score: 0,
    summary: 'Failed to parse LLM response',
  };

  const cleaned = stripCodeFences(raw);
  if (!cleaned) return fallback;

  let parsed: { verdict?: string; score?: number; summary?: string };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      ...fallback,
      summary: `Failed to parse LLM response: ${cleaned}`,
    };
  }

  const verdict: RouteVerdict = mapToRouteVerdict(parsed.verdict);

  const score =
    typeof parsed.score === 'number' && !isNaN(parsed.score)
      ? Math.max(0, Math.min(1, parsed.score))
      : VERDICT_SCORE[verdict];

  return {
    verdict,
    score,
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : `${verdict} (score ${score.toFixed(2)})`,
  };
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function toOverallVerdict(
  score: number,
): EvalResult['verdict'] {
  return score >= 0.8 ? 'pass' : 'fail';
}

function buildRouteDetailForUnreachable(route: DiscoveredRoute): RouteDetail {
  const vp = VIEWPORT_ORDER.map((vpName): ViewportDetail => ({
    viewport: vpName,
    width: VIEWPORTS[vpName].width,
    height: VIEWPORTS[vpName].height,
    verdict: 'fail',
    score: 0,
    summary: `Route ${route.status} (HTTP ${route.httpStatus ?? '?'})`,
    tileCount: 0,
  }));
  return {
    path: route.path,
    url: route.url,
    status: route.status,
    httpStatus: route.httpStatus,
    origin: route.origin,
    reachable: false,
    viewports: vp,
    aggregatedScore: 0,
  };
}

function buildCapturedSiteSummary(captured: CapturedSite) {
  return {
    previewUrl: captured.previewUrl,
    generatedAt: captured.generatedAt,
    captureDurationMs: captured.durationMs,
    totalRoutes: captured.routes.length,
    captureErrors: captured.errors,
  };
}

export class WebsiteQualityEvaluator implements Evaluator {
  readonly name = 'website-quality';
  readonly comparisonMode = 'passRate' as const;
  readonly deterministic = false;

  constructor(private readonly gocode: IGocodeClient) {}

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
  ): Promise<EvalResult> {
    const captured = transcript.capturedSite;
    if (!captured) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason: 'No captured site data on transcript.',
        details: {
          capture: null,
          scoreByViewport: { mobile: 0, laptop: 0 },
          overallScore: 0,
          routeCount: 0,
          reachableCount: 0,
          unreachableCount: 0,
          perRoute: [],
          errors: [],
        },
      };
    }

    const reachable = captured.perRoute.filter(
      (r) => r.route.status === 'ok' || r.route.status === 'redirect',
    );
    const unreachableRoutes = captured.routes.filter(
      (r) => r.status !== 'ok' && r.status !== 'redirect',
    );

    if (!reachable.length && captured.errors.length > 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason: `Route discovery failed: ${captured.errors[0]}`,
        details: {
          capture: buildCapturedSiteSummary(captured),
          scoreByViewport: { mobile: 0, laptop: 0 },
          overallScore: 0,
          routeCount: 0,
          reachableCount: 0,
          unreachableCount: 0,
          perRoute: [],
          errors: captured.errors,
        },
      };
    }

    if (!reachable.length) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'fail',
        reason: `All ${captured.routes.length} routes unreachable.`,
        details: {
          capture: buildCapturedSiteSummary(captured),
          scoreByViewport: { mobile: 0, laptop: 0 },
          overallScore: 0,
          routeCount: captured.routes.length,
          reachableCount: 0,
          unreachableCount: unreachableRoutes.length,
          perRoute: captured.routes.map(buildRouteDetailForUnreachable),
          errors: [],
        },
      };
    }

    const errors: string[] = [];

    const pairs = reachable.flatMap((routeCapture) =>
      VIEWPORT_ORDER.map((vpName) => ({ routeCapture, vpName })),
    );

    const LLM_CONCURRENCY = 6;

    const viewportResults: ViewportDetail[] = await runCapped(
      pairs.length,
      LLM_CONCURRENCY,
      async (i: number): Promise<ViewportDetail> => {
        const { routeCapture, vpName } = pairs[i];
        const vp = VIEWPORTS[vpName];
        const tiles = routeCapture.perViewport[vpName]?.tiles ?? [];
        if (!tiles.length) {
          return {
            viewport: vpName,
            width: vp.width,
            height: vp.height,
            verdict: 'fail',
            score: 0,
            summary: 'No tiles captured.',
            tileCount: 0,
          };
        }

        let content: Awaited<ReturnType<typeof buildUserContent>>;
        try {
          content = await buildUserContent(
            routeCapture.route,
            vpName,
            routeCapture.rendered,
            tiles,
            scenario,
          );
        } catch (err) {
          const msg =
            `${routeCapture.route.path} @ ${vpName}: tile read failed: ` +
            (err instanceof Error ? err.message : String(err));
          errors.push(msg);
          return {
            viewport: vpName,
            width: vp.width,
            height: vp.height,
            verdict: 'fail',
            score: 0,
            summary: 'Tile read failed.',
            tileCount: tiles.length,
            error: msg,
          };
        }

        try {
          const response = await this.gocode.complete(
            [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content },
            ],
            { signal: AbortSignal.timeout(60_000) },
          );
          const parsed = parseViewportResponse(response);
          return {
            viewport: vpName,
            width: vp.width,
            height: vp.height,
            verdict: parsed.verdict,
            score: parsed.score,
            summary: parsed.summary,
            tileCount: tiles.length,
          };
        } catch (err) {
          const msg =
            `${routeCapture.route.path} @ ${vpName}: ` +
            (err instanceof Error ? err.message : String(err));
          errors.push(msg);
          return {
            viewport: vpName,
            width: vp.width,
            height: vp.height,
            verdict: 'fail',
            score: 0,
            summary: 'LLM call failed.',
            tileCount: tiles.length,
            error: msg,
          };
        }
      },
    );

    const viewportsPerRoute = VIEWPORT_ORDER.length;
    const routeDetails: RouteDetail[] = reachable.map(
      (routeCapture, routeIdx): RouteDetail => {
        const viewportDetails = viewportResults.slice(
          routeIdx * viewportsPerRoute,
          (routeIdx + 1) * viewportsPerRoute,
        );
        return {
          path: routeCapture.route.path,
          url: routeCapture.route.url,
          status: routeCapture.route.status,
          httpStatus: routeCapture.route.httpStatus,
          origin: routeCapture.route.origin,
          reachable: true,
          rendered: routeCapture.rendered,
          viewports: viewportDetails,
          aggregatedScore: average(viewportDetails.map((v) => v.score)),
        };
      },
    );

    for (const route of unreachableRoutes) {
      routeDetails.push(buildRouteDetailForUnreachable(route));
    }

    const scoreByViewport: Record<ViewportName, number> = {
      mobile: average(
        routeDetails
          .filter((r) => r.reachable)
          .flatMap((r) =>
            r.viewports
              .filter((v) => v.viewport === 'mobile')
              .map((v) => v.score),
          ),
      ),
      laptop: average(
        routeDetails
          .filter((r) => r.reachable)
          .flatMap((r) =>
            r.viewports
              .filter((v) => v.viewport === 'laptop')
              .map((v) => v.score),
          ),
      ),
    };
    const overallScore = average([
      scoreByViewport.mobile,
      scoreByViewport.laptop,
    ]);

    return {
      evaluator: this.name,
      score: overallScore,
      verdict: toOverallVerdict(overallScore),
      reason: this.formatReason(
        overallScore,
        scoreByViewport,
        reachable.length,
        unreachableRoutes.length,
      ),
      details: {
        capture: buildCapturedSiteSummary(captured),
        scoreByViewport,
        overallScore,
        routeCount: captured.routes.length,
        reachableCount: reachable.length,
        unreachableCount: unreachableRoutes.length,
        perRoute: routeDetails,
        errors,
      },
    };
  }

  private formatReason(
    overall: number,
    byViewport: Record<ViewportName, number>,
    reachableCount: number,
    unreachableCount: number,
  ): string {
    return (
      `score=${overall.toFixed(2)} ` +
      `(mobile=${byViewport.mobile.toFixed(2)}, ` +
      `laptop=${byViewport.laptop.toFixed(2)}) ` +
      `routes=${reachableCount} unreachable=${unreachableCount}`
    );
  }
}
