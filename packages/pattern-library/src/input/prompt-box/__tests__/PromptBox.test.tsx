import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChoiceList } from '../../choice-list';
import type { PromptBoxHandle } from '../PromptBox';
import { PromptBox } from '../index';

function renderBox(props?: Partial<React.ComponentProps<typeof PromptBox>>) {
  return render(<PromptBox placeholder="Ask anything…" {...props} />);
}

/** A controlled wrapper for tests that need to seed text into the editor.
 *  Lexical's contenteditable does not respond to `userEvent.keyboard()`
 *  text in jsdom, so we drive content through React state and assert the
 *  effect on PromptBox's submit / change handlers. */
function ControlledBox({
  initialValue = '',
  ...props
}: { initialValue?: string } & Partial<React.ComponentProps<typeof PromptBox>>) {
  const [val, setVal] = useState(initialValue);
  return (
    <PromptBox
      placeholder="Ask anything…"
      {...props}
      value={val}
      onChange={(v) => {
        setVal(v);
        props.onChange?.(v);
      }}
    />
  );
}

/** Returns the Lexical contenteditable. The editor's role flips to
 *  `combobox` when `onSuggestionsRequest` is wired, so accept either. */
function getEditor() {
  return screen.queryByRole('textbox') ?? screen.getByRole('combobox');
}

/** Returns the suggestions listbox owned by PromptBox (skipping any
 *  invisible typeahead menu lexical-beautiful-mentions renders). */
function getSuggestionsListbox() {
  return screen.getByRole('listbox', { name: /suggestions/i });
}

describe('PromptBox', () => {
  describe('rendering', () => {
    it('renders the root class and a textbox', () => {
      const { container } = renderBox();
      expect(container.querySelector('.airo-input-prompt-box')).toBeInTheDocument();
      expect(getEditor()).toBeInTheDocument();
    });

    it('forwards className and data-* to the root element', () => {
      const { container } = render(
        <PromptBox placeholder="Ask anything…" className="custom" data-testid="pb" />,
      );
      const root = container.querySelector('.airo-input-prompt-box');
      expect(root).toHaveClass('custom');
      expect(root).toHaveAttribute('data-testid', 'pb');
    });

    it('renders the send button when not pending', () => {
      renderBox({ submitLabel: 'Send prompt' });
      expect(screen.getByRole('button', { name: 'Send prompt' })).toBeInTheDocument();
    });

    it('renders beforeSubmit before the send control in default appearance', () => {
      render(
        <PromptBox
          placeholder="Ask…"
          onSubmit={vi.fn()}
          beforeSubmit={<span data-testid="before-send">extra</span>}
        />,
      );
      expect(screen.getByTestId('before-send')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    });

    it('renders borderless toolbar slots and built-in send', () => {
      render(
        <PromptBox
          appearance="borderless"
          placeholder="Ask…"
          toolbarStart={<span data-testid="toolbar-start">left</span>}
          beforeSubmit={<span data-testid="before-send">mic</span>}
          onSubmit={vi.fn()}
        />,
      );
      expect(screen.getByTestId('toolbar-start')).toBeInTheDocument();
      expect(screen.getByTestId('before-send')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    });

    it('renders the stop button when pending', () => {
      renderBox({ pending: true, stopLabel: 'Cancel' });
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
    });

    it('adds data-partial="componentAiro" to the action wrapper in send state', () => {
      const { container } = renderBox({ pending: false });
      const wrapper = container.querySelector('.airo-input-prompt-box__action');
      expect(wrapper).toHaveAttribute('data-partial', 'componentAiro');
    });

    it('omits data-partial from the action wrapper in stop state', () => {
      const { container } = renderBox({ pending: true });
      const wrapper = container.querySelector('.airo-input-prompt-box__action');
      expect(wrapper).not.toHaveAttribute('data-partial');
    });

    it('exposes the placeholder via aria-placeholder on the textbox', () => {
      renderBox({ placeholder: 'Type here…' });
      expect(getEditor()).toHaveAttribute('aria-placeholder', 'Type here…');
    });

    it('renders with a defaultValue in uncontrolled mode', async () => {
      renderBox({ defaultValue: 'Hello world' });
      await waitFor(() => expect(getEditor()).toHaveTextContent('Hello world'));
    });
  });

  describe('submit', () => {
    it('fires onSubmit with trimmed value on Enter', () => {
      const onSubmit = vi.fn();
      render(<ControlledBox initialValue="  Hello  " onSubmit={onSubmit} />);

      fireEvent.keyDown(getEditor(), { key: 'Enter' });

      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith('Hello');
    });

    it('fires onSubmit when the send button is clicked', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(<ControlledBox initialValue="Hello" onSubmit={onSubmit} submitLabel="Send" />);

      await user.click(screen.getByRole('button', { name: 'Send' }));

      expect(onSubmit).toHaveBeenCalledWith('Hello');
    });

    it('does not fire onSubmit when the field is empty', () => {
      const onSubmit = vi.fn();
      renderBox({ onSubmit });

      fireEvent.keyDown(getEditor(), { key: 'Enter' });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('does not fire onSubmit when disabled', () => {
      const onSubmit = vi.fn();
      render(<ControlledBox initialValue="Hello" onSubmit={onSubmit} disabled />);

      fireEvent.keyDown(getEditor(), { key: 'Enter' });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('clears the field after submit in uncontrolled mode', () => {
      renderBox({ defaultValue: 'Hello', onSubmit: vi.fn() });

      const editor = getEditor();
      fireEvent.keyDown(editor, { key: 'Enter' });

      expect(editor).toHaveTextContent('');
    });

    it('does not fire onSubmit on Shift+Enter', () => {
      const onSubmit = vi.fn();
      render(<ControlledBox initialValue="Hello" onSubmit={onSubmit} />);

      fireEvent.keyDown(getEditor(), { key: 'Enter', shiftKey: true });

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('fires onStop when the stop button is clicked', async () => {
      const user = userEvent.setup();
      const onStop = vi.fn();
      renderBox({ pending: true, onStop, stopLabel: 'Stop' });

      await user.click(screen.getByRole('button', { name: 'Stop' }));

      expect(onStop).toHaveBeenCalledOnce();
    });

    it('resets the field value on stop in uncontrolled mode', async () => {
      const user = userEvent.setup();
      const onStop = vi.fn();
      renderBox({ pending: true, onStop, defaultValue: 'Some draft', stopLabel: 'Stop' });

      await user.click(screen.getByRole('button', { name: 'Stop' }));

      expect(getEditor()).toHaveTextContent('');
    });

    it('does not fire onSubmit when pending and onQueue is not provided', () => {
      const onSubmit = vi.fn();
      renderBox({ pending: true, onSubmit, submitLabel: 'Send' });

      // The send button is replaced by stop when pending, so this click does nothing.
      // This test ensures no accidental submit fires.
      expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('controlled mode', () => {
    it('reflects the controlled value', async () => {
      renderBox({ value: 'Controlled', onChange: vi.fn() });
      await waitFor(() => expect(getEditor()).toHaveTextContent('Controlled'));
    });

    it('updates editor content when controlled value changes externally', async () => {
      const onChange = vi.fn();
      const { rerender } = render(<PromptBox placeholder="Ask…" value="Hi" onChange={onChange} />);
      await waitFor(() => expect(getEditor()).toHaveTextContent('Hi'));

      rerender(<PromptBox placeholder="Ask…" value="Hi there" onChange={onChange} />);

      await waitFor(() => expect(getEditor()).toHaveTextContent('Hi there'));
    });
  });

  describe('suggestions / combobox', () => {
    const suggestions = [
      { id: 's1', label: 'Help me write a landing page' },
      { id: 's2', label: 'Help me write a blog post' },
    ];

    it('applies combobox role when onSuggestionsRequest is provided', () => {
      renderBox({ onSuggestionsRequest: vi.fn() });
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('shows the suggestions flyout when suggestions are provided', () => {
      renderBox({ suggestions, onSuggestionsRequest: vi.fn() });
      const listbox = getSuggestionsListbox();
      expect(listbox).toBeInTheDocument();
      expect(within(listbox).getAllByRole('option')).toHaveLength(2);
    });

    it('hides the suggestions flyout when suggestions array is empty', () => {
      renderBox({ suggestions: [], onSuggestionsRequest: vi.fn() });
      expect(screen.queryByRole('listbox', { name: /suggestions/i })).not.toBeInTheDocument();
    });

    it('accepts the first suggestion on Tab and fires onSuggestionAccept', () => {
      const onSuggestionAccept = vi.fn();
      renderBox({ suggestions, onSuggestionsRequest: vi.fn(), onSuggestionAccept });

      fireEvent.keyDown(getEditor(), { key: 'Tab' });

      expect(onSuggestionAccept).toHaveBeenCalledWith(suggestions[0], 'edit');
    });

    it('accepts the highlighted suggestion on Enter instead of submitting', () => {
      const onSubmit = vi.fn();
      const onSuggestionAccept = vi.fn();
      renderBox({ suggestions, onSuggestionsRequest: vi.fn(), onSubmit, onSuggestionAccept });

      const editor = getEditor();
      fireEvent.keyDown(editor, { key: 'ArrowDown' });
      fireEvent.keyDown(editor, { key: 'Enter' });

      expect(onSuggestionAccept).toHaveBeenCalledWith(suggestions[0], 'accept');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('dismisses suggestions on Escape', () => {
      renderBox({ suggestions, onSuggestionsRequest: vi.fn() });

      // Suggestions visible initially.
      expect(getSuggestionsListbox()).toBeInTheDocument();

      fireEvent.keyDown(getEditor(), { key: 'Escape' });

      expect(screen.queryByRole('listbox', { name: /suggestions/i })).not.toBeInTheDocument();
    });

    it('clicking a suggestion calls onSuggestionAccept with accept mode', () => {
      const onSuggestionAccept = vi.fn();
      renderBox({ suggestions, onSuggestionsRequest: vi.fn(), onSuggestionAccept });

      const options = within(getSuggestionsListbox()).getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected a second option');
      fireEvent.click(second);

      expect(onSuggestionAccept).toHaveBeenCalledWith(suggestions[1], 'accept');
    });

    it('Shift+Tab does not intercept the keypress when the flyout is open', () => {
      const onSuggestionAccept = vi.fn();
      renderBox({ suggestions, onSuggestionsRequest: vi.fn(), onSuggestionAccept });

      fireEvent.keyDown(getEditor(), { key: 'Tab', shiftKey: true });

      expect(onSuggestionAccept).not.toHaveBeenCalled();
    });
  });

  describe('listening / streaming', () => {
    it('makes the editor read-only when isListening is true', () => {
      renderBox({ isListening: true, defaultValue: 'Live transcript…' });
      const editor = getEditor();
      expect(editor).toHaveAttribute('contenteditable', 'false');
    });

    it('makes the editor read-only when isBudgetExceeded is true', () => {
      renderBox({ isBudgetExceeded: true });
      expect(getEditor()).toHaveAttribute('contenteditable', 'false');
    });
  });

  describe('ref handle', () => {
    it('exposes focus / blur on the forwarded ref', async () => {
      const ref = { current: null as PromptBoxHandle | null };
      render(<PromptBox placeholder="Ask…" ref={ref} />);
      expect(ref.current).toBeTruthy();
      expect(typeof ref.current?.focus).toBe('function');
      expect(typeof ref.current?.blur).toBe('function');
      expect(typeof ref.current?.insertElementMention).toBe('function');
      expect(typeof ref.current?.removeElementMention).toBe('function');
      expect(typeof ref.current?.clearAllElementMentions).toBe('function');

      // Lexical schedules focus via a microtask, so wait for the DOM to settle.
      ref.current?.focus();
      await waitFor(() => expect(getEditor()).toHaveFocus());
    });
  });

  describe('expansion area', () => {
    it('does not render the expansion wrapper when expansionContent is omitted', () => {
      const { container } = renderBox();
      expect(
        container.querySelector('.airo-input-prompt-box__expansion-wrap'),
      ).not.toBeInTheDocument();
    });

    it('renders expansion content when expansionContent is provided', () => {
      const { container } = render(
        <PromptBox
          placeholder="Ask…"
          expansionContent={<span data-testid="exp-content">attachment</span>}
        />,
      );
      expect(container.querySelector('.airo-input-prompt-box__expansion-wrap')).toBeInTheDocument();
      expect(screen.getByTestId('exp-content')).toBeInTheDocument();
    });

    it('applies --open modifier when expanded={true}', () => {
      const { container } = render(
        <PromptBox placeholder="Ask…" expansionContent={<span>content</span>} expanded={true} />,
      );
      expect(
        container.querySelector('.airo-input-prompt-box__expansion-wrap--open'),
      ).toBeInTheDocument();
    });

    it('does not apply --open modifier when expanded={false}', () => {
      const { container } = render(
        <PromptBox placeholder="Ask…" expansionContent={<span>content</span>} expanded={false} />,
      );
      expect(
        container.querySelector('.airo-input-prompt-box__expansion-wrap--open'),
      ).not.toBeInTheDocument();
    });

    it('uses defaultExpanded=true when no controlled expanded prop is given', () => {
      const { container } = render(
        <PromptBox
          placeholder="Ask…"
          expansionContent={<span>content</span>}
          defaultExpanded={true}
        />,
      );
      expect(
        container.querySelector('.airo-input-prompt-box__expansion-wrap--open'),
      ).toBeInTheDocument();
    });

    it('hides expansion content from assistive tech when collapsed', () => {
      const { container } = render(
        <PromptBox placeholder="Ask…" expansionContent={<span>content</span>} expanded={false} />,
      );
      expect(container.querySelector('.airo-input-prompt-box__expansion-inner')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
    });

    it('expansion content is accessible when open', () => {
      const { container } = render(
        <PromptBox placeholder="Ask…" expansionContent={<span>content</span>} expanded={true} />,
      );
      expect(
        container.querySelector('.airo-input-prompt-box__expansion-inner'),
      ).not.toHaveAttribute('aria-hidden', 'true');
    });

    it('renders expansion area in borderless appearance', () => {
      const { container } = render(
        <PromptBox
          appearance="borderless"
          placeholder="Ask…"
          expansionContent={<span data-testid="borderless-exp">file</span>}
          expanded={true}
        />,
      );
      expect(screen.getByTestId('borderless-exp')).toBeInTheDocument();
      expect(
        container.querySelector('.airo-input-prompt-box__expansion-wrap--open'),
      ).toBeInTheDocument();
    });

    it('marks the collapsed expansion subtree inert so focusable descendants are untabbable', () => {
      const { container, rerender } = render(
        <PromptBox
          placeholder="Ask…"
          expansionContent={<button type="button">click me</button>}
          expanded={false}
        />,
      );
      const inner = container.querySelector(
        '.airo-input-prompt-box__expansion-inner',
      ) as HTMLElement | null;
      expect(inner).not.toBeNull();
      expect(inner?.hasAttribute('inert')).toBe(true);

      rerender(
        <PromptBox
          placeholder="Ask…"
          expansionContent={<button type="button">click me</button>}
          expanded={true}
        />,
      );
      expect(inner?.hasAttribute('inert')).toBe(false);
    });
  });

  describe('expansion toggle (built-in chevron)', () => {
    it('uncontrolled: clicking the corner chevron flips expanded state and fires onExpandedChange', async () => {
      const onExpandedChange = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <PromptBox
          placeholder="Ask…"
          expansionContent={<span>content</span>}
          defaultExpanded={true}
          onExpandedChange={onExpandedChange}
        />,
      );
      // No band (no expansionTitle) → corner chevron is the affordance.
      const collapseBtn = screen.getByRole('button', { name: 'Collapse' });
      await user.click(collapseBtn);
      expect(onExpandedChange).toHaveBeenLastCalledWith(false);
      expect(container.querySelector('.airo-input-prompt-box__expansion-wrap--open')).toBeNull();
    });

    it('controlled: clicking the chevron fires onExpandedChange but does not flip rendered state until prop updates', async () => {
      const onExpandedChange = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <PromptBox
          placeholder="Ask…"
          expansionContent={<span>content</span>}
          expanded={true}
          onExpandedChange={onExpandedChange}
        />,
      );
      const collapseBtn = screen.getByRole('button', { name: 'Collapse' });
      await user.click(collapseBtn);
      expect(onExpandedChange).toHaveBeenCalledWith(false);
      // Still open because the controlled prop didn't change.
      expect(
        container.querySelector('.airo-input-prompt-box__expansion-wrap--open'),
      ).not.toBeNull();
    });

    it('with expansionTitle: band toggle drives expand/collapse in uncontrolled mode', async () => {
      const onExpandedChange = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <PromptBox
          placeholder="Ask…"
          expansionTitle="Choose a content type"
          expansionContent={<span>content</span>}
          defaultExpanded={false}
          onExpandedChange={onExpandedChange}
        />,
      );
      // The band's chevron starts as Expand (chevron-up) when collapsed.
      const expandBtn = screen.getByRole('button', { name: 'Expand' });
      await user.click(expandBtn);
      expect(onExpandedChange).toHaveBeenLastCalledWith(true);
      expect(
        container.querySelector('.airo-input-prompt-box__expansion-wrap--open'),
      ).not.toBeNull();
      // Now the same button labels as Collapse.
      expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
    });

    it('with expansionTitle: band shows the title text in both states', () => {
      const { rerender } = render(
        <PromptBox
          placeholder="Ask…"
          expansionTitle="Choose a content type"
          expansionContent={<span>content</span>}
          expanded={true}
        />,
      );
      expect(screen.getByText('Choose a content type')).toBeInTheDocument();
      rerender(
        <PromptBox
          placeholder="Ask…"
          expansionTitle="Choose a content type"
          expansionContent={<span>content</span>}
          expanded={false}
        />,
      );
      expect(screen.getByText('Choose a content type')).toBeInTheDocument();
    });

    it('expansionThinking renders a ThinkingIndicator beside the title', () => {
      const { container } = render(
        <PromptBox
          placeholder="Ask…"
          expansionTitle="Drafting"
          expansionThinking
          expansionContent={<span>content</span>}
          expanded={true}
        />,
      );
      expect(container.querySelector('.airo-primitives-thinking-indicator')).not.toBeNull();
      // Leading area carries the Airo partial when thinking.
      expect(
        container.querySelector('.airo-input-prompt-box__expansion-band-leading'),
      ).toHaveAttribute('data-partial', 'componentAiro');
    });
  });

  describe('ChoiceList number-key shortcut auto-wiring', () => {
    it('lets a nested ChoiceList intercept 1-9 typed in the editor', async () => {
      const user = userEvent.setup();
      render(
        <PromptBox
          placeholder="Ask anything…"
          expanded
          expansionContent={
            <ChoiceList ariaLabel="Pick">
              <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
              <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
              <ChoiceList.Item value="c">Charlie</ChoiceList.Item>
            </ChoiceList>
          }
        />,
      );

      const editor = getEditor();
      editor.focus();
      await user.keyboard('2');

      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      // DOM focus moves directly to the option button so the browser's
      // native focus ring follows; subsequent ArrowDown/ArrowUp navigates
      // via DOM-focus traversal in the listbox wrap's capture handler.
      expect(document.activeElement).toBe(second);
    });

    it('does not steal digits past the option count', async () => {
      const user = userEvent.setup();
      render(
        <PromptBox
          placeholder="Ask anything…"
          expanded
          expansionContent={
            <ChoiceList ariaLabel="Pick">
              <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
              <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
            </ChoiceList>
          }
        />,
      );

      const editor = getEditor();
      editor.focus();
      await user.keyboard('5');

      // Out-of-range → focus stays in the editor instead of moving to an option.
      const options = screen.getAllByRole('option');
      for (const option of options) {
        expect(document.activeElement).not.toBe(option);
      }
    });
  });
});
