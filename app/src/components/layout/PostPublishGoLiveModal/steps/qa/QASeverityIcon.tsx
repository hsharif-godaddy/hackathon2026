/**
 * QA Severity Icon Component
 * Displays the appropriate icon for each issue severity level
 */
import AlertIcon from '@ux/icon/alert';
import InformationIcon from '@ux/icon/information';

import type { QAIssue } from '@/types/qa';

interface QASeverityIconProps {
  severity: QAIssue['severity'];
  size?: number;
}

export function QASeverityIcon({ severity, size = 16 }: QASeverityIconProps) {
  const style = { width: size, height: size };

  switch (severity) {
    case 'error':
      return <AlertIcon style={{ ...style }} className="text-intents-ux-feedbackHighContrastCritical-feedbackColor" />;
    case 'warning':
      return <AlertIcon style={{ ...style }} className="text-intents-ux-feedbackHighContrastWarning-feedbackColor" />;
    case 'suggestion':
      return <InformationIcon style={{ ...style }} className="text-intents-ux-feedbackHighContrastInfo-feedbackColor" />;
  }
}
