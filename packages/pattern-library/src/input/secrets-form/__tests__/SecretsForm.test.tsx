import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SecretsForm, type SecretsFormComposerProps } from '../index';
import { SECRETS_FORM_HOST_I18N } from '../secretsFormHostLabels';

beforeAll(() => {
  // `@ux/icon/async-icon.js` fetches SVG from an asset host; jsdom has no network.
  vi.spyOn(globalThis, 'fetch').mockImplementation(function (input) {
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

    return Promise.reject(new Error(`Unexpected fetch in SecretsForm tests: ${url}`));
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

const BASE: SecretsFormComposerProps = {
  label: 'DISCOGS_TOKEN:',
  helperText: 'Token from discogs.com',
  onClose: vi.fn(),
  submitLabel: SECRETS_FORM_HOST_I18N.save,
};

// Test helper: merges overrides with BASE. Type assertion needed because
// Partial<> breaks discriminated unions - runtime behavior is safe.
function renderForm(overrides?: Record<string, unknown>) {
  const props = { ...BASE, ...overrides } as SecretsFormComposerProps;
  return render(<SecretsForm {...props} />);
}

function getComposerSecretInput() {
  return screen.getByLabelText('DISCOGS_TOKEN:');
}

describe('SecretsForm', () => {
  describe('rendering', () => {
    it('renders eyebrow with default text', () => {
      renderForm();
      expect(screen.getByText('New Secret')).toBeInTheDocument();
    });

    it('renders lock icon beside eyebrow', () => {
      const { container } = renderForm();
      expect(
        container.querySelector('.airo-input-secrets-form__secret-lock svg'),
      ).toBeInTheDocument();
    });

    it('merges className and forwards div passthrough props on the root', () => {
      const { container } = renderForm({
        className: 'host-extra',
        lang: 'de',
        onClose: vi.fn(),
      });
      const root = container.firstElementChild as HTMLElement;
      expect(root).toHaveClass('airo-input-secrets-form', 'host-extra');
      expect(root).toHaveAttribute('lang', 'de');
    });

    it('renders custom eyebrow', () => {
      renderForm({ eyebrow: 'Update Secret' });
      expect(screen.getByText('Update Secret')).toBeInTheDocument();
    });

    it('renders the secret label', () => {
      renderForm();
      expect(screen.getByText('DISCOGS_TOKEN:')).toBeInTheDocument();
    });

    it('renders helper text with the field', () => {
      renderForm();
      expect(screen.getByText('Token from discogs.com')).toBeInTheDocument();
    });

    it('always renders composer header close (X)', () => {
      renderForm();
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('does not render header close in conversation variant', () => {
      renderForm({ variant: 'conversation', onClose: vi.fn() });
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('omits the borderless class on the root by default', () => {
      const { container } = renderForm();
      expect(container.firstElementChild).not.toHaveClass('airo-input-secrets-form--borderless');
    });

    it('applies the borderless class on the root in composer when borderless is true', () => {
      const { container } = renderForm({ borderless: true });
      expect(container.firstElementChild).toHaveClass('airo-input-secrets-form--borderless');
    });

    it('applies the borderless class on the root in conversation when borderless is true', () => {
      const { container } = renderForm({
        variant: 'conversation',
        onClose: vi.fn(),
        borderless: true,
      });
      expect(container.firstElementChild).toHaveClass('airo-input-secrets-form--borderless');
    });

    it('renders Save primary button in composer takeover (matches paginated last step)', () => {
      renderForm();
      const save = screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save });
      expect(save).toBeInTheDocument();
      expect(save.closest('[data-partial="componentAiro"]')).toBeNull();
    });

    it('renders password input by default', () => {
      renderForm();
      expect(getComposerSecretInput()).toHaveAttribute('type', 'password');
    });

    it('associates the input with the secret name via label', () => {
      renderForm();
      const input = getComposerSecretInput();
      expect(input).toHaveAccessibleName('DISCOGS_TOKEN:');
    });

    it('renders eyebrow as heading level 3', () => {
      renderForm();
      expect(screen.getByRole('heading', { level: 3, name: 'New Secret' })).toBeInTheDocument();
    });

    it('does not render show/hide toggle when input is empty', () => {
      renderForm({ variant: 'conversation', onClose: vi.fn() });
      expect(screen.queryByRole('button', { name: 'Show value' })).not.toBeInTheDocument();
    });

    it('renders disabled show/hide toggle in composer when input is empty', () => {
      renderForm();
      expect(screen.getByRole('button', { name: 'Show value' })).toBeDisabled();
    });

    it('renders show/hide toggle when input has a value', () => {
      renderForm({ variant: 'conversation', onClose: vi.fn(), value: 'secret' });
      expect(screen.getByRole('button', { name: 'Show value' })).toBeInTheDocument();
    });

    it('renders show/hide toggle in composer when input has a value', () => {
      renderForm({ value: 'secret' });
      expect(screen.getByRole('button', { name: 'Show value' })).toBeInTheDocument();
    });
  });

  describe('visibility toggle', () => {
    it('switches composer TextEntry type to text when show is clicked', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(getComposerSecretInput(), 'secret');
      await user.click(screen.getByRole('button', { name: 'Show value' }));

      expect(getComposerSecretInput()).toHaveAttribute('type', 'text');
    });

    it('switches input type to text when show is clicked', async () => {
      const user = userEvent.setup();
      renderForm({ variant: 'conversation', onClose: vi.fn() });

      await user.type(screen.getByPlaceholderText('Enter value'), 'secret');
      await user.click(screen.getByRole('button', { name: 'Show value' }));

      const input = screen.getByPlaceholderText('Enter value');
      expect(input).toHaveAttribute('type', 'text');
      expect(screen.getByRole('button', { name: 'Hide value' })).toBeInTheDocument();
    });

    it('toggles back to password on second click', async () => {
      const user = userEvent.setup();
      renderForm({ variant: 'conversation', onClose: vi.fn() });

      await user.type(screen.getByPlaceholderText('Enter value'), 'secret');
      await user.click(screen.getByRole('button', { name: 'Show value' }));
      await user.click(screen.getByRole('button', { name: 'Hide value' }));

      expect(screen.getByPlaceholderText('Enter value')).toHaveAttribute('type', 'password');
    });

    it('uses custom show and hide labels for the visibility toggle', async () => {
      const user = userEvent.setup();
      renderForm({
        variant: 'conversation',
        onClose: vi.fn(),
        showSecretLabel: 'Reveal',
        hideSecretLabel: 'Conceal',
      });

      await user.type(screen.getByPlaceholderText('Enter value'), 'z');
      expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Reveal' }));
      expect(screen.getByRole('button', { name: 'Conceal' })).toBeInTheDocument();
    });

    it('resets to masked password after clearing the value following show', async () => {
      const user = userEvent.setup();
      renderForm({ variant: 'conversation', onClose: vi.fn() });

      const input = screen.getByPlaceholderText('Enter value');
      await user.type(input, 'a');
      await user.click(screen.getByRole('button', { name: 'Show value' }));
      expect(input).toHaveAttribute('type', 'text');
      await user.clear(input);
      expect(input).toHaveAttribute('type', 'password');
    });
  });

  describe('submit', () => {
    it('calls onSubmit with trimmed value on button click', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ onSubmit });

      await user.type(screen.getByPlaceholderText('Enter value'), '  my-token  ');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));

      expect(onSubmit).toHaveBeenCalledWith('my-token');
      expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
    });

    it('calls onSubmit on Enter keypress', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ onSubmit });

      const input = screen.getByPlaceholderText('Enter value');
      await user.type(input, 'secret123{Enter}');

      expect(onSubmit).toHaveBeenCalledWith('secret123');
      expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
    });

    it('does not submit on Shift+Enter', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ onSubmit });
      const input = screen.getByPlaceholderText('Enter value');
      await user.type(input, 'ok');
      await user.keyboard('{Shift>}{Enter}{/Shift}');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('does not submit when input is empty', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ onSubmit });

      const input = screen.getByPlaceholderText('Enter value');
      await user.type(input, '{Enter}');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('disables send button when no value is entered', () => {
      renderForm();
      expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save })).toBeDisabled();
    });

    it('enables send button when value is entered', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByPlaceholderText('Enter value'), 'val');
      expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save })).toBeEnabled();
    });

    it('uses custom closeLabel and submitLabel on composer chrome', () => {
      renderForm({ onClose: vi.fn(), closeLabel: 'Dismiss', submitLabel: 'Store' });
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Store' })).toBeInTheDocument();
    });

    it('clears input after submit in uncontrolled mode', async () => {
      const user = userEvent.setup();
      renderForm({ onSubmit: vi.fn() });

      const input = screen.getByPlaceholderText('Enter value');
      await user.type(input, 'secret');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));

      expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
    });

    it('stays mounted when onSubmit is omitted (valid submit is a no-op)', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByPlaceholderText('Enter value'), 'x');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      expect(screen.getByPlaceholderText('Enter value')).toHaveValue('x');
    });

    it('stays mounted when onSubmit throws', async () => {
      const onSubmit = vi.fn(function () {
        throw new Error('boom');
      });
      const user = userEvent.setup();
      renderForm({ onSubmit });

      await user.type(screen.getByPlaceholderText('Enter value'), 'x');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));

      expect(onSubmit).toHaveBeenCalled();
      expect(screen.getByPlaceholderText('Enter value')).toHaveValue('x');
    });

    it('dismisses after async onSubmit resolves', async () => {
      let finish!: () => void;
      const onSubmit = vi.fn(
        function () { return new Promise<void>((resolve) => {
            finish = () => resolve();
          }); },
      );
      const user = userEvent.setup();
      renderForm({ onSubmit });

      await user.type(screen.getByPlaceholderText('Enter value'), 'x');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      expect(screen.getByPlaceholderText('Enter value')).toBeInTheDocument();
      finish();
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
      });
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('does not log unmounted state-update warnings when async onSubmit resolves after unmount', async () => {
      let finish!: () => void;
      const onSubmit = vi.fn(
        function () { return new Promise<void>((resolve) => {
            finish = () => resolve();
          }); },
      );
      const user = userEvent.setup();
      const { unmount } = renderForm({ onSubmit, value: 'tok', onChange: vi.fn() });

      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      unmount();

      const spy = vi.spyOn(console, 'error').mockImplementation(function () {});
      finish();
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      const unmountUpdateWarnings = spy.mock.calls
        .map((c) => String(c[0] ?? ''))
        .filter((msg) => /unmounted component|not mounted/i.test(msg));
      spy.mockRestore();
      expect(unmountUpdateWarnings).toHaveLength(0);
    });

    it('does not run onSubmit twice while a previous async onSubmit is still pending', async () => {
      let finish!: () => void;
      const onSubmit = vi.fn(
        function () { return new Promise<void>((resolve) => {
            finish = () => resolve();
          }); },
      );
      const user = userEvent.setup();
      renderForm({ onSubmit, value: 'tok' });

      const send = screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save });
      await user.click(send);
      await user.click(send);
      expect(onSubmit).toHaveBeenCalledTimes(1);

      finish();
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
      });
    });

    it('stays mounted when async onSubmit rejects', async () => {
      const onSubmit = vi.fn(function () { return Promise.reject(new Error('fail')); });
      const user = userEvent.setup();
      renderForm({ onSubmit });

      await user.type(screen.getByPlaceholderText('Enter value'), 'x');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      expect(screen.getByPlaceholderText('Enter value')).toBeInTheDocument();
    });
  });

  describe('close', () => {
    it('calls onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderForm({ onClose });

      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('controlled mode', () => {
    it('uses value prop when provided', () => {
      renderForm({ value: 'controlled-val' });
      expect(screen.getByPlaceholderText('Enter value')).toHaveValue('controlled-val');
    });

    it('calls onChange on keystroke', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      renderForm({ value: '', onChange });

      await user.type(screen.getByPlaceholderText('Enter value'), 'a');
      expect(onChange).toHaveBeenCalledWith('a');
    });

    it('dismisses after submit even when controlled value is unchanged in parent state', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ value: 'persist', onChange: vi.fn(), onSubmit });

      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      expect(onSubmit).toHaveBeenCalledWith('persist');
      expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
    });

    it('clears after submit when parent clears controlled value', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();

      function Harness() {
        const [v, setV] = useState('gone');
        return (
          <SecretsForm
            label="DISCOGS_TOKEN:"
            helperText="Token from discogs.com"
            submitLabel={SECRETS_FORM_HOST_I18N.save}
            onClose={vi.fn()}
            value={v}
            onChange={setV}
            onSubmit={(s) => {
              onSubmit(s);
              setV('');
            }}
          />
        );
      }

      render(<Harness />);
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      expect(onSubmit).toHaveBeenCalledWith('gone');
      expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
    });
  });

  describe('pending state', () => {
    it('disables send button when pending', () => {
      renderForm({ pending: true, value: 'some-value' });
      expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save })).toBeDisabled();
    });

    it('does not call onSubmit when pending', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ pending: true, value: 'val', onSubmit });

      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('disables header close when pending', () => {
      renderForm({ pending: true, closeLabel: 'Close' });
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    });
  });

  describe('validation', () => {
    it('disables send when trimmed value is shorter than minLength', async () => {
      const user = userEvent.setup();
      renderForm({ minLength: 8 });

      const input = getComposerSecretInput();
      await user.type(input, 'short');
      expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save })).toBeDisabled();
      expect(screen.getByText('Enter at least 8 characters.')).toBeInTheDocument();
    });

    it('submits when trimmed value meets minLength', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ minLength: 4, onSubmit });

      await user.type(getComposerSecretInput(), 'abcd');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      expect(onSubmit).toHaveBeenCalledWith('abcd');
      expect(screen.queryByLabelText('DISCOGS_TOKEN:')).not.toBeInTheDocument();
    });

    it('does not submit when validate returns a message', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({
        onSubmit,
        validate: (v: string) => (v === 'bad' ? 'That value is not allowed.' : undefined),
      });

      await user.type(getComposerSecretInput(), 'bad');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText('That value is not allowed.')).toBeInTheDocument();
    });

    it('clears validate error after the value becomes valid', async () => {
      const user = userEvent.setup();
      renderForm({
        validate: (v: string) => (v === 'bad' ? 'Not allowed.' : undefined),
      });

      const input = getComposerSecretInput();
      await user.type(input, 'bad');
      expect(screen.getByText('Not allowed.')).toBeInTheDocument();
      await user.clear(input);
      await user.type(input, 'good');
      expect(screen.queryByText('Not allowed.')).not.toBeInTheDocument();
    });

    it('disables send for whitespace-only input', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(getComposerSecretInput(), '   ');
      expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save })).toBeDisabled();
      expect(screen.getByText('Enter a value.')).toBeInTheDocument();
    });

    it('uses validationMessages.minLength when trimmed value is too short', async () => {
      const user = userEvent.setup();
      renderForm({
        minLength: 3,
        validationMessages: {
          minLength: (n: number) => `Need ${n}.`,
        },
      });

      await user.type(getComposerSecretInput(), 'ab');
      expect(screen.getByText('Need 3.')).toBeInTheDocument();
    });

    it('uses validationMessages.empty for whitespace-only when minLength is 1', async () => {
      const user = userEvent.setup();
      renderForm({
        validationMessages: { empty: 'Empty!' },
      });

      await user.type(getComposerSecretInput(), '   ');
      expect(screen.getByText('Empty!')).toBeInTheDocument();
    });

    it('respects maxLength on the input', () => {
      renderForm({ maxLength: 4, value: 'abcd' });
      expect(screen.getByPlaceholderText('Enter value')).toHaveAttribute('maxLength', '4');
    });
  });

  describe('forwardRef', () => {
    it('exposes the TextEntry input in composer variant', () => {
      const ref = createRef<HTMLInputElement>();
      render(<SecretsForm {...BASE} ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it('exposes the TextEntry input in conversation variant', () => {
      const ref = createRef<HTMLInputElement>();
      render(<SecretsForm {...BASE} ref={ref} variant="conversation" onClose={vi.fn()} />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it('clears forwarded ref after successful submit', async () => {
      const ref = createRef<HTMLInputElement>();
      const user = userEvent.setup();
      render(<SecretsForm {...BASE} ref={ref} onSubmit={vi.fn()} />);

      await user.type(screen.getByPlaceholderText('Enter value'), 'x');
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      expect(ref.current).toBeNull();
    });
  });

  describe('variant conversation', () => {
    it('adds conversation root modifier', () => {
      const { container } = renderForm({ variant: 'conversation', onClose: vi.fn() });
      expect(container.firstChild).toHaveClass('airo-input-secrets-form--conversation');
    });

    it('does not render header close control', () => {
      renderForm({ variant: 'conversation', onClose: vi.fn() });
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('renders Save and Cancel instead of icon send', () => {
      renderForm({ variant: 'conversation', onClose: vi.fn() });
      expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: SECRETS_FORM_HOST_I18N.submit })).not.toBeInTheDocument();
    });

    it('does not wrap Save in componentAiro partial (standard UXCore primary)', () => {
      renderForm({
        variant: 'conversation',
        onClose: vi.fn(),
        defaultValue: 'has-value',
      });
      const save = screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save });
      expect(save.closest('[data-partial="componentAiro"]')).toBeNull();
    });

    it('calls onClose from Cancel without submitting', async () => {
      const onSubmit = vi.fn();
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderForm({ variant: 'conversation', onSubmit, onClose });

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledOnce();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText('Enter value')).toBeInTheDocument();
    });

    it('calls onSubmit from Save then dismisses the form', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ variant: 'conversation', onSubmit, onClose: vi.fn() });

      await user.type(screen.getByPlaceholderText('Enter value'), 'tok');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      expect(onSubmit).toHaveBeenCalledWith('tok');
      expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
    });

    it('omits Cancel when onClose is omitted', () => {
      render(
        <SecretsForm
          variant="conversation"
          label="DISCOGS_TOKEN:"
          helperText="Token from discogs.com"
          submitLabel={SECRETS_FORM_HOST_I18N.save}
        />,
      );
      expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });

    it('disables Save when invalid', async () => {
      const user = userEvent.setup();
      renderForm({ variant: 'conversation', minLength: 8, onClose: vi.fn() });

      await user.type(screen.getByPlaceholderText('Enter value'), 'short');
      expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save })).toBeDisabled();
    });

    it('calls onSubmit on Enter like composer', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ variant: 'conversation', onClose: vi.fn(), onSubmit });

      await user.type(screen.getByPlaceholderText('Enter value'), 'tok{Enter}');
      expect(onSubmit).toHaveBeenCalledWith('tok');
      expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
    });

    it('does not submit on Shift+Enter', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ variant: 'conversation', onClose: vi.fn(), onSubmit });
      const input = screen.getByPlaceholderText('Enter value');
      await user.type(input, 'ok');
      await user.keyboard('{Shift>}{Enter}{/Shift}');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('disables Save when pending', () => {
      renderForm({
        variant: 'conversation',
        onClose: vi.fn(),
        pending: true,
        value: 'v',
      });
      expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save })).toBeDisabled();
    });

    it('does not call onSubmit when Save is clicked while pending', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({
        variant: 'conversation',
        onClose: vi.fn(),
        pending: true,
        value: 'v',
        onSubmit,
      });
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.save }));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('uses custom submitLabel and cancelLabel', () => {
      renderForm({
        variant: 'conversation',
        onClose: vi.fn(),
        submitLabel: 'Apply',
        cancelLabel: 'Dismiss',
      });
      expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });

    it('still surfaces helper text below the field', () => {
      renderForm({ variant: 'conversation', onClose: vi.fn() });
      expect(screen.getByText('Token from discogs.com')).toBeInTheDocument();
    });
  });

  describe('multi-field mode', () => {
    it('renders multiple password fields when fields prop is provided', () => {
      render(
        <SecretsForm
          fields={[
            { name: 'STRIPE_SECRET_KEY', label: 'Secret Key:' },
            { name: 'STRIPE_PUBLISHABLE_KEY', label: 'Publishable Key:' },
          ]}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByLabelText('Secret Key:')).toBeInTheDocument();
      expect(screen.getByLabelText('Publishable Key:')).toBeInTheDocument();
    });

    it('calls onSubmitMulti with all field values on submit', async () => {
      const onSubmitMulti = vi.fn();
      const user = userEvent.setup();
      render(
        <SecretsForm
          fields={[
            { name: 'KEY_1', label: 'Key 1:' },
            { name: 'KEY_2', label: 'Key 2:' },
          ]}
          onSubmitMulti={onSubmitMulti}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      await user.type(screen.getByLabelText('Key 1:'), 'value1');
      await user.type(screen.getByLabelText('Key 2:'), 'value2');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.submit }));

      expect(onSubmitMulti).toHaveBeenCalledWith({
        KEY_1: 'value1',
        KEY_2: 'value2',
      });
    });

    it('trims field values before submitting', async () => {
      const onSubmitMulti = vi.fn();
      const user = userEvent.setup();
      render(
        <SecretsForm
          fields={[{ name: 'KEY', label: 'Key:' }]}
          onSubmitMulti={onSubmitMulti}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      await user.type(screen.getByLabelText('Key:'), '  value-with-spaces  ');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.submit }));

      expect(onSubmitMulti).toHaveBeenCalledWith({
        KEY: 'value-with-spaces',
      });
    });

    it('works in controlled mode with values prop', async () => {
      const onValuesChange = vi.fn();
      const user = userEvent.setup();
      const { rerender } = render(
        <SecretsForm
          fields={[{ name: 'KEY', label: 'Key:' }]}
          values={{ KEY: '' }}
          onValuesChange={onValuesChange}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      await user.type(screen.getByLabelText('Key:'), 'a');

      expect(onValuesChange).toHaveBeenCalledWith({ KEY: 'a' }, 'KEY');

      rerender(
        <SecretsForm
          fields={[{ name: 'KEY', label: 'Key:' }]}
          values={{ KEY: 'a' }}
          onValuesChange={onValuesChange}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByLabelText('Key:')).toHaveValue('a');
    });

    it('uses field defaultValue in uncontrolled mode', () => {
      render(
        <SecretsForm
          fields={[{ name: 'KEY', label: 'Key:', defaultValue: 'preset' }]}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByLabelText('Key:')).toHaveValue('preset');
    });

    it('validates each required field independently', async () => {
      const onSubmitMulti = vi.fn();
      const user = userEvent.setup();
      render(
        <SecretsForm
          fields={[
            { name: 'KEY_1', label: 'Key 1:', required: true },
            { name: 'KEY_2', label: 'Key 2:', required: true },
          ]}
          onSubmitMulti={onSubmitMulti}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      await user.type(screen.getByLabelText('Key 1:'), 'value1');
      // Leave Key 2 empty
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.submit }));

      expect(onSubmitMulti).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.submit })).toBeDisabled();
      expect(screen.getByText('All required fields must be filled.')).toBeInTheDocument();
    });

    it('allows optional fields to be empty', async () => {
      const onSubmitMulti = vi.fn();
      const user = userEvent.setup();
      render(
        <SecretsForm
          fields={[
            { name: 'REQUIRED_KEY', label: 'Required:', required: true },
            { name: 'OPTIONAL_KEY', label: 'Optional:', required: false },
          ]}
          onSubmitMulti={onSubmitMulti}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      await user.type(screen.getByLabelText('Required:'), 'value');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.submit }));

      expect(onSubmitMulti).toHaveBeenCalledWith({
        REQUIRED_KEY: 'value',
        OPTIONAL_KEY: '',
      });
    });

    it('displays field-specific helper text', () => {
      render(
        <SecretsForm
          fields={[
            { name: 'KEY_1', label: 'Key 1:', helperText: 'Help for key 1' },
            { name: 'KEY_2', label: 'Key 2:', helperText: 'Help for key 2' },
          ]}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      expect(screen.getByText('Help for key 1')).toBeInTheDocument();
      expect(screen.getByText('Help for key 2')).toBeInTheDocument();
    });

    it('dismisses after successful multi-field submit', async () => {
      const onSubmitMulti = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      const { container } = render(
        <SecretsForm
          fields={[{ name: 'KEY', label: 'Key:' }]}
          onSubmitMulti={onSubmitMulti}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      await user.type(screen.getByLabelText('Key:'), 'value');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.submit }));

      await vi.waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('stays mounted when multi-field onSubmitMulti rejects', async () => {
      const onSubmitMulti = vi.fn().mockRejectedValue(new Error('Save failed'));
      const user = userEvent.setup();
      render(
        <SecretsForm
          fields={[{ name: 'KEY', label: 'Key:' }]}
          onSubmitMulti={onSubmitMulti}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      await user.type(screen.getByLabelText('Key:'), 'value');
      await user.click(screen.getByRole('button', { name: SECRETS_FORM_HOST_I18N.submit }));

      expect(onSubmitMulti).toHaveBeenCalled();
      // Form should still be mounted after error
      expect(screen.getByLabelText('Key:')).toBeInTheDocument();
    });

    it('has independent show/hide toggles for each field', async () => {
      const user = userEvent.setup();
      render(
        <SecretsForm
          fields={[
            { name: 'KEY_1', label: 'Key 1:' },
            { name: 'KEY_2', label: 'Key 2:' },
          ]}
          submitLabel={SECRETS_FORM_HOST_I18N.submit}
          onClose={vi.fn()}
        />,
      );

      await user.type(screen.getByLabelText('Key 1:'), 'secret1');
      await user.type(screen.getByLabelText('Key 2:'), 'secret2');

      const showButtons = screen.getAllByRole('button', { name: 'Show value' });
      expect(showButtons).toHaveLength(2);

      // Click first show button
      await user.click(showButtons[0]!);

      // First field should be visible, second still hidden
      expect(screen.getByLabelText('Key 1:')).toHaveAttribute('type', 'text');
      expect(screen.getByLabelText('Key 2:')).toHaveAttribute('type', 'password');
    });
  });
});
