// Initialize Elastic APM first - must be before any other imports
import apmAgent from 'elastic-apm-node';

const isApmEnabled = !!(process.env.ELASTIC_APM_SECRET_TOKEN && process.env.ELASTIC_APM_SERVER_URL);
const serviceName = 'airo-agents';

if (isApmEnabled) {
  console.log(`📊 APM Server: ${process.env.ELASTIC_APM_SERVER_URL}`);
  console.log(`🏷️  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🎯 Service Name: ${serviceName}`);
} else {
  console.log('⚠️  Elastic APM disabled - Missing ELASTIC_APM_SECRET_TOKEN or ELASTIC_APM_SERVER_URL');
}

const apm = apmAgent.start({
  serviceName,
  secretToken: process.env.ELASTIC_APM_SECRET_TOKEN || '',
  serverUrl: process.env.ELASTIC_APM_SERVER_URL || '',
  environment: process.env.NODE_ENV || 'development',
  active: isApmEnabled,
  // Express specific configuration
  usePathAsTransactionName: true,
  transactionSampleRate: 1.0,
  captureBody: 'all',
  captureHeaders: true,
  // Additional configuration for better transaction capture
  instrument: true,
  instrumentIncomingHTTPRequests: true,
  captureSpanStackTraces: false,
  stackTraceLimit: 50,
  transactionMaxSpans: 500
});

// Now import other modules after APM is initialized
import express, { Express } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';

import { corsMiddleware, errorHandler, notFoundHandler, requestLogger, jwtAuthMiddleware } from './middleware/index.js';
import { agentsRouter, appsRouter, chatRouter, healthRouter, gitRouter, debugRouter, filesRouter } from './routes/index.js';
import { auth } from '../services/features.js';
// Phase 3: Replace legacy WebSocket with AI-Lib WebSocket server
import { setupAILibWebSocketServer, getWebSocketServerInfo } from './ai-lib-websocket-server.js';
import { getDatabase } from '../database/index.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { fileCleanupService } from '../services/FileCleanupService.js';

const app: Express = express();
const port = process.env.PORT || 4000;

// Create HTTP server to support both Express and WebSocket
const server = createServer(app);

// APM middleware should be added BEFORE other middleware
if (isApmEnabled) {
  app.use(apm.middleware.connect());
}

// Security middleware
app.use(helmet());
app.use(compression());

// CORS
app.use(corsMiddleware);

// Parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(requestLogger);

// APM transaction middleware for explicit transaction creation
if (isApmEnabled) {
  app.use((req, res, next) => {
    const transaction = apm.startTransaction(`${req.method} ${req.route?.path || req.path}`, 'request');
    if (transaction) {
      transaction.setLabel('method', req.method);
      transaction.setLabel('path', req.path);
      transaction.setLabel('url', req.url);

      // Add site_id label for distinguishing transactions
      const siteId = auth.getSiteId();
      if (siteId) {
        transaction.setLabel('site_id', siteId);
      }

      res.on('finish', () => {
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
      websocketChat: 'ws://localhost:4000/ws/{agent-id}',
    },
    documentation: 'See README.md for detailed API documentation',
  });
});

// Protected routes requiring authentication
app.use('/agents', jwtAuthMiddleware.authenticate, agentsRouter);
app.use('/apps', jwtAuthMiddleware.authenticate, appsRouter);
app.use('/agent', jwtAuthMiddleware.authenticate, chatRouter);
app.use('/files', jwtAuthMiddleware.authenticate, filesRouter);
app.use('/debug', jwtAuthMiddleware.authenticate, debugRouter);
app.use('/', jwtAuthMiddleware.authenticate, gitRouter);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Initialize the application
 */
async function initialize() {
  try {
    console.log('🚀 Starting @airo/agents server...');

    // Initialize database
    console.log('🗄️  Initializing database...');
    getDatabase();
    console.log('✅ Database initialized');

    // Initialize AppRepository and recover processes
    console.log('📱 Initializing AppRepository...');
    const appRepo = new AppRepository();
    await appRepo.initialize();
    console.log('✅ AppRepository initialized');

    // Phase 3: Setup AI-Lib WebSocket Server
    console.log('🚀 Phase 3: Setting up AI-Lib WebSocket Server...');
    const wsServer = await setupAILibWebSocketServer(server);
    console.log('✅ AI-Lib WebSocket server initialized with multi-agent support');

    // Start file cleanup service
    console.log('🧹 Starting file cleanup service...');
    fileCleanupService.start();
    console.log('✅ File cleanup service started');

    // Get WebSocket server info for health checks
    const wsInfo = getWebSocketServerInfo();
    console.log(`📊 WebSocket server info:`, {
      totalAgents: wsInfo.totalAgents,
      defaultAgent: wsInfo.defaultAgent,
      availableAgents: wsInfo.agentIds
    });

    console.log('📌 WebSocket Connection Info:');
    console.log('  - Socket.IO: Available on default path for ai-playground compatibility');
    console.log('  - Frontend: Use Socket.IO client to connect (not native WebSocket)');
    console.log('  - Update frontend from native WebSocket to Socket.IO for ai-lib compatibility');

    // Start server
    server.listen(port, () => {
      console.log(`🌐 Server running on http://localhost:${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
      console.log(`🤖 Agents list: http://localhost:${port}/agents`);
      console.log('');
      console.log('🎉 Phase 3 Migration Complete!');
      console.log('');
      console.log('✅ Migration to AI-Lib Successfully Completed:');
      console.log('  - ✅ Phase 1: All tools converted to ai-lib createTool() format');
      console.log('  - ✅ Phase 2: BaseAgent replaced with ai-lib Agent composition');
      console.log('  - ✅ Phase 3: WebSocket integrated with ai-lib multi-agent server');
      console.log('');
      console.log('🚀 AI-Lib Features Now Active:');
      console.log('  - Multi-agent WebSocket server with agent selection');
      console.log('  - Direct streaming and tool execution through ai-lib');
      console.log('  - Automatic agent discovery and metadata management');
      console.log('  - Native ai-lib message formats and events');
      console.log('  - Complete elimination of legacy agent system');
      console.log('');
      console.log('Available endpoints:');
      console.log('');
      console.log('🤖 Agent Management:');
      console.log(`  GET  /agents - List all available AI agents with capabilities`);
      console.log(`  GET  /agents/{id} - Get specific agent details and configuration`);
      console.log('');
      console.log('📱 App Management:');
      console.log(`  GET  /apps - List all user applications with metadata`);
      console.log(`  POST /apps - Create new application project`);
      console.log(`  GET  /apps/{id} - Get application details and status`);
      console.log(`  PUT  /apps/{id} - Update application configuration`);
      console.log(`  DELETE /apps/{id} - Delete application and clean up resources`);
      console.log('');
      console.log('📁 File Operations:');
      console.log(`  GET  /apps/{id}/files - List files in app directory tree`);
      console.log(`  GET  /apps/{id}/files/read - Read file contents with optional line range`);
      console.log(`  POST /apps/{id}/files/write - Create or edit files with backup support`);
      console.log(`  POST /apps/{id}/files/edit - Apply search-and-replace operations`);
      console.log('');
      console.log('💬 AI Chat & Development:');
      console.log(`  POST /agent/{id}/chat - Send message to AI agent (non-streaming)`);
      console.log(`  POST /agent/{id}/chat-streaming - Real-time streaming chat with AI`);
      console.log(`  WS   /ws/{id} - WebSocket connection for live AI development`);
      console.log('');
      console.log('📊 Token Usage & Analytics:');
      console.log(`  GET  /apps/{id}/usage - Get token usage summary for app`);
      console.log(`  GET  /apps/{id}/usage/history - Detailed token usage history`);
      console.log(`  GET  /apps/{id}/usage/stats - Usage statistics by time period`);
      console.log(`  DELETE /apps/{id}/usage - Reset token usage data for app`);
      console.log('');
      console.log('🔧 System:');
      console.log(`  GET  /health - System health check and status`);
      console.log(`  GET  /apps/config - Get app configuration (SHOW_USAGE_COST)`);
      console.log('');
      console.log('⚙️  Configuration:');
      console.log(`  SHOW_USAGE_COST: ${process.env.SHOW_USAGE_COST || 'false'} (UI display of token costs)`);
      console.log(`  📊 Backend tracking: Always enabled (regardless of UI setting)`);
    });

  } catch (error) {
    console.error('❌ Failed to initialize application:', error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log('🛑 Shutting down gracefully...');

  try {
    // Phase 3: AI-Lib WebSocket server handles its own cleanup automatically
    console.log('✅ Cleanup completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
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
  console.error('Uncaught Exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown();
});

// Start the application
if (import.meta.url === `file://${process.argv[1]}`) {
  initialize();
}

export { app, server, initialize, shutdown };
