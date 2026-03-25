import { useRouter } from 'next/navigation';
import { type MouseEvent, useEffect, useState } from 'react';
import Alert from '@ux/alert';
import Box from "@ux/box";
import Button from "@ux/button";
import Card from "@ux/card";
import Growl from '@ux/growl';
import ShieldIcon from '@ux/icon/shield-check-filled';
import Tag from '@ux/tag';
import text from '@ux/text';
import TextLockup from '@ux/text-lockup';

import { ChatTab } from '@/app/develop/components/types';
import { useAppIdFromParams } from '@/app/develop/components/utils';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { type TestPilotRunResult } from '@/lib/testpilot';
import { TodoListService } from '@/services/TodoListService';

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
  const t = useTranslations();
  return (
    <Card className="p-4">
      <Box gap="md" blockAlignChildren="center" inlineAlignChildren="center">
        <ShieldIcon color="green" height="3rem" width="3rem" aria-hidden="true" focusable="false" />
        <TextLockup
          title={t('builder_settings_security_results_complete_title')}
          titleLevel={3}
          centered
        >
          {t('builder_settings_security_results_complete_text')}
        </TextLockup>
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
  onToggle,
  selectionDisabled
}: {
  vulnerability: SecurityVulnerability;
  vulnerabilityId: string;
  isChecked: boolean;
  onToggle: (id: string) => void;
  selectionDisabled: boolean;
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
      disabled={selectionDisabled}
      checked={isChecked}
      onChange={() => {
        if (!selectionDisabled) {
          onToggle(vulnerabilityId);
        }
      }}
      cornerActions={
        <Button
          as="checkbox"
          disabled={selectionDisabled}
          onClick={function securityVulnerabilityCornerClick(e: MouseEvent<HTMLButtonElement>) {
            e.stopPropagation();
            if (!selectionDisabled) {
              onToggle(vulnerabilityId);
            }
          }}
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
 * @param onQuickFixInProgressChange - Notifies parent when Quick Fix create/navigation is in progress
 */
export default function SecurityResults({
  results,
  onQuickFixInProgressChange
}: {
  results: { security?: TestPilotRunResult }
  onQuickFixInProgressChange?: (inProgress: boolean) => void
}) {
  const t = useTranslations();
  const router = useRouter();
  const appId = useAppIdFromParams();
  const { activeChatTab } = useChatTabs();
  const [checkedVulnerabilities, setCheckedVulnerabilities] = useState<Set<string>>(new Set());
  const [isCreatingTodoList, setIsCreatingTodoList] = useState(false);
  const todoListService = new TodoListService();

  useEffect(() => {
    if (activeChatTab !== ChatTab.SETTINGS) {
      setIsCreatingTodoList(false);
    }
  }, [activeChatTab]);

  useEffect(() => {
    onQuickFixInProgressChange?.(isCreatingTodoList)
    return () => {
      onQuickFixInProgressChange?.(false)
    }
  }, [isCreatingTodoList, onQuickFixInProgressChange])

  const errorAlert = (
    <Alert
      emphasis="critical"
      title={t('builder_settings_security_results_failed_title')}
    >
      {t('builder_settings_security_results_failed_text')}
    </Alert>
  );

  if (!results.security) {
    return errorAlert;
  }

  const securityRunResult = results.security;

  // Handle timeout case
  if (securityRunResult.timedOut) {
    return (
      <Alert
        emphasis="warning"
        title={t('builder_settings_security_results_timeout_title')}
      >
        {t('builder_settings_security_results_timeout_text')}
      </Alert>
    );
  }

  if (!securityRunResult.results || securityRunResult.results.errors?.length) {
    return errorAlert;
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
    if (isCreatingTodoList) {
      return;
    }
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
    if (isCreatingTodoList) {
      return;
    }
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
        title: t('builder_settings_security_results_suggested_fix', { severity: vulnerability.severity, title: vulnerability.title}),
        description: `${vulnerability.description}${vulnerability.remediation ? `\n${t('builder_settings_security_results_suggested_remediation')}:\n${vulnerability.remediation.map((item) => `- ${item}`).join("\n")}` : ""}`,
      }));

      // Create the list
      const newTodoList = await todoListService.createList(
        appId,
        t('builder_settings_security_results_selected_title'),
        t('builder_settings_security_results_selected_text', { date: new Date().toLocaleDateString() }),
        todoItems,
      );

      router.push(`/develop/${appId}?todoListId=${newTodoList.id}`);
      // Keep isCreatingTodoList true until unmount so checkboxes stay locked and selected during navigation.
    } catch (error) {
      logger.error('security.todo_list.create.failed', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
      Growl.addGrowlMessage({
        id: 'security-quick-fix-create-failed',
        title: t('builder_settings_security_quick_fix_create_failed_title', undefined, 'Could not start Quick Fix'),
        children: t('builder_settings_security_quick_fix_create_failed_description', undefined, 'The fix list could not be created. Please try again.'),
        emphasis: 'critical',
        lifetime: 7000
      });
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
              {t('builder_settings_security_results_title')} ({vulnerabilities.length})
            </text.h3>
            <div className="flex gap-1">
              <Button
                size="sm"
                design="secondary"
                disabled={isCreatingTodoList}
                onClick={handleSelectAll}
              >
                {areAllSelected() ? t('builder_common_deselect_all') : t('builder_common_select_all')}
              </Button>
              <Button
                size="sm"
                design="primary"
                onClick={handleQuickFix}
                disabled={checkedVulnerabilities.size === 0 || isCreatingTodoList}
                text={
                  isCreatingTodoList
                    ? t('builder_common_creating')
                    : t('builder_settings_security_ask_airo_to_fix', undefined, 'Ask Airo to fix')
                }
              />
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
                  selectionDisabled={isCreatingTodoList}
                />
              );
            })}
          </div>
        </Box>
      )}
    </Box>
  );
}
