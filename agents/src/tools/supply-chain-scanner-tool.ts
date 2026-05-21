import { DevSupervisorClient } from '../services/DevSupervisorClient.js';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';

/**
 * Supply Chain Scanner Tool (Supply Chain category)
 *
 * Runs `lockfile-lint` (Apache-2.0) against `/app/package-lock.json` to catch:
 *   - resolved URLs from disallowed registries (dependency-confusion signal)
 *   - HTTP-resolved packages (tarball MITM signal)
 *   - missing integrity hashes (lockfile-tampering signal)
 *   - corrupt/empty-hostname entries (parseable but broken lockfiles)
 *
 * Deliberately not in scope yet:
 *   - postinstall lifecycle script detection — too noisy without provider
 *     context (esbuild, sharp etc. use postinstall legitimately). Pairs better
 *     with Socket.dev typosquat data in Phase 3.
 *   - typosquat / malicious-package detection — Socket.dev territory.
 *
 * License: lockfile-lint is Apache-2.0, commercial-SaaS friendly. Plugin lives
 * in customer node_modules (added to v8 template devDependencies).
 */

export interface SupplyChainFinding {
  ruleId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  packageName?: string;
  /** Path to the file the finding refers to (always package-lock.json today). */
  file: string;
}

export interface SupplyChainScannerOptions {
  /** Execution timeout in milliseconds (default 30s — lockfile-lint is fast). */
  timeout?: number;
  /** Path to the lockfile inside the preview container. */
  lockfilePath?: string;
  /**
   * Hostnames passed to `lockfile-lint --allowed-hosts`. lockfile-lint configures
   * the flag with yargs `array: true`, so values must be **space-separated**
   * (or supplied as multiple `--allowed-hosts` flags). Comma-separated values
   * are interpreted as a single literal hostname and match nothing — that bug
   * floored every customer's supply-chain score to 0.
   *
   * Defaults to `'npm github'` so customers using GitHub Packages don't get a
   * critical finding for every package.
   * TODO: surface this through the scanner config / env once private-registry
   * support (Artifactory, Verdaccio, etc.) lands so customers can extend the
   * allowlist for their own setups.
   */
  allowedHosts?: string | ReadonlyArray<string>;
}

const DEFAULT_ALLOWED_HOSTS: ReadonlyArray<string> = ['npm', 'github'];

/**
 * Accept either a string ("npm github" or legacy "npm,github") or an array of
 * hostnames and produce a clean array. Comma-separated strings are split for
 * back-compat — the previous shipped value was `'npm,github'` which broke
 * lockfile-lint, so callers that still pass it get the right behavior here.
 */
function normalizeAllowedHosts(
  input: string | ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  if (input === undefined) return DEFAULT_ALLOWED_HOSTS;
  if (Array.isArray(input)) return input.filter((h) => h && h.length > 0);
  if (typeof input === 'string') {
    const parts = input
      .split(/[\s,]+/)
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    return parts.length > 0 ? parts : DEFAULT_ALLOWED_HOSTS;
  }
  return DEFAULT_ALLOWED_HOSTS;
}

export interface SupplyChainScannerResult {
  success: boolean;
  executionTime: number;
  error?: string;
  findings: SupplyChainFinding[];
  summary: { total: number; critical: number; high: number; medium: number; low: number };
}

const DEFAULT_LOCKFILE_PATH = '/app/package-lock.json';

/**
 * lockfile-lint v4 emits human-readable text only — `--format json` is not a
 * supported choice (yargs rejects it with "Choices: plain, pretty"). Each
 * validator emits a `detected ... for package: <name>@<version>` line followed
 * by indented expected/actual context. We parse that text directly.
 *
 * Reference message templates from lockfile-lint-api/src/validators/*.js:
 *   ValidateScheme       → "detected invalid scheme(s) for package: ..."
 *   ValidateHost         → "detected invalid host(s) for package: ..."
 *   ValidateHttps        → "detected invalid protocol for package: ..."
 *   ValidateIntegrity    → "detected invalid integrity hash type for package: ..."
 *   ValidatePackageNames → "detected resolved URL for package with a different name: ..."
 *   ValidateUrl          → "detected invalid url(s) for package: ..."
 *
 * Severities reflect real-world risk:
 *   - allowed-hosts violation (registry not on allowlist) is the strongest
 *     dependency-confusion signal → critical.
 *   - allowed-schemes / validate-https (http://) → high (tarball MITM possible).
 *   - validate-integrity (missing SRI hash) → medium (lockfile-tampering signal
 *     but doesn't always indicate compromise; some legacy entries lack hashes).
 *   - empty-hostname is reported via ValidateHost when emptyHostname=false.
 */
interface ParsedMessage {
  meta: { ruleId: string; severity: SupplyChainFinding['severity']; title: string };
  message: string;
  packageName?: string;
}

const MESSAGE_PATTERNS: Array<{
  test: RegExp;
  meta: { ruleId: string; severity: SupplyChainFinding['severity']; title: string };
}> = [
  {
    test: /detected invalid host\(s\) for package:/i,
    meta: {
      ruleId: 'lockfile-lint/allowed-hosts',
      severity: 'critical',
      title: 'Package resolved from disallowed registry',
    },
  },
  {
    test: /detected invalid scheme\(s\) for package:/i,
    meta: {
      ruleId: 'lockfile-lint/allowed-schemes',
      severity: 'high',
      title: 'Package resolved over insecure scheme',
    },
  },
  {
    test: /detected invalid protocol for package:/i,
    meta: {
      ruleId: 'lockfile-lint/validate-https',
      severity: 'high',
      title: 'Package resolved over HTTP',
    },
  },
  {
    test: /detected invalid integrity hash (type )?for package:/i,
    meta: {
      ruleId: 'lockfile-lint/validate-integrity',
      severity: 'medium',
      title: 'Package missing or weak integrity hash',
    },
  },
  {
    test: /detected resolved URL for package with a different name:/i,
    meta: {
      ruleId: 'lockfile-lint/validate-package-names',
      severity: 'high',
      title: 'Package resolved URL name mismatch',
    },
  },
  {
    test: /detected invalid url\(s\) for package:/i,
    meta: {
      ruleId: 'lockfile-lint/allowed-urls',
      severity: 'high',
      title: 'Package resolved from disallowed URL',
    },
  },
];

const FALLBACK_META = {
  ruleId: 'lockfile-lint/other',
  severity: 'medium' as const,
  title: 'Lockfile validation issue',
};

export class SupplyChainScannerTool {
  private logger: Logger;
  private readonly DEFAULT_TIMEOUT = 30_000;

  constructor() {
    this.logger = Logger.create({ component: 'supply-chain-scanner-tool' });
  }

  async scan(
    appId: string,
    options: SupplyChainScannerOptions = {},
  ): Promise<SupplyChainScannerResult> {
    const startTime = Date.now();
    this.logger.info('supply-chain-scanner.scan.begin', { appId });

    const empty: SupplyChainScannerResult = {
      success: false,
      executionTime: 0,
      findings: [],
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
    };

    try {
      const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
      if (!devSupervisor) {
        throw new Error('Dev-supervisor not available. Make sure the app container is running.');
      }

      const lockfilePath = options.lockfilePath ?? DEFAULT_LOCKFILE_PATH;
      const lockfileExists = await this.checkLockfileExists(devSupervisor, lockfilePath);
      if (!lockfileExists) {
        // Not a hard error — some apps use yarn/pnpm. Mark as not-applicable rather than failed.
        this.logger.warn('supply-chain-scanner.lockfile.missing', { lockfilePath });
        return {
          ...empty,
          executionTime: Date.now() - startTime,
          error: `package-lock.json not found at ${lockfilePath}`,
        };
      }

      const findings = await this.runLockfileLint(devSupervisor, options, lockfilePath);
      const summary = this.summarize(findings);

      const result: SupplyChainScannerResult = {
        success: true,
        executionTime: Date.now() - startTime,
        findings,
        summary,
      };
      this.logger.info('supply-chain-scanner.scan.complete', {
        appId,
        executionTime: result.executionTime,
        findingsCount: summary.total,
        critical: summary.critical,
        high: summary.high,
      });
      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('supply-chain-scanner.scan.failed', {
        appId,
        error: errorMessage,
        executionTime: Date.now() - startTime,
      });
      return { ...empty, executionTime: Date.now() - startTime, error: errorMessage };
    }
  }

  private async checkLockfileExists(
    devSupervisor: DevSupervisorClient,
    path: string,
  ): Promise<boolean> {
    try {
      const result = await devSupervisor!.exec({
        command: `test -f ${path} && echo present || echo missing`,
        capture_output: true,
        timeout: 5,
      });
      return result.stdout?.trim() === 'present';
    } catch {
      return false;
    }
  }

  private buildLockfileLintCommand(
    lockfilePath: string,
    allowedHosts: ReadonlyArray<string>,
  ): string {
    // Run all four validators in one command. lockfile-lint exits 0 on success,
    // 1 on validation failures, and other codes on real errors.
    // --allowed-hosts: defaults to `npm github` (covers npm registry +
    //   GitHub Packages). Values are SPACE-separated because lockfile-lint
    //   configures the flag with yargs `array: true`. Passing a comma-joined
    //   string (e.g. `npm,github`) makes yargs treat it as one literal host
    //   that matches no real package — flagging every dependency as critical.
    // --allowed-schemes "https:": HTTP-resolved tarballs are MITM-prone. The
    //   trailing colon is required — lockfile-lint compares against the raw
    //   URL prefix (`https:`) and a bare `https` matches nothing, flagging
    //   every package as a false positive.
    // --validate-integrity: every entry must have an SRI hash.
    // --empty-hostname false: lockfile entries with empty resolved must be rejected.
    // --format pretty: lockfile-lint v4 only supports plain | pretty (json is
    //   rejected by yargs). We parse the text output ourselves.
    const hostsArg = allowedHosts.join(' ');
    return (
      `npx --no-install lockfile-lint ` +
      `--path ${lockfilePath} ` +
      `--type npm ` +
      `--allowed-hosts ${hostsArg} ` +
      `--allowed-schemes "https:" ` +
      `--validate-integrity ` +
      `--empty-hostname false ` +
      `--format pretty`
    );
  }

  private async runLockfileLint(
    devSupervisor: DevSupervisorClient,
    options: SupplyChainScannerOptions,
    lockfilePath: string,
  ): Promise<SupplyChainFinding[]> {
    const allowedHosts = normalizeAllowedHosts(options.allowedHosts);
    const command = this.buildLockfileLintCommand(lockfilePath, allowedHosts);
    this.logger.info('supply-chain-scanner.lockfile-lint.executing', { allowedHosts });

    const result = await devSupervisor!.exec({
      command,
      capture_output: true,
      timeout: Math.floor((options.timeout ?? this.DEFAULT_TIMEOUT) / 1000),
    });

    // 0 = clean, 1 = validation failures, anything else = real error. We can't
    // use stderr-vs-stdout to distinguish: lockfile-lint v4 writes violation
    // messages via console.error (stderr), so a normal exit-1 scan has empty
    // stdout and a populated stderr. Treat exit > 1 as a real error and parse
    // both streams concatenated for findings — `detected ... for package: ...`
    // lines are unique to violations, so noise from either stream is harmless.
    if (result.exit_code !== 0 && result.exit_code !== 1) {
      throw new Error(
        `lockfile-lint failed (exit ${result.exit_code}): ${
          (result.stderr ?? result.stdout ?? 'unknown').slice(0, 500)
        }`,
      );
    }

    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    // exit 1 + empty output = violations claimed but nothing emitted; refuse
    // to return [] which would mask real findings as a clean scan.
    if (!combined.trim()) {
      if (result.exit_code === 1) {
        this.logger.error('supply-chain-scanner.lockfile-lint.empty-output-with-findings-exit', {
          stdout: result.stdout?.slice(0, 500),
          stderr: result.stderr?.slice(0, 500),
        });
        throw new Error(
          'lockfile-lint exited 1 (violations) but output is empty — possible flag/config drift',
        );
      }
      return [];
    }

    const findings = this.parsePlainOutput(combined, lockfilePath);

    // exit_code===1 with zero parsed findings means the parser drifted — throw
    // so the orchestrator can distinguish "parser desync" from "scanner ran clean."
    if (result.exit_code === 1 && findings.length === 0) {
      this.logger.error('supply-chain-scanner.parser-desync', {
        stdoutPreview: result.stdout?.slice(0, 300),
        stderrPreview: result.stderr?.slice(0, 300),
      });
      throw new Error(
        'lockfile-lint reported violations (exit 1) but plain-text parser found none — upstream message format may have changed. Re-pin lockfile-lint to a known-good 4.13.x patch.',
      );
    }

    return findings;
  }

  /**
   * Parse lockfile-lint's plain/pretty text output. Each violation is a block
   * starting with a `detected ... for package: <name>@<version>` line followed
   * by indented `expected:` / `actual:` lines. We collect the leader line plus
   * its indented continuation as one message so the user sees the full context.
   */
  private parsePlainOutput(stdout: string, lockfilePath: string): SupplyChainFinding[] {
    const findings: SupplyChainFinding[] = [];
    const lines = stdout.split('\n');

    let current: { meta: ParsedMessage['meta']; pkg?: string; lines: string[] } | null = null;
    const flush = (): void => {
      if (!current) return;
      findings.push(
        this.buildFinding(
          current.meta,
          current.lines.join('\n').trim(),
          current.pkg,
          lockfilePath,
        ),
      );
      current = null;
    };

    for (const raw of lines) {
      const line = raw;
      if (/^detected /i.test(line.trim())) {
        flush();
        const matched = MESSAGE_PATTERNS.find((p) => p.test.test(line));
        // Unknown lockfile-lint validator message — could mean upstream added
        // a new validator (severity defaults to medium via FALLBACK_META). Log
        // so we get a signal in production logs instead of silently burying
        // a potentially critical-grade finding.
        if (!matched) {
          this.logger.warn('supply-chain-scanner.unknown-validator-message', {
            preview: line.trim().slice(0, 200),
          });
        }
        const meta = matched?.meta ?? FALLBACK_META;
        const pkgMatch = line.match(/for package(?: with a different name)?:\s+(\S+)/i);
        current = { meta, pkg: pkgMatch?.[1], lines: [line] };
        continue;
      }
      if (current && /^\s+/.test(line) && line.trim().length > 0) {
        current.lines.push(line);
        continue;
      }
      // Blank line or non-indented line that isn't a `detected` — close any
      // open finding.
      if (line.trim().length === 0) flush();
    }
    flush();

    return findings;
  }

  private buildFinding(
    meta: { ruleId: string; severity: SupplyChainFinding['severity']; title: string },
    message: string | undefined,
    packageName: string | undefined,
    file: string,
  ): SupplyChainFinding {
    return {
      ruleId: meta.ruleId,
      severity: meta.severity,
      title: meta.title,
      description: message ?? meta.title,
      file,
      ...(packageName && { packageName }),
    };
  }

  private summarize(
    findings: ReadonlyArray<SupplyChainFinding>,
  ): SupplyChainScannerResult['summary'] {
    const s = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of findings) s[f.severity] += 1;
    return s;
  }
}
