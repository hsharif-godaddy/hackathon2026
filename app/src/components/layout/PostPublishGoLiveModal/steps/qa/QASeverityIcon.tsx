/**
 * QA Severity Icon Component
 * Displays the appropriate icon for each issue severity level
 */
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';

import type { QAIssue } from '@/types/qa';

interface QASeverityIconProps {
  severity: QAIssue['severity'];
  size?: number;
}

export function QASeverityIcon({ severity, size = 16 }: QASeverityIconProps) {
  const style = { width: size, height: size };

  switch (severity) {
    case 'error':
      return <AlertCircle style={{ ...style, color: '#ef4444' }} />;
    case 'warning':
      return <AlertTriangle style={{ ...style, color: '#eab308' }} />;
    case 'suggestion':
      return <Info style={{ ...style, color: '#3b82f6' }} />;
  }
}
