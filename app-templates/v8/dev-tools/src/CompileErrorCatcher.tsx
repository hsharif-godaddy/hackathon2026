import AiroErrorBoundary from './AiroErrorBoundary';

// Adding backwards compatibility for the old CompileErrorCatcher component
// This points to the new AiroErrorBoundary component that should be used instead

export default AiroErrorBoundary;
export { AiroErrorBoundary as CompileErrorCatcher };

