// Route all ai-lib/ai-transport logging through the agents structured logger.
// Module-level loggers created by createLogger() resolve lazily on first use,
// so they pick up this factory as long as it's set before any logging occurs.
import { Logger } from '../logging/index.js';
import { setLoggerFactory } from '@airo/ai-common';
setLoggerFactory((moduleName) => Logger.create({ component: `ai-lib.${moduleName}` }));

// Initialize OpenTelemetry with Langfuse (imported from instrumentation.ts)
import './instrumentation.js';
import { handleUnhandledRejection } from './unhandled-rejection-handler.js';

// Initialize Elastic APM
import apmAgent from 'elastic-apm-node';

const isApmEnabled = !!(process.env.ELASTIC_APM_SECRET_TOKEN && process.env.ELASTIC_APM_SERVER_URL);
const serviceName = 'airo-agents';
const logger = Logger.create({ component: 'airo-agents-server' });

if (isApmEnabled) {
  logger.info('server.apm.enabled', {
    serverUrl: process.env.ELASTIC_APM_SERVER_URL,
    environment: process.env.NODE_ENV || 'development',
    serviceName,
  });
} else {
  logger.warn('server.apm.disabled', {
    reason: 'Missing ELASTIC_APM_SECRET_TOKEN or ELASTIC_APM_SERVER_URL',
  });
}

// Patch global fetch to include full URL paths in APM spans
if (isApmEnabled) {
  const originalFetch = global.fetch;
  global.fetch = async function apmFetch(this: any, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Extract URL and method
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method =
      init?.method ||
      (input instanceof Request ? input.method : undefined) ||
      'GET';

    // Check if URL is absolute (has protocol)
    const isAbsoluteUrl = url.startsWith('http://') || url.startsWith('https://');

    // For relative URLs, we need a base URL to parse them
    let urlObj: URL;
    let hostname: string;
    let path: string;
    let isExternal: boolean;

    if (!isAbsoluteUrl) {
      // Relative URL - assume it's to localhost (internal call)
      // Use a dummy base URL just for parsing the path
      try {
        urlObj = new URL(url, 'http://localhost');
        hostname = 'localhost';
        path = urlObj.pathname + urlObj.search;
        isExternal = false;
      } catch (error) {
        // If URL parsing fails, just call original fetch without instrumentation
        return originalFetch.call(this, input, init);
      }
    } else {
      // Absolute URL - parse normally
      urlObj = new URL(url);
      hostname = urlObj.hostname;
      path = urlObj.pathname + urlObj.search;
      // Consider localhost, 127.0.0.1, and same hostname as internal
      isExternal = !['localhost', '127.0.0.1', '::1'].includes(hostname.toLowerCase());
    }

    // Create custom span name with full URL path
    const spanName = `${method} ${hostname}${path}`;

    // Start custom APM span
    // Use 'external' for external calls, 'internal' for local calls
    const spanType = isExternal ? 'external' : 'internal';
    const span = apmAgent.startSpan(spanName, spanType, 'http');

    if (span) {
      // Add span labels for better filtering and searching (use underscores, not dots)
      span.addLabels({
        'http_url': url,
        'http_method': method,
        'http_hostname': hostname,
        'http_path': path,
        'http_is_external': isExternal,
        'destination_service_resource': `${hostname}${path}`
      });

      // Set span type for proper categorization
      span.setType(spanType, 'http', hostname);
    }

    try {
      // Execute the actual fetch with proper context binding
      const response = await originalFetch.call(this, input, init);

      if (span) {
        // Add response status to span
        span.addLabels({ 'http_status_code': response.status });
        span.setOutcome(response.ok ? 'success' : 'failure');
      }

      // Return the original response. Cloning a streamed response here can
      // force tee buffering of the unread branch and blow up heap usage.
      return response;
    } catch (error) {
      if (span) {
        span.setOutcome('failure');
        // Capture the error in the span
        if (error instanceof Error) {
          span.addLabels({ 'error_message': error.message });
        }
      }
      throw error;
    } finally {
      // Always end the span
      if (span) {
        span.end();
      }
    }
  } as typeof fetch;

  logger.info('server.apm.fetch_instrumentation', {
    message: 'Global fetch patched with APM instrumentation for full URL path tracking'
  });
}

const apm = apmAgent.start({
  serviceName,
  secretToken: process.env.ELASTIC_APM_SECRET_TOKEN || '',
  serverUrl: process.env.ELASTIC_APM_SERVER_URL || '',
  environment: process.env.NODE_ENV || 'development',
  active: isApmEnabled,
  // Global labels added to ALL data: transactions, spans, errors, AND metrics
  // Using ECS standard fields for container metadata
  globalLabels: {
    appId: process.env.SITE_ID || 'default-site',
    'container.image.tag': process.env.AGENT_IMAGE_TAG || 'unknown',
    'service.version': process.env.AGENT_IMAGE_TAG || 'unknown',
    'service.name': 'airo-agent',
  },
  // Express specific configuration for route template support
  usePathAsTransactionName: true,
  transactionSampleRate: 1.0,
  captureBody: 'all',
  captureHeaders: true,
  // Additional configuration for better transaction capture
  instrument: true,
  instrumentIncomingHTTPRequests: true,
  captureSpanStackTraces: false,
  stackTraceLimit: 50,
  transactionMaxSpans: 500,
  // Span configuration for external HTTP calls
  spanCompressionEnabled: false,
  spanCompressionExactMatchMaxDuration: '0ms',
  spanCompressionSameKindMaxDuration: '0ms',
  // Capture full URL paths in external HTTP spans for better dependency tracking
  spanStackTraceMinDuration: '0ms',
  // Enable OpenTelemetry bridge to receive spans from Vercel AI SDK experimental_telemetry
  opentelemetryBridgeEnabled: true,
  // Enable automatic HTTP client instrumentation for http, https, and undici
  // disableInstrumentations: ['http', 'https', 'undici']
});

// Filter out CSP event bus spans from WebSocket transactions (all environments)
apm.addSpanFilter((span) => {
  const url = span.context?.http?.url;
  // Drop spans for CSP event bus calls - these are internal observability HTTP calls
  // Matches: csp.dev-godaddy.com, csp.test-godaddy.com, csp.godaddy.com (prod)
  if (url && /csp\.(dev-|test-)?godaddy\.com/.test(url)) {
    return false;
  }
  return span;
});

// Now import other modules after APM is initialized
import path from 'node:path';

import express, { Express, Router } from 'express';
import helmet from 'helmet';
import compression from 'compression';

import { create as createServer } from './server-factory.js';
import { corsMiddleware, timingAllowOriginMiddleware, errorHandler, notFoundHandler, requestLogger, jwtAuthMiddleware, validateProductAccess } from './middleware/index.js';
import { agentsRouter, appsRouter, chatRouter, healthRouter, diagnosticsRouter, gitRouter, debugRouter, filesRouter, filesPublicRouter, publishRouter, downloadRouter, dbRouter, dbImportRouter, todoListRouter, securityMisconfigScanRouter, vulnerabilityScanRouter, securityReportRouter, secretsScanRouter, videoRouter, conversationsRouter, qaAnalyzeRouter, gitRemoteRouter, goLiveRouter, socialRouter, blogPostsRouter, customerLogsRouter, diagnoseRouter, zipImportRouter, uiKitRouter, shareRouter, mediaRouter, modelsRouter, profilesRouter, transferValidateRouter, runtimeErrorsRouter, formatOverridesRouter, brandDataRouter, rebuildRouter, nextActionsRouter, captureScreenshotRouter, feedbackRouter, inboxAccountRouter, campaignsRouter, appMetadataRouter } from './routes/index.js';
// Phase 3: Replace legacy WebSocket with AI-Lib WebSocket server
import { setupAILibWebSocketServer, getWebSocketServerInfo } from './ai-lib-websocket-server.js';
import { initAgentRuntime, getEventChannel, getAgentFactory, getMessageLifecycleDeps, getGitHookService } from './agent-runtime.js';
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
  getMessageStore,
} from '../memory/adapters/index.js';
import { workspaceScopeFromAppId } from '../memory/interfaces/scope.js';
import { ConversationContextManager } from '../services/ConversationContextManager.js';
import { getTemplateIds } from '../agents/template-registry.js';
import { createAgentRouter } from './agent-router.js';
import { getPersistedAgentIdForApp } from './persisted-agent.js';
import { persistHandoffAgent } from './develop-variant.js';
import { getModelOverride } from '../utils/model-selection.js';
import { getActiveModelOverride } from '@airo/ai-lib';
import { closeDatabase, getDatabase } from '../database/index.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { resolveAppBaseUrl } from '../utils/share-token.js';

const app: Express = express();
const port = process.env.PORT || 4000;

// Create HTTP(S) server to support both Express and WebSocket
const { server, secure } = createServer(app);
const scheme = secure ? 'https' : 'http';
const wsScheme = secure ? 'wss' : 'ws';
const localHost = secure ? 'local.gasket.dev-godaddy.com' : 'localhost';
let wsServer: Awaited<ReturnType<typeof setupAILibWebSocketServer>>['wsServer'] | null = null;
let isShuttingDown = false;
const sseRegistry = new EventStreamRegistry();
initSSERegistry(sseRegistry);
let memoryLogInterval: NodeJS.Timeout | null = null;

// Shared history loader for SSE (same config as WS path in ai-lib-websocket-server.ts)
const sseConversationContextManager = new ConversationContextManager(getMessageStore(), 10)

// Lazy SSE execution service — created on first request after init completes
let sseExecutionService: MessageExecutionService | null = null

const { validator: ssePostStreamValidator, resetRetries: sseResetPostStreamRetries } =
  buildSharedPostStreamValidator(logger)

const resolveAgent = createAgentRouter({
  hasMessagesForApp: (appId) => getMessageStore().hasMessagesForApp(workspaceScopeFromAppId(appId)),
  getTemplateIds,
  // Durable per-conversation agent fallback (transport parity with the WS router).
  // SSE has no in-memory session, so this is what keeps a conversation in its
  // persisted phase instead of defaulting to `develop` once messages exist.
  getPersistedAgentForApp: (appId) => getPersistedAgentIdForApp(getConversationLifecycleStore(), appId),
})

function getOrCreateSSEExecutionService(): MessageExecutionService | null {
  if (sseExecutionService) return sseExecutionService
  const eventChannel = getEventChannel()
  const agentFactory = getAgentFactory()
  if (!eventChannel || !agentFactory) return null

  const contextMgr = new AILibContextManager()
  const sseAppRepo = new AppRepository()

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
      // Resolution order matches ai-lib-websocket-server.ts messageProvider:
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
  })
  sseRegistry.setListener(sseExecutionService)
  return sseExecutionService
}

// APM middleware should be added BEFORE other middleware
if (isApmEnabled) {
  app.use(apm.middleware.connect());
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

// APM transaction middleware for explicit transaction creation with dynamic route support
if (isApmEnabled) {
  app.use((req, res, next) => {
    // Start with actual path, will update with route template after matching
    const transaction = apm.startTransaction(`${req.method} ${req.path}`, 'request');
    if (transaction) {
      transaction.setLabel('method', req.method);
      transaction.setLabel('path', req.path);
      transaction.setLabel('url', req.url);
      // appId is set via globalLabels in APM config

      res.on('finish', () => {
        // Update transaction name with route template if available
        if (req.route?.path) {
          // Convert :param to [param] format for better APM grouping
          const routeTemplate = req.route.path.replace(/:([a-zA-Z0-9_-]+)/g, '[$1]');
          const baseUrl = req.baseUrl || '';
          const fullRoute = baseUrl + routeTemplate;
          transaction.name = `${req.method} ${fullRoute}`;
          transaction.setLabel('route_template', fullRoute);
          transaction.setLabel('actual_path', req.path);

          // Log route template usage for debugging
          if (req.route.path.includes(':')) {
            logger.debug('apm.route.template', {
              method: req.method,
              template: fullRoute,
              actualPath: req.path,
              statusCode: res.statusCode
            });
          }
        }

        transaction.result = `HTTP ${res.statusCode}`;
        transaction.setOutcome(res.statusCode >= 400 ? 'failure' : 'success');
        transaction.end();
      });
    }
    next();
  });
}

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
      websocketChat: `${wsScheme}://${localHost}:${port}/ws/{agent-id}`,
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
protectedRouter.use('/apps', appsRouter);
protectedRouter.use('/apps', appMetadataRouter);
protectedRouter.use('/apps', captureScreenshotRouter);
protectedRouter.use('/apps', videoRouter);
protectedRouter.use('/apps', customerLogsRouter);
protectedRouter.use('/apps', diagnoseRouter);
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
protectedRouter.use('/', publishRouter);
protectedRouter.use('/', downloadRouter);
protectedRouter.use('/', goLiveRouter);
protectedRouter.use('/', conversationsRouter);
protectedRouter.use('/', socialRouter);
protectedRouter.use('/', blogPostsRouter);
protectedRouter.use('/media', mediaRouter);
protectedRouter.use('/', transferValidateRouter);
protectedRouter.use('/', modelsRouter);
protectedRouter.use('/', profilesRouter);
protectedRouter.use('/', brandDataRouter);
protectedRouter.use('/', inboxAccountRouter);
protectedRouter.use('/apps', rebuildRouter);
protectedRouter.use('/apps', nextActionsRouter);
protectedRouter.use('/', feedbackRouter);
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

    // Phase 3: Setup AI-Lib WebSocket Server
    logger.info('server.websocket.init.begin', { phase: 3 });
    const websocketSetup = await setupAILibWebSocketServer(server);
    wsServer = websocketSetup.wsServer;
    logger.info('server.websocket.init.success', { phase: 3 });

    // Pre-warm all classifiers via AssessmentAgent to avoid cold start on first prompt.
    const { getAssessmentAgent } = await import('../agents/assessment-agent/index.js');
    await getAssessmentAgent().initialize();

    // Start periodic memory logging
    startPeriodicMemoryLogging();

    // Get WebSocket server info for health checks
    const wsInfo = getWebSocketServerInfo();
    logger.info('server.websocket.info', {
      totalAgents: wsInfo.totalAgents,
      defaultAgent: wsInfo.defaultAgent,
      availableAgents: wsInfo.agentIds,
    });

    logger.info('server.websocket.connection.info', {
      socketIO: 'Available on default path for ai-playground compatibility',
      frontendClient: 'Use Socket.IO client (not native WebSocket)',
      migrationNote: 'Frontend migrated from native WebSocket to Socket.IO',
    });

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
          'WebSocket integrated with ai-lib multi-agent server',
        ],
      });

      logger.info('server.features.active', {
        features: [
          'Multi-agent WebSocket server with agent selection',
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
          websocket: 'WS /ws/{id} - WebSocket connection for live AI development',
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
async function shutdown() {
  if (isShuttingDown) {
    logger.warn('server.shutdown.already_in_progress', {
      service: serviceName,
    });
    return;
  }

  isShuttingDown = true;

  logger.info('server.shutdown.begin', {
    service: serviceName,
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

    if (wsServer) {
      try {
        // Socket.IO 4.8.3: io.close() no longer throws on a stopped server,
        // but we still catch to keep shutdown best-effort for unexpected errors.
        wsServer.close();
        logger.info('server.websocket.shutdown.success', {
          service: serviceName,
        });
      } catch (error) {
        logger.warn('server.websocket.shutdown.unexpected_error', {
          service: serviceName,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      } finally {
        wsServer = null;
      }
    }

    // Wait for disconnect-triggered git operations to complete.
    // wsServer.close() fires socket disconnect events which trigger handleConnectionEnd
    // asynchronously. We must await those before exiting or work will be lost.
    try {
      const gitHookService = getGitHookService();

      logger.info('server.shutdown.git.await', {
        service: serviceName,
      });

      await gitHookService.waitForInFlightOps();

      logger.info('server.shutdown.git.complete', {
        service: serviceName,
      });
    } catch (error) {
      logger.error('server.shutdown.git.error', {
        service: serviceName,
        error: error instanceof Error ? error.message : String(error),
      });
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

    const { destroyAgentRuntime } = await import('./agent-runtime.js')
    await destroyAgentRuntime();

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
  process.on('SIGINT', shutdown);
}
process.on('SIGTERM', shutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('server.uncaught.exception', {
    error: error.message,
    stack: error.stack,
  });
  shutdown();
});

process.on('unhandledRejection', (reason, promise) =>
  handleUnhandledRejection(reason, promise, { logger, shutdown })
);

// Start the application
if (import.meta.url === `file://${process.argv[1]}`) {
  initialize();
}

export { app, server, initialize, shutdown };
