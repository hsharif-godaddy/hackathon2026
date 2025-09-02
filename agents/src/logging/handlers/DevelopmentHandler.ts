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