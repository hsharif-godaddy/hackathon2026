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

    // Transform appId to app_id for log output
    const transformed = this.transformFieldNames(sanitized);

    // Convert to JSON string
    const jsonLog = JSON.stringify(transformed);

    // Write to appropriate stream based on log level
    if (event.level === 'error' || event.level === 'fatal') {
      this.errorOutput.write(jsonLog + '\n');
    } else {
      this.output.write(jsonLog + '\n');
    }
  }

  /**
   * Transform field names from camelCase to snake_case for log output
   * Currently transforms: appId -> app_id, productId -> product_id
   */
  private transformFieldNames(event: any): any {
    if (!event || typeof event !== 'object') {
      return event;
    }

    const result: any = Array.isArray(event) ? [] : {};

    const fieldMap: Record<string, string> = {
      appId: 'app_id',
      productId: 'product_id',
    };

    for (const [key, value] of Object.entries(event)) {
      const newKey = fieldMap[key] ?? key;

      // Recursively transform nested objects
      if (value && typeof value === 'object') {
        result[newKey] = this.transformFieldNames(value);
      } else {
        result[newKey] = value;
      }
    }

    return result;
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
