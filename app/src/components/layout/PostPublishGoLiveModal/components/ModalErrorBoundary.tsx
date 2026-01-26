/**
 * Error Boundary for Modal Steps
 * Catches rendering errors and displays fallback UI
 */
'use client';

import { AlertCircle } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import Alert from '@ux/alert';
import Button from '@ux/button';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';

interface Props {
  children: ReactNode;
  stepName: string;
  appId?: string;
  onReset?: () => void;
  translations?: {
    title: string;
    description: string;
    tryAgain: string;
  };
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ModalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const { stepName, appId } = this.props;

    logger.error('go-live.modal.render-error', {
      stepName,
      appId,
      error: error.message,
      componentStack: errorInfo.componentStack,
      stack: error.stack
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      const { translations } = this.props;
      const title = translations?.title || 'Something Went Wrong';
      const description = translations?.description || 'An error occurred while rendering this step. Please try again or skip to continue.';
      const tryAgain = translations?.tryAgain || 'Try Again';

      return (
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <AlertCircle style={{ width: '64px', height: '64px', color: '#ef4444', marginBottom: '16px' }} />
          <div className="text-center max-w-md space-y-4">
            <text.h4 size={2} className="font-bold" style={{ color: '#dc2626' }}>
              {title}
            </text.h4>
            <Alert emphasis="critical">
              <div className="text-sm">
                {description}
              </div>
              {this.state.error && (
                <div className="text-xs mt-2 font-mono" style={{ color: '#991b1b' }}>
                  {this.state.error.message}
                </div>
              )}
            </Alert>
            <div className="flex gap-2 justify-center">
              <Button
                design="secondary"
                text={tryAgain}
                onClick={this.handleReset}
              />
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Wrapper component that provides translations to the error boundary
export function ModalErrorBoundaryWithTranslations(props: Omit<Props, 'translations'>) {
  const t = useTranslations();

  const translations = {
    title: t('golive_error_title'),
    description: t('golive_error_description'),
    tryAgain: t('golive_error_button_try_again')
  };

  return <ModalErrorBoundary {...props} translations={translations} />;
}
