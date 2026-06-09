/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import {
  AnalyticsPeriodPicker,
  type AnalyticsPeriodValue,
} from '@/components/analytics/AnalyticsPeriodPicker';
import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@ux/flyout', () => ({
  default: function MockFlyout({
    children,
    onClose,
  }: {
    children: ReactNode;
    onClose?: () => void;
  }) {
    return (
      <div data-testid="mock-flyout-root">
        <button type="button" data-testid="mock-flyout-dismiss" onClick={onClose}>
          dismiss
        </button>
        {children}
      </div>
    );
  },
}));

vi.mock('@ux/button', () => ({
  default: function MockButton({
    onClick,
    disabled,
    text,
  }: {
    onClick?: () => void;
    disabled?: boolean;
    text?: ReactNode;
  }) {
    return (
      <button type="button" onClick={onClick} disabled={disabled}>
        {text}
      </button>
    );
  },
}));

const committedValue: AnalyticsPeriodValue = {
  preset: '7',
  customFromDate: '2024-01-01',
  customToDate: '2024-01-31',
};

function renderPicker(
  value: AnalyticsPeriodValue = committedValue,
  onChange: ReturnType<typeof vi.fn> = vi.fn(),
) {
  const result = renderWithProviders(
    <AnalyticsPeriodPicker value={value} onChange={onChange} />,
  );
  return { ...result, onChange, value };
}

async function openCustomFlyout(user: ReturnType<typeof renderWithProviders>['user']) {
  await user.click(screen.getByTestId('analytics-period-custom-trigger'));
  expect(screen.getByTestId('analytics-period-custom-flyout')).toBeInTheDocument();
}

describe('AnalyticsPeriodPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('custom flyout dismiss', function dismissTests() {
    it('should revert segment and draft dates when dismissed without apply', async function revertOnDismiss() {
      const { user } = renderPicker();

      await openCustomFlyout(user);
      fireEvent.change(screen.getByLabelText('builder_analytics_period_from'), {
        target: { value: '2024-06-01' },
      });
      expect(screen.getByLabelText('builder_analytics_period_from')).toHaveValue('2024-06-01');

      await user.click(screen.getByTestId('mock-flyout-dismiss'));

      expect(screen.getByRole('radio', { name: 'builder_analytics_last_7_days' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.queryByTestId('mock-flyout-root')).not.toBeInTheDocument();

      await openCustomFlyout(user);
      expect(screen.getByLabelText('builder_analytics_period_from')).toHaveValue('2024-01-01');
      expect(screen.getByLabelText('builder_analytics_period_to')).toHaveValue('2024-01-31');
    });
  });

  describe('canApply gating', function applyGatingTests() {
    it('should disable Apply when To is before From', async function invalidRange() {
      const { user } = renderPicker();

      await openCustomFlyout(user);
      fireEvent.change(screen.getByLabelText('builder_analytics_period_from'), {
        target: { value: '2024-06-15' },
      });
      fireEvent.change(screen.getByLabelText('builder_analytics_period_to'), {
        target: { value: '2024-06-01' },
      });

      expect(screen.getByRole('button', { name: 'builder_analytics_period_apply' })).toBeDisabled();
    });
  });

  describe('from date auto-correct', function autoCorrectTests() {
    it('should move To forward when From is set after To', async function bumpToDate() {
      const { user } = renderPicker();

      await openCustomFlyout(user);
      fireEvent.change(screen.getByLabelText('builder_analytics_period_to'), {
        target: { value: '2024-06-10' },
      });
      fireEvent.change(screen.getByLabelText('builder_analytics_period_from'), {
        target: { value: '2024-06-20' },
      });

      expect(screen.getByLabelText('builder_analytics_period_to')).toHaveValue('2024-06-20');
    });
  });
});
