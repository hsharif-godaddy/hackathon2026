import '@testing-library/jest-dom';

import { describe, expect,it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import AppInactivityAlert from './AppInactivityAlert';

describe('AppInactivityAlert', () => {
  it('should render without crashing', () => {
    renderWithProviders(<AppInactivityAlert />);

    expect(screen.getByText('builder_layout_inactivity_alert_title')).toBeInTheDocument();
  });

  it('should display warning message', () => {
    renderWithProviders(<AppInactivityAlert />);

    expect(screen.getByText('builder_layout_inactivity_alert')).toBeInTheDocument();
  });

  it('should render as highlight alert', () => {
    const { container } = renderWithProviders(<AppInactivityAlert />);

    // Check that the Alert component is rendered
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeInTheDocument();
  });
});
