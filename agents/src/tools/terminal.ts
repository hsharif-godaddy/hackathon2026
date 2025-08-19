import { spawn } from 'child_process';
import { join, resolve, relative } from 'path';
import { existsSync } from 'fs';

export interface TerminalCommandOptions {
  /** The shell command to execute */
  command: string;
  /** Working directory relative to app root (default: app root) */
  workingDir?: string;
  /** Maximum execution time in milliseconds (default: 30000) */
  timeout?: number;
  /** Environment variables to set */
  env?: Record<string, string>;
}

export interface TerminalCommandResult {
  /** The command that was executed */
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
 * Allows execution of shell commands within the app directory with safety restrictions
 */
export class TerminalTool {
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly MAX_TIMEOUT = 300000; // 5 minutes
  private readonly MAX_OUTPUT_LENGTH = 50000; // 50KB output limit

  // Commands that are blocked for security reasons
  private readonly BLOCKED_COMMANDS = [
    'rm -rf /',
    'sudo',
    'su',
    'chmod 777',
    'chown',
    'passwd',
    'useradd',
    'userdel',
    'systemctl',
    'service',
    'mount',
    'umount',
    'fdisk',
    'mkfs',
    'dd',
    '> /etc/',
    '> /bin/',
    '> /usr/',
    '> /var/',
    '> /opt/',
  ];

  // Potentially dangerous command patterns
  private readonly DANGEROUS_PATTERNS = [
    /rm\s+-rf\s+[\/~]/,
    />\s*\/(?:etc|bin|usr|var|opt|sys|proc|dev)\//,
    /sudo\s+/,
    /su\s+/,
    /chmod\s+777/,
    /curl.*\|\s*sh/,
    /wget.*\|\s*sh/,
    /eval\s*\$\(/,
    /\$\(.*curl/,
    /\$\(.*wget/,
  ];

  /**
   * Execute a shell command in the specified directory
   */
  async executeCommand(
    appPath: string,
    options: TerminalCommandOptions
  ): Promise<TerminalCommandResult> {
    const startTime = Date.now();
    const {
      command,
      workingDir = '',
      timeout = this.DEFAULT_TIMEOUT,
      env = {},
    } = options;

    // Check if this is a noop command (like npm run dev)
    if (this.isNoopCommand(command)) {
      const executionTime = Date.now() - startTime;
      return {
        command,
        workingDir: workingDir || '.',
        exitCode: 0,
        stdout: 'Development server is already running and watching for changes. No action needed.',
        stderr: '',
        success: true,
        executionTime,
        timedOut: false,
      };
    }

    // Validate command safety
    this.validateCommand(command);

    // Resolve and validate working directory
    const resolvedWorkingDir = this.resolveWorkingDirectory(appPath, workingDir);

    // Prepare environment
    const environment = {
      ...process.env,
      ...env,
      // Ensure PATH is available
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    };

    const result: TerminalCommandResult = {
      command,
      workingDir: relative(appPath, resolvedWorkingDir),
      exitCode: -1,
      stdout: '',
      stderr: '',
      success: false,
      executionTime: 0,
      timedOut: false,
    };

    try {
      const actualTimeout = Math.min(timeout, this.MAX_TIMEOUT);
      const commandResult = await this.runCommand(command, resolvedWorkingDir, environment, actualTimeout);
      
      Object.assign(result, commandResult);
      result.executionTime = Date.now() - startTime;
      result.success = result.exitCode === 0 && !result.timedOut;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.executionTime = Date.now() - startTime;
    }

    return result;
  }

  /**
   * Validate that the command is safe to execute
   */
  private validateCommand(command: string): void {
    const trimmedCommand = command.trim().toLowerCase();

    // Check blocked commands
    for (const blocked of this.BLOCKED_COMMANDS) {
      if (trimmedCommand.includes(blocked.toLowerCase())) {
        throw new Error(`Command contains blocked operation: ${blocked}`);
      }
    }

    // Check dangerous patterns
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        throw new Error(`Command matches dangerous pattern: ${pattern.source}`);
      }
    }

    // Basic validation
    if (!command.trim()) {
      throw new Error('Command cannot be empty');
    }

    if (command.length > 1000) {
      throw new Error('Command is too long (max 1000 characters)');
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
      'pnpm dev',
      'pnpm start',
      'bun dev',
      'bun start'
    ];

    return noopCommands.some(noop => trimmedCommand === noop || trimmedCommand.startsWith(noop + ' '));
  }

  /**
   * Resolve and validate the working directory
   */
  private resolveWorkingDirectory(appPath: string, workingDir: string): string {
    // Start with the app path
    const resolvedPath = resolve(appPath, workingDir);

    // Ensure the resolved path is within the app directory
    if (!resolvedPath.startsWith(appPath)) {
      throw new Error('Working directory must be within the app directory');
    }

    // Check if directory exists
    if (!existsSync(resolvedPath)) {
      throw new Error(`Working directory does not exist: ${workingDir || '.'}`);
    }

    return resolvedPath;
  }

  /**
   * Execute the command using child_process
   */
  private runCommand(
    command: string,
    workingDir: string,
    env: Record<string, string>,
    timeout: number
  ): Promise<Omit<TerminalCommandResult, 'command' | 'workingDir' | 'executionTime' | 'success'>> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Use shell to execute the command
      const child = spawn('sh', ['-c', command], {
        cwd: workingDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        
        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, timeout);

      // Collect stdout
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        // Prevent memory issues with very large outputs
        if (stdout.length > this.MAX_OUTPUT_LENGTH) {
          stdout = stdout.substring(0, this.MAX_OUTPUT_LENGTH) + '\n... (output truncated)';
          child.kill('SIGTERM');
        }
      });

      // Collect stderr
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        // Prevent memory issues with very large outputs
        if (stderr.length > this.MAX_OUTPUT_LENGTH) {
          stderr = stderr.substring(0, this.MAX_OUTPUT_LENGTH) + '\n... (error output truncated)';
          child.kill('SIGTERM');
        }
      });

      // Handle process completion
      child.on('close', (code) => {
        clearTimeout(timeoutId);
        resolve({
          exitCode: code || 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          timedOut,
        });
      });

      // Handle process errors
      child.on('error', (error) => {
        clearTimeout(timeoutId);
        resolve({
          exitCode: -1,
          stdout: stdout.trim(),
          stderr: error.message,
          timedOut,
          error: error.message,
        });
      });
    });
  }

  /**
   * Format the command result for display
   */
  formatResult(result: TerminalCommandResult): string {
    const lines: string[] = [];
    
    lines.push(`💻 Command: \`${result.command}\``);
    lines.push(`📁 Working Directory: ${result.workingDir || '.'}`);
    lines.push(`⏱️  Execution Time: ${result.executionTime}ms`);
    lines.push(`🔢 Exit Code: ${result.exitCode} ${result.success ? '✅' : '❌'}`);
    
    if (result.timedOut) {
      lines.push(`⏰ Command timed out`);
    }

    if (result.stdout) {
      lines.push('');
      lines.push('📤 **Standard Output:**');
      lines.push('```');
      lines.push(result.stdout);
      lines.push('```');
    }

    if (result.stderr) {
      lines.push('');
      lines.push('🚨 **Standard Error:**');
      lines.push('```');
      lines.push(result.stderr);
      lines.push('```');
    }

    if (result.error) {
      lines.push('');
      lines.push(`❌ **Error:** ${result.error}`);
    }

    return lines.join('\n');
  }
}
