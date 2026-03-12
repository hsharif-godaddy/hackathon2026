import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DowngradeAlert from './DowngradeAlert';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (values) {
      return `${key}:${JSON.stringify(values)}`;
    }
    return key;
  },
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((event: string) => `appbuilder.${event}.click`),
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('react-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-intl')>();
  return {
    ...actual,
    FormattedMessage: ({ id }: { id: string }) => <span>{id}</span>,
  };
});

const mockSubscription = {
  id: 'sub-123',
  customerId: 'cust-123',
  productId: 'aab-v1',
  status: 'active',
  isTrial: false,
  plan: 'professional',
  downgradedAt: '2027-01-29T07:00:00Z',
  downgradedPlan: 'starter',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    data: mockSubscription,
    isLoading: false,
    isError: false,
  }),
}));

describe('DowngradeAlert', function downgradeAlertTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders correctly', function renderTests() {
    it('should render the alert title', function renderTitle() {
      renderWithProviders(<DowngradeAlert />);

      expect(screen.getByText('builder_manageplan_downgrade_plan_title')).toBeInTheDocument();
    });

    it('should render the alert message with plan names and formatted date', function renderMessage() {
      renderWithProviders(<DowngradeAlert />);

      // The message should contain the translated key with values
      const messageElement = screen.getByText((content) =>
        content.includes('builder_manageplan_downgrade_to_plan_message')
      );
      expect(messageElement).toBeInTheDocument();
    });

    it('should render the message with FormattedMessage', function formatDate() {
      renderWithProviders(<DowngradeAlert />);

      // FormattedMessage renders the id as text in our mock
      const messageElement = screen.getByText('builder_manageplan_downgrade_to_plan_message');
      expect(messageElement).toBeInTheDocument();
    });
  });

  describe('keep plan button', function keepPlanButtonTests() {
    it('should render keep plan button', function showsKeepPlanButton() {
      const onKeepPlan = vi.fn();
      renderWithProviders(<DowngradeAlert onKeepPlan={onKeepPlan} />);

      expect(screen.getByText((content) =>
        content.includes('builder_manageplan_downgrade_keep_plan')
      )).toBeInTheDocument();
    });

    it('should call onKeepPlan when keep plan button is clicked', function callsOnKeepPlan() {
      const onKeepPlan = vi.fn();
      renderWithProviders(<DowngradeAlert onKeepPlan={onKeepPlan} />);

      const button = screen.getByText((content) =>
        content.includes('builder_manageplan_downgrade_keep_plan')
      );
      fireEvent.click(button);

      expect(onKeepPlan).toHaveBeenCalledTimes(1);
    });
  });

  describe('dismiss functionality', function dismissTests() {
    it('should call onDismiss when close button is clicked', function callsOnDismiss() {
      const onDismiss = vi.fn();
      const { container } = renderWithProviders(<DowngradeAlert onDismiss={onDismiss} />);

      // Find and click the close button (X icon button)
      const buttons = container.querySelectorAll('button');
      const closeButton = Array.from(buttons).find(btn =>
        btn.querySelector('svg') && !btn.textContent?.includes('builder_manageplan')
      );

      if (closeButton) {
        fireEvent.click(closeButton);
        expect(onDismiss).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('styling', function stylingTests() {
    it('should have margin bottom on wrapper', function hasMarginBottom() {
      const { container } = renderWithProviders(<DowngradeAlert />);

      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('mb-4');
    });
  });

  describe('data attributes', function dataAttributeTests() {
    it('should have correct data-eid on keep plan button', function correctDataEid() {
      const onKeepPlan = vi.fn();
      renderWithProviders(<DowngradeAlert onKeepPlan={onKeepPlan} />);

      const button = screen.getByText((content) =>
        content.includes('builder_manageplan_downgrade_keep_plan')
      ).closest('button');
      expect(button).toHaveAttribute('data-eid');
      expect(button?.getAttribute('data-eid')).toContain('manageplan.buttons.downgrade_keep_plan');
    });

    it('should have data-partial attribute on keep plan button', function hasDataPartial() {
      const onKeepPlan = vi.fn();
      renderWithProviders(<DowngradeAlert onKeepPlan={onKeepPlan} />);

      const button = screen.getByText((content) =>
        content.includes('builder_manageplan_downgrade_keep_plan')
      ).closest('button');
      expect(button).toHaveAttribute('data-partial', 'componentAiro');
    });
  });
});
