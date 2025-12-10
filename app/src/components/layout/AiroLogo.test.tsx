import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import { AiroLogo } from './AiroLogo';

describe('AiroLogo', () => {
  it('should render without crashing', () => {
    renderWithProviders(<AiroLogo />);

    const logo = screen.getByLabelText('Airo Logo');
    expect(logo).toBeInTheDocument();
  });

  it('should render with default props', () => {
    renderWithProviders(<AiroLogo />);

    const logo = screen.getByLabelText('Airo Logo');
    expect(logo).toHaveAttribute('width', '51');
    expect(logo).toHaveAttribute('height', '24');
  });

  it('should render with custom aria label', () => {
    renderWithProviders(<AiroLogo ariaLabel="Custom Logo" />);

    const logo = screen.getByLabelText('Custom Logo');
    expect(logo).toBeInTheDocument();
  });

  it('should render with custom dimensions', () => {
    renderWithProviders(<AiroLogo width={100} height={48} />);

    const logo = screen.getByLabelText('Airo Logo');
    expect(logo).toHaveAttribute('width', '100');
    expect(logo).toHaveAttribute('height', '48');
  });

  it('should apply custom className', () => {
    renderWithProviders(<AiroLogo className="custom-class" />);

    const logo = screen.getByLabelText('Airo Logo');
    expect(logo).toHaveClass('custom-class');
  });

  it('should render color design with gradient', () => {
    const { container } = renderWithProviders(<AiroLogo design="color" />);

    const gradient = container.querySelector('#paint0_radial_1125_4947');
    expect(gradient).toBeInTheDocument();
  });

  it('should render dark design without gradient', () => {
    const { container } = renderWithProviders(<AiroLogo design="dark" />);

    const gradient = container.querySelector('#paint0_radial_1125_4947');
    expect(gradient).not.toBeInTheDocument();
  });

  it('should render light design without gradient', () => {
    const { container } = renderWithProviders(<AiroLogo design="light" />);

    const gradient = container.querySelector('#paint0_radial_1125_4947');
    expect(gradient).not.toBeInTheDocument();
  });
});
