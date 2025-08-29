# Structured Logging System

## Overview

This is the Phase 1 implementation of the structured logging system for Airo App Builder. It provides a consistent, event-driven logging architecture that produces structured JSON in production while offering an enhanced developer experience in development.

## Features Implemented

### Core Infrastructure ✅

- **Logger Class**: Complete implementation with singleton pattern and configuration support
- **Event Schema Validation**: Zod-based schema validation for all log events
- **Domain-Specific Events**: Structured events for app, agent, file, api, db, ws, and perf domains
- **Multiple Handlers**: Production (JSON), Development (rich console), and Test (memory buffer) handlers
- **Configuration System**: Environment-based configuration with presets

### Key Capabilities

#### 🎯 Structured Events
```typescript
logger.info('app.created', { 
  name: 'My App', 
  templateVersion: 'v3',
  port: 3001 
});

logger.error('file.not.found', { 
  path: '/missing/file.txt' 
});
```

#### 🔧 Rich Development Experience
- Color-coded log levels with emojis
- Domain-specific formatting (📱 app, 🤖 agent, 📄 file, etc.)
- Auto-collapsing large objects (configurable threshold)
- Context information display (appId, requestId, etc.)
- Performance timing integration

#### 🏭 Production Ready
- Structured JSON output to stdout/stderr
- Automatic sensitive data sanitization
- Configurable log levels and domain filtering
- Performance optimized with minimal overhead

#### 🧪 Testing Support
- Memory-buffered test handler
- Rich assertion helpers
- Event filtering and statistics
- Async event waiting capabilities

## File Structure

```
src/logging/
├── README.md                 # This file
├── index.ts                 # Main exports
├── types.ts                 # Core type definitions
├── Logger.ts                # Main Logger class
├── config.ts                # Configuration system
├── utils.ts                 # Utility functions
├── schemas/
│   ├── index.ts            # Schema validation exports
│   ├── base.ts             # Base schemas
│   └── events.ts           # Domain-specific event schemas
├── handlers/
│   ├── ProductionHandler.ts # JSON output for production
│   ├── DevelopmentHandler.ts# Rich console for development
│   └── TestHandler.ts      # Memory buffer for testing
└── __tests__/
    └── Logger.test.ts      # Comprehensive test suite
```

## Usage Examples

### Basic Logging
```typescript
import { Logger } from './logging';

const logger = Logger.create();

// Simple events
logger.info('app.started', { port: 4000 });
logger.debug('agent.tool.called', { toolName: 'file-edit' });
logger.warn('file.large', { path: '/big/file.txt', size: 5000000 });
logger.error('db.connection.failed', { host: 'localhost' });
```

### Context & Child Loggers
```typescript
// Create logger with context
const appLogger = logger.child({ appId: 'app-123' });
appLogger.info('app.created', { name: 'My App' });

// Convenience methods
import { log } from './logging';
const agentLogger = log.forAgent('develop-agent');
const requestLogger = log.forRequest('req-456');
```

### Performance Timing
```typescript
import { log, createTimer } from './logging';

// Manual timing
const timer = createTimer();
// ... do work ...
const duration = timer.end();
logger.info('operation.completed', { result: 'success' }, { duration });

// Convenience timer
const opTimer = log.timer(logger, 'file.processed');
// ... process file ...
opTimer.end({ fileName: 'example.txt' });
```

### Error Handling
```typescript
import { log } from './logging';

try {
  // Some operation
} catch (error) {
  log.error(logger, 'operation.failed', error, {
    context: 'additional data'
  });
}
```

### Testing
```typescript
import { TestHandler, Logger } from './logging';

const testHandler = new TestHandler();
Logger.configure({ level: 'debug', handlers: [testHandler] });

// Generate events...
logger.info('test.event', { data: 'test' });

// Assertions
const assertions = testHandler.createAssertions();
assertions.hasEventType('test.event');
assertions.eventCount(1);
assertions.hasNoErrors();

// Advanced querying
const events = testHandler.getEventsByDomain('test');
const stats = testHandler.getStats();
```

## Configuration

### Environment Variables
```bash
# Log level
LOG_LEVEL=debug|info|warn|error|fatal

# Output format  
LOG_FORMAT=json|dev|pretty

# Domain filtering
LOG_DOMAINS=app,agent,file    # Only these domains
LOG_DISABLED_DOMAINS=perf     # Exclude these domains

# Development options
LOG_DEV_EXPAND_THRESHOLD=1000 # Auto-collapse threshold
LOG_DEV_TIMESTAMPS=true       # Show timestamps
LOG_DEV_PERFORMANCE=true      # Show durations
LOG_DEV_COLORIZE=true         # Use colors
```

### Programmatic Configuration
```typescript
import { Logger, LoggingPresets } from './logging';

// Use presets
Logger.configure(LoggingPresets.development());
Logger.configure(LoggingPresets.production());
Logger.configure(LoggingPresets.test());

// Custom configuration
Logger.configure({
  level: 'info',
  handlers: [new DevelopmentHandler()],
  context: { service: 'my-service', version: '1.0.0' },
  enabledDomains: ['app', 'agent'],
  disabledDomains: ['perf']
});
```

## Event Schema

### Base Event Structure
```typescript
interface LogEvent {
  // Required
  timestamp: string;           // ISO 8601
  level: 'debug'|'info'|'warn'|'error'|'fatal';
  event: string;               // e.g., 'app.created'
  message: string;             // Human readable

  // Context (optional)
  appId?: string;
  agentId?: string;
  requestId?: string;
  conversationId?: string;

  // Data & metadata (optional)
  data?: Record<string, any>;
  duration?: number;           // milliseconds
  tags?: string[];
  meta?: Record<string, any>;
  error?: LogError;
}
```

### Domain Events
- **app.*** - Application lifecycle (creating, created, running, stopped, etc.)
- **agent.*** - AI agent operations (executing, tool.called, prompt.sent, etc.) 
- **file.*** - File operations (read, write, edit, delete, etc.)
- **api.*** - HTTP API events (request.received, response.sent, etc.)
- **db.*** - Database operations (query.executed, migration.applied, etc.)
- **ws.*** - WebSocket events (connection.opened, message.received, etc.)
- **perf.*** - Performance metrics (timer.started, memory.usage, etc.)

## Security Features

### Automatic Data Sanitization
Sensitive fields are automatically redacted in logs:
- `password`, `token`, `secret`, `key`, `apikey`, `api_key`
- `authorization`, `auth`, `credential`, `credentials`

Example:
```typescript
logger.info('api.request', {
  headers: { authorization: 'Bearer secret-token' }
});
// Output: { headers: { authorization: '[REDACTED]' } }
```

## Testing

Run the test suite:
```bash
pnpm test src/logging/__tests__/Logger.test.ts
```

All 9 tests pass, covering:
- Basic logging functionality
- Context and child loggers  
- Log level filtering
- Domain filtering
- Performance timing
- Error handling
- Test assertions
- Data sanitization

## Next Steps (Future Phases)

### Phase 2: Enhanced Development Experience
- [ ] Web-based log dashboard
- [ ] Real-time log streaming via WebSocket
- [ ] Advanced filtering UI
- [ ] Event correlation and tracing
- [ ] Performance waterfall charts

### Phase 3: Production Features
- [ ] Log aggregation integration (ELK, Datadog, etc.)
- [ ] Configurable sampling and retention
- [ ] Monitoring and alerting integration
- [ ] Log rotation and archival
- [ ] Distributed tracing support

## Migration Guide

To start using the new logging system:

1. **Replace console.log statements:**
   ```typescript
   // Old
   console.log('App started on port', port);
   
   // New
   logger.info('app.started', { port });
   ```

2. **Use structured events:**
   ```typescript
   // Old
   console.error('Failed to create app:', error);
   
   // New
   log.error(logger, 'app.creation.failed', error, { name: appName });
   ```

3. **Add context:**
   ```typescript
   // Create contextual loggers
   const appLogger = log.forApp(appId);
   const requestLogger = log.forRequest(requestId);
   ```

The system is designed to be backward compatible and can be gradually adopted across the codebase.