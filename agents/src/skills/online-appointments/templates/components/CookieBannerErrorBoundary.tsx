import { Component, type ErrorInfo, type ReactNode } from "react";

export default class CookieBannerErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_error: unknown): { hasError: boolean } {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn("CookieBanner error boundary caught an error:", error, errorInfo);
  }

  override render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
