import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SecretsPaginatedForm } from '../SecretsPaginatedForm';
import { SECRETS_FORM_HOST_I18N } from '../secretsFormHostLabels';

const HOST_LABELS = {
  backLabel: SECRETS_FORM_HOST_I18N.back,
  continueLabel: SECRETS_FORM_HOST_I18N.continue,
  forwardLabel: SECRETS_FORM_HOST_I18N.forward,
  saveLabel: SECRETS_FORM_HOST_I18N.save,
};

/** Primary footer CTA; chevron uses the same i18n key as continue in production. */
function primaryFooterButton(label: string) {
  const footer = document.querySelector('.airo-input-secrets-paginated-form__footer-actions');
  if (!footer) {
    throw new Error('secrets paginated footer actions not found');
  }
  return within(footer as HTMLElement).getByRole('button', { name: label });
}

beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;

    if (url.includes('/ux-assets/@ux/icon/') || url.includes('img6.wsimg.com')) {
      return Promise.resolve(
        new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        }),
      );
    }

    return Promise.reject(new Error(`Unexpected fetch in SecretsPaginatedForm tests: ${url}`));
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('SecretsPaginatedForm', () => {
  it('renders takeover step field and footer navigation', () => {
    render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="New Secret"
        onClose={() => {}}
        showHeaderClose
      >
        <SecretsPaginatedForm.Step id="STRIPE_KEY" label="STRIPE_KEY:" />
        <SecretsPaginatedForm.Step id="STRIPE_WEBHOOK" label="STRIPE_WEBHOOK:" />
      </SecretsPaginatedForm>,
    );

    expect(screen.getByText('New Secret')).toBeInTheDocument();
    expect(screen.getByLabelText('STRIPE_KEY:')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.back })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: SECRETS_FORM_HOST_I18N.forward }).length).toBeGreaterThanOrEqual(1);
    expect(primaryFooterButton(SECRETS_FORM_HOST_I18N.forward)).toBeInTheDocument();
  });

  it('renders from the steps prop without Step children', () => {
    render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="New Secret"
        onClose={() => {}}
        showHeaderClose
        steps={[
          {
            id: 'API_KEY',
            label: 'API_KEY:',
            placeholder: 'Enter value',
            required: true,
            title: 'API_KEY',
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('API_KEY:')).toBeInTheDocument();
  });

  it('renders show/hide toggle beside the takeover field', () => {
    render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="New Secret"
        onClose={() => {}}
        showHeaderClose
        steps={[
          {
            id: 'API_KEY',
            label: 'API_KEY:',
            placeholder: 'Enter value',
            required: true,
            title: 'API_KEY',
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Show value' })).toBeDisabled();
  });

  it('enables show/hide toggle when the field has a value', async () => {
    const user = userEvent.setup();
    render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="New Secret"
        onClose={() => {}}
        showHeaderClose
        steps={[
          {
            id: 'API_KEY',
            label: 'API_KEY:',
            placeholder: 'Enter value',
            required: true,
            title: 'API_KEY',
          },
        ]}
      />,
    );

    await user.type(screen.getByLabelText('API_KEY:'), 'secret');
    expect(screen.getByRole('button', { name: 'Show value' })).toBeEnabled();
  });

  it('advances to next step when clicking Next Step', async () => {
    const user = userEvent.setup();
    render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="Secrets"
        onClose={() => {}}
        showHeaderClose
      >
        <SecretsPaginatedForm.Step id="KEY_1" label="KEY_1:" />
        <SecretsPaginatedForm.Step id="KEY_2" label="KEY_2:" />
      </SecretsPaginatedForm>,
    );

    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByLabelText('KEY_1:')).toBeInTheDocument();

    await user.type(screen.getByLabelText('KEY_1:'), 'value1');
    await user.click(primaryFooterButton(SECRETS_FORM_HOST_I18N.forward));

    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByLabelText('KEY_2:')).toBeInTheDocument();
  });

  it('preserves draft values when navigating back', async () => {
    const user = userEvent.setup();
    render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="Secrets"
        onClose={() => {}}
        showHeaderClose
      >
        <SecretsPaginatedForm.Step id="KEY_1" label="KEY_1:" />
        <SecretsPaginatedForm.Step id="KEY_2" label="KEY_2:" />
      </SecretsPaginatedForm>,
    );

    // Enter value on first step
    await user.type(screen.getByLabelText('KEY_1:'), 'draft-value');
    await user.click(primaryFooterButton(SECRETS_FORM_HOST_I18N.forward));

    // Go back
    await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.back }));

    // Draft should be restored
    expect(screen.getByLabelText('KEY_1:')).toHaveValue('draft-value');
  });

  it('calls onComplete with all values when submitting on last step', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="Secrets"
        onClose={() => {}}
        showHeaderClose
        onComplete={onComplete}
      >
        <SecretsPaginatedForm.Step id="KEY_1" label="KEY_1:" />
        <SecretsPaginatedForm.Step id="KEY_2" label="KEY_2:" />
      </SecretsPaginatedForm>,
    );

    // Fill first step
    await user.type(screen.getByLabelText('KEY_1:'), 'value1');
    await user.click(primaryFooterButton(SECRETS_FORM_HOST_I18N.forward));

    // Fill second step
    await user.type(screen.getByLabelText('KEY_2:'), 'value2');
    await user.click(primaryFooterButton(SECRETS_FORM_HOST_I18N.save));

    expect(onComplete).toHaveBeenCalledWith({
      KEY_1: 'value1',
      KEY_2: 'value2',
    });
  });

  it('handles async onComplete rejection without crashing', async () => {
    const onComplete = vi.fn().mockRejectedValue(new Error('Save failed'));
    const user = userEvent.setup();
    render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="Secrets"
        onClose={() => {}}
        showHeaderClose
        onComplete={onComplete}
      >
        <SecretsPaginatedForm.Step id="KEY_1" label="KEY_1:" />
      </SecretsPaginatedForm>,
    );

    await user.type(screen.getByLabelText('KEY_1:'), 'value');
    await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));

    expect(onComplete).toHaveBeenCalled();
    // Form should still be visible (not dismissed on error)
    expect(screen.getByLabelText('KEY_1:')).toBeInTheDocument();
  });

  it('dismisses form after successful onComplete', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { container } = render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="Secrets"
        onClose={() => {}}
        showHeaderClose
        onComplete={onComplete}
      >
        <SecretsPaginatedForm.Step id="KEY_1" label="KEY_1:" />
      </SecretsPaginatedForm>,
    );

    await user.type(screen.getByLabelText('KEY_1:'), 'value');
    await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));

    await vi.waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('submits on Enter key press on last step', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="Secrets"
        onClose={() => {}}
        showHeaderClose
        onComplete={onComplete}
      >
        <SecretsPaginatedForm.Step id="KEY_1" label="KEY_1:" />
      </SecretsPaginatedForm>,
    );

    const input = screen.getByLabelText('KEY_1:');
    await user.type(input, 'value');
    await user.type(input, '{Enter}');

    expect(onComplete).toHaveBeenCalledWith({ KEY_1: 'value' });
  });

  it('does not submit when required field is empty', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="Secrets"
        onClose={() => {}}
        showHeaderClose
        onComplete={onComplete}
      >
        <SecretsPaginatedForm.Step id="KEY_1" label="KEY_1:" required />
      </SecretsPaginatedForm>,
    );

    await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));

    expect(onComplete).not.toHaveBeenCalled();
    // Check that save button is disabled (validation blocks submit)
    expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save })).toBeDisabled();
  });

  it('disables navigation buttons while onComplete is pending', async () => {
    let resolveComplete: () => void;
    const onComplete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveComplete = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <SecretsPaginatedForm
        {...HOST_LABELS}
        headerEyebrow="Secrets"
        onClose={() => {}}
        showHeaderClose
        onComplete={onComplete}
      >
        <SecretsPaginatedForm.Step id="KEY_1" label="KEY_1:" />
      </SecretsPaginatedForm>,
    );

    await user.type(screen.getByLabelText('KEY_1:'), 'value');
    await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));

    expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save })).toBeDisabled();

    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();

    resolveComplete!();
  });
});
