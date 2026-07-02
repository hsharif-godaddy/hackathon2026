// Route all ai-lib/ai-transport logging through the agents structured logger.
// Module-level loggers created by createLogger() resolve lazily on first use,
// so they pick up this factory as long as it's set before any logging occurs.
import { Logger } from '../logging/index.js';
import { setLoggerFactory } from '@airo/ai-common';
setLoggerFactory((moduleName) => Logger.create({ component: `ai-lib.${moduleName}` }));

// Initialize OpenTelemetry (OTLP exporter, auto-instrumentations, span processors)
import './instrumentation.js';
import './instrumentation-extras.js';
import { describeError } from '@airo/shared/errors';
import { handleUnhandledRejection } from './unhandled-rejection-handler.js';
import { trace, type Span } from '@opentelemetry/api';
import { runRootSpan } from './root-span.js';
import { flushTelemetry } from './instrumentation-extras.js';

const serviceName = 'airo-agents';
const logger = Logger.create({ component: 'airo-agents-server' });
import path from 'node:path';

import express, { Express, Router, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import compression from 'compression';

import { create as createServer } from './server-factory.js';
import { corsMiddleware, timingAllowOriginMiddleware, errorHandler, notFoundHandler, requestLogger, jwtAuthMiddleware, validateProductAccess } from './middleware/index.js';
import { agentsRouter, appsRouter, chatRouter, healthRouter, diagnosticsRouter, gitRouter, debugRouter, filesRouter, filesPublicRouter, publishRouter, publishEnvRouter, downloadRouter, dbRouter, dbImportRouter, todoListRouter, securityMisconfigScanRouter, vulnerabilityScanRouter, securityReportRouter, secretsScanRouter, videoRouter, conversationsRouter, qaAnalyzeRouter, gitRemoteRouter, goLiveRouter, adsenseRouter, complianceRouter, socialRouter, customerLogsRouter, diagnoseRouter, autoFixRouter, zipImportRouter, uiKitRouter, shareRouter, mediaRouter, modelsRouter, profilesRouter, transferValidateRouter, runtimeErrorsRouter, formatOverridesRouter, brandDataRouter, designKitRouter, rebuildRouter, nextActionsRouter, captureScreenshotRouter, feedbackRouter, inboxAccountRouter, seoQualityRouter, campaignsRouter, appMetadataRouter, commerceRouter, dkimRouter, workflowStateRouter } from './routes/index.js';
import { initAgentRuntime, getEventChannel, getAgentFactory, getMessageLifecycleDeps } from './agent-runtime.js';
import { EventStreamRegistry } from './sse/EventStreamRegistry.js';
import { initSSERegistry } from './sse/registry-singleton.js';
import { createSSERoutes } from './sse/routes.js';
import { MessageExecutionService } from './sse/MessageExecutionService.js';
import { createSSEContextLoader } from './sse/context-loader.js';
import { buildSharedPostStreamValidator } from './post-stream-validator.js';
import { AgentsMessagePersistence } from './conversation-persistence.js';
import { AILibContextManager } from '../agents/ai-lib-agents/context-manager.js';
import { hasUnbuiltRebuildPages } from '../tools/ai-lib-tools/rebuild-page-selector.js';
import { resolveSkillToolMetadata } from '../tools/skill-tool-manager.js';
import { getBackgroundSummarizer } from '../services/summarization/index.js';
import {
  getConversationLifecycleStore,
  getKvMemoryStore,
  getMessageStore,
} from '../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../memory/interfaces/scope.js';
import { ConversationContextManager } from '../services/ConversationContextManager.js';
import { getTemplateIds } from '../agents/template-registry.js';
import { createAgentRouter } from './agent-router.js';
import { createCareBridge } from '../care/index.js';
import { getSwitchboardFlag } from '../services/switchboard.js';
import { getPersistedAgentIdForApp } from './persisted-agent.js';
import { persistHandoffAgent } from './develop-variant.js';
import { getModelOverride } from '../utils/model-selection.js';
import { getActiveModelOverride } from '@airo/ai-lib';
import { closeDatabase, getDatabase } from '../database/index.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { resolveAppBaseUrl } from '../utils/share-token.js';

const app: Express = express();
// PORT keeps Node-convention priority; AGENTS_PORT is the cross-process knob
// the local-control-plane, BFF helpers, and gosym-probe all read, so a single
// `AGENTS_PORT=4040` in the shell shifts the whole stack without setting PORT
// (which would also retarget unrelated services that follow Node convention —
// local-control-plane's own listener, Next.js dev, etc.).
const port = process.env.PORT || process.env.AGENTS_PORT || 4000;

// Create HTTP(S) server for the Express app.
const { server, secure } = createServer(app);
const scheme = secure ? 'https' : 'http';
const localHost = secure ? 'local.gasket.dev-godaddy.com' : 'localhost';
let isShuttingDown = false;
const sseRegistry = new EventStreamRegistry();
initSSERegistry(sseRegistry);
let memoryLogInterval: NodeJS.Timeout | null = null;

// Shared history loader for SSE (10-message context window).
const sseConversationContextManager = new ConversationContextManager(getMessageStore(), 10)

// Lazy SSE execution service — created on first request after init completes
let sseExecutionService: MessageExecutionService | null = null
// Care bridge instance — created alongside sseExecutionService; disposed on shutdown.
let careBridgeInstance: import('../care/index.js').CareBridge | null = null

const { validator: ssePostStreamValidator, resetRetries: sseResetPostStreamRetries } =
  buildSharedPostStreamValidator(logger)

const resolveAgent = createAgentRouter({
  hasMessagesForApp: (appId) => getMessageStore().hasMessagesForApp(workspaceScopeFromAppId(appId)),
  getTemplateIds,
  // Durable per-conversation agent fallback (transport parity with the WS router).
  // SSE has no in-memory session, so this is what keeps a conversation in its
  // persisted phase instead of defaulting to `develop` once messages exist.
  getPersistedAgentForApp: (appId) => getPersistedAgentIdForApp(getConversationLifecycleStore(), appId),
  // Durable per-app agent mode: written by tools (e.g. setAgentMode for deep-build).
  // New conversations on an app with a mode set inherit it without re-selection.
  getAppAgentMode: async (appId: string): Promise<string | undefined> => {
    const memoryStore = getKvMemoryStore()
    const result = await memoryStore.get(workspaceScopeFromAppId(appId), 'app.agent_mode')
    if (result.success && result.exists && result.value && typeof result.value === 'object') {
      const mode: unknown = (result.value as Record<string, unknown>).mode
      return typeof mode === 'string' ? mode : undefined
    }
    return undefined
  },
})

function getOrCreateSSEExecutionService(): MessageExecutionService | null {
  if (sseExecutionService) return sseExecutionService
  const eventChannel = getEventChannel()
  const agentFactory = getAgentFactory()
  if (!eventChannel || !agentFactory) return null

  const contextMgr = new AILibContextManager()
  const sseAppRepo = new AppRepository()
  const careBridge = createCareBridge({
    baseURL: process.env.AIRO_CARE_BASE_URL ?? '',
    executor: process.env.AIRO_CARE_EXECUTOR ?? 'v1/orchestrator-test',
  })
  careBridgeInstance = careBridge

  sseExecutionService = new MessageExecutionService({
    getAgent: (agentId?: string) => agentFactory.agents.get((agentId ?? 'develop') as any),
    contextManager: {
      loadContextMessages: createSSEContextLoader({
        agentFactory: agentFactory as any,
        contextMgr: contextMgr as any,
        hasUnbuiltRebuildPages,
        getAppContextFields: (id: string) => {
          const app = sseAppRepo.findById(id)
          if (!app) return undefined
          const { path, customerId, subscriptionId } = app
          const previewUrl = app.previewUrl
            ? resolveAppBaseUrl(app.previewUrl, id)
            : app.previewUrl
          return { path, previewUrl, customerId, subscriptionId }
        },
      }),
    },
    loadConversationHistory: async (conversationId, appId, agentName) => {
      // Model resolution order:
      // 1. AI_MODEL_OVERRIDE env var (dev/test)
      // 2. ALS-scoped override set by MessageExecutionService.runWithOverride
      //    (resolved from JWT/per-project preferences) — required so Kimi traffic
      //    is identified, skipping Anthropic-only tool-id sanitization and
      //    preserving the Kimi prompt cache.
      // 3. 'sonnet' default
      const modelName = getModelOverride() || getActiveModelOverride() || 'sonnet'
      const historyLoader = sseConversationContextManager.getHistoryLoader()
      const llmMessages = await historyLoader.loadMessagesWithTokenLimitByConversationId(
        conversationId, 40000, modelName, true, appId
      )
      return historyLoader.formatMessagesForAISDK(llmMessages, appId, agentName, modelName)
    },
    conversationPersistence: new AgentsMessagePersistence(),
    eventChannel,
    sseRegistry,
    stateManager: {
      getCurrentAgent: (id: string) => agentFactory.stateManager.getCurrentAgent?.(id),
      getLastHandoffPrompt: (id: string) => agentFactory.stateManager.getLastHandoffPrompt?.(id),
      clearLastHandoffPrompt: (id: string) => agentFactory.stateManager.clearLastHandoffPrompt?.(id),
      setSessionMetadata: (id: string, meta: Record<string, unknown>) => agentFactory.stateManager.setSessionMetadata?.(id, meta),
      getSelectedTodoList: (id: string) => agentFactory.stateManager.getSelectedTodoList(id),
      setSelectedTodoList: (id: string, listId: string) => agentFactory.stateManager.setSelectedTodoList(id, listId),
    },
    onAgentChanged: async (convId: string, _oldAgent: string, newAgent: string) => {
      // Maps base develop -> develop-<profile> for the active profile and persists
      // it (atomic map+persist; see persistHandoffAgent). Not wrapped — a failure
      // must propagate to abort the turn per the ai-transport contract.
      await persistHandoffAgent(getConversationLifecycleStore(), convId, newAgent)
    },
    get backgroundSummarizer() {
      return getBackgroundSummarizer()
    },
    postStreamValidator: ssePostStreamValidator,
    resetPostStreamRetries: sseResetPostStreamRetries,
    lifecycle: getMessageLifecycleDeps(),
    resolveToolMetadata: resolveSkillToolMetadata,
    careBridge,
    // Default true so a Switchboard outage / missing flag keeps support live.
    // Flip to false from Switchboard to gate; takes effect on the next turn
    // (in-process cache refresh ~2 min).
    isCareEnabled: () => getSwitchboardFlag('airo-builder-care-agent-enabled', true),
  })
  sseRegistry.setListener(sseExecutionService)
  return sseExecutionService
}

// Security middleware
// Configure helmet with cross-origin resource policy for file serving endpoints
// Files endpoint needs cross-origin for browser image loading (protected by signed URLs)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression({
  filter: (req, res) => {
    if (req.headers.accept?.includes('text/event-stream')) return false;
    return compression.filter(req, res);
  },
}));

// Timing-Allow-Origin — must come before CORS so the header is set on preflight responses too
app.use(timingAllowOriginMiddleware);

// CORS
app.use(corsMiddleware);

// Parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(requestLogger);

// OTel span enrichment middleware — adds route template attributes to the auto-created span
app.use((req: Request, res: Response, next: NextFunction) => {
  const span: Span | undefined = trace.getActiveSpan();
  if (span) {
    span.setAttribute('method', req.method);
    span.setAttribute('path', req.path);
    span.setAttribute('url', req.url);
    // prependListener so this runs before HttpInstrumentation's own 'finish'
    // handler ends the span — otherwise updateName/setAttribute would be no-ops.
    res.prependListener('finish', () => {
      if (req.route?.path) {
        const routeTemplate: string = req.route.path.replace(/:([a-zA-Z0-9_-]+)/g, '[$1]');
        const fullRoute: string = (req.baseUrl || '') + routeTemplate;
        span.updateName(`${req.method} ${fullRoute}`);
        span.setAttribute('route_template', fullRoute);
        span.setAttribute('actual_path', req.path);
      }
    });
  }
  next();
});

// Public routes (no authentication required)
app.use('/health', healthRouter);
app.use('/airo/health', healthRouter); // Nomad health check probe uses this path
app.use('/diagnostics', diagnosticsRouter);

// Root endpoint (public)
app.get('/', (req, res) => {
  res.json({
    name: '@airo/agents',
    version: '0.1.0',
    description: 'Class-based AI agent library with HTTP streaming endpoints',
    endpoints: {
      health: '/health',
      agents: '/agents',
      agentDetails: '/agents/{agent-id}',
      apps: '/apps',
      appDetails: '/apps/{app-id}',
      chat: '/agent/{agent-id}/chat',
      chatStreaming: '/agent/{agent-id}/chat-streaming',
    },
    documentation: 'See README.md for detailed API documentation',
  });
});

// Public routes (no JWT required)
// File serving with signed URLs - must be before JWT-protected routes
app.use('/files', filesPublicRouter);

// Share router before global JWT: public GET /api/share/validate/:token (preview proxy, no auth header).
// POST/GET /apps/:id/share still use auth on the share router.
app.use('/', shareRouter);

// Protected routes: JWT auth + product access applied once via group router
const protectedRouter = Router();
protectedRouter.use(jwtAuthMiddleware.authenticate, validateProductAccess);

protectedRouter.use('/agents', agentsRouter);
protectedRouter.use('/apps', publishEnvRouter);
protectedRouter.use('/apps', appsRouter);
protectedRouter.use('/apps', appMetadataRouter);
protectedRouter.use('/', commerceRouter);
protectedRouter.use('/apps', captureScreenshotRouter);
protectedRouter.use('/apps', videoRouter);
protectedRouter.use('/apps', customerLogsRouter);
protectedRouter.use('/apps', diagnoseRouter);
protectedRouter.use('/apps', autoFixRouter);
protectedRouter.use('/apps', runtimeErrorsRouter);
protectedRouter.use('/apps', formatOverridesRouter);
protectedRouter.use('/', dbRouter);
protectedRouter.use('/agent', chatRouter);
protectedRouter.use('/agent', todoListRouter);
protectedRouter.use('/files', filesRouter);  // protected file ops
protectedRouter.use('/debug', debugRouter);
protectedRouter.use('/', securityMisconfigScanRouter);
protectedRouter.use('/', qaAnalyzeRouter);
protectedRouter.use('/', vulnerabilityScanRouter);
protectedRouter.use('/', securityReportRouter);
protectedRouter.use('/', secretsScanRouter);
protectedRouter.use('/', gitRouter);
protectedRouter.use('/', zipImportRouter);
protectedRouter.use('/', uiKitRouter);
protectedRouter.use('/', dbImportRouter);
protectedRouter.use('/', gitRemoteRouter);
protectedRouter.use('/', dkimRouter);
protectedRouter.use('/', publishRouter);
protectedRouter.use('/', downloadRouter);
protectedRouter.use('/', goLiveRouter);
protectedRouter.use('/', adsenseRouter);
protectedRouter.use('/apps', complianceRouter);
protectedRouter.use('/', conversationsRouter);
protectedRouter.use('/', socialRouter);
protectedRouter.use('/media', mediaRouter);
protectedRouter.use('/', transferValidateRouter);
protectedRouter.use('/', modelsRouter);
protectedRouter.use('/', profilesRouter);
protectedRouter.use('/', brandDataRouter);
protectedRouter.use('/', designKitRouter);
protectedRouter.use('/', inboxAccountRouter);
protectedRouter.use('/apps', rebuildRouter);
protectedRouter.use('/apps', nextActionsRouter);
protectedRouter.use('/apps', workflowStateRouter);
protectedRouter.use('/', feedbackRouter);
protectedRouter.use('/', seoQualityRouter);
protectedRouter.use('/campaigns', campaignsRouter);
protectedRouter.use('/api/conversations', createSSERoutes({
  registry: sseRegistry,
  authenticate: (_req, _res, next) => next(), // Auth handled by protectedRouter middleware
  getEventChannel: () => getEventChannel(),
  get executionService() { return getOrCreateSSEExecutionService() ?? undefined },
  resolveAgent,
  getStateManager: () => {
    const factory = getAgentFactory()
    if (!factory) return null
    return factory.stateManager as import('./agent-router.js').AgentStateManager
  },
  getTemplateIds,
  lifecycle: getConversationLifecycleStore(),
  messages: getMessageStore(),
}));

app.use(protectedRouter);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Start periodic memory logging
 * Logs memory usage at a configurable interval (default: 5 minutes)
 * Set MEMORY_LOG_INTERVAL_MS=0 to disable
 */
function startPeriodicMemoryLogging() {
  const intervalMs = parseInt(process.env.MEMORY_LOG_INTERVAL_MS || '300000', 10);

  // Guard against invalid values (NaN, Infinity, or negative/zero)
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    logger.info('memory.logging.disabled', {
      reason: !Number.isFinite(intervalMs)
        ? 'Invalid MEMORY_LOG_INTERVAL_MS value'
        : 'MEMORY_LOG_INTERVAL_MS set to 0 or negative',
      configuredValue: process.env.MEMORY_LOG_INTERVAL_MS,
    });
    return;
  }

  logger.info('memory.logging.started', {
    intervalMs,
    intervalMinutes: intervalMs / 60000,
  });

  memoryLogInterval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const uptimeSeconds = process.uptime();

    logger.info('memory.periodic.snapshot', {
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
      externalMB: Math.round(memUsage.external / 1024 / 1024),
      arrayBuffersMB: Math.round(memUsage.arrayBuffers / 1024 / 1024),
      uptimeMinutes: Math.round(uptimeSeconds / 60),
    });
  }, intervalMs);

  // Prevent interval from keeping process alive during shutdown
  memoryLogInterval.unref();
}

/**
 * Generate socket paths based on architecture (v3 vs v4)
 * Detects v4 unified job by checking for environment variables or socket file
 */
function generateSocketPaths(siteId: string): {
  socketPath?: string;
  publishSupervisorPath?: string;
} {
  if (!process.env.NOMAD_ALLOC_DIR) {
    // Local development - return undefined (TCP mode)
    return {};
  }

  // Detect v4 unified job by checking for environment variables
  const previewSocketPathEnv = process.env.AIRO_SUPERVISOR_PREVIEW_SOCKET_PATH;
  const publishSocketPathEnv = process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
  const isV4Unified = !!(previewSocketPathEnv && publishSocketPathEnv);

  if (isV4Unified) {
    // V4: Use environment variables directly (no hardcoded fallback)
    return {
      socketPath: previewSocketPathEnv,
      publishSupervisorPath: publishSocketPathEnv
    };
  } else {
    // V3: Use dev supervisor socket path (hardcoded fallback for v3 only)
    return {
      socketPath: path.join(process.env.NOMAD_ALLOC_DIR, 'tmp', `${siteId}-dev-supervisor.sock`)
    };
  }
}

/**
 * Initialize the application
 */
async function initialize() {
  try {
    logger.info('server.init.begin', {
      service: serviceName,
      port,
    });

    // Validate configuration (security checks)
    logger.info('server.config.validate.begin', {});
    const { validateConfiguration } = await import('../services/features.js');
    validateConfiguration();
    logger.info('server.config.validate.success', {});

    // Initialize Switchboard client (allows runtime feature flag reads)
    const { initSwitchboard } = await import('../services/switchboard.js');
    await initSwitchboard();

    // Initialize database
    logger.info('server.database.init.begin', {});
    getDatabase();
    logger.info('server.database.init.success', {});

    // Initialize AppRepository and recover processes
    logger.info('server.repository.init.begin', {});
    const appRepo = new AppRepository();
    await appRepo.initialize();
    logger.info('server.repository.init.success', {});

    // Auto-register app if SITE_ID and PREVIEW_URL are set (production mode)
    if (process.env.SITE_ID && process.env.PREVIEW_URL) {
      const existingApp = appRepo.findById(process.env.SITE_ID);

      if (!existingApp) {
        logger.info('server.app.autoregister.begin', {
          siteId: process.env.SITE_ID,
          previewUrl: process.env.PREVIEW_URL
        });

        try {
          const result = await appRepo.registerOrUpdateApp({
            siteId: process.env.SITE_ID,
            name: 'default',
            initialPrompt: 'default',
            previewUrl: process.env.PREVIEW_URL
          });

          logger.info('server.app.autoregister.success', {
            siteId: process.env.SITE_ID,
            created: result.created,
            message: result.message
          });
        } catch (error) {
          logger.error('server.app.autoregister.failed', {
            siteId: process.env.SITE_ID,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } else {
        // App exists - verify paths are correct for current architecture (v3/v4)
        logger.info('server.app.autoregister.verify_paths', {
          siteId: process.env.SITE_ID,
          reason: 'App exists, verifying app path and socket paths'
        });

        try {
          // Generate correct socket paths based on v4 detection
          const socketPaths = generateSocketPaths(process.env.SITE_ID);

          const result = await appRepo.registerOrUpdateApp({
            siteId: process.env.SITE_ID,
            previewUrl: process.env.PREVIEW_URL,
            ...(process.env.CUSTOMER_APP_DIR && { appPath: process.env.CUSTOMER_APP_DIR }),
            ...(socketPaths.socketPath && { socketPath: socketPaths.socketPath }),
            ...(socketPaths.publishSupervisorPath && { publishSupervisorPath: socketPaths.publishSupervisorPath })
          });

          logger.info('server.app.autoregister.paths_verified', {
            siteId: process.env.SITE_ID,
            appPath: process.env.CUSTOMER_APP_DIR,
            socketPath: socketPaths.socketPath,
            publishSupervisorPath: socketPaths.publishSupervisorPath,
            updated: !result.created
          });
        } catch (error) {
          logger.error('server.app.autoregister.path_verification_failed', {
            siteId: process.env.SITE_ID,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    // Initialize transport-agnostic agent runtime (shared by SSE and WS)
    await initAgentRuntime()
    logger.info('server.agent_runtime.init.success')

    // Reconcile any logo jobs orphaned by a prior restart (in-flight state is
    // memory-only, so a queued/generating job left in .airo/logo.json has no live
    // worker after reboot). Best-effort — must never block boot. Dynamic import
    // keeps the logo/WS module graph out of app.ts eval.
    try {
      const { reconcileAllStaleLogoJobs } = await import('../services/logo/logo-reconciler.js')
      await runRootSpan('startup.reconcile_logo_jobs', reconcileAllStaleLogoJobs)
    } catch (error) {
      logger.error('server.logo.reconcile.failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Pre-warm all classifiers via AssessmentAgent to avoid cold start on first prompt.
    const { getAssessmentAgent } = await import('../agents/assessment-agent/index.js');
    await runRootSpan('startup.prewarm_classifiers', () => getAssessmentAgent().initialize());

    // Start periodic memory logging
    startPeriodicMemoryLogging();

    // Start server
    server.listen(port, () => {
      logger.info('server.listen.success', {
        url: `${scheme}://${localHost}:${port}`,
        port,
        secure,
        healthCheck: `${scheme}://${localHost}:${port}/health`,
        agentsList: `${scheme}://${localHost}:${port}/agents`,
      });

      logger.info('server.migration.complete', {
        phase: 3,
        features: [
          'All tools converted to ai-lib createTool() format',
          'BaseAgent replaced with ai-lib Agent composition',
        ],
      });

      logger.info('server.features.active', {
        features: [
          'Direct streaming and tool execution through ai-lib',
          'Automatic agent discovery and metadata management',
          'Native ai-lib message formats and events',
          'Complete elimination of legacy agent system',
        ],
      });

      logger.info('server.endpoints.available', {
        agents: {
          list: 'GET /agents - List all available AI agents with capabilities',
          details: 'GET /agents/{id} - Get specific agent details and configuration',
        },
        apps: {
          list: 'GET /apps - List all user applications with metadata',
          create: 'POST /apps - Create new application project',
          get: 'GET /apps/{id} - Get application details and status',
          update: 'PUT /apps/{id} - Update application configuration',
          delete: 'DELETE /apps/{id} - Delete application and clean up resources',
        },
        files: {
          list: 'GET /apps/{id}/files - List files in app directory tree',
          read: 'GET /apps/{id}/files/read - Read file contents with optional line range',
          write: 'POST /apps/{id}/files/write - Create or edit files with backup support',
          edit: 'POST /apps/{id}/files/edit - Apply search-and-replace operations',
        },
        chat: {
          standard: 'POST /agent/{id}/chat - Send message to AI agent (non-streaming)',
          streaming: 'POST /agent/{id}/chat-streaming - Real-time streaming chat with AI',
        },
        usage: {
          summary: 'GET /apps/{id}/usage - Get token usage summary for app',
          history: 'GET /apps/{id}/usage/history - Detailed token usage history',
          stats: 'GET /apps/{id}/usage/stats - Usage statistics by time period',
          reset: 'DELETE /apps/{id}/usage - Reset token usage data for app',
        },
        system: {
          health: 'GET /health - System health check and status',
          config: 'GET /apps/config - Get app configuration (SHOW_USAGE_COST)',
        },
      });

      logger.info('server.configuration', {
        showUsageCost: process.env.SHOW_USAGE_COST || 'false',
        backendTracking: 'Always enabled (regardless of UI setting)',
      });
    });

  } catch (error) {
    logger.error('server.init.failure', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(cause: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('server.shutdown.already_in_progress', {
      service: serviceName,
      cause,
    });
    return;
  }

  isShuttingDown = true;

  logger.info('server.shutdown.begin', {
    service: serviceName,
    cause,
  });

  try {
    if (memoryLogInterval) {
      clearInterval(memoryLogInterval);
      memoryLogInterval = null;
      logger.info('server.memory_logging.stopped', {
        service: serviceName,
      });
    }

    if (sseExecutionService) {
      try {
        await sseExecutionService.shutdown();
        logger.info('server.sse.shutdown.success', {
          service: serviceName,
        });
      } catch (error) {
        logger.error('server.sse.shutdown.failure', {
          service: serviceName,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        sseExecutionService = null;
      }
    }

    if (careBridgeInstance) {
      careBridgeInstance.dispose();
      careBridgeInstance = null;
    }

    const SERVER_CLOSE_TIMEOUT_MS = 20000; // 20 seconds
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }

        server.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          resolve();
        });
      }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('server.close() timed out')), SERVER_CLOSE_TIMEOUT_MS)
      )
    ]);

    try {
      closeDatabase();
      logger.info('server.shutdown.database.success', { service: serviceName });
    } catch (error) {
      logger.warn('server.shutdown.database.failure', {
        service: serviceName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const { destroySwitchboard } = await import('../services/switchboard.js');
      destroySwitchboard();
    } catch {
      // best-effort cleanup
    }

    const { destroyAgentRuntime } = await import('./agent-runtime.js')
    await destroyAgentRuntime();

    // Flush buffered OTel spans before exit so the final batch (incl. shutdown
    // error spans) isn't dropped. Best-effort + timeout-guarded inside.
    await flushTelemetry();

    logger.info('server.shutdown.success', {
      service: serviceName,
    });
    process.exit(0);
  } catch (error) {
    logger.error('server.shutdown.failure', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Handle shutdown signals
if (!process.env.NOMAD_TASK_NAME) {
  process.on('SIGINT', () => shutdown('SIGINT'));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('server.uncaught.exception', {
    error: error.message,
    ...describeError(error),
  });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) =>
  handleUnhandledRejection(reason, promise, { logger, shutdown })
);

// Start the application
if (import.meta.url === `file://${process.argv[1]}`) {
  initialize();
}

export { app, server, initialize, shutdown };
