import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

import {
  discoverSuccessfulSimulationIds,
  getScenario,
  getSimulation,
  listEvaluationsForSimulation,
  resolveScenarioIdsForKeys,
} from './dynamo.js';
import { applyAuthentication, type BrowserAuthConfig } from './auth.js';
import { loadEnv } from './env.js';
import { fetchTrace, listObservationsAll, listTracesAll } from './langfuse.js';
import { createLogger } from './logger.js';
import { dismissCookieConsent } from './site-capture/cookie-dismiss.js';
import { captureSite } from './site-capture/capture.js';
import { wait } from './site-capture/ready.js';
import { exists, loadSuiteScenarioKeys, readArg, requiredArg, writeJson } from './utils.js';

interface ManifestSimulation {
  simulationId: string;
  previewUrl?: string;
  langfuse?: { traceId: string };
}

interface Manifest {
  simulations: ManifestSimulation[];
}


async function loadManifest(manifestPath: string): Promise<Manifest> {
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<Manifest> | null;
  if (!parsed || !Array.isArray(parsed.simulations)) {
    throw new Error('Invalid manifest: expected {"simulations": [...]}');
  }
  for (let i = 0; i < parsed.simulations.length; i++) {
    const el = parsed.simulations[i] as unknown as Record<string, unknown>;
    if (typeof el?.simulationId !== 'string') {
      throw new Error(
        `Invalid manifest: simulations[${i}] is missing a valid "simulationId" string property`,
      );
    }
  }
  return { simulations: parsed.simulations };
}

function readPreviewUrl(simulation: Record<string, unknown> | null): string | null {
  if (!simulation) return null;
  const value = simulation['previewUrl'];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readTraceId(simulation: Record<string, unknown> | null): string | null {
  if (!simulation) return null;
  const direct =
    simulation['traceId'] ??
    simulation['langfuseTraceId'] ??
    simulation['langfuse_trace_id'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const conversation = simulation['conversationHistory'];
  if (conversation && typeof conversation === 'object') {
    const maybe = (conversation as Record<string, unknown>)['traceId'];
    if (typeof maybe === 'string' && maybe.trim()) return maybe.trim();
  }
  return null;
}

function readConversationId(
  simulation: Record<string, unknown> | null,
  evaluations: Array<Record<string, unknown>>,
): string | null {
  const fromSimulation = simulation?.['conversationId'];
  if (typeof fromSimulation === 'string' && fromSimulation.trim()) return fromSimulation.trim();
  for (const row of evaluations) {
    const cid = row['conversationId'];
    if (typeof cid === 'string' && cid.trim()) return cid.trim();
  }
  return null;
}

function firstPerEvaluator(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const bestById = new Map<string, { row: Record<string, unknown>; createdAtMs: number | null }>();

  for (const row of rows) {
    const evaluatorId = row['evaluatorId'];
    if (typeof evaluatorId !== 'string' || !evaluatorId.trim()) continue;

    const createdAt = row['createdAt'];
    const createdAtMs =
      typeof createdAt === 'string' && createdAt.trim()
        ? Number.isFinite(Date.parse(createdAt)) ? Date.parse(createdAt) : null
        : null;

    const existing = bestById.get(evaluatorId);
    if (!existing) {
      bestById.set(evaluatorId, { row, createdAtMs });
      continue;
    }

    if (existing.createdAtMs === null) {
      if (createdAtMs !== null) bestById.set(evaluatorId, { row, createdAtMs });
      continue;
    }
    if (createdAtMs === null) continue;
    if (createdAtMs < existing.createdAtMs) bestById.set(evaluatorId, { row, createdAtMs });
  }

  return Array.from(bestById.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v.row);
}

async function resolveTraceId(params: {
  traceId: string | null;
  conversationId: string | null;
  langfuse: Parameters<typeof fetchTrace>[0];
}): Promise<{ traceId: string; resolution: 'explicit' | 'session_lookup' }> {
  if (params.traceId) return { traceId: params.traceId, resolution: 'explicit' };
  if (!params.conversationId) {
    throw new Error('Missing both traceId and conversationId; cannot resolve Langfuse trace.');
  }
  const traces = await listTracesAll(params.langfuse, params.conversationId);
  const trace = traces[0];
  if (!trace?.id) {
    throw new Error(
      `No Langfuse traces found for conversationId='${params.conversationId}'.`,
    );
  }
  return { traceId: trace.id, resolution: 'session_lookup' };
}

function readScenarioId(simulation: Record<string, unknown> | null): string | null {
  const v = simulation?.['scenarioId'];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function readBrowserAuth(scenario: Record<string, unknown> | null): BrowserAuthConfig | null {
  if (!scenario) return null;
  const browserConfig = scenario['browserConfig'];
  if (!browserConfig || typeof browserConfig !== 'object') return null;
  const browserAuth = (browserConfig as Record<string, unknown>)['browserAuth'];
  if (!browserAuth || typeof browserAuth !== 'object') return null;
  const cfg = browserAuth as Record<string, unknown>;
  const type = cfg['type'];
  if (type !== 'none' && type !== 'form' && type !== 'cookie' && type !== 'sso') return null;
  return {
    type,
    credentialsSecretId: typeof cfg['credentialsSecretId'] === 'string' ? cfg['credentialsSecretId'] : undefined,
    loginUrl: typeof cfg['loginUrl'] === 'string' ? cfg['loginUrl'] : undefined,
    usernameSelector: typeof cfg['usernameSelector'] === 'string' ? cfg['usernameSelector'] : undefined,
    passwordSelector: typeof cfg['passwordSelector'] === 'string' ? cfg['passwordSelector'] : undefined,
    submitSelector: typeof cfg['submitSelector'] === 'string' ? cfg['submitSelector'] : undefined,
    cookies: Array.isArray(cfg['cookies']) ? (cfg['cookies'] as Array<Record<string, unknown>>) : undefined,
  };
}

/**
 * Probe whether a preview is still capturable. A live preview responds 2xx, or 3xx that resolves
 * to 2xx (redirect into the Airo Builder develop workspace). A deprovisioned site returns 404/410.
 * Used to skip dead previews so they don't leave empty simulation folders.
 */
async function isPreviewLive(url: string): Promise<{ live: boolean; status: number | null }> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    return { live: res.status >= 200 && res.status < 400, status: res.status };
  } catch {
    return { live: false, status: null };
  }
}

async function runOne(
  sim: ManifestSimulation,
  datasetDir: string,
  options: { resume: boolean },
): Promise<void> {
  const env = loadEnv();
  const log = createLogger({ level: env.logging.level, scope: sim.simulationId });
  const simDir = path.join(datasetDir, sim.simulationId);
  const donePath = path.join(simDir, 'dataset.done');

  if (options.resume && await exists(donePath)) {
    log.info('dataset.skip.resume', { reason: 'dataset.done exists' });
    return;
  }

  log.info('dataset.start');

  // Resolve the preview URL and verify the site is still live BEFORE creating any folder, so a
  // deprovisioned preview (404) is skipped entirely — no empty simulation folder is left behind.
  log.info('dynamodb.fetch.start', {
    region: env.dynamodb.region,
    simulationsTable: env.dynamodb.simulations.table,
    evaluationsTable: env.dynamodb.evaluations.table,
  });
  const simulationRow = await getSimulation(env.dynamodb, sim.simulationId);

  const previewUrl =
    (typeof sim.previewUrl === 'string' && sim.previewUrl.trim() ? sim.previewUrl.trim() : null) ??
    readPreviewUrl(simulationRow);
  if (!previewUrl) {
    throw new Error(
      `Missing previewUrl for simulationId='${sim.simulationId}'. Provide it in the manifest or ensure it exists in synthia-simulations.`,
    );
  }

  const liveness = await isPreviewLive(previewUrl);
  if (!liveness.live) {
    log.info('dataset.skip.preview_dead', { previewUrl, status: liveness.status });
    return; // no folder created for dead previews
  }
  log.info('preview.liveness', { previewUrl, status: liveness.status });

  await mkdir(simDir, { recursive: true });
  await mkdir(path.join(simDir, 'langfuse'), { recursive: true });
  await mkdir(path.join(simDir, 'dynamodb'), { recursive: true });
  await mkdir(path.join(simDir, 'site'), { recursive: true });
  await rm(path.join(simDir, 'site', 'tiles'), { recursive: true, force: true }).catch(() => {});
  await rm(path.join(simDir, 'site', 'capture.json'), { force: true }).catch(() => {});

  const evaluationRows = await listEvaluationsForSimulation(env.dynamodb, sim.simulationId);
  await writeJson(path.join(simDir, 'dynamodb', 'synthia-simulations.json'), simulationRow);
  await writeJson(path.join(simDir, 'dynamodb', 'synthia-evaluations.json'), evaluationRows);
  await writeJson(
    path.join(simDir, 'dynamodb', 'synthia-evaluations.first-per-evaluator.json'),
    firstPerEvaluator(evaluationRows),
  );
  log.info('dynamodb.fetch.done', {
    hasSimulationRow: Boolean(simulationRow),
    evaluationsCount: evaluationRows.length,
  });

  const scenarioId = readScenarioId(simulationRow);
  if (!scenarioId) {
    throw new Error(`Simulation is missing scenarioId: simulationId='${sim.simulationId}'`);
  }
  log.info('dynamodb.scenario.fetch.start', { scenarioId, scenariosTable: env.dynamodb.scenarios.table });
  const scenarioRow = await getScenario(env.dynamodb, scenarioId);
  await writeJson(path.join(simDir, 'dynamodb', 'synthia-scenario.json'), scenarioRow);
  log.info('dynamodb.scenario.fetch.done', { hasScenarioRow: Boolean(scenarioRow) });

  const conversationId = readConversationId(simulationRow, evaluationRows);
  const resolved = await resolveTraceId({
    traceId:
      (typeof sim.langfuse?.traceId === 'string' && sim.langfuse.traceId.trim()
        ? sim.langfuse.traceId.trim()
        : null) ?? readTraceId(simulationRow),
    conversationId,
    langfuse: env.langfuse,
  });

  await writeJson(path.join(simDir, 'meta.json'), {
    simulationId: sim.simulationId,
    previewUrl,
    langfuse: {
      traceId: resolved.traceId,
      conversationId,
      traceIdResolution: resolved.resolution,
    },
    generatedAt: new Date().toISOString(),
  });

  log.info('langfuse.fetch.start', {
    traceId: resolved.traceId,
    conversationId,
    resolution: resolved.resolution,
  });
  const trace = await fetchTrace(env.langfuse, resolved.traceId);
  const observations = await listObservationsAll(env.langfuse, resolved.traceId);
  await writeJson(path.join(simDir, 'langfuse', 'trace.json'), trace);
  await writeJson(path.join(simDir, 'langfuse', 'observations.json'), observations);
  log.info('langfuse.fetch.done', { observationsCount: observations.length });

  log.info('playwright.capture.start', { previewUrl, maxRoutes: env.capture.maxRoutes });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: env.capture.ignoreHttpsErrors });
    const homepagePage = await context.newPage();
    try {
      const auth = readBrowserAuth(scenarioRow);
      log.info('auth.config', {
        type: auth?.type ?? 'none',
        loginUrl: auth?.loginUrl ?? null,
        credentialsSecretId: auth?.credentialsSecretId ?? null,
      });
      await applyAuthentication({
        page: homepagePage,
        auth,
        region: env.dynamodb.region,
        startUrl: previewUrl,
        log,
      });

      const nav = await homepagePage.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      const status = nav?.status() ?? null;
      if (typeof status === 'number' && status >= 400) {
        log.info('playwright.capture.skip', { previewUrl, status, reason: 'navigation_failed' });
        await writeJson(path.join(simDir, 'site', 'capture.json'), {
          previewUrl,
          generatedAt: new Date().toISOString(),
          maxRoutes: env.capture.maxRoutes,
          routes: [{ path: '/', url: new URL(previewUrl).origin }],
          perRoute: [
            {
              path: '/',
              url: previewUrl,
              perViewport: {
                mobile: { tiles: [], error: `navigation returned HTTP ${status}` },
                laptop: { tiles: [], error: `navigation returned HTTP ${status}` },
              },
            },
          ],
          errors: [`previewUrl returned HTTP ${status}`],
        });
        return;
      }
      await wait(homepagePage);
      await dismissCookieConsent(homepagePage);

      const captured = await captureSite({
        previewUrl,
        context,
        homepagePage,
        outputDir: path.join(simDir, 'site'),
        maxRoutes: env.capture.maxRoutes,
      });
      log.info('playwright.capture.done', {
        routesDiscovered: captured.routes.length,
        routesCaptured: captured.perRoute.length,
        errors: captured.errors.length,
      });
    } finally {
      await homepagePage.close().catch(() => {});
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }

  log.info('dataset.done');
  await writeFile(donePath, `${new Date().toISOString()}\n`);
}

async function main(): Promise<void> {
  const datasetDir = readArg('--dataset-dir') ?? path.resolve('dataset');
  const resume = process.argv.includes('--resume');
  const discoverOnly = process.argv.includes('--discover-only');

  await mkdir(datasetDir, { recursive: true });

  const manifestPath = readArg('--manifest');
  if (manifestPath) {
    const manifest = await loadManifest(manifestPath);
    for (const sim of manifest.simulations) {
      await runOne(sim, datasetDir, { resume });
    }
    return;
  }

  const env = loadEnv();
  const log = createLogger({ level: env.logging.level, scope: 'discover' });
  const limitRaw = readArg('--discover-limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 0;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('Missing required argument: --manifest or --discover-limit <n>');
  }

  const statuses = (readArg('--discover-statuses') ?? 'completed,maxTurns')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const sinceDaysRaw = readArg('--discover-since-days') ?? '5';
  const sinceDays = Number.parseInt(sinceDaysRaw, 10);
  if (!Number.isFinite(sinceDays) || sinceDays <= 0) {
    throw new Error(`Invalid --discover-since-days: "${sinceDaysRaw}"`);
  }
  const sinceIso = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const suitePath = path.resolve(process.cwd(), '../goarena/simulation_eval_suite.yaml');
  const suiteScenarioKeys = await loadSuiteScenarioKeys(suitePath);
  const suiteScenarioIds = await resolveScenarioIdsForKeys(env.dynamodb, suiteScenarioKeys);

  log.info('discover.start', {
    limit,
    statuses,
    sinceDays,
    agentId: env.dynamodb.simulations.agentId,
    suiteScenarios: suiteScenarioKeys.length,
  });
  const ids = await discoverSuccessfulSimulationIds(env.dynamodb, {
    scenarioIds: suiteScenarioIds,
    statuses,
    limit,
    sinceIso,
    timeFields: env.dynamodb.simulations.timeFields,
  });
  log.info('discover.done', { picked: ids.length });

  if (discoverOnly) {
    // Print IDs for easy copy/paste.
    // Intentionally bypass dataset generation.
    process.stdout.write(`${JSON.stringify(ids, null, 2)}\n`);
    return;
  }

  for (const simulationId of ids) {
    await runOne({ simulationId }, datasetDir, { resume });
  }
}

await main();

