import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DomainPurchaseToolRenderer from '../DomainPurchaseToolRenderer';

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

vi.mock('@/app/develop/components/tool-renderers/ToolHeader', () => ({
  default: ({ displayName }: { displayName: string }) => (
    <div data-testid="tool-header">{displayName}</div>
  ),
}));

describe('DomainPurchaseToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseProps = {
    toolName: 'domainPurchase',
    toolId: 'tool-1',
    conversationId: 'conv-1',
    size: 'regular' as const,
  };

  it('should render tool header', () => {
    renderWithProviders(
      <DomainPurchaseToolRenderer
        {...baseProps}
        toolStatus="running"
        input={{}}
        result={null}
        isLastAssistantMessage={true}
      />
    );

    expect(screen.getByTestId('tool-header')).toHaveTextContent('Domain Purchase');
  });

  it('should not render widget when tool is still running', () => {
    renderWithProviders(
      <DomainPurchaseToolRenderer
        {...baseProps}
        toolStatus="running"
        input={{}}
        result={null}
        isLastAssistantMessage={true}
      />
    );

    expect(screen.queryByTestId('domain-purchase-widget')).not.toBeInTheDocument();
  });

  it('should render widget when tool is completed and is last message', () => {
    renderWithProviders(
      <DomainPurchaseToolRenderer
        {...baseProps}
        toolStatus="completed"
        input={{ brandName: 'MyBrand', appId: 'app-123' }}
        result={{ success: true, widgetData: { brandName: 'MyBrand', appId: 'app-123' } }}
        isLastAssistantMessage={true}
      />
    );

    const widget = screen.getByTestId('domain-purchase-widget');
    expect(widget).toBeInTheDocument();
    expect(widget.dataset.brand).toBe('MyBrand');
    expect(widget.dataset.appid).toBe('app-123');
  });

  it('should render summary when completed but not last message', () => {
    renderWithProviders(
      <DomainPurchaseToolRenderer
        {...baseProps}
        toolStatus="completed"
        input={{}}
        result={{ success: true, widgetData: {} }}
        isLastAssistantMessage={false}
      />
    );

    expect(screen.queryByTestId('domain-purchase-widget')).not.toBeInTheDocument();
    expect(screen.getByText('Purchase a new domain')).toBeInTheDocument();
  });

  it('should extract brandName from input when widgetData is missing', () => {
    renderWithProviders(
      <DomainPurchaseToolRenderer
        {...baseProps}
        toolStatus="completed"
        input={{ brandName: 'FromInput' }}
        result={{ success: true }}
        isLastAssistantMessage={true}
      />
    );

    const widget = screen.getByTestId('domain-purchase-widget');
    expect(widget.dataset.brand).toBe('FromInput');
  });

  it('should pass domain prop from widgetData', () => {
    renderWithProviders(
      <DomainPurchaseToolRenderer
        {...baseProps}
        toolStatus="completed"
        input={{}}
        result={{ success: true, widgetData: { domain: 'my-brand.com', appId: 'app-123' } }}
        isLastAssistantMessage={true}
      />
    );

    const widget = screen.getByTestId('domain-purchase-widget');
    expect(widget.dataset.domain).toBe('my-brand.com');
  });
});
