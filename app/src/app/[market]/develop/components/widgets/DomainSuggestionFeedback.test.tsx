/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DomainSuggestionFeedback from './DomainSuggestionFeedback';

const { mockSubmitFeedback, mockShipAnalyticsLog } = vi.hoisted(() => ({
  mockSubmitFeedback: vi.fn(),
  mockShipAnalyticsLog: vi.fn(),
}));

// Render translations as their inline fallback so queries can use the English copy.
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values?: unknown, fallback?: string) => fallback ?? key,
}));

vi.mock('@/lib/feedback-client', () => ({
  submitFeedback: (...args: unknown[]) => mockSubmitFeedback(...args),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (eid: string) => eid,
}));

vi.mock('@/app/[market]/develop/components/invocation-feedback', () => ({
  invocationFeedbackActionIconClass: 'icon-class',
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@ux/button', () => ({
  default: ({ children, text, icon, ...props }: any) => (
    <button {...props}>
      {icon}
      {text}
      {children}
    </button>
  ),
}));

vi.mock('@ux/text-input', () => ({
  default: ({ value, onChange, placeholder, id }: any) => (
    <textarea id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock('@ux/icon/thumbs-down', () => ({ default: () => <span data-testid="icon-thumbs-down" /> }));
vi.mock('@ux/icon/thumbs-up', () => ({ default: () => <span data-testid="icon-thumbs-up" /> }));
vi.mock('@ux/icon/thumbs-up-filled', () => ({ default: () => <span data-testid="icon-thumbs-up-filled" /> }));

const POSITIVE_LABEL = 'Suggestions were helpful';
const NEGATIVE_LABEL = 'Suggestions were not helpful';
const THANKS_TEXT = 'Thanks for the feedback!';
const MISMATCH_REASON = "Doesn't match my business";

describe('DomainSuggestionFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitFeedback.mockResolvedValue({ ok: true });
  });

  it('submits positive feedback immediately on thumbs-up', async () => {
    const { user } = renderWithProviders(
      <DomainSuggestionFeedback appId="app-1" messageId="msg-1" conversationId="conv-1" />
    );

    await user.click(screen.getByLabelText(POSITIVE_LABEL));

    await waitFor(() => expect(mockSubmitFeedback).toHaveBeenCalledTimes(1));
    expect(mockSubmitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        feedback: 'positive',
        targetLevel: 'invocation',
        targetId: 'msg-1',
        appId: 'app-1',
        feedbackCategory: 'domain_suggestions',
      })
    );
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'domain.suggestion_feedback.submitted',
      expect.objectContaining({ feedback: 'positive', outcome: 'success', conversationId: 'conv-1' })
    );
    expect(await screen.findByText(THANKS_TEXT)).toBeInTheDocument();
  });

  it('records negative intent on thumbs-down without submitting feedback', async () => {
    const { user } = renderWithProviders(
      <DomainSuggestionFeedback appId="app-1" messageId="msg-1" conversationId="conv-1" />
    );

    await user.click(screen.getByLabelText(NEGATIVE_LABEL));

    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'domain.suggestion_feedback.negative_intent',
      expect.objectContaining({ appId: 'app-1', targetId: 'msg-1', conversationId: 'conv-1' })
    );
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
    expect(screen.getByText(MISMATCH_REASON)).toBeInTheDocument();
  });

  it('reveals the optional text box only after a reason is selected, then submits negative feedback with text', async () => {
    const { user } = renderWithProviders(<DomainSuggestionFeedback appId="app-1" messageId="msg-1" />);

    await user.click(screen.getByLabelText(NEGATIVE_LABEL));
    expect(screen.queryByPlaceholderText('Share your feedback...')).not.toBeInTheDocument();

    await user.click(screen.getByText(MISMATCH_REASON));
    const textbox = screen.getByPlaceholderText('Share your feedback...');
    await user.type(textbox, 'too generic');
    expect(mockSubmitFeedback).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(mockSubmitFeedback).toHaveBeenCalledTimes(1));
    expect(mockSubmitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        feedback: 'negative',
        targetId: 'msg-1',
        feedbackCategory: 'domain_mismatch',
        feedbackText: 'too generic',
        hasDetailedFeedback: true,
      })
    );
    expect(await screen.findByText(THANKS_TEXT)).toBeInTheDocument();
  });

  it('omits feedbackText when the optional box is left empty', async () => {
    const { user } = renderWithProviders(<DomainSuggestionFeedback appId="app-1" messageId="msg-1" />);

    await user.click(screen.getByLabelText(NEGATIVE_LABEL));
    await user.click(screen.getByText('Preferred domain unavailable'));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(mockSubmitFeedback).toHaveBeenCalledTimes(1));
    const submittedInput: Record<string, unknown> = mockSubmitFeedback.mock.calls[0][0];
    expect(submittedInput).toMatchObject({
      feedback: 'negative',
      feedbackCategory: 'domain_unavailable',
      hasDetailedFeedback: true,
    });
    expect(submittedInput).not.toHaveProperty('feedbackText');
  });

  it('does not submit when a thumbs-down is abandoned without choosing a reason', async () => {
    const { user } = renderWithProviders(<DomainSuggestionFeedback appId="app-1" messageId="msg-1" />);

    await user.click(screen.getByLabelText(NEGATIVE_LABEL));

    expect(mockShipAnalyticsLog).toHaveBeenCalledTimes(1);
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'domain.suggestion_feedback.negative_intent',
      expect.any(Object)
    );
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
  });
});
