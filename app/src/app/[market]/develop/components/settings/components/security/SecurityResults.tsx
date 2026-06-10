import { useRouter } from 'next/navigation';
import { type MouseEvent, useEffect, useState } from 'react';
import Alert from '@ux/alert';
import Box from "@ux/box";
import Button from "@ux/button";
import Card from "@ux/card";
import Growl from '@ux/growl';
import InfoIcon from '@ux/icon/information';
import ShieldIcon from '@ux/icon/shield-check-filled';
import Tag from '@ux/tag';
import text from '@ux/text';
import TextLockup from '@ux/text-lockup';

import { ChatTab } from '@/app/[market]/develop/components/types';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { type StructuredVulnerability } from '@/app/api/testpilot/transform-scan-result';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { type TestPilotRunResult } from '@/lib/testpilot';
import { TodoListService } from '@/services/TodoListService';

type TranslateFn = ReturnType<typeof useTranslations>;

/**
 * TestPilot security response interface — `vulnerabilities` is the structured
 * shape emitted by transform-scan-result.ts. The client templates user-visible
 * strings via translation keys (builder_settings_security_*).
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
    securityReport?: {
      vulnerabilities?: StructuredVulnerability[];
    };
  };
  errors?: string[];
}

/**
 * Translate a severity string ("critical" | "high" | "medium" | "low") to its
 * localized label. Unknown severities pass through verbatim — better to surface
 * a raw value than swallow a finding.
 */
function severityLabel(severity: string, t: TranslateFn): string {
  const key = severity.toLowerCase();
  if (key === 'critical' || key === 'high' || key === 'medium' || key === 'low') {
    return t(`builder_settings_security_severity_${key}`);
  }
  return severity;
}

/**
 * Build the user-visible title for a vulnerability. Each `kind` has its own
 * translation key — registered upstream in the i18n tool.
 */
function displayTitle(v: StructuredVulnerability, t: TranslateFn): string {
  switch (v.kind) {
    case 'sca':
      return t('builder_settings_security_vuln_title_sca', { title: v.rawTitle ?? v.packageName ?? '' });
    case 'secret':
      return t('builder_settings_security_vuln_title_secret', { ruleId: v.ruleId ?? '' });
    case 'sast':
      return t('builder_settings_security_vuln_title_sast', { ruleId: v.ruleId ?? '', title: v.rawTitle ?? '' });
    case 'supplyChain':
      return t('builder_settings_security_vuln_title_supply_chain', { ruleId: v.ruleId ?? '', title: v.rawTitle ?? '' });
  }
}

/**
 * Build the user-visible impact line. Templated client-side from raw context
 * (file/line/packageName) provided by the BFF transform.
 */
function displayImpact(v: StructuredVulnerability, t: TranslateFn): string {
  switch (v.kind) {
    case 'sca':
      return t('builder_settings_security_vuln_impact_sca', { packageName: v.packageName ?? '' });
    case 'secret':
      return t('builder_settings_security_vuln_impact_secret', { file: v.file ?? '', line: v.line ?? 0 });
    case 'sast':
      return t('builder_settings_security_vuln_impact_sast', { file: v.file ?? '', line: v.line ?? 0 });
    case 'supplyChain':
      return v.packageName
        ? t('builder_settings_security_vuln_impact_supply_chain_pkg', { packageName: v.packageName })
        : t('builder_settings_security_vuln_impact_supply_chain_file', { file: v.file ?? '' });
  }
}

/**
 * Pick the right description for a finding. Scanner-emitted free-text wins
 * when present; for SCA findings we fall back to a translation key when the
 * upstream advisory provided no description.
 */
function displayDescription(v: StructuredVulnerability, t: TranslateFn): string {
  if (v.description && v.description.trim().length > 0) return v.description;
  if (v.kind === 'sca') return t('builder_settings_security_vuln_desc_sca_fallback');
  return '';
}

/**
 * Resolve a remediation list, applying the SCA-specific translated fallback
 * when the scanner did not emit one (e.g., no autoFix recommendation matched).
 */
function displayRemediation(v: StructuredVulnerability, t: TranslateFn): string[] {
  if (v.remediation && v.remediation.length > 0) return v.remediation;
  if (v.kind === 'sca') return [t('builder_settings_security_vuln_remediation_sca_fallback')];
  return [];
}

/**
 * Listed rows only if `severity.toLowerCase()` is `critical` or `high`. Anything else (medium, low,
 * info, unknown, or unexpected API values) is omitted from `visibleVulnerabilities` and the list UI.
 */
const UI_VULNERABILITY_SEVERITIES = new Set(['critical', 'high']);

/**
 * Shown when `hasIssues` is false: no rows in `visibleVulnerabilities` and no failed tests.
 * Success copy (`builder_settings_security_results_complete_text`) should state the scope (critical
 * or high only) in i18n;
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
  vulnerability: StructuredVulnerability;
  vulnerabilityId: string;
  isChecked: boolean;
  onToggle: (id: string) => void;
  selectionDisabled: boolean;
}) {
  const t = useTranslations();
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

  const impact = displayImpact(vulnerability, t);

  return (
    <Card
      id={vulnerabilityId}
      className="checkbox-card p-2.5"
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
        <Box className="pb-1.5" gap="sm" orientation="vertical">
          <Tag
            className="shrink-0 self-start"
            emphasis={getSeverityTagEmphasis(vulnerability.severity)}
            size="lg"
          >
            {severityLabel(vulnerability.severity, t)}
          </Tag>
          <text.span as="title" className="min-w-0 break-words" size={0}>
            {displayTitle(vulnerability, t)}
          </text.span>
        </Box>
      }
    >
      {impact && (
        <Box>
          <text.span>{impact}</text.span>
        </Box>
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
  const isSecurityScanUiEnabled = useSwitchboard('appbuilder-security-scan-ui') === true;
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

  const visibleVulnerabilities = vulnerabilities.filter((v) =>
    UI_VULNERABILITY_SEVERITIES.has(v.severity.toLowerCase()),
  );

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
  const getAllVulnerabilityIds = (): string[] =>
    visibleVulnerabilities.map((_, index) => `vulnerability-${index}`);

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
    if (!appId || checkedVulnerabilities.size === 0 || visibleVulnerabilities.length === 0) {
      return;
    }

    setIsCreatingTodoList(true);

    try {
      // Get selected vulnerabilities
      const selectedVulnerabilities = visibleVulnerabilities.filter((_, index) => {
        const vulnerabilityId = `vulnerability-${index}`;
        return checkedVulnerabilities.has(vulnerabilityId);
      });

      // Create items from selected vulnerabilities. Each field is templated
      // via translation keys keyed on `kind`, so a Japanese todo says
      // "脆弱性: …" not "Vulnerable package: …".
      const todoItems = selectedVulnerabilities.map((vulnerability) => {
        const remediation = displayRemediation(vulnerability, t);
        return {
          title: t('builder_settings_security_results_suggested_fix', {
            severity: severityLabel(vulnerability.severity, t),
            title: displayTitle(vulnerability, t),
          }),
          description: `${displayDescription(vulnerability, t)}${
            remediation.length > 0
              ? `\n${t('builder_settings_security_results_suggested_remediation')}:\n${remediation.map((item) => `- ${item}`).join('\n')}`
              : ''
          }`,
        };
      });

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
        title: t('builder_settings_security_quick_fix_create_failed_title'),
        children: t('builder_settings_security_quick_fix_create_failed_description'),
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

  // Success when no listed critical/high vulns and no failed tests (matches what the UI surfaces).
  const hasIssues =
    visibleVulnerabilities.length > 0 || failedTests.length > 0;

  return (
    <Box gap="lg" className="p-1.5">
      {!hasIssues && <SecuritySuccessScreen />}

      {visibleVulnerabilities.length > 0 && (
        <Box gap="md">
          <Box gap="sm">
            <div className="flex min-w-0 flex-col gap-2 @md:flex-row @md:items-center @md:justify-between @md:gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 flex-row flex-wrap items-center gap-0.5">
                  <text.h3 as="title" className="min-w-0" size={2}>
                    {t('builder_settings_security_results_title')} ({visibleVulnerabilities.length})
                  </text.h3>
                </div>
                {isSecurityScanUiEnabled && (
                  <div className="flex min-w-0 flex-row items-center gap-1 mb-2">
                    <InfoIcon className="size-2.5 shrink-0 text-intents-ux-textSubtle-textColor" />
                    <text.p emphasis="passive" size={-1} className="min-w-0">
                      {t('builder_settings_security_fix_credits_note')}
                    </text.p>
                  </div>
                )}
              </div>
              <div className="grid min-w-0 w-full grid-cols-2 gap-2 @md:flex @md:w-auto @md:flex-row @md:flex-nowrap @md:justify-end">
                <Button
                  className="min-w-0 w-full justify-center @md:w-auto"
                  size="sm"
                  design="secondary"
                  disabled={isCreatingTodoList}
                  onClick={handleSelectAll}
                  text={areAllSelected() ? t('builder_common_deselect_all') : t('builder_common_select_all')}
                />
                <Button
                  className="min-w-0 w-full justify-center @md:w-auto"
                  size="sm"
                  design="primary"
                  onClick={handleQuickFix}
                  disabled={checkedVulnerabilities.size === 0 || isCreatingTodoList}
                  text={
                    isCreatingTodoList
                      ? t('builder_common_creating')
                      : t('builder_settings_security_ask_airo_to_fix')
                  }
                />
              </div>
            </div>
            <text.p emphasis="passive" size={-1} className="min-w-0">
              {t('builder_settings_security_results_list_scope_note')}
            </text.p>
          </Box>
          <div className="grid gap-2">
            {visibleVulnerabilities.map((vulnerability, index) => {
              const vulnerabilityId = `vulnerability-${index}`;
              return (
                <SecurityVulnerabilityCard
                  key={vulnerabilityId}
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
