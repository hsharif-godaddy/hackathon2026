import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import ProjectPanel from './ProjectPanel';

describe('ProjectPanel', () => {
  it('should render without crashing', () => {
    renderWithProviders(<ProjectPanel />);

    expect(screen.getByText('Project Settings')).toBeInTheDocument();
  });

  it('should display project settings heading', () => {
    renderWithProviders(<ProjectPanel />);

    const heading = screen.getByRole('heading', { name: /Project Settings/i });
    expect(heading).toBeInTheDocument();
  });

  it('should render as h1 heading', () => {
    const { container } = renderWithProviders(<ProjectPanel />);

    const h1 = container.querySelector('h1');
    expect(h1).toBeInTheDocument();
    expect(h1).toHaveTextContent('Project Settings');
  });
});
