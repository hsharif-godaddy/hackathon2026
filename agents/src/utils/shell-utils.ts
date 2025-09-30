/**
 * Shell Command Utilities
 * 
 * Provides secure shell command construction and argument escaping utilities.
 * All functions in this module are designed to prevent command injection attacks.
 */

/**
 * Custom error class for shell command validation and construction errors
 */
export class ShellCommandError extends Error {
  constructor(
    message: string, 
    public readonly parameter?: string, 
    public readonly value?: string
  ) {
    super(message);
    this.name = 'ShellCommandError';
  }
}

/**
 * Escapes a shell argument by wrapping it in single quotes and escaping any existing single quotes.
 * This prevents shell interpretation of special characters like spaces, semicolons, backticks, etc.
 * 
 * @param arg - The argument to escape
 * @returns The escaped argument wrapped in single quotes
 * 
 * @throws {ShellCommandError} If the argument is not a string
 * 
 * @example
 * ```typescript
 * const escaped = escapeShellArg("hello world");
 * // Returns: 'hello world'
 * 
 * const escaped = escapeShellArg("it's working");
 * // Returns: 'it'\''s working'
 * 
 * const escaped = escapeShellArg("dangerous; rm -rf /");
 * // Returns: 'dangerous; rm -rf /'
 * ```
 */
export function escapeShellArg(arg: string): string {
  if (typeof arg !== 'string') {
    throw new ShellCommandError('Argument must be a string', 'arg', String(arg));
  }

  // Single quotes prevent all shell interpretation
  // Replace any existing single quotes with '\''
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Safely constructs a shell command from an array of arguments with proper escaping.
 * The first argument (command name) is validated for safety, and all subsequent arguments
 * are properly escaped to prevent command injection.
 * 
 * @param args - Array of command and arguments
 * @returns Properly escaped command string
 * 
 * @throws {ShellCommandError} If arguments are invalid or command name is unsafe
 * 
 * @example
 * ```typescript
 * const command = buildShellCommand(['git', 'commit', '-m', 'fix: handle special chars']);
 * // Returns: git 'commit' '-m' 'fix: handle special chars'
 * 
 * const command = buildShellCommand(['echo', 'hello; rm -rf /']);
 * // Returns: echo 'hello; rm -rf /'
 * 
 * // This will throw an error:
 * buildShellCommand(['../evil', 'arg']); // Command validation fails
 * ```
 */
export function buildShellCommand(args: string[]): string {
  if (!Array.isArray(args)) {
    throw new ShellCommandError('Arguments must be an array', 'args', String(args));
  }

  if (args.length === 0) {
    throw new ShellCommandError('Arguments array cannot be empty', 'args', '[]');
  }

  // First argument (command) doesn't need escaping if it's a simple command
  const [command, ...restArgs] = args;
  
  // Ensure command exists (this should never happen due to empty array check above)
  if (!command) {
    throw new ShellCommandError('Command cannot be empty', 'command', '');
  }
  
  // Validate command is safe (no path traversal, only alphanumeric + common chars)
  if (!/^[a-zA-Z0-9_-]+$/.test(command)) {
    throw new ShellCommandError('Command must be alphanumeric with hyphens/underscores only', 'command', command);
  }

  // Escape all other arguments
  const escapedArgs = restArgs.map(arg => escapeShellArg(arg));
  
  return [command, ...escapedArgs].join(' ');
}

/**
 * Validates that a command name is safe for shell execution.
 * Only allows alphanumeric characters, hyphens, and underscores.
 * 
 * @param command - The command name to validate
 * @returns The validated command name
 * 
 * @throws {ShellCommandError} If the command name is invalid
 * 
 * @example
 * ```typescript
 * validateCommandName('git'); // Returns: 'git'
 * validateCommandName('curl-test'); // Returns: 'curl-test'
 * validateCommandName('test_command'); // Returns: 'test_command'
 * 
 * validateCommandName('../evil'); // Throws ShellCommandError
 * validateCommandName('/bin/rm'); // Throws ShellCommandError
 * ```
 */
export function validateCommandName(command: string): string {
  if (typeof command !== 'string') {
    throw new ShellCommandError('Command must be a string', 'command', String(command));
  }

  if (!command) {
    throw new ShellCommandError('Command cannot be empty', 'command', '');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(command)) {
    throw new ShellCommandError('Command must be alphanumeric with hyphens/underscores only', 'command', command);
  }

  return command;
}