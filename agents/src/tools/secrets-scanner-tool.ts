import { DevSupervisorClient } from '../services/DevSupervisorClient.js';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';

/**
 * Secret finding from gitleaks
 */
export interface SecretFinding {
  file: string;
  line: number;
  column: number;
  ruleId: string;
  secret: string; // Redacted (first 4 chars + "...")
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  remediation: string;
}

/**
 * Gitleaks JSON output structure
 */
interface GitleaksFinding {
  Description?: string;
  StartLine?: number;
  EndLine?: number;
  StartColumn?: number;
  EndColumn?: number;
  Match?: string;
  Secret?: string;
  File?: string;
  Commit?: string;
  Entropy?: number;
  Author?: string;
  Email?: string;
  Date?: string;
  Message?: string;
  RuleID?: string;
}

interface GitleaksOutput {
  version?: string;
  findings?: GitleaksFinding[];
}

/**
 * Semgrep finding structure
 */
interface SemgrepFinding {
  check_id?: string;
  path?: string;
  start?: { line?: number; col?: number };
  end?: { line?: number; col?: number };
  message?: string;
  metadata?: {
    severity?: string;
    category?: string;
  };
}

interface SemgrepOutput {
  results?: SemgrepFinding[];
}

export interface SecretsScannerOptions {
  /** Working directory relative to app root */
  workingDir?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Skip Semgrep integration */
  skipSemgrep?: boolean;
  /** Force rescan (bypass cache) */
  forceRescan?: boolean;
}

export interface SecretsScannerResult {
  success: boolean;
  executionTime: number;
  error?: string;
  findings: SecretFinding[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  formattedReport: string;
  cached?: boolean;
}

/**
 * Secrets Scanner Tool
 * 
 * Comprehensive secrets scanning tool that uses gitleaks (and optionally Semgrep)
 * to detect hard-coded credentials, API keys, tokens, and other sensitive data.
 */
export class SecretsScannerTool {
  private logger: Logger;
  private appRepository: AppRepository;
  private readonly DEFAULT_TIMEOUT = 120000; // 120 seconds (gitleaks can be slow on large repos)
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private cache: Map<string, { result: SecretsScannerResult; timestamp: number; commitHash: string }> = new Map();

  constructor() {
    this.logger = Logger.create({ service: 'secrets-scanner-tool' });
    this.appRepository = new AppRepository();
  }

  /**
   * Run comprehensive secrets scan
   */
  async scan(appId: string, options: SecretsScannerOptions = {}): Promise<SecretsScannerResult> {
    const startTime = Date.now();
    
    this.logger.info('secrets-scanner.scan.begin', {
      appId,
      skipSemgrep: options.skipSemgrep,
      forceRescan: options.forceRescan,
    });

    try {
      const app = this.appRepository.findById(appId);
      if (!app) {
        throw new Error(`App '${appId}' not found`);
      }

      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor) {
        throw new Error('Dev-supervisor not available. Make sure the app container is running.');
      }

      // Check cache if not forcing rescan
      if (!options.forceRescan) {
        const cachedResult = await this.getCachedResult(appId, devSupervisor);
        if (cachedResult) {
          this.logger.info('secrets-scanner.scan.cache-hit', {
            appId,
            executionTime: Date.now() - startTime,
          });
          return {
            ...cachedResult,
            cached: true,
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Check gitleaks availability (should be pre-installed in container)
      const gitleaksAvailable = await this.checkGitleaksAvailability(devSupervisor);
      if (!gitleaksAvailable) {
        throw new Error(
          'Gitleaks is not available in the container. ' +
          'It should be installed during Docker image build. ' +
          'Please rebuild the container image: the gitleaks binary should be in /usr/local/bin/gitleaks'
        );
      }

      const result: SecretsScannerResult = {
        success: false,
        executionTime: 0,
        findings: [],
        summary: {
          total: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        },
        formattedReport: '',
      };

      // Step 1: Run gitleaks
      const gitleaksFindings = await this.runGitleaks(devSupervisor, options);
      result.findings = gitleaksFindings;

      // Step 2: Optionally run Semgrep
      if (!options.skipSemgrep) {
        try {
          const semgrepFindings = await this.runSemgrep(devSupervisor, options);
          // Merge and deduplicate findings
          result.findings = this.mergeFindings(gitleaksFindings, semgrepFindings);
        } catch (error) {
          this.logger.warn('secrets-scanner.semgrep.failed', {
            appId,
            error: getErrorMessage(error),
          });
          // Continue with gitleaks findings only
        }
      }

      // Step 3: Calculate summary
      result.summary = this.calculateSummary(result.findings);

      // Step 4: Format report
      result.formattedReport = this.formatReport(result);
      result.success = true;
      result.executionTime = Date.now() - startTime;

      // Step 5: Cache result
      await this.cacheResult(appId, result, devSupervisor);

      this.logger.info('secrets-scanner.scan.complete', {
        appId,
        executionTime: result.executionTime,
        findingsFound: result.summary.total,
        critical: result.summary.critical,
        high: result.summary.high,
      });

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('secrets-scanner.scan.failed', {
        appId,
        error: errorMessage,
        executionTime: Date.now() - startTime,
      });

      return {
        success: false,
        executionTime: Date.now() - startTime,
        error: errorMessage,
        findings: [],
        summary: {
          total: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        },
        formattedReport: `❌ **Secrets scan failed**: ${errorMessage}`,
      };
    }
  }

  /**
   * Check if gitleaks is available in the container
   */
  private async checkGitleaksAvailability(devSupervisor: DevSupervisorClient): Promise<boolean> {
    try {
      const result = await devSupervisor!.exec({
        command: 'gitleaks version',
        capture_output: true,
        timeout: 5,
      });
      
      if (result.exit_code === 0) {
        this.logger.info('secrets-scanner.gitleaks.found', {
          version: result.stdout?.trim(),
        });
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.warn('secrets-scanner.gitleaks.check-failed', {
        error: getErrorMessage(error),
      });
      return false;
    }
  }

  /**
   * Get cached result if available and valid
   */
  private async getCachedResult(
    appId: string,
    devSupervisor: DevSupervisorClient
  ): Promise<SecretsScannerResult | null> {
    try {
      // Get current commit hash
      const commitHash = await this.getCommitHash(devSupervisor);
      if (!commitHash) {
        return null;
      }

      const cacheKey = `${appId}:${commitHash}`;
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        if (cached.commitHash === commitHash) {
          return cached.result;
        }
      }

      // Clean up expired entries
      this.cleanupCache();
      return null;
    } catch (error) {
      this.logger.warn('secrets-scanner.cache.get-failed', {
        appId,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Cache result with commit hash
   */
  private async cacheResult(
    appId: string,
    result: SecretsScannerResult,
    devSupervisor: DevSupervisorClient
  ): Promise<void> {
    try {
      const commitHash = await this.getCommitHash(devSupervisor);
      if (commitHash) {
        const cacheKey = `${appId}:${commitHash}`;
        this.cache.set(cacheKey, {
          result,
          timestamp: Date.now(),
          commitHash,
        });
      }
    } catch (error) {
      this.logger.warn('secrets-scanner.cache.set-failed', {
        appId,
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Get current git commit hash
   */
  private async getCommitHash(devSupervisor: DevSupervisorClient): Promise<string | null> {
    try {
      const result = await devSupervisor!.exec({
        command: 'git rev-parse HEAD',
        capture_output: true,
        timeout: 5,
      });

      if (result.exit_code === 0 && result.stdout) {
        return result.stdout.trim();
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    const cutoff = now - this.CACHE_TTL;

    for (const [key, value] of this.cache.entries()) {
      if (value.timestamp < cutoff) {
        this.cache.delete(key);
      }
    }

    // Also limit cache size to prevent memory issues
    if (this.cache.size > 100) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      // Remove oldest 20% of entries
      const toRemove = Math.floor(entries.length * 0.2);
      for (let i = 0; i < toRemove; i++) {
        const entry = entries[i];
        if (entry) {
          this.cache.delete(entry[0]);
        }
      }
    }
  }

  /**
   * Run gitleaks scan
   */
  private async runGitleaks(
    devSupervisor: DevSupervisorClient,
    options: SecretsScannerOptions
  ): Promise<SecretFinding[]> {
    this.logger.info('secrets-scanner.gitleaks.executing');

    try {
      // Gitleaks should be in PATH (/usr/local/bin/gitleaks)
      const result = await devSupervisor!.exec({
        command: 'gitleaks detect --source /app --report-format json --no-banner',
        capture_output: true,
        timeout: Math.floor((options.timeout || this.DEFAULT_TIMEOUT) / 1000),
      });

      // Gitleaks returns exit code 1 when findings are found (this is expected)
      // Exit code 0 means no findings
      // Other exit codes indicate errors
      if (result.exit_code !== 0 && result.exit_code !== 1) {
        throw new Error(`Gitleaks execution failed: ${result.stderr || 'Unknown error'}`);
      }

      if (!result.stdout) {
        // No findings
        return [];
      }

      const trimmedContent = result.stdout.trim();
      if (!trimmedContent || (!trimmedContent.startsWith('{') && !trimmedContent.startsWith('['))) {
        this.logger.warn('secrets-scanner.gitleaks.invalid-json', {
          preview: trimmedContent.substring(0, 100),
        });
        return [];
      }

      let gitleaksData: GitleaksOutput | GitleaksFinding[];
      try {
        gitleaksData = JSON.parse(trimmedContent);
      } catch (parseError) {
        this.logger.warn('secrets-scanner.gitleaks.json-parse-failed', {
          error: getErrorMessage(parseError),
        });
        return [];
      }

      // Handle both array format and object with findings array
      const findings: GitleaksFinding[] = Array.isArray(gitleaksData)
        ? gitleaksData
        : gitleaksData.findings || [];

      const secretFindings: SecretFinding[] = findings.map((finding) => {
        const ruleId = finding.RuleID || 'unknown';
        const severity = this.mapRuleIdToSeverity(ruleId);
        const secret = finding.Secret || finding.Match || '';

        return {
          file: finding.File || 'unknown',
          line: finding.StartLine || 0,
          column: finding.StartColumn || 0,
          ruleId,
          secret: this.redactSecret(secret),
          severity,
          description: finding.Description || `Secret detected: ${ruleId}`,
          remediation: this.getRemediation(ruleId),
        };
      });

      this.logger.info('secrets-scanner.gitleaks.complete', {
        findingsCount: secretFindings.length,
      });

      return secretFindings;
    } catch (error) {
      this.logger.error('secrets-scanner.gitleaks.failed', {
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Run Semgrep scan (optional)
   */
  private async runSemgrep(
    devSupervisor: DevSupervisorClient,
    options: SecretsScannerOptions
  ): Promise<SecretFinding[]> {
    this.logger.info('secrets-scanner.semgrep.executing');

    try {
      // Check if semgrep is available
      const semgrepCheck = await devSupervisor!.exec({
        command: 'semgrep --version',
        capture_output: true,
        timeout: 5,
      });

      if (semgrepCheck.exit_code !== 0) {
        this.logger.warn('secrets-scanner.semgrep.not-available');
        return [];
      }

      // Check if config file exists, create if missing
      const configExists = await devSupervisor!.exec({
        command: 'test -f .semgrep-secrets.yml && echo "exists" || echo "missing"',
        capture_output: true,
        timeout: 5,
      });

      if (configExists.stdout?.trim() === 'missing') {
        // Create default config
        await this.createDefaultSemgrepConfig(devSupervisor);
      }

      // Run semgrep
      const result = await devSupervisor!.exec({
        command: 'semgrep --config=.semgrep-secrets.yml --json --no-git-ignore',
        capture_output: true,
        timeout: Math.floor((options.timeout || this.DEFAULT_TIMEOUT) / 1000),
      });

      if (result.exit_code !== 0 && result.exit_code !== 1) {
        // Exit code 1 means findings found (normal), other codes are errors
        throw new Error(`Semgrep execution failed: ${result.stderr || 'Unknown error'}`);
      }

      if (!result.stdout) {
        return [];
      }

      const trimmedContent = result.stdout.trim();
      if (!trimmedContent?.startsWith('{')) {
        return [];
      }

      const semgrepData: SemgrepOutput = JSON.parse(trimmedContent);
      const findings: SecretFinding[] = [];

      if (semgrepData.results) {
        semgrepData.results.forEach((finding) => {
          const checkId = finding.check_id || 'unknown';
          const severity = this.mapSemgrepSeverityToSeverity(finding.metadata?.severity || 'medium');

          findings.push({
            file: finding.path || 'unknown',
            line: finding.start?.line || 0,
            column: finding.start?.col || 0,
            ruleId: checkId,
            secret: '[REDACTED]',
            severity,
            description: finding.message || `Secret pattern detected: ${checkId}`,
            remediation: this.getRemediation(checkId),
          });
        });
      }

      this.logger.info('secrets-scanner.semgrep.complete', {
        findingsCount: findings.length,
      });

      return findings;
    } catch (error) {
      this.logger.warn('secrets-scanner.semgrep.failed', {
        error: getErrorMessage(error),
      });
      return [];
    }
  }

  /**
   * Create default Semgrep config file
   */
  private async createDefaultSemgrepConfig(devSupervisor: DevSupervisorClient): Promise<void> {
    // Use printf to create the config file (more reliable than heredoc)
    const configLines = [
      'rules:',
      '  - id: hardcoded-secret',
      '    pattern: |',
      '      (api[_-]?key|apikey|secret[_-]?key|secretkey|access[_-]?token|accesstoken|auth[_-]?token|authtoken)\\s*[:=]\\s*["\']?[A-Za-z0-9+/=]{20,}["\']?',
      '    message: Potential hardcoded API key or secret token detected',
      '    severity: ERROR',
      '    languages:',
      '      - javascript',
      '      - typescript',
      '      - python',
      '      - java',
      '      - go',
    ];

    try {
      // Write config line by line using echo
      const configContent = configLines.join('\\n');
      await devSupervisor!.exec({
        command: `printf '${configContent}' > .semgrep-secrets.yml`,
        capture_output: true,
        timeout: 5,
      });
    } catch (error) {
      this.logger.warn('secrets-scanner.semgrep.config-create-failed', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Merge findings from gitleaks and Semgrep, deduplicating by file + line
   */
  private mergeFindings(
    gitleaksFindings: SecretFinding[],
    semgrepFindings: SecretFinding[]
  ): SecretFinding[] {
    const merged = new Map<string, SecretFinding>();

    // Add gitleaks findings first
    gitleaksFindings.forEach((finding) => {
      const key = `${finding.file}:${finding.line}`;
      if (!merged.has(key)) {
        merged.set(key, finding);
      }
    });

    // Add semgrep findings, only if not already present
    semgrepFindings.forEach((finding) => {
      const key = `${finding.file}:${finding.line}`;
      if (!merged.has(key)) {
        merged.set(key, finding);
      }
    });

    return Array.from(merged.values());
  }

  /**
   * Map gitleaks rule ID to severity
   */
  private mapRuleIdToSeverity(ruleId: string): 'critical' | 'high' | 'medium' | 'low' {
    const lowerRuleId = ruleId.toLowerCase();

    // Critical severity
    if (
      lowerRuleId.includes('aws') ||
      lowerRuleId.includes('azure') ||
      lowerRuleId.includes('supabase') ||
      lowerRuleId.includes('gcp') ||
      lowerRuleId.includes('google-cloud')
    ) {
      return 'critical';
    }

    // High severity
    if (
      lowerRuleId.includes('api-key') ||
      lowerRuleId.includes('apikey') ||
      lowerRuleId.includes('password') ||
      lowerRuleId.includes('private-key') ||
      lowerRuleId.includes('secret-key')
    ) {
      return 'high';
    }

    // Medium severity
    if (
      lowerRuleId.includes('token') ||
      lowerRuleId.includes('env') ||
      lowerRuleId.includes('credential')
    ) {
      return 'medium';
    }

    // Default to low
    return 'low';
  }

  /**
   * Map Semgrep severity to our severity levels
   */
  private mapSemgrepSeverityToSeverity(semgrepSeverity: string): 'critical' | 'high' | 'medium' | 'low' {
    const lower = semgrepSeverity.toLowerCase();
    if (lower === 'error' || lower === 'critical') {return 'critical';}
    if (lower === 'warning' || lower === 'high') {return 'high';}
    if (lower === 'info' || lower === 'medium') {return 'medium';}
    return 'low';
  }

  /**
   * Redact secret (show first 4 chars + "...")
   */
  private redactSecret(secret: string): string {
    if (secret.length <= 4) {
      return '[REDACTED]';
    }
    return secret.substring(0, 4) + '...';
  }

  /**
   * Get remediation suggestion based on rule ID
   */
  private getRemediation(ruleId: string): string {
    const lowerRuleId = ruleId.toLowerCase();

    if (lowerRuleId.includes('aws') || lowerRuleId.includes('azure') || lowerRuleId.includes('gcp')) {
      return 'Use cloud provider environment variables or secrets manager. Rotate the exposed key immediately.';
    }

    if (lowerRuleId.includes('api-key') || lowerRuleId.includes('apikey')) {
      return 'Move API key to environment variables or secrets management system. Rotate the exposed key.';
    }

    if (lowerRuleId.includes('password')) {
      return 'Never hardcode passwords. Use environment variables or secure password management. Change the exposed password immediately.';
    }

    if (lowerRuleId.includes('token')) {
      return 'Store tokens in environment variables or secure storage. Revoke and regenerate the exposed token.';
    }

    if (lowerRuleId.includes('env') || lowerRuleId.includes('.env')) {
      return 'Remove .env file from version control. Use environment variables or secrets management.';
    }

    return 'Move sensitive data to environment variables or secrets management system. Rotate any exposed credentials.';
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(findings: SecretFinding[]): SecretsScannerResult['summary'] {
    const summary = {
      total: findings.length,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    findings.forEach((finding) => {
      summary[finding.severity]++;
    });

    return summary;
  }

  /**
   * Format comprehensive report
   */
  private formatReport(result: SecretsScannerResult): string {
    const lines: string[] = [];
    lines.push('🔐 **Secrets Scan Results**\n');

    if (result.summary.total === 0) {
      lines.push('✅ **No hard-coded secrets or credentials found!**\n');
      return lines.join('\n');
    }

    lines.push(`Found ${result.summary.total} secret${result.summary.total === 1 ? '' : 's'}:`);
    if (result.summary.critical > 0) {lines.push(`  🔴 Critical: ${result.summary.critical}`);}
    if (result.summary.high > 0) {lines.push(`  🟠 High: ${result.summary.high}`);}
    if (result.summary.medium > 0) {lines.push(`  🟡 Medium: ${result.summary.medium}`);}
    if (result.summary.low > 0) {lines.push(`  🟢 Low: ${result.summary.low}`);}
    lines.push('');

    // Group findings by file
    const findingsByFile = new Map<string, SecretFinding[]>();
    result.findings.forEach((finding) => {
      const fileFindings = findingsByFile.get(finding.file) || [];
      fileFindings.push(finding);
      findingsByFile.set(finding.file, fileFindings);
    });

    // Sort files by severity (critical first)
    const sortedFiles = Array.from(findingsByFile.entries()).sort((a, b) => {
      const aMaxSeverity = this.getMaxSeverity(a[1]);
      const bMaxSeverity = this.getMaxSeverity(b[1]);
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[aMaxSeverity] - severityOrder[bMaxSeverity];
    });

    lines.push('**Findings by File:**\n');
    sortedFiles.forEach(([file, findings]) => {
      lines.push(`📄 **${file}**`);
      findings.forEach((finding) => {
        const severityEmoji = {
          critical: '🔴',
          high: '🟠',
          medium: '🟡',
          low: '🟢',
        }[finding.severity];

        lines.push(`  ${severityEmoji} Line ${finding.line}:${finding.column} - ${finding.ruleId} (${finding.severity})`);
        lines.push(`     Secret: ${finding.secret}`);
        lines.push(`     Description: ${finding.description}`);
        lines.push(`     Remediation: ${finding.remediation}`);
        lines.push('');
      });
    });

    // General remediation suggestions
    lines.push('**General Remediation Steps:**');
    lines.push('1. Remove all hard-coded secrets from source code');
    lines.push('2. Use environment variables for configuration');
    lines.push('3. Implement secrets management (AWS Secrets Manager, Azure Key Vault, etc.)');
    lines.push('4. Rotate all exposed credentials immediately');
    lines.push('5. Add .env files to .gitignore');
    lines.push('6. Review git history and remove secrets from committed files');

    return lines.join('\n');
  }

  /**
   * Get maximum severity from findings
   */
  private getMaxSeverity(findings: SecretFinding[]): 'critical' | 'high' | 'medium' | 'low' {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    let maxSeverity: 'critical' | 'high' | 'medium' | 'low' = 'low';

    findings.forEach((finding) => {
      if (severityOrder[finding.severity] < severityOrder[maxSeverity]) {
        maxSeverity = finding.severity;
      }
    });

    return maxSeverity;
  }
}

