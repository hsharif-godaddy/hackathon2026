import { spawn } from 'child_process';
import { resolve, relative } from 'path';
import { existsSync } from 'fs';
// DevSupervisorClient functionality has been moved to the app service

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
 * Allows execution of shell commands within the app directory with safety restrictions
 */
export class TerminalTool {
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly MAX_TIMEOUT = 300000; // 5 minutes
  private readonly MAX_OUTPUT_LENGTH = 50000; // 50KB output limit

  constructor(socketPath?: string) {
    // DevSupervisorClient functionality has been moved to the app service
    // Terminal tool now operates without dev-supervisor integration
  }

  /**
   * Check if dev-supervisor is available for command execution
   */
  isDevSupervisorAvailable(): boolean {
    // Dev-supervisor functionality has been moved to the app service
    return false;
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

  // Commands that are blocked for security reasons (use word boundaries for exact matches)
  private readonly BLOCKED_COMMANDS = [
    'rm -rf /',
    '> /etc/',
    '> /bin/', 
    '> /usr/',
    '> /var/',
    '> /opt/',
  ];

  // Command prefixes that should be blocked (checked at word boundaries)
  private readonly BLOCKED_COMMAND_PREFIXES = [
    'sudo ',
    'su ',
    'chmod 777',
    'chown ',
    'passwd ',
    'useradd ',
    'userdel ',
    'systemctl ',
    'service ',
    'mount ',
    'umount ',
    'fdisk ',
    'mkfs.',
    'dd ',  // Block 'dd ' (with space) to avoid false positives with 'add', 'shadcn', etc.
  ];

  // Potentially dangerous command patterns
  private readonly DANGEROUS_PATTERNS = [
    /rm\s+-rf\s+[/~]/,
    />\s*\/(?:etc|bin|usr|var|opt|sys|proc|dev)\//,
    /sudo\s+/,
    /su\s+/,
    /chmod\s+777/,
    /curl.*\|\s*sh/,
    /wget.*\|\s*sh/,
    /eval\s*\$\(/,
    /\$\(.*curl/,
    /\$\(.*wget/,
    // Block dangerous file operations to system directories
    /\btouch\s+\/(?:etc|bin|usr|var|opt|sys|proc|dev)\//,
    /\bmkdir\s+\/(?:etc|bin|usr|var|opt|sys|proc|dev)\//,
    // Block standalone 'dd' command (when used as a complete word)
    /\bdd\s+if=/,
    /\bdd\s+of=/,
  ];

  /**
   * Create default npm-to-pnpm command overrides
   */
  static createNpmToPnpmOverrides(): CommandOverride[] {
    return [
      {
        pattern: /^npm\s+/,
        replacement: 'pnpm ',
        startOnly: true,
      },
      {
        pattern: /^npx\s+/,
        replacement: 'pnpm dlx ',
        startOnly: true,
      },
    ];
  }

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

    // Validate working directory (needed for both execution paths)
    if (workingDir) {
      this.resolveWorkingDirectory(appPath, workingDir);
    }

    // Check if we should use dev-supervisor
    if (this.devSupervisor && this.isDevSupervisorAvailable()) {
      return await this.executeWithDevSupervisor(command, originalCommand, appPath, workingDir, timeout, env, startTime);
    }

    // Fallback to direct execution
    return await this.executeDirectly(command, originalCommand, appPath, workingDir, timeout, env, startTime);
  }

  /**
   * Execute command using dev-supervisor
   */
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
      const actualTimeout = Math.min(Math.floor(timeout / 1000), Math.floor(this.MAX_TIMEOUT / 1000));
      
      const execOptions: { command: string; timeout: number; capture_output: boolean; working_dir?: string } = {
        command,
        timeout: actualTimeout,
        capture_output: true
      };
      
      if (workingDir) {
        execOptions.working_dir = workingDir;
      }
      
      const execResult = await this.devSupervisor!.exec(execOptions);

      const result: TerminalCommandResult = {
        command,
        workingDir: workingDir || '.',
        exitCode: execResult.exit_code,
        stdout: this.sanitizeOutput(execResult.stdout).trim(),
        stderr: this.sanitizeOutput(execResult.stderr).trim(),
        success: execResult.success,
        executionTime: Date.now() - startTime,
        timedOut: false, // dev-supervisor handles timeout internally
      };

      if (originalCommand !== command) {
        result.originalCommand = originalCommand;
      }

      return result;
    } catch (error) {
      // If dev-supervisor fails due to unavailability, fall back to direct execution
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('not available at')) {
        // Dev-supervisor is not running, fall back to direct execution
        return await this.executeDirectly(command, originalCommand, appPath, workingDir, timeout, env, startTime);
      }

      // For other errors, return error result
      const result: TerminalCommandResult = {
        command,
        workingDir: workingDir || '.',
        exitCode: -1,
        stdout: '',
        stderr: '',
        success: false,
        executionTime: Date.now() - startTime,
        timedOut: false,
        error: errorMessage,
      };

      if (originalCommand !== command) {
        result.originalCommand = originalCommand;
      }

      return result;
    }
  }

  /**
   * Execute command directly (fallback method)
   */
  private async executeDirectly(
    command: string,
    originalCommand: string,
    appPath: string,
    workingDir: string,
    timeout: number,
    env: Record<string, string>,
    startTime: number
  ): Promise<TerminalCommandResult> {
    // Resolve working directory (validation already done)
    const resolvedWorkingDir = workingDir ? resolve(appPath, workingDir) : appPath;

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
    
    if (originalCommand !== command) {
      result.originalCommand = originalCommand;
    }

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
    const trimmedCommand = command.trim();
    const lowerCommand = trimmedCommand.toLowerCase();

    // Basic validation first
    if (!trimmedCommand) {
      throw new Error('Command cannot be empty');
    }

    if (command.length > 1000) {
      throw new Error('Command is too long (max 1000 characters)');
    }

    // Check blocked commands (exact substring matches)
    for (const blocked of this.BLOCKED_COMMANDS) {
      if (lowerCommand.includes(blocked.toLowerCase())) {
        throw new Error(`Command contains blocked operation: ${blocked}`);
      }
    }

    // Check blocked command prefixes (at word boundaries or start of command)
    for (const prefix of this.BLOCKED_COMMAND_PREFIXES) {
      const lowerPrefix = prefix.toLowerCase();
      // Check if command starts with the prefix or has it after whitespace
      if (lowerCommand.startsWith(lowerPrefix) || 
          lowerCommand.includes(' ' + lowerPrefix) ||
          lowerCommand.includes('\t' + lowerPrefix) ||
          lowerCommand.includes(';' + lowerPrefix) ||
          lowerCommand.includes('&&' + lowerPrefix) ||
          lowerCommand.includes('||' + lowerPrefix)) {
        throw new Error(`Command contains blocked operation: ${prefix.trim()}`);
      }
    }

    // Check dangerous patterns
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        throw new Error(`Command matches dangerous pattern: ${pattern.source}`);
      }
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
        const sanitized = this.sanitizeOutput(data.toString());
        stdout += sanitized;
        // Prevent memory issues with very large outputs
        if (stdout.length > this.MAX_OUTPUT_LENGTH) {
          stdout = stdout.substring(0, this.MAX_OUTPUT_LENGTH) + '\n... (output truncated)';
          child.kill('SIGTERM');
        }
      });

      // Collect stderr
      child.stderr?.on('data', (data) => {
        const sanitized = this.sanitizeOutput(data.toString());
        stderr += sanitized;
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
          stdout: this.sanitizeOutput(stdout).trim(),
          stderr: this.sanitizeOutput(stderr).trim(),
          timedOut,
        });
      });

      // Handle process errors
      child.on('error', (error) => {
        clearTimeout(timeoutId);
        resolve({
          exitCode: -1,
          stdout: this.sanitizeOutput(stdout).trim(),
          stderr: this.sanitizeOutput(error.message),
          timedOut,
          error: this.sanitizeOutput(error.message),
        });
      });
    });
  }

  /**
   * Format the command result for display
   */
  formatResult(result: TerminalCommandResult): string {
    const lines: string[] = [];
    
    if (result.originalCommand) {
      lines.push(`📝 Original Command: \`${result.originalCommand}\``);
      lines.push(`🔄 Transformed to: \`${result.command}\``);
    } else {
      lines.push(`💻 Command: \`${result.command}\``);
    }
    
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
