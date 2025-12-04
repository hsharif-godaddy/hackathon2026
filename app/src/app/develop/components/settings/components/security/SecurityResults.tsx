/**
 * TODO: Integrate code scans into Security Scan Results page
 *
 * The Security Scan Results page could also run the code scans and include the results
 * alongside the current TestPilot security scan results. This would provide a comprehensive
 * security overview in a single interface.
 *
 * Implementation steps:
 * 1. Add code scan integration to SecurityPanel.tsx to call both TestPilot and agents service
 * 2. Update SecurityResults to handle both TestPilot and code scan result formats
 * 3. Merge vulnerability data from both sources into unified display
 * 4. Ensure proper error handling for both scan types
 *
 * Reference:
 * - app/src/app/api/testpilot/route.ts (lines 59-79 for code scan integration)
 * - agents/src/server/routes/security-scan.ts (current code scan implementation)
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from "@ux/button";
import text from '@ux/text';
import Tag from '@ux/tag';
import Box from "@ux/box";
import Card from "@ux/card";
import ShieldIcon from '@ux/icon/shield-check-filled';
import { TodoListService } from '@/services/TodoListService';
import { useAppIdFromParams } from '../../../utils';
import { type TestPilotRunResult } from '@/lib/testpilot';

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
 * Component to display success screen when no vulnerabilities are found
 */
function SecuritySuccessScreen() {
  return (
    <Card className="p-4 text-center">
      <Box gap="lg" className="items-center">
        <div className="flex justify-center">
          <div className="p-2">
            <ShieldIcon color="green" height="3rem" width="3rem" />
          </div>
        </div>
        <Box gap="md">
          <text.h3 as="title" size={2}>
            Security Analysis Complete
          </text.h3>
          <text.p>
            Great news! No security vulnerabilities were found in your application. Your application is secure.
          </text.p>
        </Box>
      </Box>
    </Card>
  );
}

/**
 * Component to display security vulnerabilities
 */
function SecurityVulnerabilityCard({
  vulnerability,
  vulnerabilityId,
  isChecked,
  onToggle
}: {
  vulnerability: SecurityVulnerability;
  vulnerabilityId: string;
  isChecked: boolean;
  onToggle: (id: string) => void;
}) {
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
    <Card
      id={vulnerabilityId}
      className="p-2.5 checkbox-card"
      as="checkbox"
      checked={isChecked}
      onChange={() => onToggle(vulnerabilityId)}
      cornerActions={
        <Button
          as="checkbox"
          onClick={() => onToggle(vulnerabilityId)}
          active={isChecked}
          size="sm"
        />
      }
      title={
        <Box orientation="horizontal" gap="md" className="pb-1.5">
            <Tag
              emphasis={getSeverityTagEmphasis(vulnerability.severity)}
              size="lg"
            >
              {vulnerability.severity}
            </Tag>
          {vulnerability.title}
        </Box>
      }
    >
      {vulnerability.impact && (
        <div>
          <text.span>{vulnerability.impact}</text.span>
        </div>
      )}
    </Card>
  );
}

/**
 * Component to display security analysis results
 *
 * @param results - The TestPilot API response containing security test results
 */
export default function SecurityResults({
  results,
}: {
  results: { security?: TestPilotRunResult };
}) {
  const router = useRouter();
  const appId = useAppIdFromParams();
  const [checkedVulnerabilities, setCheckedVulnerabilities] = useState<
    Set<string>
  >(new Set());
  const [isCreatingTodoList, setIsCreatingTodoList] = useState(false);
  const todoListService = new TodoListService();

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

  const securityRunResult = results.security;

  // Handle timeout case
  if (securityRunResult.timedOut) {
    return (
      <div>
        <text.p className="font-medium">
          <text.span emphasis="critical">Timeout:</text.span> Security Analysis
          Timed Out
        </text.p>
        <text.p>
          The security analysis took longer than expected to complete.
        </text.p>
        <text.p className="text-sm mt-2">
          You can try running the analysis again.
        </text.p>
      </div>
    );
  }

  const securityData: SecurityTestResult = securityRunResult.results;
  const securityReport = securityData.aiInsights?.securityReport;
  const vulnerabilities = (securityReport?.vulnerabilities || [])
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

      return getSeverityOrder(a.severity) - getSeverityOrder(b.severity);
    });

  /**
   * Toggle the checked state of a vulnerability
   *
   * @param vulnerabilityId - The unique ID of the vulnerability to toggle
   */
  const toggleVulnerability = (vulnerabilityId: string) => {
    setCheckedVulnerabilities((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(vulnerabilityId)) {
        newSet.delete(vulnerabilityId);
      } else {
        newSet.add(vulnerabilityId);
      }
      return newSet;
    });
  };

  /**
   * Get all vulnerability IDs for select all functionality
   */
  const getAllVulnerabilityIds = (): string[] => {
    if (!securityReport?.vulnerabilities) return [];
    return securityReport.vulnerabilities.map(
      (_, index) => `vulnerability-${index}`,
    );
  };

  /**
   * Check if all vulnerabilities are selected
   */
  const areAllSelected = (): boolean => {
    const allIds = getAllVulnerabilityIds();
    return (
      allIds.length > 0 && allIds.every((id) => checkedVulnerabilities.has(id))
    );
  };

  /**
   * Handle select all / deselect all functionality
   */
  const handleSelectAll = () => {
    const allIds = getAllVulnerabilityIds();
    if (areAllSelected()) {
      // Deselect all
      setCheckedVulnerabilities(new Set());
    } else {
      // Select all
      setCheckedVulnerabilities(new Set(allIds));
    }
  };

  /**
   * Handle creating a TO-DO list from selected vulnerabilities
   */
  const handleQuickFix = async () => {
    if (
      !appId ||
      checkedVulnerabilities.size === 0 ||
      !securityReport?.vulnerabilities
    ) {
      return;
    }

    setIsCreatingTodoList(true);

    try {
      // Get selected vulnerabilities
      const selectedVulnerabilities = vulnerabilities.filter((_, index) => {
        const vulnerabilityId = `vulnerability-${index}`;
        return checkedVulnerabilities.has(vulnerabilityId);
      });

      // Create items from selected vulnerabilities
      const todoItems = selectedVulnerabilities.map((vulnerability) => ({
        title: `Fix ${vulnerability.severity} severity: ${vulnerability.title}`,
        description: `${vulnerability.description}${vulnerability.remediation ? `\nSuggested Remediation:\n${vulnerability.remediation.map((item) => `- ${item}`).join("\n")}` : ""}`,
      }));

      // Create the list
      const newTodoList = await todoListService.createList(
        appId,
        "Selected Security Vulnerabilities",
        `Security vulnerabilities found during analysis on ${new Date().toLocaleDateString()}`,
        todoItems,
      );

      // Clear selections after successful creation
      setCheckedVulnerabilities(new Set());

      // Route to develop page with todoListId query parameter
      router.push(`/develop/${appId}?todoListId=${newTodoList.id}`);
    } catch (error) {
      console.error("Failed to create TODO list:", error);
      // TODO: Show error message to user
    } finally {
      setIsCreatingTodoList(false);
    }
  };

  // Get only failed test details
  const failedTests =
    securityData.details?.filter(
      (detail) => detail.status?.toLowerCase() !== "passed",
    ) || [];

  // Check if there are any issues (vulnerabilities or failed tests)
  const hasIssues =
    (vulnerabilities && vulnerabilities.length > 0) || failedTests.length > 0;

  return (
    <Box gap="lg" className="p-1.5">
      {/* Show success screen if no issues found */}
      {!hasIssues && <SecuritySuccessScreen />}

      {/* Vulnerabilities - Only show if vulnerabilities exist */}
      {vulnerabilities && vulnerabilities.length > 0 && (
        <Box gap="md">
          <div className="flex justify-between items-center">
            <text.h3 as="title" size={2}>
              Vulnerabilities ({vulnerabilities.length})
            </text.h3>
            <div className="flex gap-1">
              <Button size="sm" design="secondary" onClick={handleSelectAll}>
                {areAllSelected() ? "Deselect All" : "Select All"}
              </Button>
              <Button
                size="sm"
                design="primary"
                onClick={handleQuickFix}
                disabled={
                  checkedVulnerabilities.size === 0 || isCreatingTodoList
                }
              >
                {isCreatingTodoList ? "Creating..." : "Quick Fix"}
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            {vulnerabilities.map((vulnerability, index) => {
              const vulnerabilityId = `vulnerability-${index}`;
              return (
                <SecurityVulnerabilityCard
                  key={index}
                  vulnerability={vulnerability}
                  vulnerabilityId={vulnerabilityId}
                  isChecked={checkedVulnerabilities.has(vulnerabilityId)}
                  onToggle={toggleVulnerability}
                />
              );
            })}
          </div>
        </Box>
      )}
    </Box>
  );
}
