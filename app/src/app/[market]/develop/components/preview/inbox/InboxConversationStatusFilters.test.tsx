/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { InboxConversationStatusFilters } from './InboxConversationStatusFilters';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('InboxConversationStatusFilters', () => {
  it('calls onChange with the selected filter when enabled', () => {
    const onChange = vi.fn();
    render(<InboxConversationStatusFilters value='all' onChange={onChange} />);

    // FILTERS order: all, unresolved, pending, resolved.
    fireEvent.click(screen.getAllByRole('checkbox')[1]);

    expect(onChange).toHaveBeenCalledWith('unresolved');
  });

  it('marks the group aria-disabled and ignores selection when disabled', () => {
    const onChange = vi.fn();
    render(<InboxConversationStatusFilters value='all' onChange={onChange} disabled />);

    expect(screen.getByRole('group')).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(screen.getAllByRole('checkbox')[1]);

    expect(onChange).not.toHaveBeenCalled();
  });
});
