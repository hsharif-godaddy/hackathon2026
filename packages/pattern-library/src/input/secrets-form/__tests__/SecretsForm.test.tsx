import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SecretsForm, type SecretsFormComposerProps, type SecretsFormProps } from '../index';

beforeAll(() => {
  // `@ux/icon/async-icon.js` fetches SVG from an asset host; jsdom has no network.
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
};

function renderForm(overrides?: Partial<SecretsFormProps>) {
  return render(<SecretsForm {...BASE} {...overrides} />);
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

    it('renders helper text in toolbar', () => {
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

    it('renders send button', () => {
      renderForm();
      expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    });

    it('adds data-partial="componentAiro" to the send wrapper in composer (matches PromptBox)', () => {
      renderForm();
      const send = screen.getByRole('button', { name: 'Send' });
      const wrapper = send.closest('.airo-input-secrets-form__submit');
      expect(wrapper).toHaveAttribute('data-partial', 'componentAiro');
    });

    it('omits data-partial from the send wrapper in composer while pending', () => {
      renderForm({ pending: true, value: 'x' });
      const send = screen.getByRole('button', { name: 'Send' });
      const wrapper = send.closest('.airo-input-secrets-form__submit');
      expect(wrapper).not.toHaveAttribute('data-partial');
    });

    it('renders password input by default', () => {
      renderForm();
      const input = screen.getByPlaceholderText('Enter value');
      expect(input).toHaveAttribute('type', 'password');
    });

    it('associates the input with the secret name via <label htmlFor>', () => {
      renderForm();
      const input = screen.getByPlaceholderText('Enter value');
      const labelEl = screen.getByText('DISCOGS_TOKEN:');
      expect(labelEl.tagName).toBe('LABEL');
      expect(labelEl).toHaveAttribute('for', input.id);
      expect(input).toHaveAccessibleName('DISCOGS_TOKEN:');
      expect(input).not.toHaveAttribute('aria-labelledby');
    });

    it('renders eyebrow as heading level 3', () => {
      renderForm();
      expect(screen.getByRole('heading', { level: 3, name: 'New Secret' })).toBeInTheDocument();
    });

    it('does not render show/hide toggle when input is empty', () => {
      renderForm();
      expect(screen.queryByRole('button', { name: 'Show value' })).not.toBeInTheDocument();
    });

    it('renders show/hide toggle when input has a value', () => {
      renderForm({ value: 'secret' });
      expect(screen.getByRole('button', { name: 'Show value' })).toBeInTheDocument();
    });
  });

  describe('visibility toggle', () => {
    it('switches input type to text when show is clicked', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByPlaceholderText('Enter value'), 'secret');
      await user.click(screen.getByRole('button', { name: 'Show value' }));

      const input = screen.getByPlaceholderText('Enter value');
      expect(input).toHaveAttribute('type', 'text');
      expect(screen.getByRole('button', { name: 'Hide value' })).toBeInTheDocument();
    });

    it('toggles back to password on second click', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByPlaceholderText('Enter value'), 'secret');
      await user.click(screen.getByRole('button', { name: 'Show value' }));
      await user.click(screen.getByRole('button', { name: 'Hide value' }));

      expect(screen.getByPlaceholderText('Enter value')).toHaveAttribute('type', 'password');
    });

    it('uses custom show and hide labels for the visibility toggle', async () => {
      const user = userEvent.setup();
      renderForm({
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
      renderForm();

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
      await user.click(screen.getByRole('button', { name: 'Send' }));

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
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('enables send button when value is entered', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByPlaceholderText('Enter value'), 'val');
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
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
      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
    });

    it('stays mounted when onSubmit is omitted (valid submit is a no-op)', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByPlaceholderText('Enter value'), 'x');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(screen.getByPlaceholderText('Enter value')).toHaveValue('x');
    });

    it('stays mounted when onSubmit throws', async () => {
      const onSubmit = vi.fn(() => {
        throw new Error('boom');
      });
      const user = userEvent.setup();
      renderForm({ onSubmit });

      await user.type(screen.getByPlaceholderText('Enter value'), 'x');
      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(onSubmit).toHaveBeenCalled();
      expect(screen.getByPlaceholderText('Enter value')).toHaveValue('x');
    });

    it('dismisses after async onSubmit resolves', async () => {
      let finish!: () => void;
      const onSubmit = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = () => resolve();
          }),
      );
      const user = userEvent.setup();
      renderForm({ onSubmit });

      await user.type(screen.getByPlaceholderText('Enter value'), 'x');
      await user.click(screen.getByRole('button', { name: 'Send' }));
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
        () =>
          new Promise<void>((resolve) => {
            finish = () => resolve();
          }),
      );
      const user = userEvent.setup();
      const { unmount } = renderForm({ onSubmit, value: 'tok', onChange: vi.fn() });

      await user.click(screen.getByRole('button', { name: 'Send' }));
      unmount();

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
        () =>
          new Promise<void>((resolve) => {
            finish = () => resolve();
          }),
      );
      const user = userEvent.setup();
      renderForm({ onSubmit, value: 'tok' });

      const send = screen.getByRole('button', { name: 'Send' });
      await user.click(send);
      await user.click(send);
      expect(onSubmit).toHaveBeenCalledTimes(1);

      finish();
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
      });
    });

    it('stays mounted when async onSubmit rejects', async () => {
      const onSubmit = vi.fn(() => Promise.reject(new Error('fail')));
      const user = userEvent.setup();
      renderForm({ onSubmit });

      await user.type(screen.getByPlaceholderText('Enter value'), 'x');
      await user.click(screen.getByRole('button', { name: 'Send' }));
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

      await user.click(screen.getByRole('button', { name: 'Send' }));
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
            {...BASE}
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
      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(onSubmit).toHaveBeenCalledWith('gone');
      expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
    });
  });

  describe('pending state', () => {
    it('disables send button when pending', () => {
      renderForm({ pending: true, value: 'some-value' });
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('does not call onSubmit when pending', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ pending: true, value: 'val', onSubmit });

      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('disables send when trimmed value is shorter than minLength', async () => {
      const user = userEvent.setup();
      renderForm({ minLength: 8 });

      const input = screen.getByPlaceholderText('Enter value');
      await user.type(input, 'short');
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('Enter at least 8 characters.');
    });

    it('submits when trimmed value meets minLength', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({ minLength: 4, onSubmit });

      await user.type(screen.getByPlaceholderText('Enter value'), 'abcd');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(onSubmit).toHaveBeenCalledWith('abcd');
      expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
    });

    it('does not submit when validate returns a message', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderForm({
        onSubmit,
        validate: (v) => (v === 'bad' ? 'That value is not allowed.' : undefined),
      });

      await user.type(screen.getByPlaceholderText('Enter value'), 'bad');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent('That value is not allowed.');
    });

    it('clears validate error after the value becomes valid', async () => {
      const user = userEvent.setup();
      renderForm({
        validate: (v) => (v === 'bad' ? 'Not allowed.' : undefined),
      });

      const input = screen.getByPlaceholderText('Enter value');
      await user.type(input, 'bad');
      expect(screen.getByRole('status')).toBeInTheDocument();
      await user.clear(input);
      await user.type(input, 'good');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('disables send for whitespace-only input', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByPlaceholderText('Enter value'), '   ');
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('Enter a value.');
    });

    it('uses validationMessages.minLength when trimmed value is too short', async () => {
      const user = userEvent.setup();
      renderForm({
        minLength: 3,
        validationMessages: {
          minLength: (n) => `Need ${n}.`,
        },
      });

      await user.type(screen.getByPlaceholderText('Enter value'), 'ab');
      expect(screen.getByRole('status')).toHaveTextContent('Need 3.');
    });

    it('uses validationMessages.empty for whitespace-only when minLength is 1', async () => {
      const user = userEvent.setup();
      renderForm({
        validationMessages: { empty: 'Empty!' },
      });

      await user.type(screen.getByPlaceholderText('Enter value'), '   ');
      expect(screen.getByRole('status')).toHaveTextContent('Empty!');
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
      await user.click(screen.getByRole('button', { name: 'Send' }));
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
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    });

    it('does not wrap Save in componentAiro partial (standard UXCore primary)', () => {
      renderForm({
        variant: 'conversation',
        onClose: vi.fn(),
        defaultValue: 'has-value',
      });
      const save = screen.getByRole('button', { name: 'Save' });
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
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSubmit).toHaveBeenCalledWith('tok');
      expect(screen.queryByPlaceholderText('Enter value')).not.toBeInTheDocument();
    });

    it('omits Cancel when onClose is omitted', () => {
      render(
        <SecretsForm
          variant="conversation"
          label="DISCOGS_TOKEN:"
          helperText="Token from discogs.com"
        />,
      );
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });

    it('disables Save when invalid', async () => {
      const user = userEvent.setup();
      renderForm({ variant: 'conversation', minLength: 8, onClose: vi.fn() });

      await user.type(screen.getByPlaceholderText('Enter value'), 'short');
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
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
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
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
      await user.click(screen.getByRole('button', { name: 'Save' }));
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
});
