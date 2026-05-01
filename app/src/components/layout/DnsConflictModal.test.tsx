/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DnsConflictModal from './DnsConflictModal';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (_key: string, values?: Record<string, string>, defaultMessage?: string) =>
    (defaultMessage ?? '').replace('{fqdn}', values?.fqdn ?? ''),
}));

vi.mock('@ux/modal', () => ({
  default: ({
    actions,
    children,
    onClose,
    title,
  }: {
    actions?: React.ReactNode;
    children: React.ReactNode;
    onClose: () => void;
    title: string;
  }) => (
    <div role='dialog' aria-label={title}>
      <h2>{title}</h2>
      <button onClick={onClose}>Close</button>
      <div>{children}</div>
      <div>{actions}</div>
    </div>
  ),
}));

vi.mock('@ux/checkbox', () => ({
  default: ({
    checked,
    id,
    label,
    name,
    onChange,
  }: {
    checked: boolean;
    id: string;
    label: string;
    name: string;
    onChange: () => void;
  }) => (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        name={name}
        type='checkbox'
        checked={checked}
        onChange={onChange}
      />
    </label>
  ),
}));

describe('DnsConflictModal', function dnsConflictModalTests() {
  const baseProps = {
    fqdn: 'example.com',
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  };

  beforeEach(function resetMocks() {
    vi.clearAllMocks();
  });

  it('renders conflict variant actions', function rendersConflictVariant() {
    renderWithProviders(<DnsConflictModal {...baseProps} variant='conflict' />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Update DNS records' })).toBeInTheDocument();
    expect(
      screen.getByText('Your domain currently points to another service. Update DNS records to direct visitors to your Airo Builder site.')
    ).toBeInTheDocument();
  });

  it('calls onClose when modal close is clicked', function closesModal() {
    renderWithProviders(<DnsConflictModal {...baseProps} variant='conflict' />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm(false) when Publish is clicked without DNS update checked', function confirmsWithoutDnsUpdateByDefault() {
    renderWithProviders(<DnsConflictModal {...baseProps} variant='conflict' />);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(baseProps.onConfirm).toHaveBeenCalledWith(false);
  });

  it('calls onConfirm(true) when Publish with DNS update is checked', function confirmsWithDnsUpdateChecked() {
    renderWithProviders(<DnsConflictModal {...baseProps} variant='conflict' />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Update DNS records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(baseProps.onConfirm).toHaveBeenCalledWith(true);
  });

  it('renders unverified variant actions', function rendersUnverifiedVariant() {
    renderWithProviders(<DnsConflictModal {...baseProps} variant='unverified' />);

    expect(screen.getByRole('heading', { name: "Couldn't verify DNS for example.com" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Update DNS records' })).toBeInTheDocument();
    expect(
      screen.getByText('We could not verify current DNS records. Select Update DNS records below if you want to route traffic to your Airo Builder app.')
    ).toBeInTheDocument();
  });

  it('calls onConfirm(true) for unverified variant when checkbox is selected', function confirmsUnverifiedVariant() {
    renderWithProviders(<DnsConflictModal {...baseProps} variant='unverified' />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Update DNS records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(baseProps.onConfirm).toHaveBeenCalledWith(true);
  });

  it('calls onConfirm(false) for unverified variant when checkbox stays unchecked', function confirmsUnverifiedVariantDefaultUnchecked() {
    renderWithProviders(<DnsConflictModal {...baseProps} variant='unverified' />);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(baseProps.onConfirm).toHaveBeenCalledWith(false);
  });
});
