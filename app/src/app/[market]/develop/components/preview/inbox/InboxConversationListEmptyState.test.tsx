/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { InboxConversationListEmptyState } from './InboxConversationListEmptyState';

const emptyPrompt = vi.hoisted(() => ({
  handleCtaClick: vi.fn(),
  isProcessing: false,
}));

vi.mock('./useInboxEmptyPrompt', () => ({
  useInboxEmptyPrompt: () => emptyPrompt,
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@ux/button', () => ({
  default: ({
    children,
    onClick,
    disabled,
    'data-testid': dataTestid,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    'data-testid'?: string;
  }) => (
    <button data-testid={dataTestid} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

describe('InboxConversationListEmptyState', () => {
  beforeEach(() => {
    emptyPrompt.handleCtaClick.mockReset();
    emptyPrompt.isProcessing = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the setup empty state with both CTAs when both pointers are absent', () => {
    const { container } = render(
      <InboxConversationListEmptyState statusFilter='all' embeddableId={null} categoryId={null} />,
    );

    expect(screen.getByText('builder_inbox_empty_setup_title')).toBeInTheDocument();
    expect(screen.getByText('builder_inbox_empty_body_no_channels')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-empty-cta-add-chat')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-empty-cta-add-form')).toBeInTheDocument();
  });

  it('renders the ready empty state with no CTAs when both pointers are present', () => {
    render(
      <InboxConversationListEmptyState statusFilter='all' embeddableId={789} categoryId='support' />,
    );

    expect(screen.getByText('builder_inbox_empty_ready_title')).toBeInTheDocument();
    expect(screen.getByText('builder_inbox_empty_body_all_channels')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-empty-cta-add-chat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inbox-empty-cta-add-form')).not.toBeInTheDocument();
  });

  it('shows only the contact form CTA when the chat widget exists but the category is absent', () => {
    render(
      <InboxConversationListEmptyState statusFilter='all' embeddableId={789} categoryId={null} />,
    );

    expect(screen.getByText('builder_inbox_empty_body_chat_only')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-empty-cta-add-chat')).not.toBeInTheDocument();
    expect(screen.getByTestId('inbox-empty-cta-add-form')).toBeInTheDocument();
  });

  it('shows only the chat widget CTA when the category exists but the chat widget is absent', () => {
    render(
      <InboxConversationListEmptyState statusFilter='all' embeddableId={null} categoryId='support' />,
    );

    expect(screen.getByText('builder_inbox_empty_body_form_only')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-empty-cta-add-chat')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-empty-cta-add-form')).not.toBeInTheDocument();
  });

  it('routes an empty-state CTA click through the prompt hook', () => {
    render(
      <InboxConversationListEmptyState statusFilter='all' embeddableId={null} categoryId={null} />,
    );

    fireEvent.click(screen.getByTestId('inbox-empty-cta-add-chat'));

    expect(emptyPrompt.handleCtaClick).toHaveBeenCalledWith(
      expect.objectContaining({ eid: 'inbox.empty.cta.add_chat' }),
    );
  });

  it('disables the empty-state CTAs while the hook reports processing', () => {
    emptyPrompt.isProcessing = true;

    render(
      <InboxConversationListEmptyState statusFilter='all' embeddableId={null} categoryId={null} />,
    );

    expect(screen.getByTestId('inbox-empty-cta-add-chat')).toBeDisabled();
    expect(screen.getByTestId('inbox-empty-cta-add-form')).toBeDisabled();
  });

  it('shows the single-line message for a non-"all" filter', () => {
    render(
      <InboxConversationListEmptyState
        statusFilter='unresolved'
        embeddableId={null}
        categoryId={null}
      />,
    );

    expect(screen.getByText('builder_inbox_empty_unresolved')).toBeInTheDocument();
    expect(screen.queryByText('builder_inbox_empty_setup_title')).not.toBeInTheDocument();
  });
});
