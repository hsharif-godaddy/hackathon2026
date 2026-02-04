/**
 * Security Results Step
 *
 * Shows security scan results with vulnerabilities found
 * Allows user to publish fixes or skip
 */
'use client';

import Alert from '@ux/alert';
import Button from '@ux/button';
import Spinner from '@ux/spinner';
import text from '@ux/text';

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
      <div>
        <div className="mb-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">{t('golive_security_scanning_title')}</h3>
            <text.p as="paragraph" size={0}>
              {t('golive_security_scanning_description')}
            </text.p>
          </div>

          <Alert emphasis="info">
            <div className="text-sm flex items-center gap-2">
              <Spinner size="sm" />
              <span>{t('golive_security_scanning')}</span>
            </div>
          </Alert>
        </div>

        <div className="flex gap-2 justify-end">
          <Button
            design="primary"
            text={t('golive_security_button_continue')}
            onClick={onSkip}
            disabled={true}
          />
        </div>
      </div>
    );
  }

  // Handle scan failure case
  if (securityStatus === 'failed' && securityError) {
    return (
      <div>
        <div className="mb-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">{t('golive_security_failed_title')}</h3>
            <text.p as="paragraph" size={0}>
              {t('golive_security_failed_details')}
            </text.p>
          </div>

          <Alert emphasis="critical">
            <div className="text-sm">
              <strong>{t('golive_security_error_label')}</strong> {securityError}
            </div>
          </Alert>
        </div>

        <div className="flex gap-2 justify-end">
          <Button
            design="primary"
            text={t('golive_security_button_continue_anyway')}
            onClick={onSkip}
          />
        </div>
      </div>
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
      <div>
        <div className="mb-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">{t('golive_security_clean_title')}</h3>
            <text.p as="paragraph" size={0}>
              {t('golive_security_clean_subtitle')}
            </text.p>
          </div>

          <Alert emphasis="success">
            <div className="text-sm">
              <strong>{t('golive_security_clean_label')}</strong> {t('golive_security_clean_description')}
            </div>
          </Alert>
        </div>

        <div className="flex gap-2 justify-end">
          <Button
            design="primary"
            text={t('golive_security_button_continue')}
            onClick={onSkip}
          />
        </div>
      </div>
    );
  }

  // Handle vulnerabilities found case
  return (
    <div>

      <div className="mb-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">{t('golive_security_issues_title')}</h3>
          <text.p as="paragraph" size={0}>
            {totalIssues === 1
              ? t('golive_security_issues_found_singular')
              : t('golive_security_issues_found_plural', { count: totalIssues })}
          </text.p>
        </div>

        {/* Summary */}
        <div className="bg-intents-ux-boxLowContrast-backgroundColor rounded-md p-3">
          <div className="text-sm font-semibold mb-2">{t('golive_security_summary_label')}</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {summary.critical > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                <span>{t('golive_security_severity_critical')}: {summary.critical}</span>
              </div>
            )}
            {summary.high > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                <span>{t('golive_security_severity_high')}: {summary.high}</span>
              </div>
            )}
            {summary.moderate > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                <span>{t('golive_security_severity_moderate')}: {summary.moderate}</span>
              </div>
            )}
            {summary.low > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                <span>{t('golive_security_severity_low')}: {summary.low}</span>
              </div>
            )}
          </div>
        </div>

        {/* Vulnerabilities List - show first 5 */}
        {vulnerabilities.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {vulnerabilities.slice(0, 5).map((vuln, index) => (
              <div key={index} className="bg-intents-ux-boxLowContrast-backgroundColor rounded p-2">
                <div className="flex items-start gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                    vuln.severity === 'critical' ? 'bg-red-100 text-red-800' :
                    vuln.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                    vuln.severity === 'moderate' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {vuln.severity.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <text.p as="paragraph" size={0} className="font-semibold">
                      {vuln.title}
                    </text.p>
                    {vuln.description && (
                      <text.p as="paragraph" size={-1} emphasis="passive" className="mt-0.5">
                        {vuln.description}
                      </text.p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {vulnerabilities.length > 5 && (
              <text.p as="paragraph" size={-1} emphasis="passive" className="text-center">
                {t('golive_security_more_issues', { count: vulnerabilities.length - 5 })}
              </text.p>
            )}
          </div>
        )}

        {/* Action recommendation */}
        {hasCriticalOrHigh && (
          <Alert emphasis="critical">
            <div className="text-sm">
              <strong>{t('golive_security_action_required_label')}</strong> {t('golive_security_action_required_description')}
            </div>
          </Alert>
        )}
      </div>

      <div className="flex gap-2 justify-end">
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
      </div>
    </div>
  );
}
