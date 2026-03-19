import type { LogHandler, LogEvent } from '../types.js';

/**
 * Development handler with rich console formatting and expandable content
 */
export class DevelopmentHandler implements LogHandler {
  private expandThreshold: number;
  private showTimestamps: boolean;
  private showDuration: boolean;
  private colorize: boolean;

  constructor(options: {
    expandThreshold?: number;
    showTimestamps?: boolean;
    showDuration?: boolean;
    colorize?: boolean;
  } = {}) {
    this.expandThreshold = options.expandThreshold ?? 1000;
    this.showTimestamps = options.showTimestamps ?? true;
    this.showDuration = options.showDuration ?? true;
    this.colorize = options.colorize ?? true;
  }

  handle(event: LogEvent): void {
    const output = this.formatEvent(event);
    
    // Use appropriate console method based on log level
    switch (event.level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
      case 'fatal':
        console.error(output);
        break;
      default:
        console.log(output);
    }
  }

  private formatEvent(event: LogEvent): string {
    // Special compact formatting for HTTP requests
    if (event.event.startsWith('http.request.')) {
      return this.formatHttpRequest(event);
    }

    // Special compact formatting for WebSocket events
    if (event.event.startsWith('websocket.')) {
      return this.formatWebSocketEvent(event);
    }

    // Special compact formatting for LLM events
    if (event.event.startsWith('llm.')) {
      return this.formatLLMEvent(event);
    }

    // Special compact formatting for tool events
    if (event.event.startsWith('tool.')) {
      return this.formatToolEvent(event);
    }

    // Special compact formatting for memory events
    if (event.event.startsWith('memory.request.')) {
      return this.formatMemoryEvent(event);
    }

    const parts: string[] = [];

    // Timestamp
    if (this.showTimestamps) {
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      parts.push(this.gray(`[${timestamp}]`));
    }

    // Level with color and emoji
    const levelStr = this.formatLevel(event.level);
    parts.push(levelStr);

    // Event type
    const eventStr = this.formatEventType(event.event);
    parts.push(eventStr);

    // Message
    parts.push(event.message);

    // Duration if present
    if (this.showDuration && event.duration) {
      parts.push(this.gray(`(${event.duration}ms)`));
    }

    // Context info
    const contextInfo = this.formatContext(event);
    if (contextInfo) {
      parts.push(contextInfo);
    }

    let output = parts.join(' ');

    // Add data if present
    if (event.data) {
      output += '\n' + this.formatData(event.data);
    }

    // Add error details if present (but not for setup errors - data already shows details)
    if (event.error && !(event.data?.operation === 'setup' && (event.data?.stdout || event.data?.stderr))) {
      output += '\n' + this.formatError(event.error);
    }

    // Add tags if present
    if (event.tags && event.tags.length > 0) {
      output += '\n' + this.gray(`Tags: ${event.tags.join(', ')}`);
    }

    return output;
  }

  private formatLevel(level: string): string {
    if (!this.colorize) {
      return `[${level.toUpperCase()}]`;
    }

    switch (level) {
      case 'debug':
        return this.gray('🔍 DEBUG');
      case 'info':
        return this.blue('ℹ️  INFO ');
      case 'warn':
        return this.yellow('⚠️  WARN ');
      case 'error':
        return this.red('❌ ERROR');
      case 'fatal':
        return this.red('💀 FATAL');
      default:
        return `[${level.toUpperCase()}]`;
    }
  }

  private formatEventType(event: string): string {
    if (!this.colorize) {
      return `{${event}}`;
    }

    const domain = event.split('.')[0];
    switch (domain) {
      case 'app':
        return this.cyan(`📱 ${event}`);
      case 'agent':
        return this.magenta(`🤖 ${event}`);
      case 'file':
        return this.green(`📄 ${event}`);
      case 'api':
        return this.blue(`🌐 ${event}`);
      case 'db':
        return this.yellow(`💾 ${event}`);
      case 'ws':
        return this.purple(`🔌 ${event}`);
      case 'perf':
        return this.gray(`⚡ ${event}`);
      default:
        return `{${event}}`;
    }
  }

  private formatContext(event: LogEvent): string | null {
    const context: string[] = [];
    
    if (event.appId) {
      context.push(`app:${event.appId.substring(0, 8)}`);
    }
    if (event.agentId) {
      context.push(`agent:${event.agentId}`);
    }
    if (event.requestId) {
      context.push(`req:${event.requestId}`);
    }
    if (event.conversationId) {
      context.push(`conv:${event.conversationId.substring(0, 8)}`);
    }

    if (context.length === 0) {
      return null;
    }

    return this.gray(`[${context.join('|')}]`);
  }

  private formatData(data: any): string {
    if (typeof data === 'string') {
      return this.formatStringData(data);
    }

    if (typeof data === 'object') {
      return this.formatObjectData(data);
    }

    return String(data);
  }

  private formatStringData(str: string): string {
    if (str.length <= this.expandThreshold) {
      return `  ${str}`;
    }

    // For large strings, show truncated version with expansion option
    const truncated = str.substring(0, this.expandThreshold);
    const remaining = str.length - this.expandThreshold;
    
    return `  ${truncated}\n  ${this.gray(`... (${remaining} more characters - use debugger to see full content)`)}`;
  }

  private formatObjectData(obj: any): string {
    // Special handling for setup errors - always show stdout/stderr
    if (obj.operation === 'setup' && (obj.stdout || obj.stderr)) {
      return this.formatSetupError(obj);
    }

    // Try compact formatting for common patterns
    const compactFormat = this.tryCompactFormat(obj);
    if (compactFormat) {
      return compactFormat;
    }

    const jsonStr = JSON.stringify(obj, null, 2);
    
    if (jsonStr.length <= this.expandThreshold) {
      return this.indent(jsonStr, 2);
    }

    // For large objects, show keys and size info
    const keys = Object.keys(obj);
    const preview = keys.slice(0, 5).join(', ');
    const moreKeys = keys.length > 5 ? ` (+${keys.length - 5} more)` : '';
    
    return `  ${this.gray('Object')} {${preview}${moreKeys}} ${this.gray(`(${jsonStr.length} chars - use debugger to inspect)`)}`;
  }

  private formatSetupError(obj: any): string {
    const lines: string[] = [];
    
    // Basic info
    lines.push(`  ${this.yellow('Setup Error Details:')}`);
    if (obj.command) lines.push(`    Command: ${this.cyan(obj.command)}`);
    if (obj.exitCode !== undefined) lines.push(`    Exit Code: ${this.red(String(obj.exitCode))}`);
    
    // Show stdout if present
    if (obj.stdout && obj.stdout.trim()) {
      lines.push(`    ${this.blue('stdout:')}`);
      const stdout = obj.stdout.trim();
      stdout.split('\n').forEach((line: string) => {
        lines.push(`      ${line}`);
      });
    }
    
    // Show stderr if present
    if (obj.stderr && obj.stderr.trim()) {
      lines.push(`    ${this.red('stderr:')}`);
      const stderr = obj.stderr.trim();
      stderr.split('\n').forEach((line: string) => {
        lines.push(`      ${this.red(line)}`);
      });
    }
    
    return lines.join('\n');
  }

  private tryCompactFormat(obj: any): string | null {
    // Handle simple objects with few keys and short values
    if (this.isSimpleObject(obj)) {
      return this.formatSimpleObject(obj);
    }

    // Handle operation-based objects (common pattern in the codebase)
    if (this.isOperationObject(obj)) {
      return this.formatOperationObject(obj);
    }

    // Handle stats-only objects
    if (this.isStatsObject(obj)) {
      return this.formatStatsObject(obj);
    }

    // Handle error objects
    if (this.isErrorInfoObject(obj)) {
      return this.formatErrorInfoObject(obj);
    }

    return null;
  }

  private isSimpleObject(obj: any): boolean {
    const keys = Object.keys(obj);
    if (keys.length > 4) return false;
    
    // Check if all values are simple (strings, numbers, booleans, small arrays)
    return keys.every(key => {
      const value = obj[key];
      if (typeof value === 'string') return value.length < 50;
      if (typeof value === 'number' || typeof value === 'boolean') return true;
      if (Array.isArray(value)) return value.length < 3 && value.every(item => typeof item === 'string' && item.length < 20);
      return false;
    });
  }

  private isOperationObject(obj: any): boolean {
    return obj.operation && (obj.appId || obj.operationStats || obj.duration !== undefined);
  }

  private isStatsObject(obj: any): boolean {
    const keys = Object.keys(obj);
    return keys.length <= 6 && keys.every(key => 
      ['success', 'duration', 'count', 'size', 'status', 'error'].some(statKey => 
        key.toLowerCase().includes(statKey)) || 
      typeof obj[key] === 'number' || typeof obj[key] === 'boolean'
    );
  }

  private isErrorInfoObject(obj: any): boolean {
    return obj.error || obj.message || obj.code || obj.statusCode;
  }

  private formatSimpleObject(obj: any): string {
    const parts = Object.entries(obj).map(([key, value]) => {
      const coloredKey = this.cyan(key);
      let coloredValue: string;
      
      if (typeof value === 'string') {
        coloredValue = `"${this.green(value)}"`;
      } else if (typeof value === 'number') {
        coloredValue = this.yellow(value.toString());
      } else if (typeof value === 'boolean') {
        coloredValue = value ? this.green('true') : this.red('false');
      } else if (Array.isArray(value)) {
        coloredValue = `[${value.map(v => `"${this.green(v)}"`).join(', ')}]`;
      } else {
        coloredValue = String(value);
      }
      
      return `${coloredKey}:${coloredValue}`;
    });
    
    return `  {${parts.join(', ')}}`;
  }

  private formatOperationObject(obj: any): string {
    const parts: string[] = [];
    
    if (obj.operation) {
      parts.push(`op:${this.yellow(obj.operation)}`);
    }
    
    if (obj.appId) {
      parts.push(`app:${this.cyan(obj.appId)}`);
    }
    
    // Handle operationStats inline
    if (obj.operationStats) {
      const stats = obj.operationStats;
      const statParts: string[] = [];
      
      if (stats.success !== undefined) {
        statParts.push(stats.success ? this.green('✓') : this.red('✗'));
      }
      
      if (stats.duration !== undefined) {
        statParts.push(this.gray(`${stats.duration}ms`));
      }
      
      // Add numeric stats
      Object.entries(stats).forEach(([key, value]) => {
        if (key !== 'success' && key !== 'duration' && typeof value === 'number' && value > 0) {
          statParts.push(`${key}:${this.yellow(value.toString())}`);
        }
      });
      
      if (statParts.length > 0) {
        parts.push(`[${statParts.join(' ')}]`);
      }
    }
    
    // Add other important fields
    Object.entries(obj).forEach(([key, value]) => {
      if (!['operation', 'appId', 'operationStats'].includes(key)) {
        if (typeof value === 'string' && value.length < 30) {
          parts.push(`${key}:${this.green(value)}`);
        } else if (typeof value === 'number') {
          parts.push(`${key}:${this.yellow(value.toString())}`);
        } else if (typeof value === 'boolean') {
          parts.push(`${key}:${value ? this.green('true') : this.red('false')}`);
        }
      }
    });
    
    return `  ${parts.join(' ')}`;
  }

  private formatStatsObject(obj: any): string {
    const parts = Object.entries(obj).map(([key, value]) => {
      if (typeof value === 'boolean') {
        if (key.toLowerCase().includes('success')) {
          return value ? this.green('✓') : this.red('✗');
        }
        return `${key}:${value ? this.green('true') : this.red('false')}`;
      } else if (typeof value === 'number') {
        if (key.toLowerCase().includes('duration') || key.toLowerCase().includes('time')) {
          return this.gray(`${value}ms`);
        }
        return `${key}:${this.yellow(value.toString())}`;
      } else if (typeof value === 'string') {
        return `${key}:${this.green(value)}`;
      }
      return `${key}:${value}`;
    });
    
    return `  [${parts.join(' ')}]`;
  }

  private formatErrorInfoObject(obj: any): string {
    const parts: string[] = [];
    
    if (obj.error) {
      parts.push(this.red(`error:${obj.error}`));
    }
    if (obj.message) {
      parts.push(this.red(`msg:${obj.message}`));
    }
    if (obj.code) {
      parts.push(`code:${this.yellow(obj.code.toString())}`);
    }
    if (obj.statusCode) {
      parts.push(`status:${this.yellow(obj.statusCode.toString())}`);
    }
    
    // Add other fields
    Object.entries(obj).forEach(([key, value]) => {
      if (!['error', 'message', 'code', 'statusCode'].includes(key)) {
        if (typeof value === 'string' && value.length < 30) {
          parts.push(`${key}:${this.green(value)}`);
        } else if (typeof value === 'number') {
          parts.push(`${key}:${this.yellow(value.toString())}`);
        }
      }
    });
    
    return `  ${parts.join(' ')}`;
  }

  private formatError(error: any): string {
    const lines = [
      this.red(`  ❌ ${error.name}: ${error.message}`)
    ];

    if (error.code) {
      lines.push(this.gray(`     Code: ${error.code}`));
    }

    if (error.stack) {
      lines.push(this.gray('     Stack trace:'));
      const stackLines = error.stack.split('\n').slice(1);
      
      // Show more stack frames in development, but filter intelligently
      const relevantLines = this.filterAndFormatStackLines(stackLines);
      relevantLines.forEach((line: string) => {
        lines.push(`       ${line}`);
      });
    }

    return lines.join('\n');
  }

  private filterAndFormatStackLines(stackLines: string[]): string[] {
    const projectRoot = process.cwd();
    const formatted: string[] = [];
    let nodeModuleCount = 0;
    
    for (const line of stackLines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      // Skip empty lines and generic frames
      if (trimmedLine.includes('node:internal') || 
          trimmedLine.includes('processTicksAndRejections')) {
        continue;
      }
      
      // Format project files with highlighting
      if (trimmedLine.includes(projectRoot)) {
        const formattedLine = this.formatProjectStackLine(trimmedLine, projectRoot);
        formatted.push(formattedLine);
        continue;
      }
      
      // Limit node_modules frames but show some context
      if (trimmedLine.includes('node_modules')) {
        nodeModuleCount++;
        if (nodeModuleCount <= 2) {
          formatted.push(this.gray(this.formatNodeModulesStackLine(trimmedLine)));
        } else if (nodeModuleCount === 3) {
          formatted.push(this.gray('  ... (more node_modules frames)'));
        }
        continue;
      }
      
      // Show other relevant frames
      formatted.push(this.formatOtherStackLine(trimmedLine));
      
      // Limit total frames shown
      if (formatted.length >= 10) {
        formatted.push(this.gray('  ... (more frames available in debugger)'));
        break;
      }
    }
    
    return formatted;
  }

  private formatProjectStackLine(line: string, projectRoot: string): string {
    // Extract file path and line info
    const match = line.match(/at\s+(.+?)\s+\((.+):(\d+):(\d+)\)|at\s+(.+):(\d+):(\d+)/);
    if (match) {
      const [, functionName, filePath, lineNum, colNum, directFile, directLine, directCol] = match;
      
      if (directFile && directLine && directCol) {
        // Direct file reference (no function name)
        const relativePath = directFile.replace(projectRoot, '').replace(/^\//, '');
        return this.cyan(`${relativePath}:${directLine}:${directCol}`);
      } else if (filePath && lineNum && colNum) {
        // Function call with file reference
        const relativePath = filePath.replace(projectRoot, '').replace(/^\//, '');
        const fn = functionName || '<anonymous>';
        return `${this.yellow(fn)} ${this.gray('at')} ${this.cyan(relativePath)}:${this.cyan(lineNum)}:${colNum}`;
      }
    }
    
    // Fallback: just clean up the path
    return line.replace(projectRoot, '').replace(/^\//, '');
  }

  private formatNodeModulesStackLine(line: string): string {
    // Simplify node_modules paths - just show package name and function
    const match = line.match(/at\s+(.+?)\s+\(.+\/node_modules\/([^/]+)/);
    if (match) {
      const [, functionName, packageName] = match;
      return `${functionName} (from ${packageName})`;
    }
    
    // Fallback: show simplified path
    return line.replace(/.*\/node_modules\//, '📦 ');
  }

  private formatOtherStackLine(line: string): string {
    // Format other stack lines (system, etc.)
    return this.gray(line);
  }

  private formatHttpRequest(event: LogEvent): string {
    const parts: string[] = [];

    // Timestamp
    if (this.showTimestamps) {
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      parts.push(this.gray(`[${timestamp}]`));
    }

    // HTTP icon and level
    const isError = event.event === 'http.request.error';
    const httpIcon = isError ? this.red('🌐') : this.blue('🌐');
    parts.push(httpIcon);

    // Extract key info from data
    const data = event.data || {};
    const method = data.method || 'GET';
    const url = data.url || '/';
    const statusCode = data.responseStats?.statusCode;
    const duration = data.responseStats?.duration;
    const requestId = data.requestId;

    // Format: METHOD /path - 200 (123ms) [req:abcd1234]
    const coloredMethod = this.getMethodColor(method)(method);
    parts.push(coloredMethod);
    parts.push(this.cyan(url));

    if (statusCode !== undefined) {
      const coloredStatus = this.getStatusColor(statusCode)(statusCode.toString());
      parts.push(`- ${coloredStatus}`);
    }

    if (duration !== undefined) {
      parts.push(this.gray(`(${duration}ms)`));
    }

    if (requestId) {
      parts.push(this.gray(`[req:${requestId}]`));
    }

    // Add auth details if present
    if (data.auth) {
      const authParts: string[] = [];
      if (data.auth.customerId) {
        authParts.push(`customer:${this.cyan(data.auth.customerId)}`);
      }
      if (data.auth.shopperId) {
        authParts.push(`shopper:${this.cyan(data.auth.shopperId)}`);
      }
      if (data.auth.siteId) {
        authParts.push(`site:${this.cyan(data.auth.siteId)}`);
      }
      if (data.auth.authenticationBypass) {
        authParts.push(this.yellow('bypass'));
        if (data.auth.bypassReason) {
          authParts.push(this.gray(`(${data.auth.bypassReason})`));
        }
      }
      
      if (authParts.length > 0) {
        parts.push(this.gray(`[${authParts.join(' ')}]`));
      }
    }

    // Add error details on same line if it's an error
    if (isError && event.error) {
      parts.push(this.red(`- ${event.error.message}`));
    }

    return parts.join(' ');
  }

  private formatWebSocketEvent(event: LogEvent): string {
    const parts: string[] = [];

    // Timestamp
    if (this.showTimestamps) {
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      parts.push(this.gray(`[${timestamp}]`));
    }

    // WebSocket icon
    const data = event.data || {};
    const isError = event.event.includes('.error');
    const wsIcon = isError ? this.red('🔌') : this.purple('🔌');
    parts.push(wsIcon);

    // Determine event type and format accordingly
    if (event.event.includes('.connection.')) {
      return this.formatWebSocketConnection(event, parts, data);
    } else if (event.event.includes('.chat.')) {
      return this.formatWebSocketChat(event, parts, data);
    }

    // Fallback to generic format
    parts.push(this.purple(event.event));
    if (data.agentId) {
      parts.push(`agent:${data.agentId}`);
    }
    
    return parts.join(' ');
  }

  private formatWebSocketConnection(event: LogEvent, parts: string[], data: any): string {
    const agentId = data.agentId || 'unknown';
    const connectionId = data.connectionId;
    const clientIP = data.clientIP;
    const url = data.url;

    if (event.event.includes('.connected')) {
      parts.push(this.green('CONNECT'));
      parts.push(`agent:${this.cyan(agentId)}`);
      if (url) {
        parts.push(this.gray(url));
      }
      if (clientIP && clientIP !== '::1' && clientIP !== '127.0.0.1') {
        parts.push(`from:${this.gray(clientIP)}`);
      }
      if (connectionId) {
        parts.push(this.gray(`[${connectionId}]`));
      }
    } else if (event.event.includes('.disconnected')) {
      parts.push(this.yellow('DISCONNECT'));
      parts.push(`agent:${this.cyan(agentId)}`);
      if (connectionId) {
        parts.push(this.gray(`[${connectionId}]`));
      }
    } else if (event.event.includes('.error')) {
      parts.push(this.red('ERROR'));
      parts.push(`agent:${this.cyan(agentId)}`);
      if (event.error) {
        parts.push(this.red(`- ${event.error.message}`));
      }
      if (connectionId) {
        parts.push(this.gray(`[${connectionId}]`));
      }
    }

    return parts.join(' ');
  }

  private formatWebSocketChat(event: LogEvent, parts: string[], data: any): string {
    const agentId = data.agentId || 'unknown';
    const threadId = data.threadId;
    const messageLength = data.messageLength;
    const hasToolCalls = data.hasToolCalls;
    const duration = data.responseStats?.duration;

    if (event.event.includes('.message')) {
      parts.push(this.blue('MESSAGE'));
      parts.push(`agent:${this.cyan(agentId)}`);
      if (messageLength) {
        parts.push(this.gray(`(${messageLength} chars)`));
      }
      if (threadId) {
        parts.push(this.gray(`[${threadId.substring(0, 8)}]`));
      }
    } else if (event.event.includes('.response')) {
      parts.push(this.green('RESPONSE'));
      parts.push(`agent:${this.cyan(agentId)}`);
      if (hasToolCalls) {
        parts.push(this.yellow('with-tools'));
      }
      if (duration) {
        parts.push(this.gray(`(${duration}ms)`));
      }
      if (threadId) {
        parts.push(this.gray(`[${threadId.substring(0, 8)}]`));
      }
    } else if (event.event.includes('.error')) {
      parts.push(this.red('CHAT-ERROR'));
      parts.push(`agent:${this.cyan(agentId)}`);
      if (event.error) {
        parts.push(this.red(`- ${event.error.message}`));
      }
      if (threadId) {
        parts.push(this.gray(`[${threadId.substring(0, 8)}]`));
      }
    }

    return parts.join(' ');
  }

  private formatLLMEvent(event: LogEvent): string {
    const parts: string[] = [];

    // Timestamp
    if (this.showTimestamps) {
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      parts.push(this.gray(`[${timestamp}]`));
    }

    // LLM icon and level
    const data = event.data || {};
    const isError = event.event.includes('.error');
    const llmIcon = isError ? this.red('🧠') : this.magenta('🧠');
    parts.push(llmIcon);

    if (event.event === 'llm.request') {
      return this.formatLLMRequest(event, parts, data);
    } else if (event.event === 'llm.response') {
      return this.formatLLMResponse(event, parts, data);
    } else if (event.event.includes('.error')) {
      return this.formatLLMError(event, parts, data);
    }

    // Fallback
    parts.push(this.magenta(event.event));
    return parts.join(' ');
  }

  private formatLLMRequest(event: LogEvent, parts: string[], data: any): string {
    const model = data.model || 'unknown';
    const messageCount = data.messageCount || 0;
    const hasTools = data.hasTools;
    const streaming = data.streaming;
    const agentId = data.agentId;
    const threadId = data.threadId;

    parts.push(this.blue('REQUEST'));
    
    // Model name (simplified)
    const modelDisplay = model.replace('claude-sonnet-4-20250514', 'claude-4').replace('claude-', '');
    parts.push(this.cyan(modelDisplay));
    
    // Message count
    parts.push(`${messageCount}msg`);
    
    // Capabilities
    const caps: string[] = [];
    if (hasTools) caps.push('tools');
    if (streaming) caps.push('stream');
    if (caps.length > 0) {
      parts.push(this.yellow(`[${caps.join('+')}]`));
    }
    
    // Context info
    if (agentId) {
      parts.push(`agent:${this.cyan(agentId)}`);
    }
    if (threadId) {
      parts.push(this.gray(`[${threadId.substring(0, 8)}]`));
    }

    return parts.join(' ');
  }

  private formatLLMResponse(event: LogEvent, parts: string[], data: any): string {
    const model = data.model || 'unknown';
    const contentLength = data.contentLength;
    const duration = data.duration;
    const finishReason = data.finishReason;
    const usage = data.usage;
    const agentId = data.agentId;
    const threadId = data.threadId;

    parts.push(this.green('RESPONSE'));
    
    // Model name (simplified)
    const modelDisplay = model.replace('claude-sonnet-4-20250514', 'claude-4').replace('claude-', '');
    parts.push(this.cyan(modelDisplay));
    
    // Content info
    if (contentLength) {
      parts.push(`${contentLength}chars`);
    }
    
    // Duration
    if (duration) {
      const durationMs = Math.round(duration);
      parts.push(this.gray(`(${durationMs}ms)`));
    }
    
    // Usage tokens (if not redacted)
    if (usage && usage.totalTokens && usage.totalTokens !== '[REDACTED]') {
      parts.push(this.yellow(`${usage.totalTokens}tok`));
    }
    
    // Finish reason
    if (finishReason && finishReason !== 'stop') {
      parts.push(this.yellow(`[${finishReason}]`));
    }
    
    // Context info
    if (agentId) {
      parts.push(`agent:${this.cyan(agentId)}`);
    }
    if (threadId) {
      parts.push(this.gray(`[${threadId.substring(0, 8)}]`));
    }

    return parts.join(' ');
  }

  private formatLLMError(event: LogEvent, parts: string[], data: any): string {
    const model = data.model || 'unknown';
    const duration = data.duration;
    const agentId = data.agentId;
    const threadId = data.threadId;

    parts.push(this.red('ERROR'));
    
    // Model name (simplified)
    const modelDisplay = model.replace('claude-sonnet-4-20250514', 'claude-4').replace('claude-', '');
    parts.push(this.cyan(modelDisplay));
    
    // Duration if available
    if (duration) {
      const durationMs = Math.round(duration);
      parts.push(this.gray(`(${durationMs}ms)`));
    }
    
    // Error message
    if (event.error) {
      parts.push(this.red(`- ${event.error.message}`));
    }
    
    // Context info
    if (agentId) {
      parts.push(`agent:${this.cyan(agentId)}`);
    }
    if (threadId) {
      parts.push(this.gray(`[${threadId.substring(0, 8)}]`));
    }

    return parts.join(' ');
  }

  private formatToolEvent(event: LogEvent): string {
    const parts: string[] = [];

    // Timestamp
    if (this.showTimestamps) {
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      parts.push(this.gray(`[${timestamp}]`));
    }

    // Tool icon
    const data = event.data || {};
    const isError = event.event.includes('.failure') || event.event.includes('.error');
    const toolIcon = isError ? this.red('⚒️') : this.yellow('⚒️');
    parts.push(toolIcon);

    // Handle directory listing specifically
    if (event.event.includes('tool.directory.listing.')) {
      return this.formatDirectoryListingTool(event, parts, data);
    }

    // Handle other tool types with generic formatting
    return this.formatGenericTool(event, parts, data);
  }

  private formatDirectoryListingTool(event: LogEvent, parts: string[], data: any): string {
    const targetPath = data.targetPath || '.';
    const toolName = data.toolName || 'DirectoryTool';
    const options = data.options || {};
    const resultStats = data.resultStats;

    if (event.event.includes('.begin')) {
      parts.push(this.blue('LIST'));
      parts.push(this.cyan(targetPath === '.' ? 'current' : targetPath));
      
      // Add key options compactly
      const optParts: string[] = [];
      if (options.directoriesOnly) optParts.push('dirs-only');
      if (options.maxDepth && options.maxDepth !== 1) optParts.push(`depth:${options.maxDepth}`);
      if (options.showHidden) optParts.push('hidden');
      if (options.ignorePatterns && options.ignorePatterns.length > 0) {
        optParts.push(`ignore:${options.ignorePatterns.length}`);
      }
      
      if (optParts.length > 0) {
        parts.push(this.gray(`[${optParts.join(',')}]`));
      }
      
    } else if (event.event.includes('.success')) {
      parts.push(this.green('LISTED'));
      parts.push(this.cyan(targetPath === '.' ? 'current' : targetPath));
      
      if (resultStats) {
        const statParts: string[] = [];
        if (resultStats.totalEntries) statParts.push(`${resultStats.totalEntries}items`);
        if (resultStats.directoryCount) statParts.push(`${resultStats.directoryCount}dirs`);
        if (resultStats.fileCount) statParts.push(`${resultStats.fileCount}files`);
        if (resultStats.truncated) statParts.push(this.yellow('truncated'));
        if (resultStats.errorCount > 0) statParts.push(this.red(`${resultStats.errorCount}errors`));
        
        if (statParts.length > 0) {
          parts.push(`[${statParts.join(' ')}]`);
        }
      }
      
    } else if (event.event.includes('.failure')) {
      parts.push(this.red('LIST-ERROR'));
      parts.push(this.cyan(targetPath === '.' ? 'current' : targetPath));
      
      if (event.error) {
        parts.push(this.red(`- ${event.error.message}`));
      }
    }

    return parts.join(' ');
  }

  private formatGenericTool(event: LogEvent, parts: string[], data: any): string {
    const toolName = data.toolName || 'Tool';
    
    // Extract operation type from event name
    let operation = 'UNKNOWN';
    if (event.event.includes('.begin')) operation = 'START';
    else if (event.event.includes('.success')) operation = 'SUCCESS';
    else if (event.event.includes('.failure') || event.event.includes('.error')) operation = 'ERROR';
    
    // Simplify tool name
    const displayName = toolName
      .replace('Tool', '')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .toUpperCase();
    
    // Apply color based on operation type
    if (operation === 'SUCCESS') {
      parts.push(this.green(operation));
    } else if (operation === 'ERROR') {
      parts.push(this.red(operation));
    } else {
      parts.push(this.blue(operation));
    }
    
    parts.push(this.cyan(displayName));
    
    // Add error message if present
    if (event.error && operation === 'ERROR') {
      parts.push(this.red(`- ${event.error.message}`));
    }
    
    return parts.join(' ');
  }

  private formatMemoryEvent(event: LogEvent): string {
    const parts: string[] = [];

    // Timestamp
    if (this.showTimestamps) {
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      parts.push(this.gray(`[${timestamp}]`));
    }

    const data = event.data || {};
    const isHighUsage = event.event === 'memory.request.high_usage';
    const memIcon = isHighUsage ? this.red('📊') : this.cyan('📊');
    parts.push(memIcon);

    // Convert bytes to MiB
    const toMiB = (bytes: number | undefined): string => {
      if (bytes === undefined) return '?';
      return (bytes / 1024 / 1024).toFixed(1);
    };

    if (event.event === 'memory.request.complete') {
      parts.push(this.blue('MEM'));

      // App context
      if (data.appId) {
        parts.push(`app:${this.cyan(String(data.appId).substring(0, 8))}`);
      }

      // Memory values in MiB
      const heapUsed = toMiB(data.heapUsedBytes);
      const heapDelta = toMiB(data.heapDeltaBytes);
      const rss = toMiB(data.rssBytes);

      // Format: heap:123.4MiB (Δ+12.3MiB) rss:200.5MiB
      parts.push(`heap:${this.yellow(heapUsed)}MiB`);

      // Color delta based on sign and magnitude
      const deltaNum = data.heapDeltaBytes || 0;
      const deltaSign = deltaNum >= 0 ? '+' : '';
      let deltaStr = `Δ${deltaSign}${heapDelta}MiB`;
      if (deltaNum > 50 * 1024 * 1024) {
        deltaStr = this.red(deltaStr);
      } else if (deltaNum > 10 * 1024 * 1024) {
        deltaStr = this.yellow(deltaStr);
      } else if (deltaNum < 0) {
        deltaStr = this.green(deltaStr);
      } else {
        deltaStr = this.gray(deltaStr);
      }
      parts.push(`(${deltaStr})`);

      parts.push(`rss:${this.gray(rss)}MiB`);

      // Duration and steps
      if (data.requestDurationMs) {
        parts.push(this.gray(`${data.requestDurationMs}ms`));
      }
      if (data.steps) {
        parts.push(this.gray(`${data.steps}steps`));
      }

    } else if (event.event === 'memory.request.high_usage') {
      parts.push(this.red('MEM-HIGH'));

      if (data.appId) {
        parts.push(`app:${this.cyan(String(data.appId).substring(0, 8))}`);
      }

      const heapDelta = toMiB(data.heapDeltaBytes);
      const heapUsed = toMiB(data.heapUsedBytes);
      const threshold = toMiB(data.thresholdBytes);

      parts.push(this.red(`Δ${heapDelta}MiB`));
      parts.push(`(threshold:${threshold}MiB)`);
      parts.push(`heap:${this.yellow(heapUsed)}MiB`);

      if (data.steps) {
        parts.push(this.gray(`${data.steps}steps`));
      }

    } else if (event.event === 'memory.request.start') {
      // Compact format for start events (debug level)
      parts.push(this.gray('MEM-START'));
      if (data.appId) {
        parts.push(`app:${this.cyan(String(data.appId).substring(0, 8))}`);
      }
      parts.push(`heap:${this.gray(toMiB(data.heapUsedBytes))}MiB`);

    } else if (event.event === 'memory.request.tracking_missing') {
      parts.push(this.yellow('MEM-SKIP'));
      if (data.appId) {
        parts.push(`app:${this.cyan(String(data.appId).substring(0, 8))}`);
      }
      parts.push(this.gray('(no start data)'));
    }

    return parts.join(' ');
  }

  private getMethodColor(method: string): (text: string) => string {
    switch (method.toUpperCase()) {
      case 'GET': return this.green.bind(this);
      case 'POST': return this.blue.bind(this);
      case 'PUT': return this.yellow.bind(this);
      case 'DELETE': return this.red.bind(this);
      case 'PATCH': return this.magenta.bind(this);
      default: return this.gray.bind(this);
    }
  }

  private getStatusColor(statusCode: number): (text: string) => string {
    if (statusCode >= 200 && statusCode < 300) return this.green.bind(this);
    if (statusCode >= 300 && statusCode < 400) return this.yellow.bind(this);
    if (statusCode >= 400 && statusCode < 500) return this.red.bind(this);
    if (statusCode >= 500) return this.red.bind(this);
    return this.gray.bind(this);
  }

  private indent(text: string, spaces: number): string {
    const prefix = ' '.repeat(spaces);
    return text.split('\n').map((line: string) => prefix + line).join('\n');
  }

  // Color utility methods
  private gray(text: string): string {
    return this.colorize ? `\x1b[90m${text}\x1b[0m` : text;
  }

  private red(text: string): string {
    return this.colorize ? `\x1b[31m${text}\x1b[0m` : text;
  }

  private green(text: string): string {
    return this.colorize ? `\x1b[32m${text}\x1b[0m` : text;
  }

  private yellow(text: string): string {
    return this.colorize ? `\x1b[33m${text}\x1b[0m` : text;
  }

  private blue(text: string): string {
    return this.colorize ? `\x1b[34m${text}\x1b[0m` : text;
  }

  private magenta(text: string): string {
    return this.colorize ? `\x1b[35m${text}\x1b[0m` : text;
  }

  private cyan(text: string): string {
    return this.colorize ? `\x1b[36m${text}\x1b[0m` : text;
  }

  private purple(text: string): string {
    return this.colorize ? `\x1b[95m${text}\x1b[0m` : text;
  }

  flush(): void {
    // Console output is immediately flushed
  }
}