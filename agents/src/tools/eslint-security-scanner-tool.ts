import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import { createForWorkspace } from '../workspace/index.js';
import type { WorkspaceTasks } from '../workspace/tasks.js';

/**
 * ESLint Security Scanner Tool (Code Quality / SAST category)
 *
 * Runs the customer-app's bundled ESLint with a security-only flat config
 * (`eslint.security.config.js`, shipped with the v8 template) against /app/src
 * and parses the JSON output into normalized SAST findings.
 *
 * Why ESLint and not Semgrep:
 *   - eslint-plugin-security is Apache-2.0 and eslint-plugin-no-unsanitized is
 *     MPL-2.0 — both compatible with our commercial SaaS use case.
 *   - Semgrep's registry rulesets are under restrictive licenses
 *     ("Semgrep Rules License v1.0" + Commons Clause) that bar use as a
 *     scanning service over customer code.
 *   - ESLint already lives in customer node_modules — no Docker image bloat.
 *
 * Coverage (via the two plugins):
 *   - `security/detect-eval-with-expression`
 *   - `security/detect-unsafe-regex` (ReDoS)
 *   - `security/detect-non-literal-fs-filename` / `detect-non-literal-require`
 *   - `security/detect-non-literal-regexp`
 *   - `security/detect-child-process` (RCE surface)
 *   - `security/detect-pseudoRandomBytes` (weak RNG for secrets)
 *   - `security/detect-buffer-noassert`
 *   - `security/detect-object-injection`
 *   - `security/detect-possible-timing-attacks`
 *   - `security/detect-disable-mustache-escape`
 *   - `security/detect-bidi-characters`
 *   - `no-unsanitized/method` — `document.write`, `insertAdjacentHTML`, etc.
 *   - `no-unsanitized/property` — `innerHTML =`, `outerHTML =`, `srcdoc`
 */

/** Public SAST finding shape — normalizer consumes this directly. */
export interface SastFinding {
  file: string;
  line: number;
  column: number;
  ruleId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
}

export interface EslintSecurityScannerOptions {
  /** Execution timeout in milliseconds (default 90s). */
  timeout?: number;
  /** Path to the security ESLint flat config inside the preview container. */
  configPath?: string;
  /** Path inside the preview container to scan. */
  scanPath?: string;
}

export interface EslintSecurityScannerResult {
  success: boolean;
  executionTime: number;
  error?: string;
  findings: SastFinding[];
  summary: { total: number; critical: number; high: number; medium: number; low: number };
}

const DEFAULT_CONFIG_PATH = '/app/eslint.security.config.js';
const DEFAULT_SCAN_PATH = '/app/src';

const TEMPLATE_FALLBACK_CONFIG_PATH = '/app-template/eslint.security.config.js';

/**
 * Raw ESLint JSON output — only the fields we consume.
 * Top-level array: one entry per file, each with messages[].
 */
interface EslintFileResult {
  filePath?: string;
  messages?: EslintMessage[];
}

interface EslintMessage {
  ruleId?: string | null;
  severity?: number; // 1 = warn, 2 = error
  message?: string;
  line?: number;
  column?: number;
}

/** Rule-id prefixes we accept as "security findings." Anything else is ignored. */
const SECURITY_RULE_PREFIXES = ['security/', 'no-unsanitized/'];

export class EslintSecurityScannerTool {
  private logger: Logger;
  private readonly DEFAULT_TIMEOUT = 90_000;

  constructor() {
    this.logger = Logger.create({ component: 'eslint-security-scanner-tool' });
  }

  async scan(
    appId: string,
    options: EslintSecurityScannerOptions = {},
  ): Promise<EslintSecurityScannerResult> {
    const startTime = Date.now();
    this.logger.info('eslint-security-scanner.scan.begin', { appId });

    const empty: EslintSecurityScannerResult = {
      success: false,
      executionTime: 0,
      findings: [],
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
    };

    try {
      const workspace = createForWorkspace(appId, 'preview');
      if (!workspace) {
        throw new Error('Workspace not available. Make sure the app container is running.');
      }
      const tasks = workspace.tasks;

      const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
      const scanPath = options.scanPath ?? DEFAULT_SCAN_PATH;

      const configReady = await this.ensureConfigPresent(tasks, configPath);
      if (!configReady) {
        this.logger.warn('eslint-security-scanner.config.missing', {
          configPath,
          fallbackSourcePath: TEMPLATE_FALLBACK_CONFIG_PATH,
        });
        return {
          ...empty,
          executionTime: Date.now() - startTime,
          error:
            `Security ESLint config not found at ${configPath} and image fallback ` +
            `${TEMPLATE_FALLBACK_CONFIG_PATH} is also missing. The preview image likely ` +
            `pre-dates the v8 template addition — rebuild from a current branch.`,
        };
      }

      const messages = await this.runEslint(tasks, options, configPath, scanPath);

      // Diagnostic counters — surface the "exit 1 but 0 findings" pattern explicitly.
      // Common causes: parse errors (null ruleId), missing plugin/parser, files
      // emitting only non-security rule IDs that the prefix gate drops.
      let totalMessages = 0;
      let nullRuleId = 0;
      let droppedNonSecurity = 0;
      for (const f of messages) {
        for (const m of f.messages ?? []) {
          totalMessages++;
          if (!m.ruleId) {
            nullRuleId++;
            continue;
          }
          if (!SECURITY_RULE_PREFIXES.some((p) => (m.ruleId ?? '').startsWith(p))) {
            droppedNonSecurity++;
          }
        }
      }
      if (totalMessages > 0) {
        this.logger.info('eslint-security-scanner.eslint.message-breakdown', {
          totalMessages,
          nullRuleId,
          droppedNonSecurity,
          kept: totalMessages - nullRuleId - droppedNonSecurity,
        });
      }

      const findings = messages.flatMap((file) => this.toSastFindings(file));
      const summary = this.summarize(findings);

      const result: EslintSecurityScannerResult = {
        success: true,
        executionTime: Date.now() - startTime,
        findings,
        summary,
      };

      this.logger.info('eslint-security-scanner.scan.complete', {
        appId,
        executionTime: result.executionTime,
        findingsCount: summary.total,
        high: summary.high,
        medium: summary.medium,
        low: summary.low,
      });
      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('eslint-security-scanner.scan.failed', {
        appId,
        error: errorMessage,
        executionTime: Date.now() - startTime,
      });
      return { ...empty, executionTime: Date.now() - startTime, error: errorMessage };
    }
  }

  private async ensureConfigPresent(
    tasks: WorkspaceTasks,
    configPath: string,
  ): Promise<boolean> {
    if (await this.fileExists(tasks, configPath)) return true;

    if (!(await this.fileExists(tasks, TEMPLATE_FALLBACK_CONFIG_PATH))) {
      return false;
    }

    this.logger.info('eslint-security-scanner.config.self-heal.attempt', {
      from: TEMPLATE_FALLBACK_CONFIG_PATH,
      to: configPath,
    });

    try {
      const cp = await tasks.runCommandSync({
        command: `cp ${TEMPLATE_FALLBACK_CONFIG_PATH} ${configPath}`,
        timeoutSeconds: 5,
      });
      if (cp.exitCode !== 0) {
        this.logger.error('eslint-security-scanner.config.self-heal.failed', {
          exitCode: cp.exitCode,
          stderr: cp.stderr?.slice(0, 200),
        });
        return false;
      }
    } catch (error) {
      this.logger.error('eslint-security-scanner.config.self-heal.threw', {
        error: getErrorMessage(error),
      });
      return false;
    }

    // Verify the copy actually landed — defensive against silent cp failures
    // (read-only mount, ENOSPC, etc.).
    return await this.fileExists(tasks, configPath);
  }

  private async fileExists(
    tasks: WorkspaceTasks,
    filePath: string,
  ): Promise<boolean> {
    try {
      const result = await tasks.runCommandSync({
        command: `test -f ${filePath} && echo present || echo missing`,
        timeoutSeconds: 5,
      });
      return result.stdout?.trim() === 'present';
    } catch {
      return false;
    }
  }

  private buildEslintCommand(configPath: string, scanPath: string): string {
    // --no-config-lookup: ignore any other eslint.config.js the customer ships;
    //                     we want a deterministic security-only scan.
    // --format json:      structured output to stdout.
    // ESLint exits 0 = no findings, 1 = findings, 2 = error.
    return (
      `npx --no-install eslint --config ${configPath} --no-config-lookup ` +
      `--format json ${scanPath}`
    );
  }

  private async runEslint(
    tasks: WorkspaceTasks,
    options: EslintSecurityScannerOptions,
    configPath: string,
    scanPath: string,
  ): Promise<EslintFileResult[]> {
    const command = this.buildEslintCommand(configPath, scanPath);
    this.logger.info('eslint-security-scanner.eslint.executing');

    const result = await tasks.runCommandSync({
      command,
      timeoutSeconds: Math.floor((options.timeout ?? this.DEFAULT_TIMEOUT) / 1000),
    });

    // 0 = clean, 1 = findings, anything else is a real error
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(
        `ESLint failed (exit ${result.exitCode}): ${result.stderr?.slice(0, 500) ?? 'unknown'}`,
      );
    }

    const trimmed = result.stdout?.trim() ?? '';

    // exit 1 + empty stdout = findings claimed but nothing emitted; refuse
    // to return [] which would mask real findings as a clean scan.
    if (trimmed.length === 0) {
      if (result.exitCode === 1) {
        this.logger.error('eslint-security-scanner.eslint.empty-stdout-with-findings-exit', {
          stderr: result.stderr?.slice(0, 500),
        });
        throw new Error(
          'ESLint exited 1 (findings) but stdout is empty — possible flag/config drift',
        );
      }
      return [];
    }

    // Non-JSON output means the scan crashed — throw so the orchestrator can
    // distinguish "scanner crashed" from "scanner ran clean."
    if (!trimmed.startsWith('[')) {
      this.logger.error('eslint-security-scanner.eslint.invalid-json', {
        preview: trimmed.slice(0, 200),
      });
      throw new Error(
        `ESLint produced unparseable output (exit ${result.exitCode}): ${trimmed.slice(0, 200)}`,
      );
    }

    try {
      return JSON.parse(trimmed) as EslintFileResult[];
    } catch (error) {
      this.logger.error('eslint-security-scanner.eslint.json-parse-failed', {
        error: getErrorMessage(error),
      });
      throw new Error(`ESLint output failed JSON.parse: ${getErrorMessage(error)}`);
    }
  }

  private toSastFindings(file: EslintFileResult): SastFinding[] {
    const out: SastFinding[] = [];
    const filePath = file.filePath ?? 'unknown';
    for (const m of file.messages ?? []) {
      const ruleId = m.ruleId ?? '';
      // Drop non-security findings — the security config should only emit these,
      // but `--no-config-lookup` + the bundled config means ANY rule that fires
      // is one we asked for. Still, defensively gate on prefix.
      if (!SECURITY_RULE_PREFIXES.some((p) => ruleId.startsWith(p))) continue;

      out.push({
        file: filePath,
        line: m.line ?? 0,
        column: m.column ?? 0,
        ruleId,
        severity: this.mapSeverity(m.severity, ruleId),
        title: this.titleFromRuleId(ruleId),
        description: m.message ?? `Security issue: ${ruleId}`,
      });
    }
    return out;
  }

  /**
   * ESLint severity (1 = warn, 2 = error) plus rule-family heuristics.
   * Security findings are inherently risk-bearing, so 'low' isn't really used.
   */
  private mapSeverity(eslintSeverity: number | undefined, ruleId: string): SastFinding['severity'] {
    // High-impact rules get bumped regardless of warn/error: these are RCE/XSS
    // surface that we never want to under-weight.
    const highImpact = [
      'security/detect-eval-with-expression',
      'security/detect-child-process',
      'security/detect-non-literal-require',
      'no-unsanitized/method',
      'no-unsanitized/property',
    ];
    if (highImpact.includes(ruleId)) return 'high';

    if (eslintSeverity === 2) return 'high';
    if (eslintSeverity === 1) return 'medium';
    return 'low';
  }

  private titleFromRuleId(ruleId: string): string {
    const last = ruleId.split('/').pop() ?? ruleId;
    return last.replace(/-/g, ' ').replace(/^detect /, '');
  }

  private summarize(
    findings: ReadonlyArray<SastFinding>,
  ): EslintSecurityScannerResult['summary'] {
    const s = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of findings) s[f.severity] += 1;
    return s;
  }
}
