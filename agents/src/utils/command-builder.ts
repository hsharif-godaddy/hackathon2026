import { validateHostPort, escapeShellArg } from './network-validation.js';

/**
 * Error thrown when command building fails validation
 */
export class CommandBuilderError extends Error {
  constructor(message: string, public readonly command?: string, public readonly args?: string[]) {
    super(message);
    this.name = 'CommandBuilderError';
  }
}

/**
 * Interface for command building options
 */
export interface CommandOptions {
  /** Maximum command length (default: 1000) */
  maxLength?: number;
  /** Whether to validate the entire command for safety (default: true) */
  validateCommand?: boolean;
  /** Custom validation function for additional checks */
  customValidator?: (command: string) => void;
}

/**
 * Safe command builder for constructing shell commands with proper escaping and validation
 * 
 * This utility provides a secure way to build shell commands by:
 * - Automatically escaping all arguments
 * - Validating command structure 
 * - Preventing command injection attacks
 * - Following established security patterns from TerminalTool
 * 
 * @example
 * ```typescript
 * const builder = new CommandBuilder('curl');
 * const command = builder
 *   .addFlag('-f')
 *   .addOption('--connect-timeout', '1')
 *   .addOption('--max-time', '1')
 *   .addArgument('http://localhost:8080/health')
 *   .build();
 * ```
 */
export class CommandBuilder {
  private program: string;
  private args: string[] = [];
  private options: CommandOptions;

  // Common dangerous patterns (borrowed from TerminalTool patterns)
  private static readonly DANGEROUS_PATTERNS = [
    /\$\(/,         // Command substitution
    /`[^`]*`/,      // Backtick command substitution
    /\|\s*\w/,      // Pipe to commands
    /;\s*\w/,       // Command chaining
    /&&\s*\w/,      // AND chaining
    /\|\|\s*\w/,    // OR chaining
    /(?<!')[;&|`](?!')/,  // Unescaped dangerous chars (not in single quotes)
  ];

  /**
   * Create a new command builder
   * 
   * @param program - The base program/command to execute
   * @param options - Optional configuration
   */
  constructor(program: string, options: CommandOptions = {}) {
    this.program = this.validateAndEscapeProgram(program);
    this.options = {
      maxLength: 1000,
      validateCommand: true,
      ...options
    };
  }

  /**
   * Add a simple flag (e.g., -f, --verbose)
   * 
   * @param flag - The flag to add
   * @returns This builder for chaining
   */
  addFlag(flag: string): this {
    if (typeof flag !== 'string' || !flag.trim()) {
      throw new CommandBuilderError('Flag must be a non-empty string');
    }

    const trimmedFlag = flag.trim();
    
    // Basic validation for flag format
    if (!trimmedFlag.startsWith('-')) {
      throw new CommandBuilderError(`Invalid flag format: ${flag}. Flags must start with -`);
    }

    this.args.push(escapeShellArg(trimmedFlag));
    return this;
  }

  /**
   * Add an option with a value (e.g., --timeout 30, -p 8080)
   * 
   * @param option - The option name
   * @param value - The option value
   * @returns This builder for chaining
   */
  addOption(option: string, value: string | number): this {
    if (typeof option !== 'string' || !option.trim()) {
      throw new CommandBuilderError('Option must be a non-empty string');
    }

    const trimmedOption = option.trim();
    
    // Basic validation for option format
    if (!trimmedOption.startsWith('-')) {
      throw new CommandBuilderError(`Invalid option format: ${option}. Options must start with -`);
    }

    const stringValue = String(value);
    if (!stringValue.trim()) {
      throw new CommandBuilderError('Option value cannot be empty');
    }

    this.args.push(escapeShellArg(trimmedOption));
    this.args.push(escapeShellArg(stringValue.trim()));
    return this;
  }

  /**
   * Add a raw argument (will be escaped automatically)
   * 
   * @param arg - The argument to add
   * @returns This builder for chaining
   */
  addArgument(arg: string): this {
    if (typeof arg !== 'string') {
      throw new CommandBuilderError('Argument must be a string');
    }

    if (!arg.trim()) {
      throw new CommandBuilderError('Argument cannot be empty');
    }

    this.args.push(escapeShellArg(arg.trim()));
    return this;
  }

  /**
   * Add a URL argument with host/port validation
   * 
   * @param url - The URL to add (will be validated and escaped)
   * @returns This builder for chaining
   */
  addUrl(url: string): this {
    if (typeof url !== 'string' || !url.trim()) {
      throw new CommandBuilderError('URL must be a non-empty string');
    }

    const trimmedUrl = url.trim();

    try {
      const urlObj = new URL(trimmedUrl);
      
      // Validate host and port if present
      const port = urlObj.port ? parseInt(urlObj.port, 10) : (urlObj.protocol === 'https:' ? 443 : 80);
      validateHostPort(urlObj.hostname, port);
      
      this.args.push(escapeShellArg(trimmedUrl));
    } catch (error) {
      if (error instanceof Error) {
        throw new CommandBuilderError(`Invalid URL: ${error.message}`, undefined, [url]);
      }
      throw new CommandBuilderError(`Invalid URL: ${url}`, undefined, [url]);
    }

    return this;
  }

  /**
   * Add multiple arguments at once
   * 
   * @param args - Array of arguments to add
   * @returns This builder for chaining
   */
  addArguments(args: string[]): this {
    if (!Array.isArray(args)) {
      throw new CommandBuilderError('Arguments must be an array');
    }

    for (const arg of args) {
      this.addArgument(arg);
    }

    return this;
  }

  /**
   * Build the final command string
   * 
   * @returns The safely constructed command string
   */
  build(): string {
    const command = [this.program, ...this.args].join(' ');

    // Check length
    if (command.length > this.options.maxLength!) {
      throw new CommandBuilderError(`Command exceeds maximum length (${this.options.maxLength} characters)`, command);
    }

    // Validate command if enabled
    if (this.options.validateCommand) {
      this.validateBuiltCommand(command);
    }

    // Apply custom validation if provided
    if (this.options.customValidator) {
      this.options.customValidator(command);
    }

    return command;
  }

  /**
   * Get the current command arguments (for debugging)
   * 
   * @returns Array of current arguments
   */
  getArgs(): string[] {
    return [...this.args];
  }

  /**
   * Reset the builder to start over
   * 
   * @returns This builder for chaining
   */
  reset(): this {
    this.args = [];
    return this;
  }

  /**
   * Validate and escape the base program name
   */
  private validateAndEscapeProgram(program: string): string {
    if (typeof program !== 'string' || !program.trim()) {
      throw new CommandBuilderError('Program must be a non-empty string');
    }

    const trimmedProgram = program.trim();

    // Check for paths first (should be just program name)
    if (trimmedProgram.includes('/') || trimmedProgram.includes('\\')) {
      throw new CommandBuilderError(`Program should be a command name, not a path: ${program}`);
    }

    // Check for dangerous characters in program name
    const dangerousChars = /[;&|`$(){}[\]<>'"]/;
    if (dangerousChars.test(trimmedProgram)) {
      throw new CommandBuilderError(`Program name contains dangerous characters: ${program}`);
    }

    // Check for spaces (indicates multiple words/commands)
    if (trimmedProgram.includes(' ')) {
      throw new CommandBuilderError(`Program name cannot contain spaces: ${program}`);
    }

    return escapeShellArg(trimmedProgram);
  }

  /**
   * Validate the complete built command for safety
   */
  private validateBuiltCommand(command: string): void {
    // Check for dangerous patterns
    for (const pattern of CommandBuilder.DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        throw new CommandBuilderError(`Command contains dangerous pattern: ${pattern.source}`, command);
      }
    }

    // Check for unescaped special characters (shouldn't happen with proper escaping)
    const unescapedSpecial = /(?<!')([;&|`$(){}])(?!')/;
    if (unescapedSpecial.test(command)) {
      throw new CommandBuilderError('Command contains unescaped special characters', command);
    }
  }
}

/**
 * Convenience function to create common curl commands safely
 * 
 * @param url - The URL to curl
 * @param options - Additional curl options
 * @returns Safely built curl command
 * 
 * @example
 * ```typescript
 * const command = buildCurlCommand('http://localhost:8080/health', {
 *   connectTimeout: 1,
 *   maxTime: 1,
 *   failOnError: true
 * });
 * ```
 */
export function buildCurlCommand(url: string, options: {
  connectTimeout?: number;
  maxTime?: number;
  failOnError?: boolean;
  method?: string;
  headers?: Record<string, string>;
  data?: string;
} = {}): string {
  const builder = new CommandBuilder('curl');

  // Add common options
  if (options.failOnError !== false) {
    builder.addFlag('-f');
  }

  if (options.connectTimeout !== undefined) {
    builder.addOption('--connect-timeout', options.connectTimeout);
  }

  if (options.maxTime !== undefined) {
    builder.addOption('--max-time', options.maxTime);
  }

  if (options.method) {
    builder.addOption('-X', options.method);
  }

  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      builder.addOption('-H', `${key}: ${value}`);
    }
  }

  if (options.data) {
    builder.addOption('-d', options.data);
  }

  // Add URL last
  builder.addUrl(url);

  return builder.build();
}

/**
 * Convenience function to create common npm commands safely
 * 
 * @param subcommand - The npm subcommand (install, build, test, etc.)
 * @param args - Additional arguments
 * @returns Safely built npm command
 */
export function buildNpmCommand(subcommand: string, args: string[] = []): string {
  const builder = new CommandBuilder('npm');
  builder.addArgument(subcommand);
  
  if (args.length > 0) {
    builder.addArguments(args);
  }

  return builder.build();
}

/**
 * Convenience function to create common git commands safely
 * 
 * @param subcommand - The git subcommand (clone, pull, push, etc.)
 * @param args - Additional arguments
 * @returns Safely built git command
 */
export function buildGitCommand(subcommand: string, args: string[] = []): string {
  const builder = new CommandBuilder('git');
  builder.addArgument(subcommand);
  
  if (args.length > 0) {
    builder.addArguments(args);
  }

  return builder.build();
}
