import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';

import { corsMiddleware, errorHandler, notFoundHandler, requestLogger } from './middleware/index.js';
import { agentsRouter, appsRouter, chatRouter, healthRouter } from './routes/index.js';
import { AgentRegistry } from '../registry/index.js';
import { ExampleAgent, DevelopAgent } from '../agents/index.js';
import { getDatabase } from '../database/index.js';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

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
    
    // Initialize agent registry
    const registry = AgentRegistry.getInstance();
    
    // Register agents
    console.log('📝 Registering agents...');
    registry.register(ExampleAgent);
    registry.register(DevelopAgent);
    
    // Initialize all agents
    await registry.initializeAll();
    
    console.log('✅ Agent registry initialized');
    
    // Start server
    app.listen(port, () => {
      console.log(`🌐 Server running on http://localhost:${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
      console.log(`🤖 Agents list: http://localhost:${port}/agents`);
      console.log('');
      console.log('Available endpoints:');
      console.log(`  GET  /agents - List all agents`);
      console.log(`  GET  /agents/{id} - Get agent details`);
      console.log(`  GET  /apps - List all apps`);
      console.log(`  POST /apps - Create new app`);
      console.log(`  GET  /apps/{id} - Get app details`);
      console.log(`  PUT  /apps/{id} - Update app`);
      console.log(`  DELETE /apps/{id} - Delete app`);
      console.log(`  POST /agent/{id}/chat - Chat with agent`);
      console.log(`  POST /agent/{id}/chat-streaming - Streaming chat`);
      console.log(`  GET  /health - Health check`);
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

export { app, initialize, shutdown };
