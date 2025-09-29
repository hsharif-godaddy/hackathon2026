import { Component, ReactNode } from 'react';
import ErrorBoundary from './ErrorBoundary';
import { safePostMessage } from './utils/postMessage';

interface CompileErrorState {
  hasCompileError: boolean;
  compileError?: string;
  errorType: 'runtime' | 'compile' | 'import' | 'syntax';
}

interface CompileErrorCatcherProps {
  children: ReactNode;
}

class CompileErrorCatcher extends Component<CompileErrorCatcherProps, CompileErrorState> {
  private errorEventHandler: ((event: ErrorEvent) => void) | null = null;
  private unhandledRejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null;

  constructor(props: CompileErrorCatcherProps) {
    super(props);
    this.state = {
      hasCompileError: false,
      errorType: 'runtime'
    };
  }

  componentDidMount() {
    // Listen for global JavaScript errors (syntax errors, import errors)
    this.errorEventHandler = (event: ErrorEvent) => {
      console.error('Global error caught:', event);
      
      // Check if it's a compile-related error
      const errorMessage = event.message || '';
      const isCompileError = this.isCompileError(errorMessage, event.error);
      
      if (isCompileError) {
        this.setState({
          hasCompileError: true,
          compileError: this.formatCompileError(errorMessage, event.error),
          errorType: this.getErrorType(errorMessage, event.error)
        });
      }
    };

    // Listen for unhandled promise rejections (import() failures)
    this.unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
      console.error('Unhandled rejection caught:', event);
      
      const reason = event.reason;
      const errorMessage = reason?.message || String(reason);
      
      if (this.isCompileError(errorMessage, reason)) {
        this.setState({
          hasCompileError: true,
          compileError: this.formatCompileError(errorMessage, reason),
          errorType: 'import'
        });
        event.preventDefault(); // Prevent default browser error handling
      }
    };

    window.addEventListener('error', this.errorEventHandler);
    window.addEventListener('unhandledrejection', this.unhandledRejectionHandler);

    // Listen for Vite HMR errors (compile errors during development)
    if (import.meta.hot) {
      import.meta.hot.on('vite:error', (data) => {
        console.error('Vite compile error:', data);
        this.setState({
          hasCompileError: true,
          compileError: this.formatViteError(data),
          errorType: 'compile'
        });
      });
    }
  }

  componentWillUnmount() {
    if (this.errorEventHandler) {
      window.removeEventListener('error', this.errorEventHandler);
    }
    if (this.unhandledRejectionHandler) {
      window.removeEventListener('unhandledrejection', this.unhandledRejectionHandler);
    }
  }

  /**
   * Determine if an error is compile-related
   */
  private isCompileError(message: string, error: any): boolean {
    const compileErrorPatterns = [
      /SyntaxError/i,
      /Unexpected token/i,
      /Unexpected end of input/i,
      /Cannot resolve module/i,
      /Module not found/i,
      /Import.*not found/i,
      /Failed to resolve/i,
      /Invalid regular expression/i,
      /Duplicate declaration/i,
      /Cannot redeclare/i,
      /Transform failed/i
    ];

    const textToCheck = `${message} ${error?.stack || ''}`;
    return compileErrorPatterns.some(pattern => pattern.test(textToCheck));
  }

  /**
   * Determine the specific error type
   */
  private getErrorType(message: string, error: any): 'compile' | 'import' | 'syntax' {
    const textToCheck = `${message} ${error?.stack || ''}`;
    
    if (/Module not found|Cannot resolve|Failed to resolve/i.test(textToCheck)) {
      return 'import';
    }
    if (/SyntaxError|Unexpected token|Unexpected end of input/i.test(textToCheck)) {
      return 'syntax';
    }
    return 'compile';
  }

  /**
   * Format compile error for display - extract only the essential information
   */
  private formatCompileError(message: string, _error?: any): string {
    // Remove React dev messages and stack traces
    let cleanMessage = message
      .replace(/💿 Hey developer 👋[\s\S]*$/m, '')
      .replace(/\n\s*at\s+[\s\S]*$/m, '');
    
    // Remove duplicate lines
    const uniqueLines = cleanMessage.split('\n').filter((line, index, arr) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return arr.findIndex(l => l.trim() === trimmed) === index;
    });
    
    // Extract file location
    const fileMatch = cleanMessage.match(/([^/]*\.tsx?:[0-9]+:[0-9]+)/);
    const fileLocation = fileMatch ? `\n\nFile: ${fileMatch[1]}` : '';
    
    // Get core error message
    const coreError = uniqueLines.find(line => 
      /Unexpected|SyntaxError|Cannot resolve|Module not found|:/.test(line)
    ) || uniqueLines[0] || message;
    
    // Extract code context (lines with | or ^ characters)
    const codeContextStart = cleanMessage.indexOf('|');
    const codeContext = codeContextStart !== -1 
      ? '\n\n' + cleanMessage.substring(codeContextStart)
          .split('\n')
          .filter(line => line.includes('|') || line.includes('^'))
          .slice(0, 5)
          .join('\n')
      : '';
    
    return `${coreError}${codeContext}${fileLocation}`.trim();
  }

  /**
   * Format Vite HMR error for display
   */
  private formatViteError(data: any): string {
    return data?.err?.message 
      ? this.formatCompileError(data.err.message, data.err)
      : 'Unknown compilation error occurred';
  }

  /**
   * Send message to parent window using secure postMessage utility
   */
  private sendMessageToParent = (errorMessage: string) => {
    console.log('Sending error message to parent:', errorMessage);
    try {
      safePostMessage(window.parent, {
        type: 'error-fix-request',
        errorMessage: errorMessage
      });
      console.log('Message sent to parent window via secure postMessage');
    } catch (err) {
      console.error('Failed to send message to parent:', err);
    }
  };

  private handleAskAiroToFix = () => {
    const errorType = 'Compilation Error';
    const errorMessage = `${errorType}: ${this.state.compileError || 'Unknown compilation error'}`;
    
    console.log('Asked Airo to fix error:', errorMessage);
    this.sendMessageToParent(errorMessage);
  };

  private renderCompileErrorUI() {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        backgroundColor: '#ffffff',
        padding: '1rem'
      }}>
        <div style={{ 
          maxWidth: '56rem',
          margin: '0 auto', 
          textAlign: 'center'
        }}>
          <h1 style={{ 
            fontSize: '1.5rem', 
            fontWeight: 'bold', 
            color: '#dc2626', 
            marginBottom: '1rem' 
          }}>
            Something went wrong
          </h1>
          
          <pre style={{ 
            color: '#6b7280',
            marginBottom: '1.5rem',
            backgroundColor: '#f3f4f6',
            padding: '1rem',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            whiteSpace: 'pre-wrap',
            textAlign: 'left',
            maxWidth: '100%',
            overflow: 'auto',
            fontFamily: 'monospace'
          }}>
            {this.formatCompileError(this.state.compileError || '', null)}
          </pre>
          
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={this.handleAskAiroToFix}
              style={{
                backgroundColor: '#6b46c1',
                color: 'white',
                padding: '0.5rem 1rem',
                borderRadius: '0.375rem',
                border: 'none',
                cursor: 'pointer',
                transition: 'background-color 0.2s ease-in-out',
                fontSize: '0.875rem',
                fontWeight: '500'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#5a32b0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#6b46c1';
              }}
            >
              Ask Airo to fix code
            </button>
          </div>
        </div>
      </div>
    );
  }

  render() {
    if (this.state.hasCompileError && this.state.compileError) {
      return this.renderCompileErrorUI();
    }

    return (
      <ErrorBoundary>
        {this.props.children}
      </ErrorBoundary>
    );
  }
}

export default CompileErrorCatcher;
