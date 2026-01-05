import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import ProjectPanel from './ProjectPanel';

describe('ProjectPanel', () => {
  it('should render without crashing', () => {
    renderWithProviders(<ProjectPanel />);

    expect(screen.getByText('Daily Usage')).toBeInTheDocument();
  });

  it('should display usage heading', () => {
    renderWithProviders(<ProjectPanel />);

    const heading = screen.getByRole('heading', { name: /Daily Usage/i });
    expect(heading).toBeInTheDocument();
  });
});
