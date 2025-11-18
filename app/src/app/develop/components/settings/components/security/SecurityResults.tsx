import text from '@ux/text';
import Tag from '@ux/tag';
import Box from "@ux/box";
import OkIcon from '@ux/icon/ok';
import XThickIcon from '@ux/icon/x-thick';

/**
 * Security vulnerability interface based on TestPilot response
 */
interface SecurityVulnerability {
  severity: string;
  title: string;
  description: string;
  impact?: string;
  remediation?: string[];
  location?: string;
}

/**
 * Security recommendation interface
 */
interface SecurityRecommendation {
  priority?: 'high' | 'medium' | 'low';
  text: string;
}

/**
 * Security report interface based on TestPilot response
 */
interface SecurityReport {
  vulnerabilities?: SecurityVulnerability[];
  recommendations?: (string | SecurityRecommendation)[];
}

/**
 * TestPilot security response interface
 */
interface SecurityTestResult {
  status?: 'pending' | 'completed' | 'failed';
  success?: boolean;
  testsPassed?: number;
  testsFailed?: number;
  totalTests?: number;
  passRate?: number;
  details?: Array<{
    name: string;
    status: string;
    duration?: number;
    elementContext?: Record<string, unknown>;
  }>;
  aiInsights?: {
    securityReport?: SecurityReport;
  };
  errors?: string[];
}

/**
 * Component to display security vulnerabilities
 */
function SecurityVulnerabilityCard({ vulnerability }: { vulnerability: SecurityVulnerability }) {
  const getSeverityTagEmphasis = (severity: string): 'critical' | 'warning' | 'info' | 'neutral' => {
    switch (severity.toLowerCase()) {
      case 'critical':
        return 'critical';
      case 'high':
        return 'critical';
      case 'medium':
        return 'warning';
      case 'low':
        return 'info';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="border rounded-lg p-5">
      <div className="flex justify-between items-start mb-2">
        <text.h4 as="title" className="mr-1">
          {vulnerability.title}
        </text.h4>
        <Tag emphasis={getSeverityTagEmphasis(vulnerability.severity)} size="lg">
          {vulnerability.severity}
        </Tag>
      </div>

      <text.p className="mb-3">
        {vulnerability.description}
      </text.p>

      {vulnerability.impact && (
        <div className="mb-3">
          <text.span className="font-bold">Impact:</text.span>{' '}
          <text.span>{vulnerability.impact}</text.span>
        </div>
      )}

      {vulnerability.location && (
        <div className="mb-3">
          <text.span className="font-bold">Location:</text.span>{' '}
          <code className="bg-white px-2 py-1 rounded text-sm">{vulnerability.location}</code>
        </div>
      )}

      {vulnerability.remediation && vulnerability.remediation.length > 0 && (
        <div>
          <text.span className="font-bold">Remediation:</text.span>
          <ul className="list-disc list-inside mt-1 ml-4">
            {vulnerability.remediation.map((item, index) => (
              <li key={index} className="mb-1">
                <text.span>{item}</text.span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Component to display security analysis results
 *
 * @param results - The TestPilot API response containing security test results
 */
export default function SecurityResults({ results }: { results: { security?: SecurityTestResult } }) {
  // Check if security results exists
  if (!results.security) {
    return (
      <div>
        <text.p className="font-medium">
          <text.span emphasis="critical">Error:</text.span> Security Analysis
          Failed
        </text.p>
        <text.p>
          The security test results are missing. Please try running the analysis
          again.
        </text.p>
      </div>
    );
  }

  const securityData: SecurityTestResult = results.security;
  const securityReport = securityData.aiInsights?.securityReport;

  const testResultData = [
    {
      data: securityData.testsPassed,
      label: "Passed",
    },
    {
      data: securityData.testsFailed,
      label: "Failed",
    },
    {
      data: securityData.totalTests,
      label: "Total Tests",
    },
    {
      data:
        securityData.passRate !== undefined
          ? Math.round(securityData.passRate * 100) + "%"
          : undefined,
      label: "Pass Rate",
    },
  ];

  return (
    <Box gap="lg" className="p-3">
      {/* Test Summary */}
      {(securityData.testsPassed !== undefined ||
        securityData.testsFailed !== undefined) && (
        <Box gap="md">
          <div className="flex justify-between items-center">
            <text.h3 as="title" size={2}>
              Tests Results
            </text.h3>
            {securityData.success !== undefined && (
              <Tag
                emphasis={securityData.success ? "success" : "critical"}
                size="lg"
              >
                {securityData.success ? "Passed" : "Issues Found"}
              </Tag>
            )}
          </div>
          <Box gap="lg" className="p-6 border border-gray-200 rounded-lg">
            <div className="py-4 grid md:grid-cols-4">
              {testResultData.map((item, index) => (
                <div key={index} className="text-center">
                  <text.p>{item.data}</text.p>
                  <text.p>{item.label}</text.p>
                </div>
              ))}
            </div>

            {/* Details */}
            {securityData.details && securityData.details.length > 0 && (
              <ul className="space-y-1">
                {securityData.details.map((detail, index) => {
                  const isPassed = detail.status?.toLowerCase() === "passed";

                  return (
                    <li key={index} className="flex items-center gap-2">
                      {isPassed ? (
                        <OkIcon color="green" height="1.5rem" />
                      ) : (
                        <XThickIcon color="red" height='1.5rem' />
                      )}
                      <text.span className="font-medium">
                        {detail.name}
                      </text.span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Box>
        </Box>
      )}

      {/* Vulnerabilities */}
      {securityReport?.vulnerabilities &&
        securityReport.vulnerabilities.length > 0 && (
          <Box gap="md">
            <text.h3 as="title" size={2}>
              Vulnerabilities Found
            </text.h3>
            <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
              {securityReport.vulnerabilities
                .slice()
                .sort((a, b) => {
                  const getSeverityOrder = (severity: string) => {
                    switch (severity.toLowerCase()) {
                      case "critical":
                        return 1;
                      case "high":
                        return 2;
                      case "medium":
                        return 3;
                      case "low":
                        return 4;
                      default:
                        return 5; // Unknown severity goes last
                    }
                  };
                  return (
                    getSeverityOrder(a.severity) - getSeverityOrder(b.severity)
                  );
                })
                .map((vulnerability, index) => (
                  <SecurityVulnerabilityCard
                    key={index}
                    vulnerability={vulnerability}
                  />
                ))}
            </div>
          </Box>
        )}
    </Box>
  );
}
