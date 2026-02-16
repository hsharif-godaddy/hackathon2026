/**
 * Security Results Step
 *
 * Shows security scan results with vulnerabilities found
 * Allows user to publish fixes or skip
 */
'use client';

import { memo } from 'react';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Card, { spaceOptions } from '@ux/card';
import Spinner from '@ux/spinner';
import Tag from '@ux/tag';
import text from '@ux/text';
import TextLockup from '@ux/text-lockup';

import { useTranslations } from '@/hooks/useTranslations';
import type { TaskStatus } from '../types';
import type { SecurityScanResult } from '../types';

interface SecurityResultsStepProps {
  securityStatus: TaskStatus;
  securityScanResults: SecurityScanResult | null;
  securityError?: string | null;
  onPublishFixes: () => void;
  onSkip: () => void;
}

function getSeverityEmphasis(severity: 'critical' | 'high' | 'moderate' | 'low'): 'critical' | 'warning' | 'info' {
  if (severity === 'critical' || severity === 'high') return 'critical';
  if (severity === 'moderate') return 'warning';
  return 'info';
}

const ButtonToolbar = memo(function ButtonToolbar({ children }: { children: React.ReactNode }) {
  return (
    <Box orientation="horizontal" blockAlignChildren="end" gap="md" wrap>
      {children}
    </Box>
  );
});

export function SecurityResultsStep({
  securityStatus,
  securityScanResults,
  securityError,
  onPublishFixes,
  onSkip
}: SecurityResultsStepProps) {
  const t = useTranslations();

  // Handle scan still running case
  if (securityStatus === 'running') {
    return (
      <Box gap="xl">
        <Box gap="md">
          <Spinner size="md" />
          <TextLockup title={t('golive_security_scanning_description')} centered>
            {t('golive_security_scanning')}
          </TextLockup>
        </Box>

        <ButtonToolbar>
          <Button
            design="primary"
            text={t('golive_security_button_continue')}
            onClick={onSkip}
            disabled={true}
            />
        </ButtonToolbar>
      </Box>
    );
  }

  // Handle scan failure case
  if (securityStatus === 'failed' && securityError) {
    return (
      <Box gap="xl">
        <Alert emphasis="critical" title={t('golive_security_failed_title')}>
          <text.p>
            {t('golive_security_failed_details')}
          </text.p>
          <strong>{t('golive_security_error_label')}</strong>
          <text.p emphasis="critical">
            {securityError}
          </text.p>
        </Alert>

        <ButtonToolbar>
          <Button
            design="primary"
            text={t('golive_security_button_continue_anyway')}
            onClick={onSkip}
          />
        </ButtonToolbar>
      </Box>
    );
  }

  // If no results yet, don't show this step
  if (!securityScanResults) {
    return null;
  }

  const { vulnerabilities, summary } = securityScanResults;
  const totalIssues = summary.critical + summary.high + summary.moderate + summary.low;
  const hasCriticalOrHigh = summary.critical > 0 || summary.high > 0;
  
  // Handle "all clear" case - no vulnerabilities found
  if (totalIssues === 0) {
    return (
      <Box gap="xl">
        <Alert emphasis="success" title={t('golive_security_clean_subtitle')}>
          {t('golive_security_clean_description')}
        </Alert>

        <ButtonToolbar>
          <Button
            design="primary"
            text={t('golive_security_button_continue')}
            onClick={onSkip}
          />
        </ButtonToolbar>
      </Box>
    );
  }

  const summaryCardSpace = { block: spaceOptions.MD, inline: spaceOptions.MD };

  // Handle vulnerabilities found case
  return (
    <Box gap="xl">

      {/* Summary */}
      <Box gap="md">
        <text.p>
          {totalIssues === 1
            ? t('golive_security_issues_found_singular')
            : t('golive_security_issues_found_plural', { count: totalIssues })}
        </text.p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1 md:gap-2">
          {summary.critical > 0 && (
            <Card space={summaryCardSpace}>
              <TextLockup 
                eyebrow={
                  <Tag emphasis={getSeverityEmphasis('critical')}>
                    {t('golive_security_severity_critical')}
                  </Tag>
                }
                title={summary.critical}
              />
            </Card>
          )}
          {summary.high > 0 && (
            <Card space={summaryCardSpace}>
              <TextLockup 
                eyebrow={
                  <Tag emphasis={getSeverityEmphasis('high')}>
                    {t('golive_security_severity_high')}
                  </Tag>
                }
                title={summary.high}
              />
            </Card>
          )}
          {summary.moderate > 0 && (
            <Card space={summaryCardSpace}>
              <TextLockup 
                eyebrow={
                  <Tag emphasis={getSeverityEmphasis('moderate')}>
                    {t('golive_security_severity_moderate')}
                  </Tag>
                }
                title={summary.moderate}
              />
            </Card>
          )}
          {summary.low > 0 && (
            <Card space={summaryCardSpace}>
              <TextLockup 
                eyebrow={
                  <Tag emphasis={getSeverityEmphasis('low')}>
                    {t('golive_security_severity_low')}
                  </Tag>
                }
                title={summary.low}
              />
            </Card>
          )}
        </div>
      </Box>

      {/* Vulnerabilities List - show first 5 */}
      {vulnerabilities.length > 0 && (
        <Box gap="sm" className="max-h-24 overflow-y-auto">
          {vulnerabilities.slice(0, 5).map((vuln, index) => (
            <Box
              key={index}
              orientation="horizontal"
              gap="sm"
              blockAlignChildren="spaceBetween"
            >
              <TextLockup size="sm" title={vuln.title} textMaxWidth={false} compact>
                {vuln.description}
              </TextLockup>
              <Tag emphasis={getSeverityEmphasis(vuln.severity)}>
                {vuln.severity.toUpperCase()}
              </Tag>
            </Box>
          ))}
          {vulnerabilities.length > 5 && (
            <text.span size={-1} emphasis="passive">
              {t('golive_security_more_issues', { count: vulnerabilities.length - 5 })}
            </text.span>
          )}
        </Box>
      )}

      {/* Action recommendation */}
      {hasCriticalOrHigh && (
        <Alert emphasis="critical" title={t('golive_security_action_required_label')}>
          {t('golive_security_action_required_description')}
        </Alert>
      )}

      <ButtonToolbar>
        <Button
          design="secondary"
          text={t('golive_security_button_skip')}
          onClick={onSkip}
        />
        <Button
          design="primary"
          text={t('golive_security_button_fix')}
          onClick={onPublishFixes}
        />
      </ButtonToolbar>
    </Box>
  );
}
