// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { InboxUnreadBadge } from './InboxUnreadBadge';

describe('InboxUnreadBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<InboxUnreadBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when count is negative', () => {
    const { container } = render(<InboxUnreadBadge count={-3} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the exact count when at or below the cap', () => {
    render(<InboxUnreadBadge count={7} />);
    expect(screen.getByTestId('inbox-unread-badge')).toHaveTextContent('7');
  });

  it('renders 99 at the cap boundary', () => {
    render(<InboxUnreadBadge count={99} />);
    expect(screen.getByTestId('inbox-unread-badge')).toHaveTextContent('99');
  });

  it('renders 99+ above the cap', () => {
    render(<InboxUnreadBadge count={150} />);
    // Exact match (not substring) so a regression like "99+5" can't pass.
    expect(screen.getByTestId('inbox-unread-badge').textContent).toBe('99+');
  });

  it('is hidden from assistive tech', () => {
    render(<InboxUnreadBadge count={3} />);
    expect(screen.getByTestId('inbox-unread-badge')).toHaveAttribute('aria-hidden', 'true');
  });
});
