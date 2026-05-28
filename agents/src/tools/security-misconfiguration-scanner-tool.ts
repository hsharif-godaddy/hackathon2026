import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { createForWorkspace } from '../workspace/index.js';
import type { WorkspaceTasks } from '../workspace/tasks.js';
import { safeJoin, UnsafePathError } from '../utils/safe-path.js';

export type MisconfigurationSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type MisconfigurationCategory =
  | 'admin-route'
  | 'unprotected-endpoint'
  | 'missing-rate-limit'
  | 'cors'
  | 'https'
  | 'security-headers'
  | 'tls';

export interface MisconfigurationFinding {
  category: MisconfigurationCategory;
  severity: MisconfigurationSeverity;
  file: string;
  line: number;
  column: number;
  ruleId?: string;
  route?: { method: string; path: string };
  evidence: string;
  remediation: string;
}

export interface SecurityMisconfigurationScannerOptions {
  /** Working directory relative to app root */
  workingDir?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Skip Semgrep integration */
  skipSemgrep?: boolean;
  /** Scan strictness affects severity mapping for heuristic checks */
  strictness?: 'low' | 'medium' | 'high';
  /** Ignore paths (substrings) during static scan */
  ignorePaths?: string[];
  /** Hostnames allowed to appear in http:// URLs (dev-only) */
  allowHttpHosts?: string[];
  /** Route path regex fragments treated as admin-like */
  adminRoutePatterns?: string[];
}

export interface SecurityMisconfigurationScannerResult {
  success: boolean;
  executionTime: number;
  error?: string;
  findings: MisconfigurationFinding[];
  summary: Record<MisconfigurationSeverity, number> & { total: number };
  formattedReport: string;
}

interface SemgrepFinding {
  check_id?: string;
  path?: string;
  start?: { line?: number; col?: number };
  end?: { line?: number; col?: number };
  extra?: {
    message?: string;
    metadata?: Record<string, any>;
    severity?: string;
  };
}

interface SemgrepOutput {
  results?: SemgrepFinding[];
}

interface StaticAuditOutput {
  findings?: MisconfigurationFinding[];
  meta?: Record<string, any>;
}

function removeUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value !== undefined) {
        result[key] = value as T[Extract<keyof T, string>];
      }
    }
  }
  return result;
}

/**
 * Security Misconfiguration Scanner Tool
 *
 * Hybrid scanner using (1) Semgrep for pattern detection and (2) static route/config inspection
 * to flag common security misconfigurations.
 */
export class SecurityMisconfigurationScannerTool {
  private logger: Logger;
  private appRepository: AppRepository;
  private readonly DEFAULT_TIMEOUT = 90000; // 90 seconds

  constructor() {
    this.logger = Logger.create({ component: 'security-misconfiguration-scanner-tool' });
    this.appRepository = new AppRepository();
  }

  async scan(
    appId: string,
    options: SecurityMisconfigurationScannerOptions = {}
  ): Promise<SecurityMisconfigurationScannerResult> {
    const startTime = Date.now();

    const normalizedOptions = removeUndefined({
      ...options,
      strictness: options.strictness || 'medium',
      ignorePaths: options.ignorePaths || ['node_modules', 'dist', 'build', '.git', '.api', 'coverage'],
      allowHttpHosts: options.allowHttpHosts || ['localhost', '127.0.0.1', '::1'],
      adminRoutePatterns:
        options.adminRoutePatterns || ['(^|/)admin($|/)', '(^|/)internal($|/)', '(^|/)debug($|/)', '(^|/)manage($|/)', '(^|/)console($|/)'],
      skipSemgrep: options.skipSemgrep || false,
    }) as Required<SecurityMisconfigurationScannerOptions>;

    this.logger.info('security-misconfig.scan.begin', {
      appId,
      options: normalizedOptions,
    });

    try {
      const app = this.appRepository.findById(appId);
      if (!app) {
        throw new Error(`App '${appId}' not found`);
      }

      const workspace = createForWorkspace(appId, 'preview');
      if (!workspace) {
        throw new Error('Workspace not available. Make sure the app container is running.');
      }
      const tasks = workspace.tasks;

      // Validate workingDir to prevent path traversal attacks
      let workDir = '/app';
      if (normalizedOptions.workingDir) {
        try {
          // safeJoin ensures the resolved path stays within /app
          workDir = safeJoin('/app', normalizedOptions.workingDir);
        } catch (error) {
          if (error instanceof UnsafePathError) {
            throw new Error(`Invalid workingDir: path traversal detected. ${error.message}`);
          }
          throw error;
        }
      }

      const findings: MisconfigurationFinding[] = [];

      // 1) Semgrep scan (best-effort)
      if (!normalizedOptions.skipSemgrep) {
        try {
          const semgrepFindings = await this.runSemgrep(tasks, workDir, normalizedOptions);
          findings.push(...semgrepFindings);
        } catch (error) {
          this.logger.warn('security-misconfig.semgrep.failed', {
            appId,
            error: getErrorMessage(error),
          });
        }
      }

      // 2) Static audit scan (always)
      const staticFindings = await this.runStaticAudit(tasks, workDir, normalizedOptions);
      findings.push(...staticFindings);

      const merged = this.dedupeFindings(findings);
      const summary = this.calculateSummary(merged);
      const formattedReport = this.formatReport({ findings: merged, summary });

      const result: SecurityMisconfigurationScannerResult = {
        success: true,
        executionTime: Date.now() - startTime,
        findings: merged,
        summary,
        formattedReport,
      };

      this.logger.info('security-misconfig.scan.complete', {
        appId,
        executionTime: result.executionTime,
        total: result.summary.total,
        high: result.summary.high,
        critical: result.summary.critical,
      });

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('security-misconfig.scan.failed', {
        appId,
        error: errorMessage,
        executionTime: Date.now() - startTime,
      });

      return {
        success: false,
        executionTime: Date.now() - startTime,
        error: errorMessage,
        findings: [],
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        formattedReport: `❌ **Security misconfiguration scan failed**: ${errorMessage}`,
      };
    }
  }

  private async runSemgrep(
    tasks: WorkspaceTasks,
    workDir: string,
    options: Required<SecurityMisconfigurationScannerOptions>
  ): Promise<MisconfigurationFinding[]> {
    this.logger.info('security-misconfig.semgrep.executing');

    // Check if semgrep is available
    const semgrepCheck = await tasks.runCommandSync({
      command: 'semgrep --version',
      timeoutSeconds: 5,
      workingDir: workDir,
    });
    if (semgrepCheck.exitCode !== 0) {
      this.logger.warn('security-misconfig.semgrep.not-available');
      return [];
    }

    // Use unique config path to avoid race conditions between concurrent scans
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const configPath = `.semgrep-security-misconfig-${timestamp}-${randomSuffix}.yml`;

    // Create config file for this scan
    await this.createDefaultSemgrepConfig(tasks, workDir, configPath);

    try {
      const result = await tasks.runCommandSync({
        command: `semgrep --config=${configPath} --json --no-git-ignore`,
        timeoutSeconds: Math.floor((options.timeout || this.DEFAULT_TIMEOUT) / 1000),
        workingDir: workDir,
      });

      // Exit code 1 can mean findings; other non-zero means error
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(`Semgrep execution failed: ${result.stderr || 'Unknown error'}`);
      }

      if (!result.stdout) return [];
      const trimmed = result.stdout.trim();
      if (!trimmed.startsWith('{')) return [];

      let data: SemgrepOutput;
      try {
        data = JSON.parse(trimmed);
      } catch (error) {
        this.logger.warn('security-misconfig.semgrep.parse-failed', { error: getErrorMessage(error) });
        return [];
      }

      const out: MisconfigurationFinding[] = [];
      for (const r of data.results || []) {
        const ruleId = r.check_id || 'unknown';
        const category = this.mapSemgrepRuleToCategory(ruleId);
        const severity = this.mapSemgrepSeverityToSeverity(r.extra?.severity || r.extra?.metadata?.severity || 'medium');
        out.push({
          category,
          severity,
          file: r.path || 'unknown',
          line: r.start?.line || 0,
          column: r.start?.col || 0,
          ruleId,
          evidence: r.extra?.message || `Semgrep finding: ${ruleId}`,
          remediation: this.getRemediation(category, ruleId),
        });
      }

      this.logger.info('security-misconfig.semgrep.complete', { findingsCount: out.length });
      return out;
    } finally {
      // Always clean up config file after scan
      await tasks.runCommandSync({
        command: `rm -f ${configPath}`,
        timeoutSeconds: 5,
        workingDir: workDir,
      }).catch(() => {
        // Ignore cleanup errors
        this.logger.warn('security-misconfig.semgrep.cleanup-failed', { configPath });
      });
    }
  }

  private async createDefaultSemgrepConfig(
    tasks: WorkspaceTasks,
    workDir: string,
    configPath: string
  ): Promise<void> {
    // Keep rules small and high-signal; absence checks are handled by static audit.
    const yaml = [
      'rules:',
      '  - id: misconfig-cors-wildcard-credentials',
      '    message: "CORS allows credentials with wildcard origin (high risk)"',
      '    severity: ERROR',
      '    languages: [javascript, typescript]',
      '    patterns:',
      '      - pattern-either:',
      '          - pattern: cors({ ..., origin: "*", ..., credentials: true, ... })',
      '          - pattern: cors({ ..., credentials: true, ..., origin: "*", ... })',
      '',
      '  - id: misconfig-http-url-literal',
      '    message: "Hardcoded http:// URL detected; verify HTTPS usage in production"',
      '    severity: WARNING',
      '    languages: [javascript, typescript]',
      `    pattern-regex: "(?<!\\\\w)http://[^\\\\s\\\\"\\']+"`,
      '',
      '  - id: misconfig-unsafe-tls-rejectUnauthorized-false',
      '    message: "TLS verification disabled (rejectUnauthorized: false); unsafe for production"',
      '    severity: WARNING',
      '    languages: [javascript, typescript]',
      '    pattern: rejectUnauthorized: false',
      '',
    ].join('\n');

    const writeCmd = this.nodeWriteFileCommand(configPath, yaml);
    await tasks.runCommandSync({
      command: writeCmd,
      timeoutSeconds: 10,
      workingDir: workDir,
    });
  }

  private mapSemgrepRuleToCategory(ruleId: string): MisconfigurationCategory {
    const lower = ruleId.toLowerCase();
    if (lower.includes('cors')) return 'cors';
    if (lower.includes('http-url') || lower.includes('http')) return 'https';
    if (lower.includes('tls') || lower.includes('rejectunauthorized')) return 'tls';
    if (lower.includes('helmet') || lower.includes('csp') || lower.includes('hsts') || lower.includes('x-frame')) return 'security-headers';
    if (lower.includes('rate')) return 'missing-rate-limit';
    if (lower.includes('admin')) return 'admin-route';
    return 'unprotected-endpoint';
  }

  private mapSemgrepSeverityToSeverity(semgrepSeverity: string): MisconfigurationSeverity {
    const lower = String(semgrepSeverity).toLowerCase();
    // Preserve distinction between critical and high findings
    if (lower === 'critical') return 'critical';
    if (lower === 'error' || lower === 'high') return 'high';
    if (lower === 'warning' || lower === 'medium') return 'medium';
    if (lower === 'low') return 'low';
    return 'info';
  }

  private async runStaticAudit(
    tasks: WorkspaceTasks,
    workDir: string,
    options: Required<SecurityMisconfigurationScannerOptions>
  ): Promise<MisconfigurationFinding[]> {
    this.logger.info('security-misconfig.static.executing');

    // Use unique script path to avoid race conditions between concurrent scans
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const scriptPath = `/tmp/airo-misconfig-audit-${timestamp}-${randomSuffix}.js`;
    const script = this.buildStaticAuditScript();

    // Write script to /tmp and execute it with base64-encoded options
    await tasks.runCommandSync({
      command: this.nodeWriteFileCommand(scriptPath, script),
      timeoutSeconds: 15,
      workingDir: workDir,
    });

    const optsJson = JSON.stringify({
      strictness: options.strictness,
      ignorePaths: options.ignorePaths,
      allowHttpHosts: options.allowHttpHosts,
      adminRoutePatterns: options.adminRoutePatterns,
    });
    const optsB64 = Buffer.from(optsJson).toString('base64');

    try {
      const result = await tasks.runCommandSync({
        command: `node ${scriptPath} '${optsB64}'`,
        timeoutSeconds: Math.floor((options.timeout || this.DEFAULT_TIMEOUT) / 1000),
        workingDir: workDir,
      });

      if (result.exitCode !== 0) {
        this.logger.warn('security-misconfig.static.failed', {
          exitCode: result.exitCode,
          stderr: result.stderr?.substring(0, 300),
        });
        return [];
      }

      const trimmed = (result.stdout || '').trim();
      if (!trimmed.startsWith('{')) return [];

      let parsed: StaticAuditOutput;
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        this.logger.warn('security-misconfig.static.parse-failed', { error: getErrorMessage(error) });
        return [];
      }

      const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
      this.logger.info('security-misconfig.static.complete', { findingsCount: findings.length });
      return findings;
    } finally {
      // Always clean up script file after execution
      await tasks.runCommandSync({
        command: `rm -f ${scriptPath}`,
        timeoutSeconds: 5,
        workingDir: workDir,
      }).catch(() => {
        // Ignore cleanup errors
        this.logger.warn('security-misconfig.static.cleanup-failed', { scriptPath });
      });
    }
  }

  private buildStaticAuditScript(): string {
    // Keep this script dependency-free (Node stdlib only). It is written into the app container and executed there.
    return `
const fs = require("node:fs");
const path = require("node:path");

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function decodeOpts() {
  const b64 = process.argv[2] || "";
  const raw = b64 ? Buffer.from(b64, "base64").toString("utf8") : "{}";
  return safeJsonParse(raw) || {};
}

function isIgnored(filePath, ignoreParts) {
  const normalized = filePath.replace(/\\\\/g, "/");
  return (ignoreParts || []).some((p) => p && normalized.includes(p));
}

function walk(dir, ignoreParts, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (isIgnored(full, ignoreParts)) continue;
    if (e.isDirectory()) walk(full, ignoreParts, out);
    else out.push(full);
  }
}

function indexToLineCol(text, idx) {
  const pre = text.slice(0, idx);
  const lines = pre.split("\\n");
  const line = lines.length;
  const col = (lines[lines.length - 1] || "").length + 1;
  return { line, col };
}

function classifySeverity(base, strictness) {
  // strictness affects heuristic-only findings; semgrep-based findings are handled elsewhere.
  const s = strictness || "medium";
  if (base === "info") return "info";
  if (s === "low") return base === "high" ? "medium" : base;
  if (s === "high") return base === "medium" ? "high" : base;
  return base;
}

function isAdminPath(routePath, patterns) {
  const p = routePath || "";
  const pats = patterns || [];
  for (const pat of pats) {
    try {
      const re = new RegExp(pat, "i");
      if (re.test(p)) return true;
    } catch {}
  }
  return false;
}

function extractHttpHost(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function main() {
  const opts = decodeOpts();
  const root = process.cwd();
  const ignoreParts = opts.ignorePaths || [];
  const allowHttpHosts = opts.allowHttpHosts || ["localhost", "127.0.0.1", "::1"];
  const adminRoutePatterns = opts.adminRoutePatterns || [];
  const strictness = opts.strictness || "medium";

  const files = [];
  walk(root, ignoreParts, files);

  const sourceFiles = files.filter((f) => /\\.(ts|js|tsx|jsx)$/.test(f));
  const findings = [];

  let hasHelmet = false;
  let hasRateLimit = false;

  // Derive file-based API routes from template convention: src/server/api/**/(GET|POST|PUT|DELETE).ts|js
  const derivedRoutes = [];
  for (const filePath of sourceFiles) {
    const normalized = filePath.replace(/\\\\/g, "/");
    const m = normalized.match(/\\/src\\/server\\/api\\/(.+)\\/(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\\.(ts|js|tsx|jsx)$/i);
    if (!m) continue;
    const subpath = m[1] || "";
    const method = (m[2] || "GET").toUpperCase();
    const routePath = "/api/" + subpath.replace(/\\/index$/i, "");
    derivedRoutes.push({ method, path: routePath, file: normalized.replace(root.replace(/\\\\/g, "/") + "/", "") });
  }

  // Scan content
  for (const filePath of sourceFiles) {
    const normalized = filePath.replace(/\\\\/g, "/");
    const relFile = normalized.startsWith(root.replace(/\\\\/g, "/")) ? normalized.slice(root.length + 1) : normalized;

    let text = "";
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 1024 * 1024) continue; // skip >1MB
      text = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    if (text.includes("helmet(") || text.includes("import helmet") || text.includes("from 'helmet'") || text.includes('from "helmet"')) {
      hasHelmet = true;
    }
    if (text.includes("rateLimit(") || text.includes("express-rate-limit") || text.includes("slowDown(") || text.includes("express-slow-down")) {
      hasRateLimit = true;
    }

    // CORS: wildcard + credentials (high signal)
    const corsRegex = /origin\\s*:\\s*["']\\*["'][\\s\\S]{0,200}?credentials\\s*:\\s*true|credentials\\s*:\\s*true[\\s\\S]{0,200}?origin\\s*:\\s*["']\\*["']/i;
    const corsMatch = corsRegex.exec(text);
    if (corsMatch) {
      const pos = indexToLineCol(text, corsMatch.index);
      findings.push({
        category: "cors",
        severity: classifySeverity("high", strictness),
        file: relFile,
        line: pos.line,
        column: pos.col,
        evidence: "CORS configured with origin='*' and credentials=true",
        remediation: "Do not use wildcard origin with credentials. Set explicit allowed origins and review cookie/token usage.",
      });
    }

    // HTTP URL literals (exclude allowed hosts)
    const httpRegex = /http:\\/\\/[^\\s"']+/g;
    let match;
    while ((match = httpRegex.exec(text))) {
      const url = match[0];
      const host = extractHttpHost(url);
      if (!host) continue;
      if (allowHttpHosts.includes(host)) continue;
      const pos = indexToLineCol(text, match.index);
      findings.push({
        category: "https",
        severity: classifySeverity("medium", strictness),
        file: relFile,
        line: pos.line,
        column: pos.col,
        evidence: "Hardcoded http:// URL: " + url,
        remediation: "Use https:// for production URLs. If this is dev-only, guard it behind environment checks.",
      });
    }

    // TLS disable: rejectUnauthorized false
    const tlsRegex = /rejectUnauthorized\\s*:\\s*false/g;
    while ((match = tlsRegex.exec(text))) {
      const pos = indexToLineCol(text, match.index);
      findings.push({
        category: "tls",
        severity: classifySeverity("high", strictness),
        file: relFile,
        line: pos.line,
        column: pos.col,
        evidence: "TLS verification disabled (rejectUnauthorized: false)",
        remediation: "Enable TLS verification in production. Use proper CA bundles and set rejectUnauthorized: true.",
      });
    }

    // Express-like routes: app.get('/x'...) or router.get('/x'...)
    const routeRegex = /\\b(app|router)\\.(get|post|put|delete|patch|options|head)\\(\\s*(["'\\x60])([^"'\\x60]+)\\3/gi;
    while ((match = routeRegex.exec(text))) {
      const method = (match[2] || "GET").toUpperCase();
      const routePath = match[4] || "";
      if (!routePath) continue;
      if (!isAdminPath(routePath, adminRoutePatterns)) continue;
      const pos = indexToLineCol(text, match.index);

      // Heuristic protection signal: unknown auth convention, so only check for obvious tokens near the route declaration line.
      const lineText = (text.split("\\n")[pos.line - 1] || "");
      const hasProtectionSignal = /auth|jwt|session|requireAuth|authenticate/i.test(lineText);

      findings.push({
        category: hasProtectionSignal ? "admin-route" : "unprotected-endpoint",
        severity: classifySeverity(hasProtectionSignal ? "medium" : "high", strictness),
        file: relFile,
        line: pos.line,
        column: pos.col,
        route: { method, path: routePath },
        evidence: hasProtectionSignal
          ? "Admin-like route detected (verify access control): " + method + " " + routePath
          : "Admin-like route may be unprotected: " + method + " " + routePath,
        remediation: "Restrict admin routes behind authentication and authorization. Add explicit access control middleware/guards.",
      });
    }
  }

  // Missing security headers (helmet/manual): only flag if there's any server code
  const hasServerCode = sourceFiles.some((f) => f.replace(/\\\\/g, "/").includes("/src/server/") || f.replace(/\\\\/g, "/").includes("/server/"));
  if (hasServerCode && !hasHelmet) {
    findings.push({
      category: "security-headers",
      severity: classifySeverity("medium", strictness),
      file: "unknown",
      line: 0,
      column: 0,
      evidence: "No helmet() usage detected in server code",
      remediation: "Add security headers (CSP, HSTS, X-Frame-Options) via helmet() or explicit header middleware.",
    });
  }

  // Missing rate limits: only flag if server/API routes exist
  if (hasServerCode && !hasRateLimit) {
    // Elevate if admin-like routes exist (derived from file-based routes)
    const adminRoutes = derivedRoutes.filter((r) => isAdminPath(r.path, adminRoutePatterns));
    findings.push({
      category: "missing-rate-limit",
      severity: classifySeverity(adminRoutes.length > 0 ? "high" : "medium", strictness),
      file: "unknown",
      line: 0,
      column: 0,
      evidence: "No rate limiting detected in server code",
      remediation: "Add rate limiting globally and/or per route (especially for admin-like, auth, and expensive endpoints).",
    });
  }

  // Admin routes from derived template API routes: if admin-like and no obvious protection signal in file content
  for (const r of derivedRoutes) {
    if (!isAdminPath(r.path, adminRoutePatterns)) continue;
    let text = "";
    try { text = fs.readFileSync(path.join(root, r.file), "utf8"); } catch { continue; }
    const hasProtectionSignal = /auth|jwt|session|requireAuth|authenticate/i.test(text);
    findings.push({
      category: hasProtectionSignal ? "admin-route" : "unprotected-endpoint",
      severity: classifySeverity(hasProtectionSignal ? "medium" : "high", strictness),
      file: r.file,
      line: 1,
      column: 1,
      route: { method: r.method, path: r.path },
      evidence: hasProtectionSignal
        ? "Admin-like API route detected (verify access control): " + r.method + " " + r.path
        : "Admin-like API route may be unprotected: " + r.method + " " + r.path,
      remediation: "Restrict admin endpoints behind authentication and authorization. Add explicit access control checks.",
    });
  }

  const out = {
    findings,
    meta: {
      hasHelmet,
      hasRateLimit,
      derivedRouteCount: derivedRoutes.length,
      scannedFiles: sourceFiles.length,
    },
  };

  process.stdout.write(JSON.stringify(out));
}

main();
`.trimStart();
  }

  private nodeWriteFileCommand(filePath: string, content: string): string {
    // Write file using base64 encoding to avoid shell injection from quotes in content.
    // Content could contain single quotes (e.g., "foo's rule") which would break shell escaping.
    const js = `require("node:fs").writeFileSync(${JSON.stringify(filePath)}, Buffer.from(process.argv[1], "base64").toString("utf8"), "utf8");`;
    const contentBase64 = Buffer.from(content).toString('base64');
    return `node -e '${js}' '${contentBase64}'`;
  }

  private dedupeFindings(findings: MisconfigurationFinding[]): MisconfigurationFinding[] {
    const m = new Map<string, MisconfigurationFinding>();
    for (const f of findings) {
      const routeKey = f.route ? `${f.route.method}:${f.route.path}` : '';
      const key = `${f.category}:${f.file}:${f.line}:${f.column}:${routeKey}:${f.ruleId || ''}`;
      if (!m.has(key)) m.set(key, f);
    }
    return Array.from(m.values());
  }

  private calculateSummary(findings: MisconfigurationFinding[]): SecurityMisconfigurationScannerResult['summary'] {
    const summary = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) {
      summary[f.severity]++;
    }
    return summary;
  }

  private getRemediation(category: MisconfigurationCategory, ruleId?: string): string {
    switch (category) {
      case 'cors':
        return 'Configure CORS with explicit origins and avoid wildcard origin with credentials. Review allowed headers/methods.';
      case 'https':
        return 'Use HTTPS for production endpoints and enforce HTTPS at the edge (proxy/load balancer). Avoid hardcoded http:// URLs.';
      case 'security-headers':
        return 'Add security headers (CSP, HSTS, X-Frame-Options) via helmet() or explicit middleware.';
      case 'missing-rate-limit':
        return 'Add global and/or per-route rate limiting (especially for admin/auth/expensive endpoints).';
      case 'admin-route':
      case 'unprotected-endpoint':
        return 'Restrict sensitive endpoints behind authentication and authorization. Add explicit access control checks.';
      case 'tls':
        return 'Do not disable TLS verification in production; enable certificate validation and use proper CA trust.';
      default:
        return `Review finding (${ruleId || 'unknown'}) and apply appropriate security hardening.`;
    }
  }

  private formatReport(input: { findings: MisconfigurationFinding[]; summary: SecurityMisconfigurationScannerResult['summary'] }): string {
    const lines: string[] = [];
    lines.push('🛡️ **Security Misconfiguration Scan Results**\n');

    const { summary, findings } = input;
    if (summary.total === 0) {
      lines.push('✅ **No security misconfiguration signals detected**\n');
      return lines.join('\n');
    }

    lines.push(`Found ${summary.total} issue${summary.total === 1 ? '' : 's'}:`);
    if (summary.critical) lines.push(`  🔴 Critical: ${summary.critical}`);
    if (summary.high) lines.push(`  🟠 High: ${summary.high}`);
    if (summary.medium) lines.push(`  🟡 Medium: ${summary.medium}`);
    if (summary.low) lines.push(`  🟢 Low: ${summary.low}`);
    if (summary.info) lines.push(`  🔵 Info: ${summary.info}`);
    lines.push('');

    // Group by file for readability
    const byFile = new Map<string, MisconfigurationFinding[]>();
    for (const f of findings) {
      const arr = byFile.get(f.file) || [];
      arr.push(f);
      byFile.set(f.file, arr);
    }

    lines.push('**Findings by File:**\n');
    for (const [file, fileFindings] of Array.from(byFile.entries())) {
      lines.push(`📄 **${file}**`);
      for (const f of fileFindings) {
        const loc = f.line ? `Line ${f.line}:${f.column}` : 'Location unknown';
        const route = f.route ? ` [${f.route.method} ${f.route.path}]` : '';
        lines.push(`  - (${f.severity}) ${f.category}${route} — ${loc}`);
        lines.push(`    Evidence: ${f.evidence}`);
        lines.push(`    Remediation: ${f.remediation}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

