import { isIP } from 'node:net';

/**
 * Error thrown when network parameter validation fails
 */
export class NetworkValidationError extends Error {
  constructor(message: string, public readonly parameter: string, public readonly value: string) {
    super(message);
    this.name = 'NetworkValidationError';
  }
}

/**
 * Validate a hostname or IP address for safety in shell commands
 * 
 * Ensures the host parameter contains only safe characters and patterns
 * to prevent command injection when used in shell commands like curl.
 * 
 * @param host - The hostname or IP address to validate
 * @returns The validated host string
 * 
 * @throws {NetworkValidationError} If validation fails
 * 
 * @example
 * ```typescript
 * const safeHost = validateHost('localhost'); // Returns 'localhost'
 * const safeIP = validateHost('127.0.0.1');  // Returns '127.0.0.1'
 * 
 * // These will throw NetworkValidationError:
 * validateHost('host; rm -rf /');  // Command injection attempt
 * validateHost('host`id`');        // Command substitution
 * ```
 */
export function validateHost(host: string): string {
  if (typeof host !== 'string') {
    throw new NetworkValidationError('Host must be a string', 'host', String(host));
  }

  const trimmedHost = host.trim();

  // Basic validation
  if (!trimmedHost) {
    throw new NetworkValidationError('Host cannot be empty', 'host', host);
  }

  if (trimmedHost.length > 253) {
    throw new NetworkValidationError('Host exceeds maximum length (253 characters)', 'host', host);
  }

  // Check for dangerous characters that could enable command injection
  const dangerousChars = /[;&|`$(){}[\]<>'"\\]/;
  if (dangerousChars.test(trimmedHost)) {
    throw new NetworkValidationError('Host contains dangerous characters', 'host', host);
  }

  // Check for control characters and null bytes
  // eslint-disable-next-line no-control-regex
  const controlChars = /[\x00-\x1f\x7f]/;
  if (controlChars.test(trimmedHost)) {
    throw new NetworkValidationError('Host contains control characters', 'host', host);
  }

  // Check for command substitution patterns
  if (trimmedHost.includes('$(') || trimmedHost.includes('`')) {
    throw new NetworkValidationError('Host contains command substitution patterns', 'host', host);
  }

  // Validate as either IP address or hostname
  if (isIP(trimmedHost)) {
    // Valid IP address
    return trimmedHost;
  }

  // Validate hostname format using safer iterative approach instead of complex regex
  if (!isValidHostname(trimmedHost)) {
    throw new NetworkValidationError('Invalid hostname format', 'host', host);
  }

  return trimmedHost;
}

/**
 * Validate hostname format using safe iterative approach
 * 
 * This replaces the ReDoS-vulnerable regex with a safer implementation
 * that checks DNS hostname rules without catastrophic backtracking.
 * 
 * @param hostname - The hostname to validate
 * @returns True if hostname is valid, false otherwise
 */
function isValidHostname(hostname: string): boolean {
  // Basic checks
  if (hostname.length === 0 || hostname.length > 253) {
    return false;
  }

  // Cannot start or end with dot
  if (hostname.startsWith('.') || hostname.endsWith('.')) {
    return false;
  }

  // Cannot start or end with hyphen
  if (hostname.startsWith('-') || hostname.endsWith('-')) {
    return false;
  }

  // Check for consecutive dots
  if (hostname.includes('..')) {
    return false;
  }

  // Split into labels and validate each one
  const labels = hostname.split('.');
  
  for (const label of labels) {
    if (!isValidHostnameLabel(label)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate a single hostname label (part between dots)
 * 
 * @param label - The label to validate
 * @returns True if label is valid, false otherwise
 */
function isValidHostnameLabel(label: string): boolean {
  // Label cannot be empty
  if (label.length === 0) {
    return false;
  }

  // Label cannot be longer than 63 characters
  if (label.length > 63) {
    return false;
  }

  // Label cannot start or end with hyphen
  if (label.startsWith('-') || label.endsWith('-')) {
    return false;
  }

  // Check each character individually (safe iteration)
  for (let i = 0; i < label.length; i++) {
    const char = label.charAt(i);
    const charCode = char.charCodeAt(0);
    
    // Must be alphanumeric or hyphen
    const isLowerAlpha = charCode >= 97 && charCode <= 122; // a-z
    const isUpperAlpha = charCode >= 65 && charCode <= 90;  // A-Z
    const isDigit = charCode >= 48 && charCode <= 57;       // 0-9
    const isHyphen = charCode === 45;                       // -
    
    if (!isLowerAlpha && !isUpperAlpha && !isDigit && !isHyphen) {
      return false;
    }
  }

  return true;
}

/**
 * Validate a port number for safety in shell commands
 * 
 * Ensures the port parameter is a valid port number to prevent
 * command injection when used in shell commands.
 * 
 * @param port - The port number to validate (string or number)
 * @returns The validated port as a number
 * 
 * @throws {NetworkValidationError} If validation fails
 * 
 * @example
 * ```typescript
 * const safePort = validatePort(8080);    // Returns 8080
 * const safePort2 = validatePort('3000'); // Returns 3000
 * 
 * // These will throw NetworkValidationError:
 * validatePort('8080; rm -rf /'); // Command injection attempt
 * validatePort(70000);            // Invalid port range
 * validatePort(-1);               // Invalid port range
 * ```
 */
export function validatePort(port: string | number): number {
  let portNum: number;

  if (typeof port === 'string') {
    const trimmedPort = port.trim();
    
    if (!trimmedPort) {
      throw new NetworkValidationError('Port cannot be empty', 'port', port);
    }

    // Check for dangerous characters in string port
    const dangerousChars = /[;&|`$(){}[\]<>'"\\]/;
    if (dangerousChars.test(trimmedPort)) {
      throw new NetworkValidationError('Port contains dangerous characters', 'port', port);
    }

    // Check for control characters
    // eslint-disable-next-line no-control-regex
    const controlChars = /[\x00-\x1f\x7f]/;
    if (controlChars.test(trimmedPort)) {
      throw new NetworkValidationError('Port contains control characters', 'port', port);
    }

    // Must be only digits
    if (!/^\d+$/.test(trimmedPort)) {
      throw new NetworkValidationError('Port must contain only digits', 'port', port);
    }

    portNum = parseInt(trimmedPort, 10);
  } else if (typeof port === 'number') {
    if (!Number.isInteger(port)) {
      throw new NetworkValidationError('Port must be an integer', 'port', String(port));
    }
    portNum = port;
  } else {
    throw new NetworkValidationError('Port must be a string or number', 'port', String(port));
  }

  // Validate port range (1-65535)
  if (portNum < 1 || portNum > 65535) {
    throw new NetworkValidationError('Port must be between 1 and 65535', 'port', String(port));
  }

  return portNum;
}

/**
 * Validate both host and port parameters together
 * 
 * Convenience function that validates both parameters and returns them
 * as a safe tuple for use in network operations.
 * 
 * @param host - The hostname or IP address to validate
 * @param port - The port number to validate
 * @returns Tuple of [validatedHost, validatedPort]
 * 
 * @throws {NetworkValidationError} If either parameter fails validation
 * 
 * @example
 * ```typescript
 * const [safeHost, safePort] = validateHostPort('localhost', 8080);
 * console.log(`Connecting to ${safeHost}:${safePort}`);
 * ```
 */
export function validateHostPort(host: string, port: string | number): [string, number] {
  const validatedHost = validateHost(host);
  const validatedPort = validatePort(port);
  return [validatedHost, validatedPort];
}

