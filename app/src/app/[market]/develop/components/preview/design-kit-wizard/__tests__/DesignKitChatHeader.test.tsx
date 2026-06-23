// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DesignKitChatHeader } from '../DesignKitChatHeader';

// Pin the appId so the click-context assertion is deterministic.
vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: (): string => 'app1234567',
}));

// useTranslations needs no provider here — return the key for the beta tag.
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: (): ((key: string) => string) => (key: string): string => key,
}));

// next/link's app-router context is absent in unit tests; render a plain anchor.
vi.mock('next/link', () => ({
  default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>): ReactElement => (
    <a {...props}>{children}</a>
  ),
}));

// UserMenu pulls in auth/venture/query deps; stub it to a marker.
vi.mock('@/components/layout/UserMenu', () => ({
  default: (): ReactElement => <div data-testid="user-menu">user menu</div>,
}));

// @ux/tag renders fine in jsdom but stub it for isolation/speed.
vi.mock('@ux/tag', () => ({
  default: ({ children }: { children?: ReactNode }): ReactElement => (
    <span data-testid="beta-tag">{children}</span>
  ),
}));

const logClickEvent = vi.fn(() => vi.fn());
vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: (...args: unknown[]): (() => void) => logClickEvent(...args),
}));

describe('DesignKitChatHeader', () => {
  it('renders the minimal bar: home-linked Airo logo, beta tag, and the user menu', () => {
    render(<DesignKitChatHeader />);

    expect(screen.getByTestId('design-kit-chat-header')).toBeInTheDocument();
    expect(screen.getByLabelText('Airo Logo')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('user-menu')).toBeInTheDocument();
  });

  it('does not render the develop chrome (no preview/edit toggles or chat toolbar)', () => {
    render(<DesignKitChatHeader />);

    expect(screen.queryByTestId('chat-toolbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview|edit|code/i })).not.toBeInTheDocument();
  });

  it('logs the airo home-link click', async () => {
    const user = userEvent.setup();
    render(<DesignKitChatHeader />);

    await user.click(screen.getByRole('link'));

    expect(logClickEvent).toHaveBeenCalledWith('develop.header.airo_ai_link', { appId: 'app1234567' });
  });
});
