/**
 * App domain event interfaces with consistent lifecycle naming
 */

import type {
  AppEventData,
  DockerEventData,
  ProcessEventData,
  FileEventData,
  DurationInfo,
  ErrorContext,
  NetworkInfo,
  OperationType
} from './base.js';

// Repository Events
export interface AppRepositoryInitData extends DurationInfo {
  adapterType: 'Docker' | 'Local';
  processCount?: number;  // orphaned processes found
}

export interface AppProcessRecoveryData extends ProcessEventData {
  port?: number;
  status: 'recovered' | 'cleanup' | 'dead';
  wasValid?: boolean;     // for cleanup cases
  portOccupied?: boolean; // for validation
}

// App Creation Events
export interface AppCreationBeginData extends AppEventData {
  name: string;
  templateVersion: string;
  baseDir: string;
  port: number;
  initialPrompt?: string;
}

export interface AppNameSuggestionData extends AppEventData {
  originalName: string;
  suggestedName?: string;
  hasPrompt: boolean;
}

export interface AppTemplateOperationData extends AppEventData, FileEventData {
  templateVersion: string;
  templatePath: string;
  operation: 'resolve' | 'copy' | 'validate';
}

export interface AppDirectoryOperationData extends AppEventData, FileEventData {
  permissions: string;
  size?: number;
  parentExists: boolean;
  diskSpace?: {
    available: number;
    used: number;
    total: number;
  };
}

// Setup & Installation Events
export interface AppSetupOperationData extends AppEventData, DurationInfo {
  operation: OperationType;
  phase?: 'template' | 'dependencies' | 'git' | 'server' | undefined;
  exitCode?: number | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  command?: string | undefined;
  originalError?: string | undefined;
}

export interface AppProcessManagementData extends AppEventData {
  processId: number;
  port?: number;
  operation: 'kill' | 'start' | 'stop' | 'cleanup';
  signal?: 'SIGTERM' | 'SIGKILL';
}

export interface AppCleanupOperationData extends AppEventData {
  operation: 'process' | 'directory' | 'docker' | 'orphan';
  itemsProcessed?: number;
  itemsCleaned?: number;
}

export interface AppDependencyInstallData extends AppEventData, FileEventData, DurationInfo {
  packageManager: 'npm' | 'pnpm' | 'yarn';
  registry?: string;
  packages?: {
    installed: number;
    cached: number;
    failed: number;
  };
}

export interface AppGitOperationData extends AppEventData, FileEventData {
  operation: 'init' | 'config' | 'commit';
  branch?: string;
  commits?: number;
  userConfigured?: boolean;
}

// Server & Container Events
export interface AppServerOperationData extends AppEventData, NetworkInfo, DurationInfo {
  processId?: number;
  packageManager?: 'npm' | 'pnpm' | 'yarn';
  command?: string;
  logPaths?: {
    stdout: string;
    stderr: string;
  };
}

export interface AppDockerOperationData extends AppEventData, DockerEventData, NetworkInfo {
  image?: string;
  ports?: number[];
  command?: string;
}

// Lifecycle Management Events
export interface AppLifecycleData extends AppEventData, DurationInfo {
  previousStatus?: 'creating' | 'created' | 'running' | 'stopped' | 'error';
  newStatus: 'creating' | 'created' | 'running' | 'stopped' | 'error';
  reason?: string;
}

export interface AppCleanupData extends AppEventData, FileEventData {
  operation: 'database' | 'directory' | 'process' | 'docker';
  itemsRemoved?: number;
  bytesFreed?: number;
}

// Error Events
export interface AppErrorData extends AppEventData, ErrorContext {
  operation: string;
  phase?: string;
  rollbackPerformed?: boolean;
  cleanupRequired?: boolean;
}

// Transaction Events
export interface AppTransactionData extends AppEventData {
  operation: 'begin' | 'commit' | 'rollback';
  transactionId?: string;
  itemsAffected?: number;
}

// File Upload Events
export interface FileUploadProcessData extends AppEventData {
  uploadId: string;
  fileCount: number;
  totalSize: number;
}

export interface FileUploadValidationData extends AppEventData {
  uploadId?: string;
  fileCount?: number;
  mimeType?: string;
  fileSize?: number;
  maxFileSize?: number;
  maxFiles?: number;
  allowedTypes?: string[];
}

export interface FileUploadRetrievalData extends AppEventData {
  uploadId: string;
  fileCount?: number;
  metadataExists: boolean;
}

export interface FileUploadCleanupData extends AppEventData {
  uploadId?: string;
  deletedCount?: number;
  expiredCount?: number;
  operation: 'delete' | 'expired' | 'app-cleanup';
}

export interface FileUploadDirectoryData extends AppEventData {
  uploadId?: string;
  path: string;
  operation: 'create' | 'ensure';
}

// Tool Events
export interface ToolImageSearchData {
  toolName: string;
  prompt: string;
  count: number;
  provider: 'getty' | 'openai' | 'unsplash';
  cacheHit?: boolean;
  resultUrls?: string[];
  resultCount?: number;
}

export interface ToolCacheOperationData {
  toolName: string;
  cacheKey: string;
  operation: 'get' | 'set' | 'cleanup';
  cacheDir?: string;
  fileAge?: number;
  maxAge?: number;
  itemsProcessed?: number;
}

export interface ToolFileEditData {
  toolName: string;
  filePath: string;
  mode: 'create' | 'edit' | 'rewrite';
  appId?: string;
  contentLength?: number;
  editsCount?: number;
  dryRun?: boolean;
  autoCommit?: boolean;
  autoBuild?: boolean;
}

export interface ToolBuildOperationData {
  toolName: string;
  appId?: string;
  appPath: string;
  buildCommand?: string;
  buildType?: 'validation' | 'full';
}

export interface ToolServerHealthData {
  toolName: string;
  appId: string;
  port: number;
  isHealthy?: boolean;
  responseStatus?: number;
}

export interface ToolDirectoryListingData {
  toolName: string;
  targetPath: string;
  appId?: string;
  options?: {
    directoriesOnly?: boolean;
    pattern?: string;
    search?: string;
    maxDepth?: number;
    showHidden?: boolean;
    ignorePatterns?: string[];
  };
  resultStats?: {
    totalEntries: number;
    directoryCount: number;
    fileCount: number;
    truncated: boolean;
    errorCount: number;
  };
}

export interface ToolDirectoryWalkData {
  toolName: string;
  currentPath: string;
  appId?: string;
  depth: number;
  maxDepth: number;
  entriesProcessed?: number;
}

export interface ToolGrepSearchData {
  toolName: string;
  query: string;
  appId?: string;
  searchOptions?: {
    regex: boolean;
    caseSensitive: boolean;
    wholeWord: boolean;
    contextLines: number;
    maxResults: number;
    maxFilesSearched: number;
  };
  resultStats?: {
    totalMatches: number;
    filesSearched: number;
    truncated: boolean;
    searchTime: number;
  };
  paths?: string[];
}

export interface ToolGitOperationData {
  toolName: string;
  operation: 'status' | 'add' | 'commit' | 'diff' | 'log' | 'branch' | 'checkout' | 'merge' | 'pull' | 'push' | 'stash' | 'reset' | 'revert' | 'restore';
  appPath: string;
  appId?: string;
  options?: {
    files?: string[];
    message?: string;
    branch?: string;
    all?: boolean;
    amend?: boolean;
    force?: boolean;
    hard?: boolean;
    count?: number;
    createBranch?: boolean;
    includeUntracked?: boolean;
    verbose?: boolean;
    autoMessage?: boolean;
    dryRun?: boolean;
  };
  resultStats?: {
    success: boolean;
    filesAffected?: number;
    branchesCount?: number;
    commitsCount?: number;
    executionTime?: number;
  };
}

export interface ToolImageGenerationData {
  toolName: string;
  appId: string;
  prompt: string;
  options?: {
    size?: '1024x1024' | '512x512' | '256x256';
    style?: 'vivid' | 'natural';
    filename?: string;
  };
  resultStats?: {
    success: boolean;
    filePath?: string;
    publicPath?: string;
    fileSize?: number;
    executionTime?: number;
  };
}

export interface ToolAstEditData {
  toolName: string;
  appId?: string;
  filePath: string;
  editType: 'style' | 'component' | 'generic';
  targetInfo?: {
    tagName?: string;
    className?: string;
    lineNumber?: number;
    selector?: string;
    componentName?: string;
  };
  changes?: {
    property?: string;
    value?: string;
    oldClassName?: string;
    newClassName?: string;
  };
  resultStats?: {
    success: boolean;
    hasChanges?: boolean;
    linesChanged?: number;
    commitHash?: string;
    executionTime?: number;
  };
}

export interface ToolMySqlData {
  toolName: string;
  appId?: string;
  operation: 'enable_database' | 'test_connection' | 'list_databases';
  connectionInfo?: {
    host?: string;
    port?: number;
    user?: string;
  };
  databaseInfo?: {
    databaseName?: string;
    originalDatabaseName?: string;
    username?: string;
    userId?: string;
  };
  resultStats?: {
    success: boolean;
    databaseCreated?: boolean;
    userCreated?: boolean;
    databasesFound?: number;
    connectionTested?: boolean;
    executionTime?: number;
  };
}

export interface ToolLogReaderData {
  toolName: string;
  appId?: string;
  operation: 'read' | 'summary';
  logOptions?: {
    source?: 'stdout' | 'stderr';
    lines?: number;
    since?: string;
    format?: boolean;
  };
  resultStats?: {
    success: boolean;
    totalEntries?: number;
    linesRequested?: number;
    sourceFilter?: string;
    sinceFilter?: string;
    executionTime?: number;
  };
}

// Tool Memory Operations Data
export interface ToolMemoryOperationData {
  toolName: string;
  appId?: string;
  key?: string;
  query?: string;
  operation: 'set' | 'read' | 'list' | 'search';
  valueType?: 'string' | 'object' | 'array' | 'number' | 'boolean' | 'null';
  memoryPath?: string;
  keyExists?: boolean;
  limit?: number;
  scoreThreshold?: number;
  prefix?: string;
  resultStats?: {
    keyCount?: number;
    resultCount?: number;
    fileSize?: number;
    success: boolean;
    executionTime?: number;
  };
}

// HTTP Request Events
export interface HttpRequestData {
  method: string;
  url: string;
  userAgent?: string;
  ip?: string;
  requestId?: string;
  headers?: Record<string, string>;
  query?: Record<string, any>;
  body?: any;
  auth?: {
    customerId?: string;
    shopperId?: string;
    siteId?: string;
    authenticationBypass?: boolean;
    bypassReason?: string;
  };
  responseStats?: {
    statusCode: number;
    contentLength?: number;
    duration: number;
  };
}

// WebSocket Events
export interface WebSocketConnectionData {
  event: 'connection' | 'disconnection' | 'error';
  agentId: string;
  clientIP?: string;
  url?: string;
  connectionId?: string;
  error?: string;
}

export interface WebSocketChatData {
  event: 'chat_message' | 'chat_response' | 'chat_error';
  agentId: string;
  threadId?: string;
  conversationId?: string;
  appId?: string;
  userId?: string;
  messageLength?: number;
  hasToolCalls?: boolean;
  toolCallCount?: number;
  responseStats?: {
    duration: number;
    functionCallCount?: number;
    contentLength?: number;
  };
}

// Docker Container Events
export interface DockerContainerData {
  appId: string;
  containerId?: string;
  imageName?: string;
  port?: number;
  templateVersion?: string;
  operation: 'initialize' | 'create' | 'start' | 'stop' | 'remove' | 'restart' | 'rebuild' | 'recover' | 'cleanup';
  operationStats?: {
    success: boolean;
    duration?: number;
    containerStatus?: 'building' | 'running' | 'stopped' | 'error';
    containersRecovered?: number;
    containersCleanedUp?: number;
  };
}

// LLM Request/Response Events
export interface LLMRequestData {
  requestId?: string | undefined;
  agentId?: string | undefined;
  threadId?: string | undefined;
  model: string;
  messageCount: number;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  streaming?: boolean | undefined;
  hasTools?: boolean | undefined;
  // messages moved to debug level logging only
}

export interface LLMResponseData extends LLMRequestData {
  responseId?: string | undefined;
  contentLength?: number | undefined;
  chunkCount?: number | undefined;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | undefined;
  finishReason?: string | undefined;
  duration: number;
}

export interface LLMTokenUsageData {
  appId: string;
  operation: 'record_usage' | 'record_streaming_usage';
  tokenType: 'llm_request';
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number | undefined;
  model?: string | undefined;
  conversationId?: string | undefined;
  description?: string | undefined;
}

export interface LLMRetryData {
  attempt: number;
  totalAttempts: number;
  /** High-level category of error */
  errorType: 'network' | 'server' | 'client' | 'unknown';
  /** Optional subtype for more granular classification */
  errorSubType?: 'rate_limit' | 'service_unavailable';
  statusCode?: number;
  message: string;
  nextRetryDelayMs?: number;
  elapsedMs: number;
  operation: 'generate' | 'stream';
  model?: string;
  agentId?: string;
}

// Tracing Events
export interface TracingEventData {
  traceId: string;
  eventType: 'request' | 'response' | 'error' | 'debug' | 'tool_call' | 'websocket';
  agentId?: string | undefined;
  threadId?: string | undefined;
  data: Record<string, unknown>;
}

// Conversation Context Events
export interface ConversationContextLoadData {
  conversationId: string;
  messageCount: number;
  recentMessageCount: number;
  hasHistory: boolean;
  hasAppContext?: boolean;
  hasAiEditContext?: boolean;
  hasVisualContext?: boolean;
}

export interface ConversationContextBuildData {
  conversationId?: string | undefined;
  totalMessages: number;
  systemPromptLength: number;
  currentMessageLength: number;
  hasHistory: boolean;
  hasAppContext?: boolean | undefined;
  hasAiEditContext?: boolean;
  hasVisualContext?: boolean;
  filteredMessages?: number;
}

// App Context Events
export interface AppContextGenerationData extends AppEventData {
  directoryPath: string;
  fileCount?: number;
  directoryCount?: number;
  packageName?: string;
  packageVersion?: string;
  dependencyCount?: number;
  scriptCount?: number;
  dependenciesInstalled?: boolean;
  contextSize?: number;
}

export interface AppContextPackageData extends AppEventData {
  packageJsonFound: boolean;
  packageName?: string;
  packageVersion?: string;
  dependencyCount?: number;
  devDependencyCount?: number;
  scriptCount?: number;
  dependenciesInstalled?: boolean;
  installationCheckMethod?: 'lockfile' | 'timestamps' | 'none';
}

export interface AppContextDirectoryData extends AppEventData, FileEventData {
  maxDepth: number;
  fileCount?: number;
  directoryCount?: number;
  treeLines?: number;
  truncated?: boolean;
}

export interface ConversationHistoryProcessData {
  conversationId: string;
  totalDbMessages: number;
  processedMessages: number;
  messageType: 'user' | 'agent';
  hasSegments?: boolean;
  hasToolCalls?: boolean;
}

export interface ConversationTokenLimitData {
  appId: string;
  agentId: string;
  conversationsFound: number;
  totalDbMessages: number;
  processedMessages: number;
  estimatedTokens: number;
  maxTokens: number;
  modelName?: string;
  messageDistribution: Record<string, number>;
}

// Event type mappings for consistent naming
export const AppEvents = {
  // Repository lifecycle: app.repository.init.{begin|success|failure}
  repositoryInit: {
    begin: 'app.repository.init.begin' as const,
    success: 'app.repository.init.success' as const,
    failure: 'app.repository.init.failure' as const,
  },

  // Process recovery: app.process.recover.{begin|success|failure}
  processRecover: {
    begin: 'app.process.recover.begin' as const,
    success: 'app.process.recover.success' as const,
    failure: 'app.process.recover.failure' as const,
  },

  // App creation: app.create.{begin|success|failure|abort}
  create: {
    begin: 'app.create.begin' as const,
    success: 'app.create.success' as const,
    failure: 'app.create.failure' as const,
    abort: 'app.create.abort' as const,
  },

  // Name suggestion: app.name.suggest.{begin|success|failure}
  nameSuggest: {
    begin: 'app.name.suggest.begin' as const,
    success: 'app.name.suggest.success' as const,
    failure: 'app.name.suggest.failure' as const,
  },

  // Template operations: app.template.{resolve|copy|validate}.{begin|success|failure}
  template: {
    resolve: {
      begin: 'app.template.resolve.begin' as const,
      success: 'app.template.resolve.success' as const,
      failure: 'app.template.resolve.failure' as const,
    },
    copy: {
      begin: 'app.template.copy.begin' as const,
      success: 'app.template.copy.success' as const,
      failure: 'app.template.copy.failure' as const,
    },
    validate: {
      begin: 'app.template.validate.begin' as const,
      success: 'app.template.validate.success' as const,
      failure: 'app.template.validate.failure' as const,
    },
  },

  // Directory operations: app.directory.{create|cleanup}.{begin|success|failure}
  directory: {
    create: {
      begin: 'app.directory.create.begin' as const,
      success: 'app.directory.create.success' as const,
      failure: 'app.directory.create.failure' as const,
    },
    cleanup: {
      begin: 'app.directory.cleanup.begin' as const,
      success: 'app.directory.cleanup.success' as const,
      failure: 'app.directory.cleanup.failure' as const,
    },
  },

  // Setup operations: app.setup.{init|install|build}.{begin|progress|success|failure}
  setup: {
    init: {
      begin: 'app.setup.init.begin' as const,
      progress: 'app.setup.init.progress' as const,
      success: 'app.setup.init.success' as const,
      failure: 'app.setup.init.failure' as const,
    },
    install: {
      begin: 'app.setup.install.begin' as const,
      progress: 'app.setup.install.progress' as const,
      success: 'app.setup.install.success' as const,
      failure: 'app.setup.install.failure' as const,
    },
  },

  // Process management: app.process.{kill|cleanup}.{begin|success|failure}
  processManagement: {
    kill: {
      begin: 'app.process.kill.begin' as const,
      success: 'app.process.kill.success' as const,
      failure: 'app.process.kill.failure' as const,
    },
    cleanup: {
      begin: 'app.process.cleanup.begin' as const,
      success: 'app.process.cleanup.success' as const,
      failure: 'app.process.cleanup.failure' as const,
    },
  },

  // Cleanup operations: app.cleanup.{orphan|directory}.{begin|success|failure}
  cleanup: {
    orphan: {
      begin: 'app.cleanup.orphan.begin' as const,
      success: 'app.cleanup.orphan.success' as const,
      failure: 'app.cleanup.orphan.failure' as const,
    },
    directory: {
      begin: 'app.cleanup.directory.begin' as const,
      success: 'app.cleanup.directory.success' as const,
      failure: 'app.cleanup.directory.failure' as const,
    },
  },

  // Server operations: app.server.{deploy|start|stop|restart}.{begin|success|failure}
  server: {
    deploy: {
      begin: 'app.server.deploy.begin' as const,
      success: 'app.server.deploy.success' as const,
      failure: 'app.server.deploy.failure' as const,
    },
    start: {
      begin: 'app.server.start.begin' as const,
      success: 'app.server.start.success' as const,
      failure: 'app.server.start.failure' as const,
    },
    stop: {
      begin: 'app.server.stop.begin' as const,
      success: 'app.server.stop.success' as const,
      failure: 'app.server.stop.failure' as const,
    },
  },

  // Docker operations: app.docker.{deploy|start|stop}.{begin|success|failure}
  docker: {
    deploy: {
      begin: 'app.docker.deploy.begin' as const,
      success: 'app.docker.deploy.success' as const,
      failure: 'app.docker.deploy.failure' as const,
    },
    start: {
      begin: 'app.docker.start.begin' as const,
      success: 'app.docker.start.success' as const,
      failure: 'app.docker.start.failure' as const,
    },
    stop: {
      begin: 'app.docker.stop.begin' as const,
      success: 'app.docker.stop.success' as const,
      failure: 'app.docker.stop.failure' as const,
    },
  },

  // Lifecycle state changes: app.lifecycle.{create|ready|destroy}
  lifecycle: {
    create: 'app.lifecycle.create' as const,
    ready: 'app.lifecycle.ready' as const,
    destroy: 'app.lifecycle.destroy' as const,
  },

  // Transaction operations: app.transaction.{begin|commit|rollback}
  transaction: {
    begin: 'app.transaction.begin' as const,
    commit: 'app.transaction.commit' as const,
    rollback: 'app.transaction.rollback' as const,
  },

  // Tool operations: tool.image.search.{begin|success|failure}
  tool: {
    imageSearch: {
      begin: 'tool.image.search.begin' as const,
      success: 'tool.image.search.success' as const,
      failure: 'tool.image.search.failure' as const,
    },
    cache: {
      get: {
        begin: 'tool.cache.get.begin' as const,
        success: 'tool.cache.get.success' as const,
        failure: 'tool.cache.get.failure' as const,
      },
      set: {
        begin: 'tool.cache.set.begin' as const,
        success: 'tool.cache.set.success' as const,
        failure: 'tool.cache.set.failure' as const,
      },
      cleanup: {
        begin: 'tool.cache.cleanup.begin' as const,
        success: 'tool.cache.cleanup.success' as const,
        failure: 'tool.cache.cleanup.failure' as const,
      },
    },
    fileEdit: {
      begin: 'tool.file.edit.begin' as const,
      success: 'tool.file.edit.success' as const,
      failure: 'tool.file.edit.failure' as const,
    },
    build: {
      begin: 'tool.build.begin' as const,
      success: 'tool.build.success' as const,
      failure: 'tool.build.failure' as const,
    },
    serverHealth: {
      check: 'tool.server.health.check' as const,
      healthy: 'tool.server.health.healthy' as const,
      unhealthy: 'tool.server.health.unhealthy' as const,
      restart: 'tool.server.health.restart' as const,
    },
    directoryListing: {
      begin: 'tool.directory.listing.begin' as const,
      success: 'tool.directory.listing.success' as const,
      failure: 'tool.directory.listing.failure' as const,
    },
    directoryWalk: {
      begin: 'tool.directory.walk.begin' as const,
      progress: 'tool.directory.walk.progress' as const,
      complete: 'tool.directory.walk.complete' as const,
      error: 'tool.directory.walk.error' as const,
    },
    grep: {
      begin: 'tool.grep.search.begin' as const,
      success: 'tool.grep.search.success' as const,
      failure: 'tool.grep.search.failure' as const,
    },
    git: {
      begin: 'tool.git.operation.begin' as const,
      success: 'tool.git.operation.success' as const,
      failure: 'tool.git.operation.failure' as const,
    },
    imageGeneration: {
      begin: 'tool.image.generation.begin' as const,
      success: 'tool.image.generation.success' as const,
      failure: 'tool.image.generation.failure' as const,
    },
    astEdit: {
      begin: 'tool.ast.edit.begin' as const,
      success: 'tool.ast.edit.success' as const,
      failure: 'tool.ast.edit.failure' as const,
    },
    mysql: {
      begin: 'tool.mysql.operation.begin' as const,
      success: 'tool.mysql.operation.success' as const,
      failure: 'tool.mysql.operation.failure' as const,
    },
    memory: {
      set: {
        begin: 'tool.memory.set.begin' as const,
        success: 'tool.memory.set.success' as const,
        failure: 'tool.memory.set.failure' as const,
      },
      read: {
        begin: 'tool.memory.read.begin' as const,
        success: 'tool.memory.read.success' as const,
        failure: 'tool.memory.read.failure' as const,
      },
      list: {
        begin: 'tool.memory.list.begin' as const,
        success: 'tool.memory.list.success' as const,
        failure: 'tool.memory.list.failure' as const,
      },
      search: {
        begin: 'tool.memory.search.begin' as const,
        success: 'tool.memory.search.success' as const,
        failure: 'tool.memory.search.failure' as const,
      },
    },
    logReader: {
      read: {
        begin: 'tool.log.reader.read.begin' as const,
        success: 'tool.log.reader.read.success' as const,
        failure: 'tool.log.reader.read.failure' as const,
      },
      summary: {
        begin: 'tool.log.reader.summary.begin' as const,
        success: 'tool.log.reader.summary.success' as const,
        failure: 'tool.log.reader.summary.failure' as const,
      },
    },
  },

  // HTTP Request events: http.request.{begin|success|error}
  http: {
    request: {
      begin: 'http.request.begin' as const,
      success: 'http.request.success' as const,
      error: 'http.request.error' as const,
    },
  },

  // WebSocket events: websocket.{connection|chat}.{event_type}
  websocket: {
    connection: {
      connected: 'websocket.connection.connected' as const,
      disconnected: 'websocket.connection.disconnected' as const,
      error: 'websocket.connection.error' as const,
    },
    chat: {
      message: 'websocket.chat.message' as const,
      response: 'websocket.chat.response' as const,
      error: 'websocket.chat.error' as const,
    },
  },

  // LLM events: llm.{request|response|token_usage|error|retry}
  llm: {
    request: 'llm.request' as const,
    response: 'llm.response' as const,
    error: 'llm.error' as const,
    tokenUsage: {
      begin: 'llm.token_usage.begin' as const,
      success: 'llm.token_usage.success' as const,
      failure: 'llm.token_usage.failure' as const,
    },
    retry: {
      attempt: 'llm.api_call.retry' as const,
      success: 'llm.api_call.retry_success' as const,
      exhausted: 'llm.api_call.retry_exhausted' as const,
    },
  },

  // Tracing events: trace.{event_type}
  trace: {
    request: 'trace.request' as const,
    response: 'trace.response' as const,
    error: 'trace.error' as const,
    debug: 'trace.debug' as const,
    toolCall: 'trace.tool_call' as const,
    websocket: 'trace.websocket' as const,
  },

  // Docker Container events: docker.container.{begin|success|failure}
  dockerContainer: {
    begin: 'docker.container.operation.begin' as const,
    success: 'docker.container.operation.success' as const,
    failure: 'docker.container.operation.failure' as const,
  },

  // Conversation Context events: conversation.context.{load|build}.{begin|success|failure}
  conversation: {
    context: {
      load: {
        begin: 'conversation.context.load.begin' as const,
        success: 'conversation.context.load.success' as const,
        failure: 'conversation.context.load.failure' as const,
      },
      build: {
        begin: 'conversation.context.build.begin' as const,
        success: 'conversation.context.build.success' as const,
        failure: 'conversation.context.build.failure' as const,
      },
    },
    history: {
      process: {
        begin: 'conversation.history.process.begin' as const,
        success: 'conversation.history.process.success' as const,
        failure: 'conversation.history.process.failure' as const,
      },
    },
    tokenLimit: {
      load: {
        begin: 'conversation.token_limit.load.begin' as const,
        success: 'conversation.token_limit.load.success' as const,
        failure: 'conversation.token_limit.load.failure' as const,
      },
    },
  },

  // File Upload events: fileUpload.{process|validate|retrieve|cleanup|directory}.{begin|success|failure}
  fileUpload: {
    process: {
      start: 'file-upload.process.start' as const,
      success: 'file-upload.process.success' as const,
      failure: 'file-upload.process.failure' as const,
    },
    validate: {
      file: 'file-upload.validation.file' as const,
      upload: 'file-upload.validation.upload' as const,
      failure: 'file-upload.validation.failure' as const,
    },
    retrieve: {
      success: 'file-upload.get.success' as const,
      notFound: 'file-upload.get.not-found' as const,
      failure: 'file-upload.metadata.read-error' as const,
    },
    cleanup: {
      deleted: 'file-upload.upload.deleted' as const,
      expired: 'file-upload.cleanup.expired' as const,
      complete: 'file-upload.cleanup.complete' as const,
      appComplete: 'file-upload.app-cleanup.complete' as const,
      failure: 'file-upload.cleanup.failed' as const,
    },
    directory: {
      created: 'file-upload.directory.created' as const,
      uploadCreated: 'file-upload.upload-directory.created' as const,
      appCreated: 'file-upload.app-directory.created' as const,
      failure: 'file-upload.directory.creation-failed' as const,
    },
    file: {
      saved: 'file-upload.file.saved' as const,
    },
  },

  // App Context events: app.context.{generate|package|directory}.{begin|success|failure}
  app: {
    context: {
      generate: {
        begin: 'app.context.generate.begin' as const,
        success: 'app.context.generate.success' as const,
        failure: 'app.context.generate.failure' as const,
      },
      package: {
        begin: 'app.context.package.begin' as const,
        success: 'app.context.package.success' as const,
        failure: 'app.context.package.failure' as const,
      },
      directory: {
        begin: 'app.context.directory.begin' as const,
        success: 'app.context.directory.success' as const,
        failure: 'app.context.directory.failure' as const,
      },
    },
  },
} as const;

// Type helpers for event data validation
export type AppEventType = typeof AppEvents[keyof typeof AppEvents];
export type AppEventName = AppEventType extends Record<string, infer U> ? U : AppEventType;
