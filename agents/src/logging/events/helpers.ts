/**
 * Typed logging helper functions for consistent event logging
 */

import type { ILogger } from '../types.js';
import { log } from '../index.js';
import { AppEvents } from './app.js';
import type {
  AppRepositoryInitData,
  AppProcessRecoveryData,
  AppCreationBeginData,
  AppNameSuggestionData,
  AppTemplateOperationData,
  AppDirectoryOperationData,
  AppSetupOperationData,
  AppDependencyInstallData,
  AppGitOperationData,
  AppServerOperationData,
  AppDockerOperationData,
  AppLifecycleData,
  AppCleanupData,
  AppErrorData,
  AppTransactionData,
  AppProcessManagementData,
  AppCleanupOperationData,
  ToolImageSearchData,
  ToolCacheOperationData,
  ToolFileEditData,
  ToolBuildOperationData,
  ToolServerHealthData,
  ToolDirectoryListingData,
  ToolDirectoryWalkData,
  ToolGrepSearchData,
  ToolGitOperationData,
  ToolImageGenerationData,
  ToolAstEditData,
  ToolMySqlData,
  HttpRequestData,
  WebSocketConnectionData,
  WebSocketChatData,
  DockerContainerData,
  LLMRequestData,
  LLMResponseData,
  LLMTokenUsageData,
  TracingEventData,
} from './app.js';

/**
 * App Repository logging helpers
 */
export const appRepositoryEvents = {
  initBegin: (logger: ILogger, data: Omit<AppRepositoryInitData, 'startTime'>) => {
    logger.info(AppEvents.repositoryInit.begin, {
      ...data,
      startTime: new Date().toISOString(),
    });
  },

  initSuccess: (logger: ILogger, data: AppRepositoryInitData) => {
    logger.info(AppEvents.repositoryInit.success, data);
  },

  initFailure: (logger: ILogger, error: Error, data: Partial<AppRepositoryInitData>) => {
    log.error(logger, AppEvents.repositoryInit.failure, error, data);
  },
};

/**
 * App Process Recovery logging helpers
 */
export const appProcessEvents = {
  recoverBegin: (logger: ILogger, data: { processCount: number }) => {
    logger.info(AppEvents.processRecover.begin, data);
  },

  recoverSuccess: (logger: ILogger, data: AppProcessRecoveryData) => {
    logger.info(AppEvents.processRecover.success, data);
  },
};

/**
 * App Creation logging helpers
 */
export const appCreationEvents = {
  begin: (logger: ILogger, data: AppCreationBeginData) => {
    logger.info(AppEvents.create.begin, data);
  },

  success: (logger: ILogger, data: AppCreationBeginData & { duration: number }) => {
    logger.info(AppEvents.create.success, data);
  },

  failure: (logger: ILogger, error: Error, data: Partial<AppCreationBeginData>) => {
    log.error(logger, AppEvents.create.failure, error, data);
  },

  abort: (logger: ILogger, data: Partial<AppCreationBeginData> & { reason: string }) => {
    logger.warn(AppEvents.create.abort, data);
  },
};

/**
 * App Name Suggestion logging helpers  
 */
export const appNameEvents = {
  suggestBegin: (logger: ILogger, data: Pick<AppNameSuggestionData, 'appId' | 'originalName' | 'hasPrompt'>) => {
    logger.debug(AppEvents.nameSuggest.begin, data);
  },

  suggestSuccess: (logger: ILogger, data: AppNameSuggestionData) => {
    logger.info(AppEvents.nameSuggest.success, data);
  },

  suggestFailure: (logger: ILogger, error: Error, data: Pick<AppNameSuggestionData, 'appId' | 'originalName'>) => {
    log.error(logger, AppEvents.nameSuggest.failure, error, data);
  },
};

/**
 * App Template logging helpers
 */
export const appTemplateEvents = {
  resolveBegin: (logger: ILogger, data: Pick<AppTemplateOperationData, 'appId' | 'templateVersion'>) => {
    logger.debug(AppEvents.template.resolve.begin, {
      ...data,
      operation: 'resolve' as const,
      path: '',
      templatePath: '',
    });
  },

  resolveSuccess: (logger: ILogger, data: AppTemplateOperationData) => {
    logger.info(AppEvents.template.resolve.success, data);
  },

  copyBegin: (logger: ILogger, data: AppTemplateOperationData) => {
    logger.info(AppEvents.template.copy.begin, data);
  },

  copySuccess: (logger: ILogger, data: AppTemplateOperationData) => {
    logger.info(AppEvents.template.copy.success, data);
  },

  copyFailure: (logger: ILogger, error: Error, data: AppTemplateOperationData) => {
    log.error(logger, AppEvents.template.copy.failure, error, data);
  },
};

/**
 * App Directory logging helpers
 */
export const appDirectoryEvents = {
  createBegin: (logger: ILogger, data: Pick<AppDirectoryOperationData, 'appId' | 'path'>) => {
    logger.debug(AppEvents.directory.create.begin, {
      ...data,
      permissions: '',
      parentExists: false,
    });
  },

  createSuccess: (logger: ILogger, data: AppDirectoryOperationData) => {
    logger.info(AppEvents.directory.create.success, data);
  },

  createFailure: (logger: ILogger, error: Error, data: Pick<AppDirectoryOperationData, 'appId' | 'path'>) => {
    log.error(logger, AppEvents.directory.create.failure, error, data);
  },

  cleanupSuccess: (logger: ILogger, data: AppDirectoryOperationData) => {
    logger.info(AppEvents.directory.cleanup.success, data);
  },
};

/**
 * App Setup logging helpers
 */
export const appSetupEvents = {
  initBegin: (logger: ILogger, data: Pick<AppSetupOperationData, 'appId'>) => {
    logger.info(AppEvents.setup.init.begin, {
      ...data,
      operation: 'setup' as const,
      startTime: new Date().toISOString(),
      duration: 0,
    });
  },

  initProgress: (logger: ILogger, data: AppSetupOperationData) => {
    logger.debug(AppEvents.setup.init.progress, data);
  },

  initSuccess: (logger: ILogger, data: AppSetupOperationData) => {
    logger.info(AppEvents.setup.init.success, data);
  },

  initFailure: (logger: ILogger, error: Error, data: Partial<AppSetupOperationData>) => {
    log.error(logger, AppEvents.setup.init.failure, error, data);
  },
};

/**
 * App Server logging helpers
 */
export const appServerEvents = {
  deployBegin: (logger: ILogger, data: Pick<AppServerOperationData, 'appId' | 'processId' | 'port'>) => {
    logger.info(AppEvents.server.deploy.begin, {
      ...data,
      protocol: 'http' as const,
      startTime: new Date().toISOString(),
      duration: 0,
    });
  },

  deploySuccess: (logger: ILogger, data: AppServerOperationData) => {
    logger.info(AppEvents.server.deploy.success, data);
  },

  deployFailure: (logger: ILogger, error: Error, data: Partial<AppServerOperationData>) => {
    log.error(logger, AppEvents.server.deploy.failure, error, data);
  },

  startBegin: (logger: ILogger, data: Pick<AppServerOperationData, 'appId' | 'port'>) => {
    logger.info(AppEvents.server.start.begin, {
      ...data,
      processId: 0,
      protocol: 'http' as const,
      startTime: new Date().toISOString(),
      duration: 0,
    });
  },

  startSuccess: (logger: ILogger, data: AppServerOperationData) => {
    logger.info(AppEvents.server.start.success, data);
  },

  startFailure: (logger: ILogger, error: Error, data: Partial<AppServerOperationData>) => {
    log.error(logger, AppEvents.server.start.failure, error, data);
  },
};

/**
 * App Docker logging helpers
 */
export const appDockerEvents = {
  deployBegin: (logger: ILogger, data: Pick<AppDockerOperationData, 'appId' | 'containerId'>) => {
    logger.info(AppEvents.docker.deploy.begin, {
      ...data,
      port: 0,
      protocol: 'http' as const,
    });
  },

  deploySuccess: (logger: ILogger, data: AppDockerOperationData) => {
    logger.info(AppEvents.docker.deploy.success, data);
  },

  startBegin: (logger: ILogger, data: Pick<AppDockerOperationData, 'appId' | 'containerId'>) => {
    logger.info(AppEvents.docker.start.begin, {
      ...data,
      port: 0,
      protocol: 'http' as const,
    });
  },

  startSuccess: (logger: ILogger, data: AppDockerOperationData) => {
    logger.info(AppEvents.docker.start.success, data);
  },

  startFailure: (logger: ILogger, error: Error, data: Partial<AppDockerOperationData>) => {
    log.error(logger, AppEvents.docker.start.failure, error, data);
  },
};

/**
 * App Lifecycle logging helpers
 */
export const appLifecycleEvents = {
  create: (logger: ILogger, data: AppLifecycleData) => {
    logger.info(AppEvents.lifecycle.create, data);
  },

  ready: (logger: ILogger, data: AppLifecycleData) => {
    logger.info(AppEvents.lifecycle.ready, data);
  },

  destroy: (logger: ILogger, data: AppLifecycleData) => {
    logger.info(AppEvents.lifecycle.destroy, data);
  },
};

/**
 * App Transaction logging helpers
 */
export const appTransactionEvents = {
  begin: (logger: ILogger, data: AppTransactionData) => {
    logger.debug(AppEvents.transaction.begin, data);
  },

  commit: (logger: ILogger, data: AppTransactionData) => {
    logger.debug(AppEvents.transaction.commit, data);
  },

  rollback: (logger: ILogger, data: AppTransactionData) => {
    logger.info(AppEvents.transaction.rollback, data);
  },
};

/**
 * App Process Management logging helpers
 */
export const appProcessManagementEvents = {
  killBegin: (logger: ILogger, data: Pick<AppProcessManagementData, 'appId' | 'processId' | 'signal'>) => {
    logger.info(AppEvents.processManagement.kill.begin, {
      ...data,
      operation: 'kill' as const
    });
  },

  killSuccess: (logger: ILogger, data: AppProcessManagementData) => {
    logger.info(AppEvents.processManagement.kill.success, data);
  },

  killFailure: (logger: ILogger, error: Error, data: Pick<AppProcessManagementData, 'appId' | 'processId'>) => {
    log.error(logger, AppEvents.processManagement.kill.failure, error, data);
  },

  cleanupBegin: (logger: ILogger, data: Pick<AppProcessManagementData, 'appId'>) => {
    logger.info(AppEvents.processManagement.cleanup.begin, {
      ...data,
      processId: 0,
      operation: 'cleanup' as const
    });
  },

  cleanupSuccess: (logger: ILogger, data: AppProcessManagementData) => {
    logger.info(AppEvents.processManagement.cleanup.success, data);
  },
};

/**
 * App Cleanup logging helpers
 */
export const appCleanupEvents = {
  orphanBegin: (logger: ILogger, data: Pick<AppCleanupOperationData, 'appId' | 'itemsProcessed'>) => {
    logger.info(AppEvents.cleanup.orphan.begin, {
      ...data,
      operation: 'orphan' as const
    });
  },

  orphanSuccess: (logger: ILogger, data: AppCleanupOperationData) => {
    logger.info(AppEvents.cleanup.orphan.success, data);
  },

  directoryBegin: (logger: ILogger, data: Pick<AppCleanupOperationData, 'appId'>) => {
    logger.info(AppEvents.cleanup.directory.begin, {
      ...data,
      operation: 'directory' as const
    });
  },

  directorySuccess: (logger: ILogger, data: AppCleanupOperationData) => {
    logger.info(AppEvents.cleanup.directory.success, data);
  },
};

/**
 * Tool Image Search logging helpers
 */
export const toolImageSearchEvents = {
  begin: (logger: ILogger, data: { toolName: string; prompt: string; count: number; provider: 'getty' | 'openai' | 'unsplash'; cacheHit?: boolean }) => {
    logger.info(AppEvents.tool.imageSearch.begin, data);
  },

  success: (logger: ILogger, data: ToolImageSearchData) => {
    logger.info(AppEvents.tool.imageSearch.success, data);
  },

  failure: (logger: ILogger, error: Error, data: { toolName: string; prompt: string; count: number; provider: 'getty' | 'openai' | 'unsplash' }) => {
    log.error(logger, AppEvents.tool.imageSearch.failure, error, data);
  },
};

/**
 * Tool Cache logging helpers
 */
export const toolCacheEvents = {
  getBegin: (logger: ILogger, data: { toolName: string; cacheKey: string }) => {
    logger.debug(AppEvents.tool.cache.get.begin, {
      ...data,
      operation: 'get' as const,
    });
  },

  getSuccess: (logger: ILogger, data: ToolCacheOperationData) => {
    logger.debug(AppEvents.tool.cache.get.success, data);
  },

  getFailure: (logger: ILogger, error: Error, data: { toolName: string; cacheKey: string }) => {
    log.error(logger, AppEvents.tool.cache.get.failure, error, data);
  },

  setBegin: (logger: ILogger, data: { toolName: string; cacheKey: string }) => {
    logger.debug(AppEvents.tool.cache.set.begin, {
      ...data,
      operation: 'set' as const,
    });
  },

  setSuccess: (logger: ILogger, data: ToolCacheOperationData) => {
    logger.debug(AppEvents.tool.cache.set.success, data);
  },

  setFailure: (logger: ILogger, error: Error, data: { toolName: string; cacheKey: string }) => {
    log.error(logger, AppEvents.tool.cache.set.failure, error, data);
  },

  cleanupBegin: (logger: ILogger, data: { toolName: string }) => {
    logger.info(AppEvents.tool.cache.cleanup.begin, {
      ...data,
      operation: 'cleanup' as const,
      cacheKey: '',
    });
  },

  cleanupSuccess: (logger: ILogger, data: ToolCacheOperationData) => {
    logger.info(AppEvents.tool.cache.cleanup.success, data);
  },

  cleanupFailure: (logger: ILogger, error: Error, data: { toolName: string }) => {
    log.error(logger, AppEvents.tool.cache.cleanup.failure, error, data);
  },
};

/**
 * Tool File Edit logging helpers
 */
export const toolFileEditEvents = {
  begin: (logger: ILogger, data: { toolName: string; filePath: string; mode: 'create' | 'edit' | 'rewrite'; appId?: string; dryRun?: boolean }) => {
    logger.info(AppEvents.tool.fileEdit.begin, data);
  },

  success: (logger: ILogger, data: ToolFileEditData) => {
    logger.info(AppEvents.tool.fileEdit.success, data);
  },

  failure: (logger: ILogger, error: Error, data: { toolName: string; filePath: string; mode: 'create' | 'edit' | 'rewrite'; appId?: string }) => {
    log.error(logger, AppEvents.tool.fileEdit.failure, error, data);
  },
};

/**
 * Tool Build Operation logging helpers
 */
export const toolBuildEvents = {
  begin: (logger: ILogger, data: { toolName: string; appPath: string; buildCommand?: string; appId?: string }) => {
    logger.info(AppEvents.tool.build.begin, {
      ...data,
      buildType: 'validation' as const,
    });
  },

  success: (logger: ILogger, data: ToolBuildOperationData) => {
    logger.info(AppEvents.tool.build.success, data);
  },

  failure: (logger: ILogger, error: Error, data: { toolName: string; appPath: string; buildCommand?: string; appId?: string }) => {
    log.error(logger, AppEvents.tool.build.failure, error, data);
  },
};

/**
 * Tool Server Health logging helpers
 */
export const toolServerHealthEvents = {
  check: (logger: ILogger, data: { toolName: string; appId: string; port: number }) => {
    logger.debug(AppEvents.tool.serverHealth.check, data);
  },

  healthy: (logger: ILogger, data: ToolServerHealthData) => {
    logger.debug(AppEvents.tool.serverHealth.healthy, data);
  },

  unhealthy: (logger: ILogger, data: ToolServerHealthData) => {
    logger.info(AppEvents.tool.serverHealth.unhealthy, data);
  },

  restart: (logger: ILogger, data: ToolServerHealthData) => {
    logger.info(AppEvents.tool.serverHealth.restart, data);
  },
};

/**
 * Tool Directory Listing logging helpers
 */
export const toolDirectoryListingEvents = {
  begin: (logger: ILogger, data: { toolName: string; targetPath: string; appId?: string; options?: any }) => {
    logger.info(AppEvents.tool.directoryListing.begin, data);
  },

  success: (logger: ILogger, data: ToolDirectoryListingData) => {
    logger.info(AppEvents.tool.directoryListing.success, data);
  },

  failure: (logger: ILogger, error: Error, data: { toolName: string; targetPath: string; appId?: string }) => {
    log.error(logger, AppEvents.tool.directoryListing.failure, error, data);
  },
};

/**
 * Tool Directory Walk logging helpers
 */
export const toolDirectoryWalkEvents = {
  begin: (logger: ILogger, data: { toolName: string; currentPath: string; depth: number; maxDepth: number; appId?: string }) => {
    logger.debug(AppEvents.tool.directoryWalk.begin, data);
  },

  progress: (logger: ILogger, data: ToolDirectoryWalkData) => {
    logger.debug(AppEvents.tool.directoryWalk.progress, data);
  },

  complete: (logger: ILogger, data: ToolDirectoryWalkData) => {
    logger.debug(AppEvents.tool.directoryWalk.complete, data);
  },

  error: (logger: ILogger, error: Error, data: { toolName: string; currentPath: string; depth: number; appId?: string }) => {
    log.error(logger, AppEvents.tool.directoryWalk.error, error, data);
  },
};

/**
 * Tool Grep Search logging helpers
 */
export const toolGrepEvents = {
  begin: (logger: ILogger, data: { toolName: string; query: string; appId?: string; paths?: string[]; searchOptions?: any }) => {
    logger.info(AppEvents.tool.grep.begin, data);
  },

  success: (logger: ILogger, data: ToolGrepSearchData) => {
    logger.info(AppEvents.tool.grep.success, data);
  },

  failure: (logger: ILogger, error: Error, data: { toolName: string; query: string; appId?: string }) => {
    log.error(logger, AppEvents.tool.grep.failure, error, data);
  },
};

/**
 * Tool Git Operation logging helpers
 */
export const toolGitEvents = {
  begin: (logger: ILogger, data: { toolName: string; operation: string; appPath: string; appId?: string; options?: any }) => {
    logger.info(AppEvents.tool.git.begin, data);
  },

  success: (logger: ILogger, data: ToolGitOperationData) => {
    logger.info(AppEvents.tool.git.success, data);
  },

  failure: (logger: ILogger, error: Error, data: { toolName: string; operation: string; appPath: string; appId?: string }) => {
    log.error(logger, AppEvents.tool.git.failure, error, data);
  },
};

/**
 * Tool Image Generation logging helpers
 */
export const toolImageGenerationEvents = {
  begin: (logger: ILogger, data: { toolName: string; appId: string; prompt: string; options?: any }) => {
    logger.info(AppEvents.tool.imageGeneration.begin, data);
  },

  success: (logger: ILogger, data: ToolImageGenerationData) => {
    logger.info(AppEvents.tool.imageGeneration.success, data);
  },

  failure: (logger: ILogger, error: Error, data: { toolName: string; appId: string; prompt: string }) => {
    log.error(logger, AppEvents.tool.imageGeneration.failure, error, data);
  },
};

/**
 * Tool AST Edit logging helpers
 */
export const toolAstEditEvents = {
  begin: (logger: ILogger, data: { toolName: string; appId?: string; filePath: string; editType: 'style' | 'component' | 'generic'; targetInfo?: any }) => {
    logger.info(AppEvents.tool.astEdit.begin, data);
  },

  success: (logger: ILogger, data: ToolAstEditData) => {
    logger.info(AppEvents.tool.astEdit.success, data);
  },

  failure: (logger: ILogger, error: Error, data: { toolName: string; appId?: string; filePath: string; editType: 'style' | 'component' | 'generic' }) => {
    log.error(logger, AppEvents.tool.astEdit.failure, error, data);
  },
};

/**
 * Tool MySQL logging helpers
 */
export const toolMySqlEvents = {
  begin: (logger: ILogger, data: { toolName: string; appId?: string; operation: 'enable_database' | 'test_connection' | 'list_databases'; connectionInfo?: any; databaseInfo?: any }) => {
    logger.info(AppEvents.tool.mysql.begin, data);
  },

  success: (logger: ILogger, data: ToolMySqlData) => {
    logger.info(AppEvents.tool.mysql.success, data);
  },

  failure: (logger: ILogger, error: Error, data: { toolName: string; appId?: string; operation: 'enable_database' | 'test_connection' | 'list_databases' }) => {
    log.error(logger, AppEvents.tool.mysql.failure, error, data);
  },
};

/**
 * HTTP Request logging helpers
 */
export const httpRequestEvents = {
  begin: (logger: ILogger, data: { method: string; url: string; userAgent?: string; ip?: string; requestId?: string; headers?: Record<string, string>; query?: Record<string, any>; body?: any }) => {
    logger.info(AppEvents.http.request.begin, data);
  },

  success: (logger: ILogger, data: HttpRequestData) => {
    logger.info(AppEvents.http.request.success, data);
  },

  error: (logger: ILogger, error: Error, data: { method: string; url: string; userAgent?: string; ip?: string; requestId?: string }) => {
    log.error(logger, AppEvents.http.request.error, error, data);
  },
};

/**
 * WebSocket Connection logging helpers
 */
export const webSocketConnectionEvents = {
  connected: (logger: ILogger, data: { agentId: string; clientIP?: string; url?: string; connectionId?: string }) => {
    logger.info(AppEvents.websocket.connection.connected, {
      event: 'connection',
      ...data
    });
  },

  disconnected: (logger: ILogger, data: { agentId: string; connectionId?: string }) => {
    logger.info(AppEvents.websocket.connection.disconnected, {
      event: 'disconnection',
      ...data
    });
  },

  error: (logger: ILogger, error: Error, data: { agentId: string; connectionId?: string; url?: string }) => {
    log.error(logger, AppEvents.websocket.connection.error, error, {
      event: 'error',
      error: error.message,
      ...data
    });
  },
};

/**
 * WebSocket Chat logging helpers
 */
export const webSocketChatEvents = {
  message: (logger: ILogger, data: { agentId: string; threadId?: string; conversationId?: string; appId?: string; userId?: string; messageLength?: number }) => {
    logger.info(AppEvents.websocket.chat.message, {
      event: 'chat_message',
      ...data
    });
  },

  response: (logger: ILogger, data: WebSocketChatData) => {
    logger.info(AppEvents.websocket.chat.response, data);
  },

  error: (logger: ILogger, error: Error, data: { agentId: string; threadId?: string; conversationId?: string; appId?: string }) => {
    log.error(logger, AppEvents.websocket.chat.error, error, {
      event: 'chat_error',
      error: error.message,
      ...data
    });
  },
};

/**
 * Docker Container logging helpers
 */
export const dockerContainerEvents = {
  begin: (logger: ILogger, data: Pick<DockerContainerData, 'appId' | 'operation'> & { containerId?: string; imageName?: string; port?: number; templateVersion?: string }) => {
    logger.info(AppEvents.dockerContainer.begin, data);
  },

  success: (logger: ILogger, data: DockerContainerData) => {
    logger.info(AppEvents.dockerContainer.success, data);
  },

  failure: (logger: ILogger, error: Error, data: Pick<DockerContainerData, 'appId' | 'operation'> & { containerId?: string; imageName?: string; port?: number; templateVersion?: string }) => {
    log.error(logger, AppEvents.dockerContainer.failure, error, data);
  },
};

/**
 * LLM Request/Response logging helpers
 */
export const llmEvents = {
  request: (logger: ILogger, data: LLMRequestData) => {
    logger.info(AppEvents.llm.request, data);
  },

  response: (logger: ILogger, data: LLMResponseData) => {
    logger.info(AppEvents.llm.response, data);
  },

  error: (logger: ILogger, error: Error, data: Pick<LLMRequestData, 'agentId' | 'threadId' | 'model'> & { duration?: number }) => {
    log.error(logger, AppEvents.llm.error, error, data);
  },

  tokenUsageBegin: (logger: ILogger, data: Pick<LLMTokenUsageData, 'appId' | 'operation' | 'tokenType'>) => {
    logger.debug(AppEvents.llm.tokenUsage.begin, data);
  },

  tokenUsageSuccess: (logger: ILogger, data: LLMTokenUsageData) => {
    logger.debug(AppEvents.llm.tokenUsage.success, data);
  },

  tokenUsageFailure: (logger: ILogger, error: Error, data: Pick<LLMTokenUsageData, 'appId' | 'operation' | 'tokenType'>) => {
    log.error(logger, AppEvents.llm.tokenUsage.failure, error, data);
  },
};

/**
 * Tracing logging helpers
 */
export const tracingEvents = {
  request: (logger: ILogger, data: TracingEventData) => {
    logger.debug(AppEvents.trace.request, data);
  },

  response: (logger: ILogger, data: TracingEventData) => {
    logger.debug(AppEvents.trace.response, data);
  },

  error: (logger: ILogger, data: TracingEventData) => {
    logger.error(AppEvents.trace.error, data);
  },

  debug: (logger: ILogger, data: TracingEventData) => {
    logger.debug(AppEvents.trace.debug, data);
  },

  toolCall: (logger: ILogger, data: TracingEventData) => {
    logger.debug(AppEvents.trace.toolCall, data);
  },

  websocket: (logger: ILogger, data: TracingEventData) => {
    logger.debug(AppEvents.trace.websocket, data);
  },
};