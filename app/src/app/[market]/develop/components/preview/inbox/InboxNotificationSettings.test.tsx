/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Growl from '@ux/growl';

import { InboxNotificationSettings } from './InboxNotificationSettings';

const BRAND = '550e8400-e29b-41d4-a716-446655440000';

const mockToggleMutate = vi.fn();
const mockEmailMutate = vi.fn();
const useInboxStaff = vi.fn();
const useInboxEmailNotifications = vi.fn();

vi.mock('../../../hooks/useInbox', () => ({
  useInboxStaff: (...args: unknown[]) => useInboxStaff(...args),
  useInboxEmailNotifications: (...args: unknown[]) => useInboxEmailNotifications(...args),
  useUpdateStaffNotificationEmail: () => ({ mutate: mockEmailMutate, isPending: false }),
  useUpdateEmailNotifications: () => ({ mutate: mockToggleMutate, isPending: false }),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => {
      ['initial', 'animate', 'exit', 'transition', 'custom'].forEach((k) => delete rest[k]);
      return <div {...rest}>{children}</div>;
    },
  },
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (_key: string, _vals?: unknown, fallback?: string) => fallback ?? _key,
}));

vi.mock('@ux/growl', () => ({ default: { addGrowlMessage: vi.fn() } }));

vi.mock('@ux/toggle-button', () => ({
  default: ({
    active,
    disabled,
    onClick,
    ...rest
  }: {
    active?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button
      role='switch'
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    />
  ),
}));

vi.mock('@ux/text-input', () => ({
  default: ({
    value,
    onChange,
    errorMessage,
    invalid: _invalid,
    ...rest
  }: {
    value?: string;
    onChange?: (val: string) => void;
    errorMessage?: string;
    invalid?: boolean;
    [key: string]: unknown;
  }) => (
    // The real @ux/text-input passes the input value as a string directly to
    // onChange (not a DOM event), so the mock bridges e.target.value → onChange
    // to honour that contract while still working with fireEvent.change in tests.
    // `errorMessage` is rendered alongside so the inline validation hint is
    // assertable; `invalid` is destructured off to keep it off the DOM node.
    <>
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      />
      {errorMessage ? <span data-testid='inbox-notification-email-error'>{errorMessage}</span> : null}
    </>
  ),
}));

vi.mock('@ux/button', () => ({
  default: ({
    text,
    icon,
    disabled,
    onClick,
    ...rest
  }: {
    text?: string;
    icon?: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button disabled={disabled} onClick={onClick} {...rest}>
      {text ?? icon}
    </button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useInboxStaff.mockReturnValue({ data: { id: 7, notificationEmail: 'a@b.com' }, isLoading: false });
  useInboxEmailNotifications.mockReturnValue({ data: { emailNotifications: true }, isLoading: false });
});

function openPanel() {
  render(<InboxNotificationSettings brandId={BRAND} />);
  fireEvent.click(screen.getByTestId('inbox-manage-notifications'));
}

describe('InboxNotificationSettings', () => {
  it('renders the current notification email from the staff query', () => {
    openPanel();
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
  });

  it('toggling email notifications calls the mutation with the negated value', () => {
    openPanel();
    fireEvent.click(screen.getByTestId('inbox-email-notifications-toggle'));
    expect(mockToggleMutate).toHaveBeenCalledWith(false, expect.objectContaining({ onError: expect.any(Function) }));
  });

  it('disables Save when the email is unchanged', () => {
    openPanel();
    fireEvent.click(screen.getByLabelText('Email Notification settings'));
    expect(screen.getByTestId('inbox-notification-edit-email-save')).toBeDisabled();
  });

  it('enables Save once the email is edited, and saves on click', () => {
    openPanel();
    fireEvent.click(screen.getByLabelText('Email Notification settings'));
    fireEvent.change(screen.getByTestId('inbox-notification-email-input'), {
      target: { value: 'new@b.com' },
    });
    const save = screen.getByTestId('inbox-notification-edit-email-save');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(mockEmailMutate).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 7, notificationEmail: 'new@b.com' }),
      expect.anything(),
    );
  });

  it('keeps Save disabled and shows an inline error for a malformed email', () => {
    openPanel();
    fireEvent.click(screen.getByLabelText('Email Notification settings'));
    fireEvent.change(screen.getByTestId('inbox-notification-email-input'), {
      target: { value: 'garbage' },
    });
    expect(screen.getByTestId('inbox-notification-edit-email-save')).toBeDisabled();
    expect(screen.getByTestId('inbox-notification-email-error')).toBeInTheDocument();
    expect(mockEmailMutate).not.toHaveBeenCalled();
  });

  it('clears the inline error and enables Save once the email is valid', () => {
    openPanel();
    fireEvent.click(screen.getByLabelText('Email Notification settings'));
    const input = screen.getByTestId('inbox-notification-email-input');
    fireEvent.change(input, { target: { value: 'garbage' } });
    expect(screen.getByTestId('inbox-notification-email-error')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'valid@b.com' } });
    expect(screen.queryByTestId('inbox-notification-email-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('inbox-notification-edit-email-save')).toBeEnabled();
  });

  it('resets to the list view when the popover is closed and reopened', () => {
    render(<InboxNotificationSettings brandId={BRAND} />);
    fireEvent.click(screen.getByTestId('inbox-manage-notifications')); // open
    fireEvent.click(screen.getByLabelText('Email Notification settings')); // -> edit-email
    expect(screen.getByTestId('inbox-notification-edit-email-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('inbox-manage-notifications')); // toggle closed
    fireEvent.click(screen.getByTestId('inbox-manage-notifications')); // reopen
    expect(screen.getByTestId('inbox-notification-settings-list')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-notification-edit-email-panel')).not.toBeInTheDocument();
  });

  it('shows a success Growl and returns to the list view after a successful email save', () => {
    mockEmailMutate.mockImplementation(
      (_payload: unknown, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess();
      },
    );
    openPanel();
    fireEvent.click(screen.getByLabelText('Email Notification settings'));
    fireEvent.change(screen.getByTestId('inbox-notification-email-input'), {
      target: { value: 'new@b.com' },
    });
    fireEvent.click(screen.getByTestId('inbox-notification-edit-email-save'));
    expect(vi.mocked(Growl.addGrowlMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'inbox-notification-email-save-success',
        emphasis: 'success',
      }),
    );
    expect(screen.getByTestId('inbox-notification-settings-list')).toBeInTheDocument();
  });

  it('shows an error Growl when the email save fails', () => {
    mockEmailMutate.mockImplementation(
      (_payload: unknown, { onError }: { onError: () => void }) => {
        onError();
      },
    );
    openPanel();
    fireEvent.click(screen.getByLabelText('Email Notification settings'));
    fireEvent.change(screen.getByTestId('inbox-notification-email-input'), {
      target: { value: 'new@b.com' },
    });
    fireEvent.click(screen.getByTestId('inbox-notification-edit-email-save'));
    expect(vi.mocked(Growl.addGrowlMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'inbox-notification-email-save-error',
        emphasis: 'critical',
      }),
    );
  });

  it('disables the edit-email chevron while staff is loading', () => {
    useInboxStaff.mockReturnValue({ data: undefined, isLoading: true });
    openPanel();
    expect(screen.getByLabelText('Email Notification settings')).toBeDisabled();
  });

  it('shows an error Growl when the toggle mutation fails', () => {
    mockToggleMutate.mockImplementation((_val: unknown, opts?: { onError?: () => void }) => opts?.onError?.());
    openPanel();
    fireEvent.click(screen.getByTestId('inbox-email-notifications-toggle'));
    expect(vi.mocked(Growl.addGrowlMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ emphasis: 'critical' }),
    );
  });
});
