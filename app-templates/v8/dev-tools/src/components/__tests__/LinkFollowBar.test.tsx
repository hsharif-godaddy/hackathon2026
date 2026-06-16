/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LinkFollowBar } from '../LinkFollowBar';

vi.mock('../../utils/translations', () => ({
  t: vi.fn((_: string, fallback: string) => fallback),
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LinkFollowBar', function packageTests() {
  it('renders link destination and follows on icon click', function iconClick() {
    const onFollow = vi.fn();

    render(
      <LinkFollowBar
        style={{ top: '100px', left: '50px' }}
        target={{ kind: 'link', href: 'https://loom.com/share/abc', displayUrl: 'loom.com/share/abc' }}
        onFollow={onFollow}
      />,
    );

    expect(screen.getByText('Go to: loom.com/share/abc')).toBeTruthy();
    fireEvent.click(screen.getByTestId('devtools-link-follow-icon'));
    expect(onFollow).toHaveBeenCalledTimes(1);
  });

  it('follows on destination click', function destinationClick() {
    const onFollow = vi.fn();

    render(
      <LinkFollowBar
        style={{ top: '100px', left: '50px' }}
        target={{ kind: 'button' }}
        onFollow={onFollow}
      />,
    );

    fireEvent.click(screen.getByTestId('devtools-link-follow-destination'));
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Test button')).toBeTruthy();
  });
});
