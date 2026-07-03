import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { GocodeClient } from '../../clients/gocode-client.js';
import type {
  CapturedSite,
  DiscoveredRoute,
  RouteCapture,
  ViewportCapture,
} from '../../clients/site-capture/types.js';
import type { Persona } from '../../personas/types.js';
import type { Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { EvalResult } from '../evaluator.js';
import { WebsiteQualityEvaluator } from '../website-quality.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [{ description: 'Page renders correctly', assertion: 'positive' }],
    evaluators: [],
    trials: 1,
    ...overrides,
  };
}

function makeRoute(overrides: Partial<DiscoveredRoute> = {}): DiscoveredRoute {
  return {
    path: '/',
    url: 'https://localhost:8443/',
    origin: 'homepage',
    status: 'ok',
    ...overrides,
  };
}

function makeViewportCapture(tilePaths: string[]): ViewportCapture {
  return {
    tiles: tilePaths.map((path, index) => ({ index, path, yOffset: index * 900 })),
  };
}

function makeTranscript(capturedSite?: CapturedSite): Transcript {
  return {
    scenarioName: 'test',
    trialIndex: 0,
    turns: [],
    snapshots: [],
    errors: [],
    captureErrors: [],
    capturedSite,
  };
}

let tmpRoot: string;

async function writeTile(name = 'tile-0.png'): Promise<string> {
  const path = join(tmpRoot, name);
  await writeFile(path, Buffer.from('fake-png'));
  return path;
}

describe('WebsiteQualityEvaluator', () => {
  let mockGocode: { complete: ReturnType<typeof vi.fn> };
  let evaluator: WebsiteQualityEvaluator;

  beforeEach(async () => {
    mockGocode = { complete: vi.fn() };
    evaluator = new WebsiteQualityEvaluator(
      mockGocode as unknown as GocodeClient,
    );
    tmpRoot = await mkdtemp(join(tmpdir(), 'website-quality-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  describe('incomplete — no captured site', () => {
    it('returns incomplete when transcript has no capturedSite', async () => {
      const result = await evaluator.evaluate(
        makeTranscript(),
        makeScenario(),
      );

      expect(result.evaluator).toBe('website-quality');
      expect(result.verdict).toBe('incomplete');
      expect(result.score).toBe(0);
      expect(mockGocode.complete).not.toHaveBeenCalled();
    });
  });

  describe('fail — all routes unreachable', () => {
    it('returns fail when all routes have non-ok status', async () => {
      const route = makeRoute({ status: 'serverError', httpStatus: 500 });
      const captured: CapturedSite = {
        previewUrl: 'https://localhost:8443',
        generatedAt: new Date().toISOString(),
        durationMs: 1000,
        outputDir: tmpRoot,
        routes: [route],
        perRoute: [],
        errors: [],
      };

      const result = await evaluator.evaluate(
        makeTranscript(captured),
        makeScenario(),
      );

      expect(result.verdict).toBe('fail');
      expect(result.score).toBe(0);
      expect(mockGocode.complete).not.toHaveBeenCalled();
    });
  });

  describe('incomplete — route discovery infrastructure failure', () => {
    it('returns incomplete when routes is empty and capture errors exist', async () => {
      const captured: CapturedSite = {
        previewUrl: 'https://localhost:8443',
        generatedAt: new Date().toISOString(),
        durationMs: 1000,
        outputDir: tmpRoot,
        routes: [],
        perRoute: [],
        errors: [
          'route discovery failed: Navigation timeout of 30000ms exceeded',
        ],
      };

      const result = await evaluator.evaluate(
        makeTranscript(captured),
        makeScenario(),
      );

      expect(result.verdict).toBe('incomplete');
      expect(result.score).toBe(0);
      expect(result.reason).toContain('Route discovery failed');
      expect(mockGocode.complete).not.toHaveBeenCalled();
    });
  });

  describe('pass — LLM returns ok for all viewports', () => {
    it('returns pass when LLM scores all viewports as ok', async () => {
      const tilePath = await writeTile();
      const route = makeRoute();
      const routeCapture: RouteCapture = {
        route,
        rendered: {
          title: 'Test Page',
          h1: 'Welcome',
          headingText: 'Welcome',
          bodyPreview: 'Hello world',
        },
        perViewport: {
          mobile: makeViewportCapture([tilePath]),
          laptop: makeViewportCapture([tilePath]),
        },
      };
      const captured: CapturedSite = {
        previewUrl: 'https://localhost:8443',
        generatedAt: new Date().toISOString(),
        durationMs: 1000,
        outputDir: tmpRoot,
        routes: [route],
        perRoute: [routeCapture],
        errors: [],
      };

      mockGocode.complete.mockResolvedValue(
        JSON.stringify({ verdict: 'ok', score: 1.0, summary: 'Looks good' }),
      );

      const result = await evaluator.evaluate(
        makeTranscript(captured),
        makeScenario(),
      );

      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1.0);
      expect(mockGocode.complete).toHaveBeenCalledTimes(2);
    });
  });

  describe('fail — mixed viewport scores below pass threshold', () => {
    it('returns fail when mobile is broken and laptop is ok (score 0.5 < 0.8)', async () => {
      const tilePath = await writeTile();
      const route = makeRoute();
      const routeCapture: RouteCapture = {
        route,
        rendered: {
          title: 'Test',
          h1: null,
          headingText: '',
          bodyPreview: 'content',
        },
        perViewport: {
          mobile: makeViewportCapture([tilePath]),
          laptop: makeViewportCapture([tilePath]),
        },
      };
      const captured: CapturedSite = {
        previewUrl: 'https://localhost:8443',
        generatedAt: new Date().toISOString(),
        durationMs: 500,
        outputDir: tmpRoot,
        routes: [route],
        perRoute: [routeCapture],
        errors: [],
      };

      let callIndex = 0;
      mockGocode.complete.mockImplementation(async function () {
        callIndex += 1;
        if (callIndex === 1) {
          return JSON.stringify({ verdict: 'fail', score: 0.1, summary: 'Layout broken on mobile' });
        }
        return JSON.stringify({ verdict: 'pass', score: 0.9, summary: 'Desktop fine' });
      });

      const result = await evaluator.evaluate(
        makeTranscript(captured),
        makeScenario(),
      );

      expect(result.verdict).toBe('fail');
      expect(result.score).toBe(0.5);
    });
  });

  describe('fail — LLM returns broken for all viewports', () => {
    it('returns fail when LLM scores all viewports as broken', async () => {
      const tilePath = await writeTile();
      const route = makeRoute();
      const routeCapture: RouteCapture = {
        route,
        rendered: {
          title: '',
          h1: null,
          headingText: '',
          bodyPreview: '',
        },
        perViewport: {
          mobile: makeViewportCapture([tilePath]),
          laptop: makeViewportCapture([tilePath]),
        },
      };
      const captured: CapturedSite = {
        previewUrl: 'https://localhost:8443',
        generatedAt: new Date().toISOString(),
        durationMs: 500,
        outputDir: tmpRoot,
        routes: [route],
        perRoute: [routeCapture],
        errors: [],
      };

      mockGocode.complete.mockResolvedValue(
        JSON.stringify({ verdict: 'broken', score: 0.0, summary: 'Page blank' }),
      );

      const result = await evaluator.evaluate(
        makeTranscript(captured),
        makeScenario(),
      );

      expect(result.verdict).toBe('fail');
      expect(result.score).toBe(0);
    });
  });

  describe('error handling', () => {
    it('scores broken when LLM call throws', async () => {
      const tilePath = await writeTile();
      const route = makeRoute();
      const routeCapture: RouteCapture = {
        route,
        perViewport: {
          mobile: makeViewportCapture([tilePath]),
          laptop: makeViewportCapture([tilePath]),
        },
      };
      const captured: CapturedSite = {
        previewUrl: 'https://localhost:8443',
        generatedAt: new Date().toISOString(),
        durationMs: 500,
        outputDir: tmpRoot,
        routes: [route],
        perRoute: [routeCapture],
        errors: [],
      };

      mockGocode.complete.mockRejectedValue(new Error('timeout'));

      const result = await evaluator.evaluate(
        makeTranscript(captured),
        makeScenario(),
      );

      expect(result.verdict).toBe('fail');
      expect(result.score).toBe(0);
      const details = result.details as { errors: string[] };
      expect(details.errors).toHaveLength(2);
      expect(details.errors[0]).toContain('timeout');
    });

    it('scores broken when LLM returns unparseable response', async () => {
      const tilePath = await writeTile();
      const route = makeRoute();
      const routeCapture: RouteCapture = {
        route,
        rendered: {
          title: 'Test',
          h1: 'Hi',
          headingText: 'Hi',
          bodyPreview: 'content',
        },
        perViewport: {
          mobile: makeViewportCapture([tilePath]),
          laptop: makeViewportCapture([tilePath]),
        },
      };
      const captured: CapturedSite = {
        previewUrl: 'https://localhost:8443',
        generatedAt: new Date().toISOString(),
        durationMs: 500,
        outputDir: tmpRoot,
        routes: [route],
        perRoute: [routeCapture],
        errors: [],
      };

      mockGocode.complete.mockResolvedValue('not valid json at all');

      const result = await evaluator.evaluate(
        makeTranscript(captured),
        makeScenario(),
      );

      expect(result.verdict).toBe('fail');
      expect(result.score).toBe(0);
    });
  });

  describe('no tiles captured', () => {
    it('scores broken for viewports with no tiles', async () => {
      const route = makeRoute();
      const routeCapture: RouteCapture = {
        route,
        perViewport: {
          mobile: { tiles: [] },
          laptop: { tiles: [] },
        },
      };
      const captured: CapturedSite = {
        previewUrl: 'https://localhost:8443',
        generatedAt: new Date().toISOString(),
        durationMs: 500,
        outputDir: tmpRoot,
        routes: [route],
        perRoute: [routeCapture],
        errors: [],
      };

      const result = await evaluator.evaluate(
        makeTranscript(captured),
        makeScenario(),
      );

      expect(result.verdict).toBe('fail');
      expect(result.score).toBe(0);
      expect(mockGocode.complete).not.toHaveBeenCalled();
    });
  });

  describe('multiple routes', () => {
    it('aggregates scores across routes', async () => {
      const tilePath = await writeTile();
      const route1 = makeRoute({ path: '/', url: 'https://localhost:8443/' });
      const route2 = makeRoute({ path: '/about', url: 'https://localhost:8443/about' });
      const makeCapture = (route: DiscoveredRoute): RouteCapture => ({
        route,
        rendered: { title: 'T', h1: 'H', headingText: 'H', bodyPreview: 'B' },
        perViewport: {
          mobile: makeViewportCapture([tilePath]),
          laptop: makeViewportCapture([tilePath]),
        },
      });
      const captured: CapturedSite = {
        previewUrl: 'https://localhost:8443',
        generatedAt: new Date().toISOString(),
        durationMs: 1000,
        outputDir: tmpRoot,
        routes: [route1, route2],
        perRoute: [makeCapture(route1), makeCapture(route2)],
        errors: [],
      };

      mockGocode.complete.mockResolvedValue(
        JSON.stringify({ verdict: 'ok', score: 0.8, summary: 'Fine' }),
      );

      const result = await evaluator.evaluate(
        makeTranscript(captured),
        makeScenario(),
      );

      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(0.8);
      expect(mockGocode.complete).toHaveBeenCalledTimes(4);
    });
  });

  describe('overall verdict boundary at 0.8', () => {
    async function evaluateAtScore(score: number): Promise<EvalResult> {
      const tilePath: string = await writeTile();
      const route: DiscoveredRoute = makeRoute();
      const routeCapture: RouteCapture = {
        route,
        rendered: { title: 'T', h1: 'H', headingText: 'H', bodyPreview: 'B' },
        perViewport: {
          mobile: makeViewportCapture([tilePath]),
          laptop: makeViewportCapture([tilePath]),
        },
      };
      const captured: CapturedSite = {
        previewUrl: 'https://localhost:8443',
        generatedAt: new Date().toISOString(),
        durationMs: 1000,
        outputDir: tmpRoot,
        routes: [route],
        perRoute: [routeCapture],
        errors: [],
      };

      mockGocode.complete.mockResolvedValue(
        JSON.stringify({ verdict: 'pass', score, summary: 'Fine' }),
      );

      return evaluator.evaluate(makeTranscript(captured), makeScenario());
    }

    it('returns pass when overall score is exactly 0.8', async () => {
      const result: EvalResult = await evaluateAtScore(0.8);

      expect(result.score).toBe(0.8);
      expect(result.verdict).toBe('pass');
    });

    it('returns fail when overall score is just below 0.8', async () => {
      const result: EvalResult = await evaluateAtScore(0.7);

      expect(result.score).toBe(0.7);
      expect(result.verdict).toBe('fail');
    });
  });
});
