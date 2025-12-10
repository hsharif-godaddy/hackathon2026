import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import AppInactivityAlert from './AppInactivityAlert';

describe('AppInactivityAlert', () => {
  it('should render without crashing', () => {
    renderWithProviders(<AppInactivityAlert />);

    expect(screen.getByText('Heads up!')).toBeInTheDocument();
  });

  it('should display warning message', () => {
    renderWithProviders(<AppInactivityAlert />);

    expect(screen.getByText(/Apps that haven't been changed or published in 7 days/i)).toBeInTheDocument();
  });

  it('should render as highlight alert', () => {
    const { container } = renderWithProviders(<AppInactivityAlert />);

    // Check that the Alert component is rendered
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeInTheDocument();
  });
});
