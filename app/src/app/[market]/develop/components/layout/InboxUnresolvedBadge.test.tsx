// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { InboxUnresolvedBadge } from './InboxUnresolvedBadge';

describe('InboxUnresolvedBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<InboxUnresolvedBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when count is negative', () => {
    const { container } = render(<InboxUnresolvedBadge count={-3} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the exact count when at or below the cap', () => {
    render(<InboxUnresolvedBadge count={7} />);
    expect(screen.getByTestId('inbox-unresolved-badge')).toHaveTextContent('7');
  });

  it('renders 99 at the cap boundary', () => {
    render(<InboxUnresolvedBadge count={99} />);
    expect(screen.getByTestId('inbox-unresolved-badge')).toHaveTextContent('99');
  });

  it('renders 99+ above the cap', () => {
    render(<InboxUnresolvedBadge count={150} />);
    // Exact match (not substring) so a regression like "99+5" can't pass.
    expect(screen.getByTestId('inbox-unresolved-badge').textContent).toBe('99+');
  });

  it('is hidden from assistive tech', () => {
    render(<InboxUnresolvedBadge count={3} />);
    expect(screen.getByTestId('inbox-unresolved-badge')).toHaveAttribute('aria-hidden', 'true');
  });
});
