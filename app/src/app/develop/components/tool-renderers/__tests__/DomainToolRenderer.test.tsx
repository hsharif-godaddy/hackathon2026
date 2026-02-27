import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DomainToolRenderer from '../DomainToolRenderer';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _params: any, fallback: string) => fallback || key,
}));

vi.mock('@/app/develop/components/widgets/DomainPurchaseWidget', () => ({
  default: ({ brandName, domain, appId }: { brandName?: string; domain?: string; appId?: string }) => (
    <div data-testid="domain-purchase-widget" data-brand={brandName} data-domain={domain} data-appid={appId}>
      DomainPurchaseWidget
    </div>
  ),
}));

vi.mock('@/app/develop/components/widgets/DomainAttachWidget', () => ({
  default: ({ brandName, appId }: { brandName?: string; appId?: string }) => (
    <div data-testid="domain-attach-widget" data-brand={brandName} data-appid={appId}>
      DomainAttachWidget
    </div>
  ),
}));

vi.mock('@/app/develop/components/tool-renderers/ToolHeader', () => ({
  default: ({ displayName }: { displayName: string }) => (
    <div data-testid="tool-header">{displayName}</div>
  ),
}));

describe('DomainToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseProps = {
    toolName: 'domainPurchase',
    toolId: 'tool-1',
    conversationId: 'conv-1',
    size: 'regular' as const,
  };

  describe('purchase action', () => {
    it('should render purchase tool header', () => {
      renderWithProviders(
        <DomainToolRenderer
          {...baseProps}
          toolStatus="running"
          input={{ action: 'purchase' }}
          result={null}
          isLastAssistantMessage={true}
        />
      );

      expect(screen.getByTestId('tool-header')).toHaveTextContent('Domain Purchase');
    });

    it('should not render widget when tool is still running', () => {
      renderWithProviders(
        <DomainToolRenderer
          {...baseProps}
          toolStatus="running"
          input={{ action: 'purchase' }}
          result={null}
          isLastAssistantMessage={true}
        />
      );

      expect(screen.queryByTestId('domain-purchase-widget')).not.toBeInTheDocument();
    });

    it('should render purchase widget when completed and is last message', () => {
      renderWithProviders(
        <DomainToolRenderer
          {...baseProps}
          toolStatus="completed"
          input={{ action: 'purchase', brandName: 'MyBrand', appId: 'app-123' }}
          result={{ success: true, widgetData: { type: 'domain-purchase', brandName: 'MyBrand', appId: 'app-123' } }}
          isLastAssistantMessage={true}
        />
      );

      const widget = screen.getByTestId('domain-purchase-widget');
      expect(widget).toBeInTheDocument();
      expect(widget.dataset.brand).toBe('MyBrand');
      expect(widget.dataset.appid).toBe('app-123');
    });

    it('should render purchase summary when completed but not last message', () => {
      renderWithProviders(
        <DomainToolRenderer
          {...baseProps}
          toolStatus="completed"
          input={{ action: 'purchase' }}
          result={{ success: true, widgetData: { type: 'domain-purchase' } }}
          isLastAssistantMessage={false}
        />
      );

      expect(screen.queryByTestId('domain-purchase-widget')).not.toBeInTheDocument();
      expect(screen.getByText('Purchase a new domain')).toBeInTheDocument();
    });
  });

  describe('attach action', () => {
    it('should render attach tool header', () => {
      renderWithProviders(
        <DomainToolRenderer
          {...baseProps}
          toolStatus="running"
          input={{ action: 'attach' }}
          result={null}
          isLastAssistantMessage={true}
        />
      );

      expect(screen.getByTestId('tool-header')).toHaveTextContent('Domain Attach');
    });

    it('should render attach widget when completed and is last message', () => {
      renderWithProviders(
        <DomainToolRenderer
          {...baseProps}
          toolStatus="completed"
          input={{ action: 'attach', brandName: 'LetterClub' }}
          result={{ success: true, widgetData: { type: 'domain-attach', brandName: 'LetterClub', appId: 'app-456' } }}
          isLastAssistantMessage={true}
        />
      );

      const widget = screen.getByTestId('domain-attach-widget');
      expect(widget).toBeInTheDocument();
      expect(widget.dataset.brand).toBe('LetterClub');
      expect(widget.dataset.appid).toBe('app-456');
    });

    it('should render attach summary when completed but not last message', () => {
      renderWithProviders(
        <DomainToolRenderer
          {...baseProps}
          toolStatus="completed"
          input={{ action: 'attach' }}
          result={{ success: true, widgetData: { type: 'domain-attach' } }}
          isLastAssistantMessage={false}
        />
      );

      expect(screen.queryByTestId('domain-attach-widget')).not.toBeInTheDocument();
      expect(screen.getByText('Connect a domain')).toBeInTheDocument();
    });

    it('should infer attach from widgetData type when action is missing', () => {
      renderWithProviders(
        <DomainToolRenderer
          {...baseProps}
          toolStatus="completed"
          input={{}}
          result={{ success: true, widgetData: { type: 'domain-attach', appId: 'app-789' } }}
          isLastAssistantMessage={true}
        />
      );

      expect(screen.getByTestId('domain-attach-widget')).toBeInTheDocument();
    });

    it('should not render attach widget when result is not successful', () => {
      renderWithProviders(
        <DomainToolRenderer
          {...baseProps}
          toolStatus="completed"
          input={{ action: 'attach' }}
          result={{ success: false, requiresPublish: true, error: 'App must be published' }}
          isLastAssistantMessage={true}
        />
      );

      expect(screen.queryByTestId('domain-attach-widget')).not.toBeInTheDocument();
      expect(screen.queryByText('Connect a domain')).not.toBeInTheDocument();
    });
  });

  describe('failed results', () => {
    it('should not render purchase widget when permission denied', () => {
      renderWithProviders(
        <DomainToolRenderer
          {...baseProps}
          toolStatus="completed"
          input={{ action: 'purchase' }}
          result={{ success: false, error: 'Domain purchase permission not granted' }}
          isLastAssistantMessage={true}
        />
      );

      expect(screen.queryByTestId('domain-purchase-widget')).not.toBeInTheDocument();
      expect(screen.queryByText('Purchase a new domain')).not.toBeInTheDocument();
    });

    it('should not render any widget when result is null', () => {
      renderWithProviders(
        <DomainToolRenderer
          {...baseProps}
          toolStatus="completed"
          input={{ action: 'attach' }}
          result={null}
          isLastAssistantMessage={true}
        />
      );

      expect(screen.queryByTestId('domain-attach-widget')).not.toBeInTheDocument();
    });
  });
});
