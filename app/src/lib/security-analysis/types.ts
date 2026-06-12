/**
 * Security Analysis Types
 *
 * Response-shape types for the internal vulnerability scan service.
 */

export interface SecurityAnalysisResponse {
  status?: 'pending' | 'completed' | 'failed';
  success?: boolean;
  testsPassed?: number;
  testsFailed?: number;
  testsSkipped?: number;
  totalTests?: number;
  passRate?: number;
  testSource?: string;
  details?: Array<{
    name: string;
    status: string;
    duration?: number;
    elementContext?: Record<string, unknown>;
  }>;
  performance?: Record<string, unknown>;
  devTools?: Record<string, unknown>;
  errors?: string[];
  aiInsights?: {
    functional?: Record<string, unknown>;
    // Structural shape mirrors StructuredVulnerability / StructuredRecommendation
    // from @/app/api/security-analysis/transform-scan-result without importing those
    // types here. Keeps this lib free of BFF-internal coupling.
    securityReport?: {
      vulnerabilities?: Array<{
        kind: 'sca' | 'secret' | 'sast' | 'supplyChain';
        severity: string;
        ruleId?: string;
        rawTitle?: string;
        description?: string;
        remediation?: string[];
        packageName?: string;
        file?: string;
        line?: number;
        column?: number;
      }>;
      recommendations?: Array<{
        kind: 'autoFix' | 'manualReview' | 'deprecated';
        severity?: string;
        package: string;
        description?: string;
        action?: string;
        reason?: string;
      }>;
    };
  };
}

export interface SecurityAnalysisRunResult {
  results: SecurityAnalysisResponse;
  timedOut: boolean;
  taskId: string;
}
