import type { WorkspaceTasks } from '../workspace/tasks.js';

export interface CommandOverride {
  /** Pattern to match against (can be string or regex) */
  pattern: string | RegExp;
  /** Replacement command template (use $1, $2, etc. for regex groups) */
  replacement: string;
  /** Whether to match only at the start of the command */
  startOnly?: boolean;
}

export interface TerminalCommandOptions {
  /** The shell command to execute */
  command: string;
  /** Working directory relative to app root (default: app root) */
  workingDir?: string;
  /** Maximum execution time in milliseconds (default: 30000) */
  timeout?: number;
  /** Environment variables to set */
  env?: Record<string, string>;
  /** Command overrides to apply before execution */
  commandOverrides?: CommandOverride[];
}

export interface TerminalCommandResult {
  /** The original command that was requested */
  originalCommand?: string;
  /** The command that was executed (after overrides) */
  command: string;
  /** The working directory where it was executed */
  workingDir: string;
  /** Exit code of the command */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Whether the command succeeded (exitCode === 0) */
  success: boolean;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Whether the command timed out */
  timedOut: boolean;
  /** Any errors that occurred during execution */
  error?: string;
}

/**
 * Terminal Tool
 * Allows execution of shell commands within the app directory via dev-supervisor only
 */
export class TerminalTool {
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly MAX_TIMEOUT = 300000; // 5 minutes
  private readonly MAX_OUTPUT_LENGTH = 50000; // 50KB output limit
  private readonly tasks: WorkspaceTasks | null;

  constructor(tasks?: WorkspaceTasks) {
    this.tasks = tasks || null;
  }

  isWorkspaceAvailable(): boolean {
    return this.tasks !== null;
  }

  /**
   * Sanitize terminal output by removing ANSI escape codes and other control characters
   */
  private sanitizeOutput(text: string): string {
    return text
      // Remove ANSI escape sequences (colors, cursor movements, etc.)
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      // Remove other ANSI escape sequences  
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07]*\x07/g, '')
      // Remove other control characters except newlines, tabs, and carriage returns
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '')
      // Clean up multiple consecutive newlines
      .replace(/\n{3,}/g, '\n\n')
      // Clean up carriage returns followed by newlines
      .replace(/\r\n/g, '\n')
      // Remove standalone carriage returns
      .replace(/\r/g, '');
  }

  // Fork bomb pattern — Landlock can't limit process creation, so we keep this check.
  // All other dangerous commands (filesystem destruction, network abuse, etc.) are enforced
  // by the Landlock sandbox in dev-supervisor's airo-sandbox binary.
  private readonly FORK_BOMB_PATTERN = /:\(\)\s*\{.*\|.*&\s*\}\s*;?\s*:/;

  /**
   * Apply command overrides to transform the command
   */
  private applyCommandOverrides(command: string, overrides: CommandOverride[] = []): string {
    let transformedCommand = command;

    for (const override of overrides) {
      const { pattern, replacement, startOnly = false } = override;

      if (typeof pattern === 'string') {
        // Simple string replacement
        if (startOnly) {
          if (transformedCommand.startsWith(pattern)) {
            transformedCommand = replacement + transformedCommand.slice(pattern.length);
          }
        } else {
          transformedCommand = transformedCommand.replace(new RegExp(pattern, 'g'), replacement);
        }
      } else {
        // Regex pattern replacement
        if (startOnly) {
          const match = transformedCommand.match(new RegExp(`^${pattern.source}`, pattern.flags));
          if (match) {
            transformedCommand = transformedCommand.replace(new RegExp(`^${pattern.source}`, pattern.flags), replacement);
          }
        } else {
          transformedCommand = transformedCommand.replace(pattern, replacement);
        }
      }
    }

    return transformedCommand;
  }

  /**
   * Execute a shell command in the specified directory
   */
  async executeCommand(
    appPath: string,
    options: TerminalCommandOptions
  ): Promise<TerminalCommandResult> {
    const startTime = Date.now();
    const {
      command: originalCommand,
      workingDir = '',
      timeout = this.DEFAULT_TIMEOUT,
      env = {},
      commandOverrides = [],
    } = options;

    // Apply command overrides
    const command = this.applyCommandOverrides(originalCommand, commandOverrides);

    // Check if this is a noop command (like npm run dev)
    if (this.isNoopCommand(command)) {
      const executionTime = Date.now() - startTime;
      const result: TerminalCommandResult = {
        command,
        workingDir: workingDir || '.',
        exitCode: 0,
        stdout: 'Development server is already running and watching for changes. No action needed.',
        stderr: '',
        success: true,
        executionTime,
        timedOut: false,
      };
      
      if (originalCommand !== command) {
        result.originalCommand = originalCommand;
      }
      
      return result;
    }

    // Validate command safety
    this.validateCommand(command);

    // Validate working directory
    if (workingDir) {
      this.resolveWorkingDirectory(appPath, workingDir);
    }

    if (!this.isWorkspaceAvailable()) {
      throw new Error(
        'Terminal tool requires a workspace connection for command execution. ' +
        'This typically means the system is not running in a containerized environment with dev-supervisor installed, ' +
        'or the supervisor socket is not accessible. For security reasons, direct command execution has been disabled.'
      );
    }

    return await this.executeWithDevSupervisor(command, originalCommand, appPath, workingDir, timeout, env, startTime);
  }

  private async executeWithDevSupervisor(
    command: string,
    originalCommand: string,
    appPath: string,
    workingDir: string,
    timeout: number,
    env: Record<string, string>,
    startTime: number
  ): Promise<TerminalCommandResult> {
    try {
      const timeoutSeconds = Math.min(Math.floor(timeout / 1000), Math.floor(this.MAX_TIMEOUT / 1000));

      const execResult = await this.tasks!.runCommandSync({
        command,
        workingDir: workingDir || undefined,
        timeoutSeconds,
        env: Object.keys(env).length > 0 ? env : undefined,
      });

      // Detect "accepted past wait" — task is still running but our wait expired.
      // HttpTasks signals this with exitCode=-1, timedOut=false, executionTimeMs=0.
      const stillRunning = execResult.exitCode === -1 && !execResult.timedOut && execResult.executionTimeMs === 0;

      const result: TerminalCommandResult = {
        command,
        workingDir: workingDir || '.',
        exitCode: stillRunning ? -1 : execResult.exitCode,
        stdout: this.sanitizeOutput(execResult.stdout).trim(),
        stderr: this.sanitizeOutput(execResult.stderr).trim(),
        success: stillRunning ? false : execResult.exitCode === 0,
        executionTime: Date.now() - startTime,
        timedOut: stillRunning ? true : execResult.timedOut,
        ...(stillRunning && { error: `Command still running after ${timeoutSeconds}s wait — output may be incomplete` }),
      };

      if (originalCommand !== command) {
        result.originalCommand = originalCommand;
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: TerminalCommandResult = {
        command,
        workingDir: workingDir || '.',
        exitCode: -1,
        stdout: '',
        stderr: '',
        success: false,
        executionTime: Date.now() - startTime,
        timedOut: false,
        error: `Task execution failed: ${errorMessage}`,
      };

      if (originalCommand !== command) {
        result.originalCommand = originalCommand;
      }

      return result;
    }
  }


  /**
   * Validate that the command is safe to execute.
   * Most dangerous command patterns (filesystem destruction, privilege escalation, etc.)
   * are enforced by the Landlock sandbox at the kernel level. This validation only covers
   * what Landlock can't enforce: fork bombs and basic input validation.
   */
  private validateCommand(command: string): void {
    const trimmedCommand = command.trim();

    if (!trimmedCommand) {
      throw new Error('Command cannot be empty');
    }

    if (command.length > 1000) {
      throw new Error('Command is too long (max 1000 characters)');
    }

    // Fork bomb detection — Landlock can't limit process creation
    if (this.FORK_BOMB_PATTERN.test(command)) {
      throw new Error('Potentially dangerous command pattern detected');
    }
  }

  /**
   * Check if the command should be treated as a noop
   */
  private isNoopCommand(command: string): boolean {
    const trimmedCommand = command.trim().toLowerCase();
    
    // Commands that should be noops because dev server is already running
    const noopCommands = [
      'npm run dev',
      'npm start',
      'yarn dev',
      'yarn start',
      'yarn run dev',
      'pnpm dev',
      'pnpm start',
      'pnpm run dev',
      'bun dev',
      'bun start',
      'bun run dev'
    ];

    return noopCommands.some(noop => trimmedCommand === noop || trimmedCommand.startsWith(noop + ' '));
  }

  /**
   * Resolve and validate the working directory
   */
  private resolveWorkingDirectory(appPath: string, workingDir: string): void {
    // We just need to validate that the directory path is reasonable
    // The actual path resolution is handled by dev-supervisor
    if (workingDir.includes('..')) {
      throw new Error('Working directory cannot contain ".." path segments');
    }
    
    if (workingDir.startsWith('/')) {
      throw new Error('Working directory must be relative to the app directory');
    }
  }

  /**
   * Format the command result for display
   */
  formatResult(result: TerminalCommandResult): string {
    // Return JSON for easier parsing in custom renderers
    return JSON.stringify({
      originalCommand: result.originalCommand,
      command: result.command,
      workingDir: result.workingDir,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      success: result.success,
      executionTime: result.executionTime,
      timedOut: result.timedOut,
      error: result.error
    }, null, 2);
  }
}
