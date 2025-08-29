import type { LogHandler, LogEvent } from '../types.js';
import { sanitizeLogEvent } from '../schemas/index.js';

/**
 * Production handler that outputs structured JSON logs
 */
export class ProductionHandler implements LogHandler {
  private output: NodeJS.WriteStream;
  private errorOutput: NodeJS.WriteStream;

  constructor(options: {
    output?: NodeJS.WriteStream;
    errorOutput?: NodeJS.WriteStream;
  } = {}) {
    this.output = options.output || process.stdout;
    this.errorOutput = options.errorOutput || process.stderr;
  }

  handle(event: LogEvent): void {
    // Sanitize sensitive data
    const sanitized = sanitizeLogEvent(event);
    
    // Convert to JSON string
    const jsonLog = JSON.stringify(sanitized);
    
    // Write to appropriate stream based on log level
    if (event.level === 'error' || event.level === 'fatal') {
      this.errorOutput.write(jsonLog + '\n');
    } else {
      this.output.write(jsonLog + '\n');
    }
  }

  flush(): void {
    // Ensure all output is written
    if (this.output.write('')) {
      // Write completed synchronously
    }
    if (this.errorOutput.write('')) {
      // Write completed synchronously  
    }
  }
}