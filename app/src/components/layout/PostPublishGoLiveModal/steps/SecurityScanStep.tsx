/**
 * Security scan step for Go Live modal
 * Runs security scan and displays results
 */

import { useState } from 'react';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Spinner from '@ux/spinner';
import Tag from '@ux/tag';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import type { SecurityScanResult } from '../types';

interface SecurityScanStepProps {
  isScanning: boolean;
  scanError: string | null;
  securityScanResults: SecurityScanResult | null;
  isGeneratingVideo: boolean;
  onSkip: () => void;
  onRescan: () => void;
  onFixIssues: () => void;
  onContinue: () => void;
}

export function SecurityScanStep({
  isScanning,
  scanError,
  securityScanResults,
  isGeneratingVideo,
  onSkip,
  onRescan,
  onFixIssues,
  onContinue
}: SecurityScanStepProps) {
  const t = useTranslations();
  const [expandedSeverity, setExpandedSeverity] = useState<string | null>(null);

  const hasIssues = securityScanResults &&
    (securityScanResults.summary.critical > 0 ||
     securityScanResults.summary.high > 0 ||
     securityScanResults.summary.moderate > 0 ||
     securityScanResults.summary.low > 0);

  return (
    <Box gap="lg">
      {/* Header */}
      <Box gap="md">
        <Box orientation="horizontal" gap="md" inlineAlignChildren="center">
          <div className="w-10 h-10 bg-intents-ux-feedbackInfo-backgroundColor rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-intents-ux-feedbackHighContrastInfo-feedbackColor" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <Box gap="sm" className="flex-1">
            <text.h3 as="title" size={1}>
              {t('golive_security_scan_title')}
            </text.h3>
            <text.p as="paragraph" size={0} emphasis="passive">
              {t('golive_security_scan_description')}
            </text.p>
          </Box>
        </Box>
      </Box>

      {/* Scanning State */}
      {isScanning && (
        <Box
          gap="md"
          blockPadding="lg"
          inlinePadding="lg"
          className="bg-intents-ux-feedbackInfo-backgroundColor rounded-lg border border-intents-ux-feedbackInfo-borderColor"
        >
          <Box orientation="horizontal" gap="md" blockAlignChildren="center">
            <Spinner size="md" />
            <Box gap="sm" className="flex-1">
              <text.p as="paragraph" size={1} className="font-semibold">
                {t('golive_security_scan_scanning_title')}
              </text.p>
              <text.p as="paragraph" size={0} emphasis="passive">
                {t('golive_security_scan_scanning_description')}
              </text.p>
            </Box>
          </Box>
        </Box>
      )}

      {/* Error State */}
      {scanError && (
        <>
          <Alert emphasis="critical">
            <Box gap="sm">
              <text.p as="paragraph" size={1} className="font-semibold">
                {t('golive_security_scan_failed_title')}
              </text.p>
              <text.p as="paragraph" size={0}>
                {scanError}
              </text.p>
            </Box>
          </Alert>

          <div className="flex justify-end gap-3">
            <Button design="secondary" text={t('golive_security_scan_button_retry')} size="md" onClick={onRescan} />
            <Button design="primary" text={t('golive_security_scan_button_skip_scan')} size="md" onClick={onSkip} />
          </div>
        </>
      )}

      {/* Results - Issues Found */}
      {securityScanResults && !isScanning && hasIssues && (() => {
        const severityGroups = {
          critical: securityScanResults.vulnerabilities.filter(v => v.severity === 'critical'),
          high: securityScanResults.vulnerabilities.filter(v => v.severity === 'high'),
          moderate: securityScanResults.vulnerabilities.filter(v => v.severity === 'moderate'),
          low: securityScanResults.vulnerabilities.filter(v => v.severity === 'low'),
        };

        const getSeverityConfig = (severity: string) => {
          switch (severity) {
            case 'critical':
              return {
                emphasis: 'critical' as const,
                bgColor: 'bg-intents-ux-feedbackCritical-backgroundColor',
                borderColor: 'border-intents-ux-feedbackCritical-borderColor',
              };
            case 'high':
              return {
                emphasis: 'critical' as const,
                bgColor: 'bg-intents-ux-feedbackWarning-backgroundColor',
                borderColor: 'border-intents-ux-feedbackWarning-borderColor',
              };
            case 'moderate':
              return {
                emphasis: 'warning' as const,
                bgColor: 'bg-intents-ux-feedbackInfo-backgroundColor',
                borderColor: 'border-intents-ux-feedbackInfo-borderColor',
              };
            case 'low':
              return {
                emphasis: 'info' as const,
                bgColor: 'bg-gray-50',
                borderColor: 'border-gray-300',
              };
            default:
              return {
                emphasis: 'neutral' as const,
                bgColor: 'bg-gray-50',
                borderColor: 'border-gray-300',
              };
          }
        };

        return (
          <>
            {/* Accordion for each severity level */}
            <Box gap="sm" className="min-w-0">
              <text.p as="paragraph" size={0} className="font-semibold">
                {securityScanResults.vulnerabilities.length} {securityScanResults.vulnerabilities.length === 1 ? t('golive_security_scan_issues_singular') : t('golive_security_scan_issues_plural')} Found
              </text.p>

              <div className="grid gap-0.5 min-w-0">
                {Object.entries(severityGroups).map(([severity, vulnerabilities]) => {
                  if (vulnerabilities.length === 0) return null;

                  const config = getSeverityConfig(severity);
                  const isExpanded = expandedSeverity === severity;

                  return (
                    <div key={severity} className={`border ${config.borderColor} rounded overflow-hidden min-w-0`}>
                      {/* Accordion Header */}
                      <button
                        onClick={() => setExpandedSeverity(isExpanded ? null : severity)}
                        className={`w-full flex items-center justify-between px-2 py-1.5 ${config.bgColor} hover:opacity-80 transition-opacity min-w-0`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Tag emphasis={config.emphasis} size="sm" className="flex-shrink-0">
                            {severity}
                          </Tag>
                          <text.p as="paragraph" size={0} className="font-medium truncate">
                            {vulnerabilities.length} {vulnerabilities.length === 1 ? t('golive_security_scan_severity_issue_singular') : t('golive_security_scan_severity_issue_plural')}
                          </text.p>
                        </div>
                        <svg
                          className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''} flex-shrink-0 ml-2`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Accordion Content */}
                      {isExpanded && (
                        <div className="px-2 py-1.5 bg-white border-t border-gray-200 overflow-hidden">
                          <div className="grid gap-1 max-h-32 overflow-y-auto overflow-x-hidden">
                            {vulnerabilities.map((vulnerability, index) => (
                              <div
                                key={index}
                                className="p-1.5 rounded bg-gray-50 border border-gray-200 min-w-0"
                              >
                                <text.p as="paragraph" size={0} className="font-medium break-words overflow-wrap-anywhere">
                                  {vulnerability.title}
                                </text.p>
                                {vulnerability.description && (
                                  <text.p as="paragraph" size={0} emphasis="passive" className="mt-0.5 break-words overflow-wrap-anywhere">
                                    {vulnerability.description}
                                  </text.p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Box>

            <text.p as="paragraph" size={0} emphasis="passive" className="px-2">
              {t('golive_security_scan_ai_help')}
            </text.p>

            <div className="flex justify-end gap-3">
              <Button design="secondary" text={t('golive_security_scan_button_skip')} size="md" onClick={onSkip} />
              <Button design="secondary" text={t('golive_security_scan_button_rescan')} size="md" onClick={onRescan} />
              <Button design="primary" text={t('golive_security_scan_button_fix')} size="md" onClick={onFixIssues} />
            </div>
          </>
        );
      })()}

      {/* Results - No Issues (Success) */}
      {securityScanResults && !isScanning && !hasIssues && (
        <>
          <Box
            gap="md"
            blockPadding="lg"
            inlinePadding="lg"
            className="bg-intents-ux-feedbackSuccess-backgroundColor rounded-lg border border-intents-ux-feedbackSuccess-borderColor"
          >
            <Box orientation="horizontal" gap="md" inlineAlignChildren="center">
              <div className="w-12 h-12 bg-intents-ux-feedbackHighContrastSuccess-feedbackColor rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <Box gap="sm" className="flex-1">
                <text.p as="paragraph" size={1} className="font-semibold">
                  {t('golive_security_scan_clean_title')}
                </text.p>
                <text.p as="paragraph" size={0}>
                  {t('golive_security_scan_clean_description')}
                </text.p>
              </Box>
            </Box>
          </Box>

          <div className="flex justify-end gap-3">
            <Button design="secondary" text={t('golive_security_scan_button_skip_to_marketing')} size="md" onClick={onSkip} />
            <Button design="primary" text={t('golive_security_scan_button_continue_to_video')} size="md" onClick={onContinue} disabled={isGeneratingVideo} />
          </div>
        </>
      )}
    </Box>
  );
}
