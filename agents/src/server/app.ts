import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { createServer } from 'http';

import { corsMiddleware, errorHandler, notFoundHandler, requestLogger } from './middleware/index.js';
import { agentsRouter, appsRouter, chatRouter, healthRouter } from './routes/index.js';
import { createWebSocketServer } from './routes/websocket.js';
import { AgentRegistry } from '../registry/index.js';
import { ExampleAgent, DevelopAgent, FakeEventsAgent } from '../agents/index.js';
import { getDatabase } from '../database/index.js';
import { AppRepository } from '../database/repositories/AppRepository.js';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Create HTTP server to support both Express and WebSocket
const server = createServer(app);

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

// Routes
app.use('/health', healthRouter);
app.use('/agents', agentsRouter);
app.use('/apps', appsRouter);
app.use('/agent', chatRouter);

// Root endpoint
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
    
    // Initialize agent registry
    const registry = AgentRegistry.getInstance();
    
    // Register agents
    console.log('📝 Registering agents...');
    registry.register(ExampleAgent);
    registry.register(DevelopAgent);
    registry.register(FakeEventsAgent);
    
    // Initialize all agents
    await registry.initializeAll();
    
    console.log('✅ Agent registry initialized');
    
    // Setup WebSocket server
    console.log('🔌 Setting up WebSocket server...');
    const wss = createWebSocketServer(server);
    console.log('✅ WebSocket server initialized');
    
    // Start server
    server.listen(port, () => {
      console.log(`🌐 Server running on http://localhost:${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
      console.log(`🤖 Agents list: http://localhost:${port}/agents`);
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
    // Cleanup AppRepository first (stop dev servers)
    const appRepo = new AppRepository();
    await appRepo.cleanup();
    
    // Then cleanup agent registry
    const registry = AgentRegistry.getInstance();
    await registry.cleanup();
    
    console.log('✅ Cleanup completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGINT', shutdown);
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
