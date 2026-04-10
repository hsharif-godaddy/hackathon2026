/**
 * SqlStatementSplitter
 *
 * Streaming SQL statement splitter that correctly handles:
 * - Semicolons inside string literals ('foo;bar')
 * - Double-quoted identifiers ("col;name")
 * - DELIMITER commands (for stored procedures/triggers)
 * - Block comments
 * - Single-line comments (-- ... and # ...)
 * - BOM removal
 * - SQL sanitization (strip DEFINER, GTID_PURGED, etc.)
 *
 * Usage:
 *   const splitter = new SqlStatementSplitter();
 *   for (const chunk of chunks) {
 *     const statements = splitter.splitStatements(chunk);
 *     for (const stmt of statements) { await execute(stmt); }
 *   }
 *   const remaining = splitter.flush();
 *   for (const stmt of remaining) { await execute(stmt); }
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export class SqlStatementSplitter {
  private buffer = '';
  private inSingleQuote = false;
  private inDoubleQuote = false;
  private inBacktickQuote = false;
  private inBlockComment = false;
  private inLineComment = false;
  private currentDelimiter = ';';
  private isFirstChunk = true;

  /**
   * Feed a chunk of SQL text and get back any complete statements.
   */
  splitStatements(chunk: string): string[] {
    // Strip BOM from first chunk
    if (this.isFirstChunk) {
      if (chunk.charCodeAt(0) === 0xfeff) {
        chunk = chunk.slice(1);
      }
      this.isFirstChunk = false;
    }

    const statements: string[] = [];
    let i = 0;

    while (i < chunk.length) {
      const ch = chunk[i];
      const next = i + 1 < chunk.length ? chunk[i + 1] : '';

      // Handle line comment end
      if (this.inLineComment) {
        if (ch === '\n') {
          this.inLineComment = false;
        }
        this.buffer += ch;
        i++;
        continue;
      }

      // Handle block comment end
      if (this.inBlockComment) {
        this.buffer += ch;
        if (ch === '*' && next === '/') {
          this.buffer += '/';
          this.inBlockComment = false;
          i += 2;
        } else {
          i++;
        }
        continue;
      }

      // Handle single-quoted string
      if (this.inSingleQuote) {
        this.buffer += ch;
        if (ch === '\\') {
          // Escaped character — consume next char too
          if (next) {
            this.buffer += next;
            i += 2;
          } else {
            i++;
          }
        } else if (ch === "'") {
          // Check for escaped single quote ('')
          if (next === "'") {
            this.buffer += next;
            i += 2;
          } else {
            this.inSingleQuote = false;
            i++;
          }
        } else {
          i++;
        }
        continue;
      }

      // Handle double-quoted string
      if (this.inDoubleQuote) {
        this.buffer += ch;
        if (ch === '\\') {
          if (next) {
            this.buffer += next;
            i += 2;
          } else {
            i++;
          }
        } else if (ch === '"') {
          if (next === '"') {
            this.buffer += next;
            i += 2;
          } else {
            this.inDoubleQuote = false;
            i++;
          }
        } else {
          i++;
        }
        continue;
      }

      // Handle backtick-quoted identifier
      if (this.inBacktickQuote) {
        this.buffer += ch;
        if (ch === '`') {
          if (next === '`') {
            this.buffer += next;
            i += 2;
          } else {
            this.inBacktickQuote = false;
            i++;
          }
        } else {
          i++;
        }
        continue;
      }

      // Not inside any quote or comment — check for new constructs

      // Block comment start
      if (ch === '/' && next === '*') {
        this.inBlockComment = true;
        this.buffer += '/*';
        i += 2;
        continue;
      }

      // Line comment start (-- followed by whitespace or end-of-input, per MySQL spec)
      if (ch === '-' && next === '-') {
        const afterDash = i + 2 < chunk.length ? chunk[i + 2] : undefined;
        if (afterDash === undefined || afterDash === ' ' || afterDash === '\t' || afterDash === '\n' || afterDash === '\r') {
          this.inLineComment = true;
          this.buffer += '--';
          i += 2;
          continue;
        }
      }

      // Line comment start (#)
      if (ch === '#') {
        this.inLineComment = true;
        this.buffer += '#';
        i++;
        continue;
      }

      // String literal start
      if (ch === "'") {
        this.inSingleQuote = true;
        this.buffer += ch;
        i++;
        continue;
      }
      if (ch === '"') {
        this.inDoubleQuote = true;
        this.buffer += ch;
        i++;
        continue;
      }
      if (ch === '`') {
        this.inBacktickQuote = true;
        this.buffer += ch;
        i++;
        continue;
      }

      // Check for DELIMITER command (case-insensitive, at start of statement)
      if (this.buffer.trim() === '' && this.matchDelimiterCommand(chunk, i)) {
        const match = this.extractDelimiterCommand(chunk, i);
        if (match) {
          this.currentDelimiter = match.delimiter;
          i = match.endIndex;
          this.buffer = '';
          continue;
        }
      }

      // Check for delimiter match
      if (this.matchesDelimiter(chunk, i)) {
        const stmt = this.buffer.trim();
        if (stmt.length > 0) {
          const sanitized = SqlStatementSplitter.sanitizeStatement(stmt);
          if (sanitized !== null) {
            statements.push(sanitized);
          }
        }
        this.buffer = '';
        i += this.currentDelimiter.length;
        continue;
      }

      this.buffer += ch;
      i++;
    }

    return statements;
  }

  /**
   * Return any remaining buffered statement at end of stream.
   */
  flush(): string[] {
    const stmt = this.buffer.trim();
    this.buffer = '';
    if (stmt.length > 0) {
      const sanitized = SqlStatementSplitter.sanitizeStatement(stmt);
      if (sanitized !== null) {
        return [sanitized];
      }
    }
    return [];
  }

  /**
   * Reset internal state for reuse.
   */
  reset(): void {
    this.buffer = '';
    this.inSingleQuote = false;
    this.inDoubleQuote = false;
    this.inBacktickQuote = false;
    this.inBlockComment = false;
    this.inLineComment = false;
    this.currentDelimiter = ';';
    this.isFirstChunk = true;
  }

  /**
   * Check if text at position matches current delimiter.
   */
  private matchesDelimiter(text: string, pos: number): boolean {
    if (pos + this.currentDelimiter.length > text.length) return false;
    return text.substring(pos, pos + this.currentDelimiter.length) === this.currentDelimiter;
  }

  /**
   * Check if we're at a DELIMITER command.
   */
  private matchDelimiterCommand(text: string, pos: number): boolean {
    const remaining = text.substring(pos).trimStart();
    return /^DELIMITER\s/i.test(remaining);
  }

  /**
   * Extract the DELIMITER command and return the new delimiter + end position.
   */
  private extractDelimiterCommand(
    text: string,
    pos: number,
  ): { delimiter: string; endIndex: number } | null {
    // Find DELIMITER keyword start (skip leading whitespace in buffer context)
    const remaining = text.substring(pos);
    const match = remaining.match(/^(\s*DELIMITER\s+)(\S+)([ \t]*(?:\r?\n|$))/i);
    if (!match) return null;

    const delimiter = match[2]!;
    const endIndex = pos + match[1]!.length + match[2]!.length + match[3]!.length;
    return { delimiter, endIndex };
  }

  /**
   * Sanitize a SQL statement. Returns null if the statement should be skipped entirely.
   */
  static sanitizeStatement(stmt: string): string | null {
    const trimmed = stmt.trim();

    // Skip empty or comment-only statements
    if (trimmed.length === 0) return null;
    if (trimmed.startsWith('--') && !trimmed.includes('\n')) return null;
    if (trimmed.startsWith('/*') && trimmed.endsWith('*/') && !trimmed.includes('\n')) return null;

    const upper = trimmed.toUpperCase();

    // Strip statements that should be skipped entirely
    if (upper.startsWith('CREATE DATABASE')) return null;
    if (upper.startsWith('DROP DATABASE')) return null;
    if (/^USE\s+/i.test(trimmed)) return null;
    if (upper.startsWith('LOCK TABLES')) return null;
    if (upper === 'UNLOCK TABLES') return null;
    if (upper.startsWith('SET @@GLOBAL.GTID_PURGED')) return null;
    if (upper.startsWith('SET @@SESSION.SQL_LOG_BIN')) return null;

    // Filter privilege-escalation statements
    if (upper.startsWith('GRANT ')) return null;
    if (upper.startsWith('REVOKE ')) return null;
    if (upper.startsWith('CREATE USER')) return null;
    if (upper.startsWith('DROP USER')) return null;
    if (upper.startsWith('ALTER USER')) return null;
    if (upper.startsWith('RENAME USER')) return null;
    if (upper.startsWith('SET PASSWORD')) return null;

    let result = trimmed;

    // Strip DEFINER clauses from CREATE VIEW/PROCEDURE/TRIGGER/FUNCTION/EVENT
    // Pattern: DEFINER=`user`@`host` or DEFINER='user'@'host' or DEFINER = `user`@`host`
    result = result.replace(
      /\bDEFINER\s*=\s*(?:`[^`]*`|'[^']*'|"[^"]*"|[^\s@]+)\s*@\s*(?:`[^`]*`|'[^']*'|"[^"]*"|[^\s]+)\s*/gi,
      '',
    );

    // Strip NO_AUTO_CREATE_USER from SET sql_mode
    if (/^SET\s+(?:@@(?:SESSION|GLOBAL)\.)?sql_mode/i.test(result)) {
      result = result.replace(/,?\s*'?NO_AUTO_CREATE_USER'?\s*,?/gi, (match, offset, str) => {
        // If removing creates empty quotes or trailing comma issues, clean up
        return match.startsWith(',') && match.endsWith(',') ? ',' : '';
      });
      // Clean up double commas or trailing commas in quotes
      result = result.replace(/,,+/g, ',');
      result = result.replace(/,\s*'/g, "'");
      result = result.replace(/'\s*,/g, "'");
    }

    return result;
  }

  /**
   * Fast estimate of statement count via semicolon counting.
   * This is approximate — counts semicolons inside strings and comments too.
   */
  static async estimateStatementCount(filePath: string, timeoutMs = 5000): Promise<number> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await new Promise((resolve, reject) => {
        let count = 0;
        const rl = createInterface({
          input: createReadStream(filePath, { encoding: 'utf8', signal: ac.signal }),
          crlfDelay: Infinity,
        });

        rl.on('line', (line: string) => {
          for (const ch of line) {
            if (ch === ';') count++;
          }
        });

        rl.on('close', () => resolve(count));
        rl.on('error', reject);
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
