import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ChoiceListNumberKeyShortcutsConfig } from '../ChoiceList';
import { ChoiceListItem } from '../ChoiceListItem';
import { ChoiceListStep } from '../ChoiceListStep';

vi.mock('@ux/icon/async-icon.js', () => ({
  default: ({ icon, ...rest }: { icon: string }) => (
    <svg data-testid={`async-icon-${icon}`} data-icon={icon} {...rest} />
  ),
}));

import { ChoiceList, ChoiceListItemContent, ChoiceListShortcutScopeContext } from '../index';

function renderThree(props?: Partial<React.ComponentProps<typeof ChoiceList>>) {
  return render(
    <ChoiceList ariaLabel="Pick a direction" {...props}>
      <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
      <ChoiceList.Item value="campaign">Launch a campaign</ChoiceList.Item>
      <ChoiceList.Item value="research">Run research calls</ChoiceList.Item>
    </ChoiceList>,
  );
}

describe('ChoiceList', () => {
  describe('rendering', () => {
    it('renders the base class and a listbox role', () => {
      const { container } = renderThree();
      expect(container.querySelector('.airo-input-choice-list')).toBeInTheDocument();
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('renders one option per ChoiceList.Item', () => {
      renderThree();
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('names the listbox via ariaLabel', () => {
      renderThree({ ariaLabel: 'Pick a direction' });
      const listbox = screen.getByRole('listbox');
      expect(listbox).toHaveAttribute('aria-label', 'Pick a direction');
      expect(listbox).not.toHaveAttribute('aria-labelledby');
    });

    it('prefers a caller-supplied aria-labelledby over ariaLabel', () => {
      render(
        <>
          <h2 id="external-prompt">Pick a direction</h2>
          <ChoiceList ariaLabel="unused" aria-labelledby="external-prompt">
            <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
            <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
          </ChoiceList>
        </>,
      );
      const listbox = screen.getByRole('listbox');
      expect(listbox).toHaveAttribute('aria-labelledby', 'external-prompt');
      expect(listbox).not.toHaveAttribute('aria-label');
    });

    it('falls back to a native aria-label when ariaLabel is not supplied', () => {
      render(
        <ChoiceList aria-label="Pick something">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
          <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
        </ChoiceList>,
      );
      expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'Pick something');
    });

    it('falls back to the default aria-label when no naming prop is supplied', () => {
      render(
        <ChoiceList>
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
          <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
        </ChoiceList>,
      );
      expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'Choose an option');
    });

    it('does not render any explanatory copy of its own', () => {
      renderThree({ ariaLabel: 'Pick a direction' });
      // Sanity check: the prompt is expected to come from a sibling
      // agent-message component, so the ChoiceList root should contain no
      // loose text nodes other than the option labels/letters.
      expect(screen.queryByText('Pick a direction')).not.toBeInTheDocument();
    });

    it('assigns number badges 1, 2, 3 in document order', () => {
      renderThree();
      const items = screen.getAllByRole('option');
      const [first, second, third] = items;
      if (!first || !second || !third) throw new Error('expected three items');
      expect(within(first).getByText('1')).toBeInTheDocument();
      expect(within(second).getByText('2')).toBeInTheDocument();
      expect(within(third).getByText('3')).toBeInTheDocument();
    });

    it('honors a custom letter prop on an item', () => {
      render(
        <ChoiceList ariaLabel="Custom">
          <ChoiceList.Item value="first" letter="X">
            One
          </ChoiceList.Item>
          <ChoiceList.Item value="second">Two</ChoiceList.Item>
        </ChoiceList>,
      );
      const items = screen.getAllByRole('option');
      const [first, second] = items;
      if (!first || !second) throw new Error('expected two items');
      expect(within(first).getByText('X')).toBeInTheDocument();
      expect(within(second).getByText('2')).toBeInTheDocument();
    });

    it('continues numbering sequentially for large lists', () => {
      const manyItems = Array.from({ length: 30 }, (_, i) => ({
        value: `item-${i}`,
        label: `Item ${i}`,
      }));
      render(
        <ChoiceList ariaLabel="Long">
          {manyItems.map((item) => (
            <ChoiceList.Item key={item.value} value={item.value}>
              {item.label}
            </ChoiceList.Item>
          ))}
        </ChoiceList>,
      );
      const items = screen.getAllByRole('option');
      const tenth = items[9];
      const twentyFifth = items[24];
      const thirtieth = items[29];
      if (!tenth || !twentyFifth || !thirtieth) throw new Error('expected 30 items');
      expect(within(tenth).getByText('10')).toBeInTheDocument();
      expect(within(twentyFifth).getByText('25')).toBeInTheDocument();
      expect(within(thirtieth).getByText('30')).toBeInTheDocument();
    });

    it('skips non-ChoiceList.Item children', () => {
      render(
        <ChoiceList ariaLabel="Mixed">
          <ChoiceList.Item value="real">Real option</ChoiceList.Item>
          <div>Noise</div>
          {null}
          <ChoiceList.Item value="another">Another real option</ChoiceList.Item>
        </ChoiceList>,
      );
      expect(screen.getAllByRole('option')).toHaveLength(2);
    });

    it('forwards className and data-* attributes to the root', () => {
      const { container } = render(
        <ChoiceList ariaLabel="Pick" className="custom" data-testid="choice-list-root">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
          <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
        </ChoiceList>,
      );
      const root = container.querySelector('.airo-input-choice-list');
      expect(root).toHaveClass('custom');
      expect(root).toHaveAttribute('data-testid', 'choice-list-root');
    });

    it('adds listbox option-dividers class by default', () => {
      const { container } = renderThree();
      expect(
        container.querySelector('.airo-input-choice-list__listbox--option-dividers'),
      ).toBeInTheDocument();
    });

    it('does not add option-dividers class when optionDividers is false', () => {
      const { container } = renderThree({ optionDividers: false });
      expect(
        container.querySelector('.airo-input-choice-list__listbox--option-dividers'),
      ).not.toBeInTheDocument();
    });

    it('renders a decorative trailing chevron per single-select option', () => {
      const { container } = renderThree();
      const chevrons = container.querySelectorAll('.airo-input-choice-list__option-chevron');
      expect(chevrons).toHaveLength(3);
      for (const el of chevrons) {
        expect(el).toHaveAttribute('aria-hidden', 'true');
      }
    });
  });

  describe('decision event', () => {
    it('does not pre-select any option', () => {
      renderThree();
      for (const item of screen.getAllByRole('option')) {
        expect(item).not.toHaveAttribute('aria-selected', 'true');
      }
    });

    it('does not retain a selected option after a decision', async () => {
      const user = userEvent.setup();
      renderThree();

      await user.click(screen.getByRole('option', { name: /Launch a campaign/ }));

      // The menu is a decision surface — picking an option fires the
      // callback but must not mark the item as selected. The surrounding
      // chat flow is expected to unmount the menu (or replace it with a
      // confirmation) after the decision.
      for (const item of screen.getAllByRole('option')) {
        expect(item).not.toHaveAttribute('aria-selected', 'true');
      }
    });

    it('fires onDecision with the chosen value and an event', async () => {
      const user = userEvent.setup();
      const onDecision = vi.fn();
      renderThree({ onDecision });

      await user.click(screen.getByRole('option', { name: /Run research calls/ }));

      expect(onDecision).toHaveBeenCalledTimes(1);
      const firstCall = onDecision.mock.calls[0];
      if (!firstCall) throw new Error('expected onDecision to have been called');
      const [value, meta] = firstCall;
      expect(value).toBe('research');
      expect(meta).toHaveProperty('event');
    });

    it('also fires the deprecated onChange and onSelect aliases', async () => {
      const user = userEvent.setup();
      const onDecision = vi.fn();
      const onChange = vi.fn();
      const onSelect = vi.fn();
      renderThree({ onDecision, onChange, onSelect });

      await user.click(screen.getByRole('option', { name: /Build a landing page/ }));

      expect(onDecision).toHaveBeenCalledWith(
        'landing',
        expect.objectContaining({ event: expect.anything() }),
      );
      expect(onChange).toHaveBeenCalledWith(
        'landing',
        expect.objectContaining({ event: expect.anything() }),
      );
      expect(onSelect).toHaveBeenCalledWith('landing');
    });

    it('fires once per activation, not cumulatively', async () => {
      const user = userEvent.setup();
      const onDecision = vi.fn();
      renderThree({ onDecision });

      await user.click(screen.getByRole('option', { name: /Build a landing page/ }));
      await user.click(screen.getByRole('option', { name: /Run research calls/ }));

      expect(onDecision).toHaveBeenNthCalledWith(1, 'landing', expect.anything());
      expect(onDecision).toHaveBeenNthCalledWith(2, 'research', expect.anything());
    });
  });

  describe('keyboard', () => {
    it('dispatches a decision for the focused option on Enter', async () => {
      const user = userEvent.setup();
      const onDecision = vi.fn();
      renderThree({ onDecision });

      const listbox = screen.getByRole('listbox');
      listbox.focus();

      // Arrow down to the first option, then Enter to confirm.
      await user.keyboard('{ArrowDown}{Enter}');

      expect(onDecision).toHaveBeenCalledTimes(1);
      expect(onDecision).toHaveBeenCalledWith('landing', expect.anything());
    });
  });

  describe('ChoiceListItemContent', () => {
    it('injects the auto-assigned number into an explicit content element', () => {
      render(
        <ChoiceList ariaLabel="Injected number">
          <ChoiceList.Item value="alpha">
            <ChoiceListItemContent description="Alpha" />
          </ChoiceList.Item>
          <ChoiceList.Item value="bravo">
            <ChoiceListItemContent description="Bravo" />
          </ChoiceList.Item>
        </ChoiceList>,
      );
      const items = screen.getAllByRole('option');
      const [first, second] = items;
      if (!first || !second) throw new Error('expected two items');
      expect(within(first).getByText('1')).toBeInTheDocument();
      expect(within(second).getByText('2')).toBeInTheDocument();
    });

    it('respects a custom letter prop on the item when content is explicit', () => {
      render(
        <ChoiceList ariaLabel="Custom letter">
          <ChoiceList.Item value="alpha" letter="★">
            <ChoiceListItemContent description="Starred" />
          </ChoiceList.Item>
        </ChoiceList>,
      );
      expect(screen.getByText('★')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Starred/ })).toBeInTheDocument();
    });

    it('renders the image slot when provided and marks it aria-hidden', () => {
      render(
        <ChoiceList ariaLabel="With image">
          <ChoiceList.Item value="landing">
            <ChoiceListItemContent
              image={<span data-testid="thumb">[preview]</span>}
              description="Build a landing page"
            />
          </ChoiceList.Item>
        </ChoiceList>,
      );
      const option = screen.getByRole('option');
      const thumb = screen.getByTestId('thumb');
      expect(option).toContainElement(thumb);
      // The media wrapper is decorative — the accessible name comes from
      // the description and letter, not the image.
      const mediaWrapper = thumb.parentElement;
      expect(mediaWrapper).toHaveClass('airo-input-choice-list__item-content-media');
      expect(mediaWrapper).toHaveAttribute('aria-hidden', 'true');
    });

    it('allows mixing plain-string items and ChoiceListItemContent in one menu', () => {
      render(
        <ChoiceList ariaLabel="Mixed">
          <ChoiceList.Item value="plain">Plain option</ChoiceList.Item>
          <ChoiceList.Item value="rich">
            <ChoiceListItemContent image={<span>icon</span>} description="Rich option" />
          </ChoiceList.Item>
        </ChoiceList>,
      );
      const items = screen.getAllByRole('option');
      expect(items).toHaveLength(2);
      const [first, second] = items;
      if (!first || !second) throw new Error('expected two items');
      expect(within(first).getByText('1')).toBeInTheDocument();
      expect(within(second).getByText('2')).toBeInTheDocument();
      // The plain-string item has no image wrapper; the rich item does.
      expect(first.querySelector('.airo-input-choice-list__item-content-media')).toBeNull();
      expect(
        second.querySelector('.airo-input-choice-list__item-content-media'),
      ).toBeInTheDocument();
    });

    it('still fires onDecision with the value when the rich content variant is clicked', async () => {
      const user = userEvent.setup();
      const onDecision = vi.fn();
      render(
        <ChoiceList ariaLabel="Decision with image" onDecision={onDecision}>
          <ChoiceList.Item value="landing">
            <ChoiceListItemContent image={<span>icon</span>} description="Build a landing page" />
          </ChoiceList.Item>
        </ChoiceList>,
      );

      await user.click(screen.getByRole('option', { name: /Build a landing page/ }));

      expect(onDecision).toHaveBeenCalledWith('landing', expect.anything());
    });
  });

  describe('header chrome', () => {
    it('does not render a header when title is omitted', () => {
      renderThree();
      expect(document.querySelector('.airo-input-choice-list__header')).not.toBeInTheDocument();
    });

    it('renders a header with the title when title is provided', () => {
      render(
        <ChoiceList title="Pick a direction">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        </ChoiceList>,
      );
      expect(document.querySelector('.airo-input-choice-list__header')).toBeInTheDocument();
      expect(screen.getByText('Pick a direction')).toBeInTheDocument();
    });

    it('uses a string title as the listbox aria-label when no ariaLabel is supplied', () => {
      render(
        <ChoiceList title="Pick a direction">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        </ChoiceList>,
      );
      expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'Pick a direction');
    });

    it('prefers an explicit ariaLabel over a string title', () => {
      render(
        <ChoiceList title="Pick a direction" ariaLabel="Custom label">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        </ChoiceList>,
      );
      expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'Custom label');
    });

    it('renders a close button that fires onClose', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(
        <ChoiceList title="Closeable" onClose={onClose}>
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        </ChoiceList>,
      );
      const closeBtn = screen.getByRole('button', { name: 'Close' });
      await user.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not render a close button when onClose is omitted', () => {
      render(
        <ChoiceList title="No buttons">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        </ChoiceList>,
      );
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });
  });

  describe('multi-step mode (ChoiceList.Step)', () => {
    function renderTwoStep(props?: Partial<React.ComponentProps<typeof ChoiceList>>) {
      return render(
        <ChoiceList onComplete={vi.fn()} {...props}>
          <ChoiceList.Step id="style" title="What style do you prefer?">
            <ChoiceList.Item value="modern">Modern</ChoiceList.Item>
            <ChoiceList.Item value="classic">Classic</ChoiceList.Item>
          </ChoiceList.Step>
          <ChoiceList.Step id="color" title="Pick a color palette">
            <ChoiceList.Item value="warm">Warm and Bold</ChoiceList.Item>
            <ChoiceList.Item value="cool">Cool and Calm</ChoiceList.Item>
          </ChoiceList.Step>
        </ChoiceList>,
      );
    }

    it('renders the first step on mount with header and step indicator', () => {
      renderTwoStep();
      expect(screen.getByText('What style do you prefer?')).toBeInTheDocument();
      expect(screen.getByText('1 of 2')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Modern/ })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Classic/ })).toBeInTheDocument();
    });

    it('does not render the second step on mount', () => {
      renderTwoStep();
      expect(screen.queryByText('Pick a color palette')).not.toBeInTheDocument();
    });

    it('adds the multi-step modifier class', () => {
      const { container } = renderTwoStep();
      expect(container.querySelector('.airo-input-choice-list--multi-step')).toBeInTheDocument();
    });

    it('advances to the next step when the user makes a selection', async () => {
      const user = userEvent.setup();
      renderTwoStep();

      await user.click(screen.getByRole('option', { name: /Modern/ }));

      expect(screen.getByText('Pick a color palette')).toBeInTheDocument();
      expect(screen.getByText('2 of 2')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Warm and Bold/ })).toBeInTheDocument();
    });

    it('renders back and forward arrows in the footer', () => {
      renderTwoStep();
      expect(screen.getByRole('button', { name: 'Previous step' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next step' })).toBeInTheDocument();
    });

    it('disables back on the first step', () => {
      renderTwoStep();
      expect(screen.getByRole('button', { name: 'Previous step' })).toBeDisabled();
    });

    it('goes back to the previous step via the back button', async () => {
      const user = userEvent.setup();
      renderTwoStep();

      await user.click(screen.getByRole('option', { name: /Modern/ }));
      expect(screen.getByText('Pick a color palette')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Previous step' }));
      expect(screen.getByText('What style do you prefer?')).toBeInTheDocument();
      expect(screen.getByText('1 of 2')).toBeInTheDocument();
    });

    it('advances via forward arrow and records null for unanswered step', async () => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      renderTwoStep({ onComplete });

      await user.click(screen.getByRole('button', { name: 'Next step' }));
      expect(screen.getByText('Pick a color palette')).toBeInTheDocument();
      await user.click(screen.getByRole('option', { name: /Warm and Bold/ }));
      expect(onComplete).toHaveBeenCalledWith({ style: null, color: 'warm' });
    });

    it('fires onComplete with all selections after the last step', async () => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      renderTwoStep({ onComplete });

      await user.click(screen.getByRole('option', { name: /Modern/ }));
      await user.click(screen.getByRole('option', { name: /Cool and Calm/ }));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith({ style: 'modern', color: 'cool' });
    });

    it('fires onStepChange on each step selection', async () => {
      const user = userEvent.setup();
      const onStepChange = vi.fn();
      renderTwoStep({ onStepChange });

      await user.click(screen.getByRole('option', { name: /Classic/ }));
      expect(onStepChange).toHaveBeenCalledWith('style', 'classic');

      await user.click(screen.getByRole('option', { name: /Warm and Bold/ }));
      expect(onStepChange).toHaveBeenCalledWith('color', 'warm');
    });

    it('fires onClose when the close button is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderTwoStep({ onClose });

      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not render a close button when onClose is omitted', () => {
      renderTwoStep();
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('uses the step title as the listbox aria-label', () => {
      renderTwoStep();
      expect(screen.getByRole('listbox')).toHaveAttribute(
        'aria-label',
        'What style do you prefer?',
      );
    });

    it('calls onComplete immediately for a single step', async () => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      render(
        <ChoiceList onComplete={onComplete}>
          <ChoiceList.Step id="only" title="One question">
            <ChoiceList.Item value="yes">Yes</ChoiceList.Item>
            <ChoiceList.Item value="no">No</ChoiceList.Item>
          </ChoiceList.Step>
        </ChoiceList>,
      );

      await user.click(screen.getByRole('option', { name: /Yes/ }));
      expect(onComplete).toHaveBeenCalledWith({ only: 'yes' });
    });

    it('also fires onDecision per step in multi-step mode', async () => {
      const user = userEvent.setup();
      const onDecision = vi.fn();
      renderTwoStep({ onDecision });

      await user.click(screen.getByRole('option', { name: /Modern/ }));
      expect(onDecision).toHaveBeenCalledWith('modern', expect.anything());

      await user.click(screen.getByRole('option', { name: /Cool and Calm/ }));
      expect(onDecision).toHaveBeenCalledWith('cool', expect.anything());
    });

    it('restores single-select Other freeform when revisiting a step via Previous step', async () => {
      const user = userEvent.setup();
      render(
        <ChoiceList allowOther onComplete={vi.fn()}>
          <ChoiceList.Step id="topic" title="Pick topic">
            <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
          </ChoiceList.Step>
          <ChoiceList.Step id="extra" title="Pick extra">
            <ChoiceList.Item value="x">Option X</ChoiceList.Item>
          </ChoiceList.Step>
        </ChoiceList>,
      );
      const field = screen.getByRole('textbox');
      await user.type(field, 'My custom topic');
      await user.keyboard('{Enter}');
      expect(screen.getByText('Pick extra')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Previous step' }));
      expect(screen.getByText('Pick topic')).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toHaveValue('My custom topic');
    });

    describe('skip button', () => {
      it('always renders a Skip button in multi-step mode', () => {
        renderTwoStep();
        expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
      });

      it('records null and advances when Skip is clicked', async () => {
        const user = userEvent.setup();
        const onComplete = vi.fn();
        renderTwoStep({ onComplete });

        await user.click(screen.getByRole('button', { name: 'Skip' }));
        expect(screen.getByText('Pick a color palette')).toBeInTheDocument();
        await user.click(screen.getByRole('option', { name: /Cool and Calm/ }));
        expect(onComplete).toHaveBeenCalledWith({ style: null, color: 'cool' });
      });

      it('always overwrites prior selection with null when Skip is clicked', async () => {
        const user = userEvent.setup();
        const onComplete = vi.fn();
        renderTwoStep({ onComplete });

        await user.click(screen.getByRole('option', { name: /Modern/ }));
        await user.click(screen.getByRole('button', { name: 'Previous step' }));
        await user.click(screen.getByRole('button', { name: 'Skip' }));
        await user.click(screen.getByRole('option', { name: /Cool and Calm/ }));
        expect(onComplete).toHaveBeenCalledWith({ style: null, color: 'cool' });
      });

      it('fires onComplete when skipping the last step', async () => {
        const user = userEvent.setup();
        const onComplete = vi.fn();
        renderTwoStep({ onComplete });

        await user.click(screen.getByRole('option', { name: /Modern/ }));
        await user.click(screen.getByRole('button', { name: 'Skip' }));
        expect(onComplete).toHaveBeenCalledWith({ style: 'modern', color: null });
      });

      it('uses a custom skipLabel', () => {
        render(
          <ChoiceList onComplete={vi.fn()} skipLabel="Pass">
            <ChoiceList.Step id="a" title="Q1">
              <ChoiceList.Item value="x">X</ChoiceList.Item>
            </ChoiceList.Step>
            <ChoiceList.Step id="b" title="Q2">
              <ChoiceList.Item value="y">Y</ChoiceList.Item>
            </ChoiceList.Step>
          </ChoiceList>,
        );
        expect(screen.getByRole('button', { name: 'Pass' })).toBeInTheDocument();
      });
    });

    describe('forward arrow preserves existing answers', () => {
      it('keeps the existing answer when forward is clicked after answering', async () => {
        const user = userEvent.setup();
        const onComplete = vi.fn();
        renderTwoStep({ onComplete });

        await user.click(screen.getByRole('option', { name: /Modern/ }));
        await user.click(screen.getByRole('button', { name: 'Previous step' }));
        await user.click(screen.getByRole('button', { name: 'Next step' }));
        await user.click(screen.getByRole('option', { name: /Cool and Calm/ }));
        expect(onComplete).toHaveBeenCalledWith({ style: 'modern', color: 'cool' });
      });
    });

    describe('step indicator in footer', () => {
      it('renders step indicator in the footer for multi-step', () => {
        renderTwoStep();
        expect(screen.getByText('1 of 2')).toBeInTheDocument();
      });

      it('updates step indicator when advancing', async () => {
        const user = userEvent.setup();
        renderTwoStep();
        await user.click(screen.getByRole('option', { name: /Modern/ }));
        expect(screen.getByText('2 of 2')).toBeInTheDocument();
      });

      it('does not show step indicator for a single step', () => {
        render(
          <ChoiceList onComplete={vi.fn()}>
            <ChoiceList.Step id="only" title="One question">
              <ChoiceList.Item value="yes">Yes</ChoiceList.Item>
            </ChoiceList.Step>
          </ChoiceList>,
        );
        expect(screen.queryByText(/of/)).not.toBeInTheDocument();
      });
    });
  });
});

describe('multi-select mode', () => {
  function renderMultiSelect(props?: Partial<React.ComponentProps<typeof ChoiceList>>) {
    return render(
      <ChoiceList onComplete={vi.fn()} {...props}>
        <ChoiceList.Step id="features" title="What features do you need?" selectionMode="multiple">
          <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
          <ChoiceList.Item value="shop">Online shop</ChoiceList.Item>
          <ChoiceList.Item value="gallery">Photo gallery</ChoiceList.Item>
        </ChoiceList.Step>
        <ChoiceList.Step id="style" title="Pick a style">
          <ChoiceList.Item value="modern">Modern</ChoiceList.Item>
          <ChoiceList.Item value="classic">Classic</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
  }

  it('does not render single-select option chevrons on multi-select steps', () => {
    const { container } = render(
      <ChoiceList ariaLabel="Pick features">
        <ChoiceList.Step id="features" title="What features?" selectionMode="multiple">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
          <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    expect(container.querySelectorAll('.airo-input-choice-list__option-chevron')).toHaveLength(0);
  });

  it('adds multi-select option-dividers class when optionDividers is true', () => {
    const { container } = render(
      <ChoiceList ariaLabel="Pick features" optionDividers>
        <ChoiceList.Step id="features" title="What features?" selectionMode="multiple">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
          <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    expect(
      container.querySelector('.airo-input-choice-list__multi-option-list--option-dividers'),
    ).toBeInTheDocument();
  });

  it('renders checkbox rows instead of a listbox on a multi-select step', () => {
    renderMultiSelect();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders an always-enabled Continue button on multi-select steps', () => {
    renderMultiSelect();
    const btn = screen.getByRole('button', { name: 'Continue' });
    expect(btn).not.toBeDisabled();
  });

  it('toggles checkboxes on and off', async () => {
    const user = userEvent.setup();
    renderMultiSelect();
    const blog = screen.getByRole('checkbox', { name: /Blog/ });
    await user.click(blog);
    expect(blog).toBeChecked();
    await user.click(blog);
    expect(blog).not.toBeChecked();
  });

  it('toggles when clicking the row chrome (target is the row, not label/input)', () => {
    renderMultiSelect();
    const blog = screen.getByRole('checkbox', { name: /Blog/ });
    expect(blog).not.toBeChecked();
    const row = blog.closest('.airo-input-choice-list__multi-row');
    expect(row).toBeInstanceOf(HTMLElement);
    fireEvent.click(row as HTMLElement);
    expect(blog).toBeChecked();
    fireEvent.click(row as HTMLElement);
    expect(blog).not.toBeChecked();
  });

  it('preserves in-progress checkboxes when the parent re-renders mid-edit', async () => {
    // Why: the parent recreates <ChoiceList.Step> JSX on every render, so
    // `activeStep` and `collected` take fresh object identities even when the
    // user is on the same step. A previous bug had those objects in a
    // useEffect's deps, so a parent re-render mid-edit fired the effect, found
    // no committed selection for the active step, and reset multiChecked to [].
    const user = userEvent.setup();
    function Harness({ tick }: { tick: number }) {
      // `tick` is read so React sees a real prop change forcing the re-render.
      return (
        <div data-tick={tick}>
          <ChoiceList onComplete={vi.fn()}>
            <ChoiceList.Step
              id="features"
              title="What features do you need?"
              selectionMode="multiple"
            >
              <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
              <ChoiceList.Item value="shop">Online shop</ChoiceList.Item>
              <ChoiceList.Item value="gallery">Photo gallery</ChoiceList.Item>
            </ChoiceList.Step>
            <ChoiceList.Step id="style" title="Pick a style">
              <ChoiceList.Item value="modern">Modern</ChoiceList.Item>
              <ChoiceList.Item value="classic">Classic</ChoiceList.Item>
            </ChoiceList.Step>
          </ChoiceList>
        </div>
      );
    }

    const { rerender } = render(<Harness tick={0} />);
    await user.click(screen.getByRole('checkbox', { name: /Blog/ }));
    await user.click(screen.getByRole('checkbox', { name: /Photo gallery/ }));
    expect(screen.getByRole('checkbox', { name: /Blog/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Photo gallery/ })).toBeChecked();

    rerender(<Harness tick={1} />);

    expect(screen.getByRole('checkbox', { name: /Blog/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Photo gallery/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Online shop/ })).not.toBeChecked();
  });

  it('advances to the next step on Continue with multiple selections', async () => {
    const user = userEvent.setup();
    renderMultiSelect();
    await user.click(screen.getByRole('checkbox', { name: /Blog/i }));
    await user.click(screen.getByRole('checkbox', { name: /gallery/i }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Pick a style')).toBeInTheDocument();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('fires onComplete with string[] for multi-select steps and string for single-select', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderMultiSelect({ onComplete });
    await user.click(screen.getByRole('checkbox', { name: /Blog/i }));
    await user.click(screen.getByRole('checkbox', { name: /shop/i }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('option', { name: /Modern/ }));
    expect(onComplete).toHaveBeenCalledWith({
      features: ['blog', 'shop'],
      style: 'modern',
    });
  });

  it('records null when Continue is clicked with no selections', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderMultiSelect({ onComplete });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('option', { name: /Modern/ }));
    expect(onComplete).toHaveBeenCalledWith({ features: null, style: 'modern' });
  });

  it('does not show number badges on multi-select items', () => {
    renderMultiSelect();
    const blogRow = screen
      .getByRole('checkbox', { name: /Blog/i })
      .closest('.airo-input-choice-list__multi-row');
    const shopRow = screen
      .getByRole('checkbox', { name: /Online shop/i })
      .closest('.airo-input-choice-list__multi-row');
    const galleryRow = screen
      .getByRole('checkbox', { name: /Photo gallery/i })
      .closest('.airo-input-choice-list__multi-row');
    expect(blogRow).toBeInstanceOf(HTMLElement);
    expect(shopRow).toBeInstanceOf(HTMLElement);
    expect(galleryRow).toBeInstanceOf(HTMLElement);
    expect(within(blogRow as HTMLElement).queryByText('1')).not.toBeInTheDocument();
    expect(within(shopRow as HTMLElement).queryByText('2')).not.toBeInTheDocument();
    expect(within(galleryRow as HTMLElement).queryByText('3')).not.toBeInTheDocument();
  });

  it('uses a custom continueLabel when provided', () => {
    render(
      <ChoiceList onComplete={vi.fn()} continueLabel="Next">
        <ChoiceList.Step id="features" title="Pick features" selectionMode="multiple">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('fires onStepChange with an array on Continue', async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    renderMultiSelect({ onStepChange });
    await user.click(screen.getByRole('checkbox', { name: /shop/i }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onStepChange).toHaveBeenCalledWith('features', ['shop']);
  });

  describe('keyboard navigation', () => {
    it('moves focus between checkboxes with ArrowDown and ArrowUp', async () => {
      const user = userEvent.setup();
      renderMultiSelect({ loop: true });
      const checkboxes = screen.getAllByRole('checkbox');
      const [blog, shop, gallery] = checkboxes;
      if (!blog || !shop || !gallery) throw new Error('expected three checkboxes');

      await user.click(blog);
      expect(blog).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect(shop).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect(gallery).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect(blog).toHaveFocus();

      await user.keyboard('{ArrowUp}');
      expect(gallery).toHaveFocus();
    });

    it('clamps at boundaries when loop is false', async () => {
      const user = userEvent.setup();
      renderMultiSelect();
      const checkboxes = screen.getAllByRole('checkbox');
      const [blog, , gallery] = checkboxes;
      if (!blog || !gallery) throw new Error('expected three checkboxes');

      await user.click(blog);
      await user.keyboard('{ArrowUp}');
      expect(blog).toHaveFocus();

      await user.click(gallery);
      await user.keyboard('{ArrowDown}');
      expect(gallery).toHaveFocus();
    });

    it('moves focus to first/last with Home and End', async () => {
      const user = userEvent.setup();
      renderMultiSelect();
      const checkboxes = screen.getAllByRole('checkbox');
      const [blog, , gallery] = checkboxes;
      if (!blog || !gallery) throw new Error('expected three checkboxes');

      await user.click(blog);
      await user.keyboard('{End}');
      expect(gallery).toHaveFocus();

      await user.keyboard('{Home}');
      expect(blog).toHaveFocus();
    });

    it('toggles a checkbox with Space', async () => {
      const user = userEvent.setup();
      renderMultiSelect();
      const blog = screen.getByRole('checkbox', { name: /Blog/i });

      await user.click(blog);
      expect(blog).toBeChecked();

      await user.keyboard('{ }');
      expect(blog).not.toBeChecked();

      await user.keyboard('{ }');
      expect(blog).toBeChecked();
    });

    it('toggles a checkbox with Enter', async () => {
      const user = userEvent.setup();
      renderMultiSelect();
      const blog = screen.getByRole('checkbox', { name: /Blog/i });

      await user.click(blog);
      expect(blog).toBeChecked();

      await user.keyboard('{Enter}');
      expect(blog).not.toBeChecked();
    });
  });

  it('appends trimmed other text on Continue when allowOther and custom text is enabled', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <ChoiceList allowOther onComplete={onComplete}>
        <ChoiceList.Step id="features" title="Pick features" selectionMode="multiple">
          <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    await user.click(screen.getByRole('checkbox', { name: /Enable custom text/i }));
    await user.type(screen.getByRole('textbox'), 'Custom work');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onComplete).toHaveBeenCalledWith({ features: ['Custom work'] });
  });

  it('merges other text with checked items on Continue', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <ChoiceList allowOther onComplete={onComplete}>
        <ChoiceList.Step id="features" title="Pick features" selectionMode="multiple">
          <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    await user.click(screen.getByRole('checkbox', { name: /Blog/i }));
    await user.click(screen.getByRole('checkbox', { name: /Enable custom text/i }));
    await user.type(screen.getByRole('textbox'), 'Also this');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onComplete).toHaveBeenCalledWith({ features: ['blog', 'Also this'] });
  });

  it('deduplicates Other text when it matches an already-checked option id', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <ChoiceList allowOther onComplete={onComplete}>
        <ChoiceList.Step id="features" title="Pick features" selectionMode="multiple">
          <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    await user.click(screen.getByRole('checkbox', { name: /Blog/i }));
    await user.click(screen.getByRole('checkbox', { name: /Enable custom text/i }));
    await user.type(screen.getByRole('textbox'), 'blog');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onComplete).toHaveBeenCalledWith({ features: ['blog'] });
  });

  it('fires Continue from Other TextEntry on Enter when checked and non-empty', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <ChoiceList allowOther onComplete={onComplete}>
        <ChoiceList.Step id="features" title="Pick features" selectionMode="multiple">
          <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    await user.click(screen.getByRole('checkbox', { name: /Enable custom text/i }));
    const field = screen.getByRole('textbox');
    await user.type(field, 'Typed other');
    await user.keyboard('{Enter}');
    expect(onComplete).toHaveBeenCalledWith({ features: ['Typed other'] });
  });

  it('restores Other row and checkboxes when returning to a multi-select step via Back', async () => {
    const user = userEvent.setup();
    render(
      <ChoiceList allowOther onComplete={vi.fn()}>
        <ChoiceList.Step id="features" title="Pick features" selectionMode="multiple">
          <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
          <ChoiceList.Item value="shop">Online shop</ChoiceList.Item>
        </ChoiceList.Step>
        <ChoiceList.Step id="style" title="Pick style">
          <ChoiceList.Item value="modern">Modern</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    await user.click(screen.getByRole('checkbox', { name: /Blog/i }));
    await user.click(screen.getByRole('checkbox', { name: /Enable custom text/i }));
    await user.type(screen.getByPlaceholderText('Type your own'), 'Custom note');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Pick style')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous step' }));
    expect(screen.getByText('Pick features')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type your own')).toHaveValue('Custom note');
    expect(screen.getByRole('checkbox', { name: /Enable custom text/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Blog/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Online shop/i })).not.toBeChecked();
  });

  it('checks the other checkbox on first TextEntry focus and does not re-check after uncheck', async () => {
    const user = userEvent.setup();
    render(
      <ChoiceList allowOther onComplete={vi.fn()}>
        <ChoiceList.Step id="features" title="Pick features" selectionMode="multiple">
          <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    const otherCb = screen.getByRole('checkbox', { name: /Enable custom text/i });
    const field = screen.getByRole('textbox');
    expect(otherCb).not.toBeChecked();
    await user.click(field);
    expect(otherCb).toBeChecked();
    await user.click(otherCb);
    expect(otherCb).not.toBeChecked();
    await user.click(field);
    expect(otherCb).not.toBeChecked();
  });

  it('allows Continue with only custom text after focusing the TextEntry first', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <ChoiceList allowOther onComplete={onComplete}>
        <ChoiceList.Step id="features" title="Pick features" selectionMode="multiple">
          <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    const field = screen.getByRole('textbox');
    await user.click(field);
    await user.type(field, 'Only custom');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onComplete).toHaveBeenCalledWith({ features: ['Only custom'] });
  });

  it('multi-step: when Other freeform equals an option id, Back restores that id as a checkbox (ambiguous encoding)', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <ChoiceList allowOther onComplete={onComplete}>
        <ChoiceList.Step id="focus" title="Step A" selectionMode="multiple">
          <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
          <ChoiceList.Item value="shop">Shop</ChoiceList.Item>
        </ChoiceList.Step>
        <ChoiceList.Step id="extra" title="Step B">
          <ChoiceList.Item value="x">Option X</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    const field = screen.getByRole('textbox');
    await user.click(field);
    await user.type(field, 'shop');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onComplete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('option', { name: /Option X/ }));
    expect(onComplete).toHaveBeenCalledWith({ focus: ['shop'], extra: 'x' });
    await user.click(screen.getByRole('button', { name: 'Previous step' }));
    expect(screen.getByRole('checkbox', { name: /Shop/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Enable custom text/i })).not.toBeChecked();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});

describe('ChoiceList allowOther (single-select)', () => {
  it('submits trimmed freeform text on Enter', async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    render(
      <ChoiceList ariaLabel="Pick" allowOther onDecision={onDecision}>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    expect(screen.getByPlaceholderText('Type your own')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), '  my idea  ');
    await user.keyboard('{Enter}');
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith(
      'my idea',
      expect.objectContaining({ event: expect.anything() }),
    );
  });

  it('uses otherPlaceholder for the field hint', () => {
    render(
      <ChoiceList ariaLabel="Pick" allowOther otherPlaceholder="Something else">
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    expect(screen.getByPlaceholderText('Something else')).toBeInTheDocument();
  });

  it('maps deprecated string otherLabel to placeholder when otherPlaceholder is omitted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(function () {});
    render(
      <ChoiceList ariaLabel="Pick" allowOther otherLabel="Legacy hint">
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    expect(screen.getByPlaceholderText('Legacy hint')).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(
      '[@airo-ux/pattern-library ChoiceList] `otherLabel` is deprecated; use `otherPlaceholder` instead.',
    );
    warn.mockRestore();
  });

  it('moves focus from the last listbox option to the Other field on ArrowDown when loop is false', async () => {
    const user = userEvent.setup();
    render(
      <ChoiceList ariaLabel="Pick" allowOther onDecision={vi.fn()}>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
      </ChoiceList>,
    );
    const listbox = screen.getByRole('listbox');
    listbox.focus();
    const field = screen.getByPlaceholderText('Type your own');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    expect(field).not.toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(field).toHaveFocus();
  });

  it('does not move focus to Other from the last option when loop is true', async () => {
    const user = userEvent.setup();
    render(
      <ChoiceList ariaLabel="Pick" allowOther loop onDecision={vi.fn()}>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
      </ChoiceList>,
    );
    const listbox = screen.getByRole('listbox');
    listbox.focus();
    const field = screen.getByPlaceholderText('Type your own');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    expect(field).not.toHaveFocus();
    expect(listbox).toHaveFocus();
  });

  it('returns focus to the listbox from the Other field on ArrowUp at caret start', async () => {
    const user = userEvent.setup();
    render(
      <ChoiceList ariaLabel="Pick" allowOther onDecision={vi.fn()}>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
      </ChoiceList>,
    );
    const listbox = screen.getByRole('listbox');
    const field = screen.getByPlaceholderText('Type your own');
    listbox.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(field).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(listbox).toHaveFocus();
  });
});

describe('ChoiceList disabled', () => {
  it('adds the disabled modifier class', () => {
    const { container } = render(
      <ChoiceList ariaLabel="Pick" disabled>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    expect(container.querySelector('.airo-input-choice-list--disabled')).toBeInTheDocument();
  });

  it('puts inert, aria-disabled, and the disabled modifier on the root when disabled', () => {
    const { container } = render(
      <ChoiceList ariaLabel="Pick" disabled>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    const root = container.querySelector('.airo-input-choice-list');
    expect(root).toHaveClass('airo-input-choice-list--disabled');
    expect(root).toHaveAttribute('aria-disabled', 'true');
    expect(root).toHaveAttribute('inert');
  });

  it('marks the allowOther text field disabled when the list is disabled', () => {
    render(
      <ChoiceList ariaLabel="Pick" allowOther disabled onDecision={vi.fn()}>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('does not fire onComplete when multi-step ChoiceList is disabled and Skip is pressed', async () => {
    // `pointerEventsCheck: 0` bypasses user-event's preflight that refuses to click
    // into a subtree with `pointer-events: none` (applied by the disabled root). The
    // test still verifies the real assertion: disabled controls don't invoke handlers.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onComplete = vi.fn();
    render(
      <ChoiceList disabled onComplete={onComplete}>
        <ChoiceList.Step id="a" title="Q1">
          <ChoiceList.Item value="x">X</ChoiceList.Item>
        </ChoiceList.Step>
        <ChoiceList.Step id="b" title="Q2">
          <ChoiceList.Item value="y">Y</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('disables the multi-select fieldset when the list is disabled', () => {
    render(
      <ChoiceList disabled>
        <ChoiceList.Step id="features" title="Pick features" selectionMode="multiple">
          <ChoiceList.Item value="a">A</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    expect(screen.getByRole('group')).toBeDisabled();
  });

  it('does not fire onDecision when disabled', async () => {
    // `pointerEventsCheck: 0` bypasses user-event's preflight that refuses to click
    // into a subtree with `pointer-events: none` (applied by the disabled root). The
    // test still verifies the real assertion: disabled controls don't invoke handlers.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onDecision = vi.fn();
    render(
      <ChoiceList ariaLabel="Pick" disabled onDecision={onDecision}>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    await user.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(onDecision).not.toHaveBeenCalled();
  });

  it('does not submit allowOther when disabled', async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    render(
      <ChoiceList ariaLabel="Pick" allowOther disabled onDecision={onDecision}>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    const field = screen.getByRole('textbox');
    await user.type(field, 'nope');
    await user.keyboard('{Enter}');
    expect(onDecision).not.toHaveBeenCalled();
  });
});

// ── Sentinel components (ChoiceList reads their type/props, never renders them) ──

describe('ChoiceListItem sentinel', () => {
  it('renders nothing when mounted directly', () => {
    const { container } = render(
      <ChoiceListItem value="test">Build a landing page</ChoiceListItem>,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('ChoiceListStep sentinel', () => {
  it('renders nothing when mounted directly', () => {
    const { container } = render(
      <ChoiceListStep id="step-1" title="Step 1">
        <ChoiceListItem value="a">Option A</ChoiceListItem>
      </ChoiceListStep>,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('onActiveStepChange', () => {
  function TwoStep(props: Partial<React.ComponentProps<typeof ChoiceList>>) {
    return (
      <ChoiceList onComplete={vi.fn()} {...props}>
        <ChoiceList.Step id="first" title="Step one">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        </ChoiceList.Step>
        <ChoiceList.Step id="second" title="Step two">
          <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>
    );
  }

  it('fires on initial mount with the first step id and index 0', () => {
    const onActiveStepChange = vi.fn();
    render(<TwoStep onActiveStepChange={onActiveStepChange} />);
    expect(onActiveStepChange).toHaveBeenCalledTimes(1);
    expect(onActiveStepChange).toHaveBeenCalledWith('first', 0);
  });

  it('fires on forward navigation with the new step id and index', async () => {
    const user = userEvent.setup();
    const onActiveStepChange = vi.fn();
    render(<TwoStep onActiveStepChange={onActiveStepChange} />);
    onActiveStepChange.mockClear();
    await user.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(onActiveStepChange).toHaveBeenCalledTimes(1);
    expect(onActiveStepChange).toHaveBeenCalledWith('second', 1);
  });

  it('fires on back navigation', async () => {
    const user = userEvent.setup();
    const onActiveStepChange = vi.fn();
    render(<TwoStep onActiveStepChange={onActiveStepChange} />);
    await user.click(screen.getByRole('option', { name: /Alpha/ }));
    onActiveStepChange.mockClear();
    await user.click(screen.getByRole('button', { name: 'Previous step' }));
    expect(onActiveStepChange).toHaveBeenCalledTimes(1);
    expect(onActiveStepChange).toHaveBeenCalledWith('first', 0);
  });

  it('does not fire on unrelated re-renders that preserve the active step', () => {
    const onActiveStepChange = vi.fn();
    const { rerender } = render(<TwoStep onActiveStepChange={onActiveStepChange} />);
    onActiveStepChange.mockClear();
    // Re-render with a new function reference but same step index — should not fire again.
    rerender(<TwoStep onActiveStepChange={vi.fn()} />);
    expect(onActiveStepChange).not.toHaveBeenCalled();
  });
});

describe('per-step otherPlaceholder / otherAriaLabel overrides', () => {
  it('uses the step-level placeholder when provided', async () => {
    const user = userEvent.setup();
    render(
      <ChoiceList allowOther otherPlaceholder="Root placeholder" onComplete={vi.fn()}>
        <ChoiceList.Step id="first" title="Step one" otherPlaceholder="Step one hint">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        </ChoiceList.Step>
        <ChoiceList.Step id="second" title="Step two">
          <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    expect(screen.getByPlaceholderText('Step one hint')).toBeInTheDocument();
    // Advance to second step (no per-step override → falls back to root).
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByPlaceholderText('Root placeholder')).toBeInTheDocument();
  });

  it('falls back to the package default when neither step nor root provides a placeholder', () => {
    render(
      <ChoiceList allowOther onComplete={vi.fn()}>
        <ChoiceList.Step id="only" title="Step">
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
        </ChoiceList.Step>
      </ChoiceList>,
    );
    expect(screen.getByPlaceholderText('Type your own')).toBeInTheDocument();
  });
});

describe('allowOther submit button (single-select)', () => {
  it('clicking the submit button fires onDecision with trimmed text', async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    render(
      <ChoiceList ariaLabel="Pick" allowOther onDecision={onDecision}>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    await user.type(screen.getByRole('textbox'), '  my idea  ');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith(
      'my idea',
      expect.objectContaining({ event: expect.anything() }),
    );
  });

  it('submit button is disabled when the field is empty', () => {
    render(
      <ChoiceList ariaLabel="Pick" allowOther onDecision={vi.fn()}>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('submit button is disabled for whitespace-only input', async () => {
    const user = userEvent.setup();
    render(
      <ChoiceList ariaLabel="Pick" allowOther onDecision={vi.fn()}>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    await user.type(screen.getByRole('textbox'), '   ');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('uses otherSubmitLabel for the submit button accessible name', () => {
    render(
      <ChoiceList ariaLabel="Pick" allowOther otherSubmitLabel="Go" onDecision={vi.fn()}>
        <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
      </ChoiceList>,
    );
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });
});

describe('ChoiceList numberKeyShortcuts', () => {
  function renderFive(
    props?: Partial<React.ComponentProps<typeof ChoiceList>>,
  ): ReturnType<typeof render> {
    return render(
      <ChoiceList ariaLabel="Pick a direction" {...props}>
        <ChoiceList.Item value="one">Option one</ChoiceList.Item>
        <ChoiceList.Item value="two">Option two</ChoiceList.Item>
        <ChoiceList.Item value="three">Option three</ChoiceList.Item>
        <ChoiceList.Item value="four">Option four</ChoiceList.Item>
        <ChoiceList.Item value="five">Option five</ChoiceList.Item>
      </ChoiceList>,
    );
  }

  describe('single-select, listenOn: self (default)', () => {
    it('moves focus to the Nth option without committing', async () => {
      const user = userEvent.setup();
      const onDecision = vi.fn();
      renderFive({ numberKeyShortcuts: true, onDecision });

      const listbox = screen.getByRole('listbox');
      listbox.focus();

      await user.keyboard('3');

      const options = screen.getAllByRole('option');
      const third = options[2];
      if (!third) throw new Error('expected three options');
      // DOM focus moves directly to the option button so the browser's
      // native focus ring follows.
      expect(document.activeElement).toBe(third);
      expect(onDecision).not.toHaveBeenCalled();
    });

    it('after focusing via number key, ArrowDown advances to the next option', async () => {
      const user = userEvent.setup();
      renderFive({ numberKeyShortcuts: true });

      const listbox = screen.getByRole('listbox');
      listbox.focus();

      await user.keyboard('2{ArrowDown}');

      const options = screen.getAllByRole('option');
      const third = options[2];
      if (!third) throw new Error('expected three options');
      // The wrap intercepts ArrowDown when an option is focused and
      // walks DOM focus to the next option — bypassing the listbox's
      // stale internal active-id state.
      expect(document.activeElement).toBe(third);
    });

    it('Enter on the focused option commits as usual', async () => {
      const user = userEvent.setup();
      const onDecision = vi.fn();
      renderFive({ numberKeyShortcuts: true, onDecision });

      screen.getByRole('listbox').focus();
      await user.keyboard('2{Enter}');

      expect(onDecision).toHaveBeenCalledTimes(1);
      expect(onDecision).toHaveBeenCalledWith('two', expect.anything());
    });

    it('does not focus anything when N exceeds the number of options', async () => {
      const user = userEvent.setup();
      renderFive({ numberKeyShortcuts: true });

      const listbox = screen.getByRole('listbox');
      listbox.focus();
      await user.keyboard('7');

      // Focus stays on the listbox container (no option focus moved).
      const options = screen.getAllByRole('option');
      for (const opt of options) {
        expect(document.activeElement).not.toBe(opt);
      }
    });

    it('is on by default (prop omitted)', async () => {
      const user = userEvent.setup();
      renderFive();

      screen.getByRole('listbox').focus();
      await user.keyboard('3');

      const options = screen.getAllByRole('option');
      const third = options[2];
      if (!third) throw new Error('expected three options');
      expect(document.activeElement).toBe(third);
    });

    it('is a no-op when explicitly opted out via numberKeyShortcuts={false}', async () => {
      const user = userEvent.setup();
      renderFive({ numberKeyShortcuts: false });

      const listbox = screen.getByRole('listbox');
      listbox.focus();
      await user.keyboard('3');

      const options = screen.getAllByRole('option');
      const third = options[2];
      if (!third) throw new Error('expected three options');
      expect(document.activeElement).not.toBe(third);
    });

    it('respects the enabled flag on the config object', async () => {
      const user = userEvent.setup();
      renderFive({ numberKeyShortcuts: { enabled: false } });

      const listbox = screen.getByRole('listbox');
      listbox.focus();
      await user.keyboard('2');

      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      expect(document.activeElement).not.toBe(second);
    });

    it('does not fire when modifier keys are held', async () => {
      const user = userEvent.setup();
      renderFive({ numberKeyShortcuts: true });

      const listbox = screen.getByRole('listbox');
      listbox.focus();
      await user.keyboard('{Meta>}2{/Meta}');
      await user.keyboard('{Control>}2{/Control}');
      await user.keyboard('{Alt>}2{/Alt}');

      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      expect(document.activeElement).not.toBe(second);
    });

    it('does not fire when ChoiceList is disabled', async () => {
      const user = userEvent.setup();
      renderFive({ numberKeyShortcuts: true, disabled: true });

      const listbox = screen.getByRole('listbox');
      listbox.focus();
      await user.keyboard('2');

      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      expect(document.activeElement).not.toBe(second);
    });
  });

  describe('single-select with allowOther', () => {
    it('does not hijack number keys when focus is in the Other input', async () => {
      const user = userEvent.setup();
      const onDecision = vi.fn();
      render(
        <ChoiceList ariaLabel="Pick" allowOther numberKeyShortcuts onDecision={onDecision}>
          <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
          <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
          <ChoiceList.Item value="c">Charlie</ChoiceList.Item>
        </ChoiceList>,
      );

      const otherField = screen.getByRole('textbox');
      otherField.focus();
      await user.keyboard('2');

      expect(otherField).toHaveValue('2');
      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      expect(document.activeElement).not.toBe(second);
      expect(onDecision).not.toHaveBeenCalled();
    });
  });

  describe('listenOn: document + scope', () => {
    function HarnessWithScope(props: { shortcuts: ChoiceListNumberKeyShortcutsConfig }) {
      const scopeRef = useRef<HTMLDivElement>(null);
      return (
        <div>
          <div ref={scopeRef}>
            <input data-testid="scoped-input" placeholder="Scoped" />
          </div>
          <input data-testid="unscoped-input" placeholder="Unscoped" />
          <ChoiceList ariaLabel="Pick" numberKeyShortcuts={{ ...props.shortcuts, scope: scopeRef }}>
            <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
            <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
            <ChoiceList.Item value="c">Charlie</ChoiceList.Item>
          </ChoiceList>
        </div>
      );
    }

    it('fires when the keypress target is inside the scope ref', async () => {
      const user = userEvent.setup();
      render(<HarnessWithScope shortcuts={{ listenOn: 'document' }} />);

      const scoped = screen.getByTestId('scoped-input');
      scoped.focus();
      await user.keyboard('2');

      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      expect(document.activeElement).toBe(second);
    });

    it('does not fire when the keypress target is outside the scope ref', async () => {
      const user = userEvent.setup();
      render(<HarnessWithScope shortcuts={{ listenOn: 'document' }} />);

      const unscoped = screen.getByTestId('unscoped-input');
      unscoped.focus();
      await user.keyboard('2');

      expect(unscoped).toHaveValue('2');
      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      expect(document.activeElement).not.toBe(second);
    });

    it('still fires when focus is already inside the ChoiceList itself', async () => {
      // `'document'` mode is a superset of `'self'`: tabbing into the list
      // must not break the digit shortcut for the user.
      const user = userEvent.setup();
      render(<HarnessWithScope shortcuts={{ listenOn: 'document' }} />);

      const options = screen.getAllByRole('option');
      const first = options[0];
      const third = options[2];
      if (!first || !third) throw new Error('expected options');
      first.focus();
      expect(document.activeElement).toBe(first);

      await user.keyboard('3');

      expect(document.activeElement).toBe(third);
    });
  });

  describe('exclude refs', () => {
    function HarnessWithExclude() {
      const excludeRef = useRef<HTMLDivElement>(null);
      return (
        <div>
          <div ref={excludeRef}>
            <input data-testid="excluded-input" placeholder="Excluded" />
          </div>
          <ChoiceList
            ariaLabel="Pick"
            numberKeyShortcuts={{ listenOn: 'document', exclude: excludeRef }}
          >
            <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
            <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
            <ChoiceList.Item value="c">Charlie</ChoiceList.Item>
          </ChoiceList>
        </div>
      );
    }

    it('does not fire when the target is inside an excluded ref', async () => {
      const user = userEvent.setup();
      render(<HarnessWithExclude />);

      const excluded = screen.getByTestId('excluded-input');
      excluded.focus();
      await user.keyboard('2');

      expect(excluded).toHaveValue('2');
      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      expect(document.activeElement).not.toBe(second);
    });
  });

  describe('multi-select', () => {
    function renderMulti(
      props?: Partial<React.ComponentProps<typeof ChoiceList>>,
    ): ReturnType<typeof render> {
      return render(
        <ChoiceList onComplete={vi.fn()} {...props}>
          <ChoiceList.Step id="features" title="Features" selectionMode="multiple">
            <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
            <ChoiceList.Item value="shop">Online shop</ChoiceList.Item>
            <ChoiceList.Item value="gallery">Photo gallery</ChoiceList.Item>
            <ChoiceList.Item value="forum">Forum</ChoiceList.Item>
          </ChoiceList.Step>
        </ChoiceList>,
      );
    }

    it('focuses the Nth checkbox', async () => {
      const user = userEvent.setup();
      renderMulti({ numberKeyShortcuts: true });

      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes[0]?.focus();
      await user.keyboard('3');

      expect(document.activeElement).toBe(checkboxes[2]);
      expect(checkboxes[2]).not.toBeChecked();
    });

    it('after focusing via number key, ArrowDown moves to the next row (activeIndex sync)', async () => {
      const user = userEvent.setup();
      renderMulti({ numberKeyShortcuts: true });

      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes[0]?.focus();
      await user.keyboard('2{ArrowDown}');

      expect(document.activeElement).toBe(checkboxes[2]);
    });

    it('does not hijack number keys inside the multi Other text field', async () => {
      const user = userEvent.setup();
      render(
        <ChoiceList ariaLabel="Pick" allowOther numberKeyShortcuts onComplete={vi.fn()}>
          <ChoiceList.Step id="features" title="Features" selectionMode="multiple">
            <ChoiceList.Item value="blog">Blog</ChoiceList.Item>
            <ChoiceList.Item value="shop">Online shop</ChoiceList.Item>
            <ChoiceList.Item value="gallery">Photo gallery</ChoiceList.Item>
          </ChoiceList.Step>
        </ChoiceList>,
      );

      const otherField = screen.getByRole('textbox');
      otherField.focus();
      await user.keyboard('2');

      expect(otherField).toHaveValue('2');
      const checkboxes = screen.getAllByRole('checkbox');
      // The first 3 are option checkboxes; 4th is the "other" checkbox.
      const second = checkboxes[1];
      if (!second) throw new Error('expected checkboxes');
      expect(document.activeElement).not.toBe(second);
    });
  });

  describe('auto-promotion via ChoiceListShortcutScopeContext', () => {
    function HarnessWithContext({
      shortcuts,
    }: {
      shortcuts?: boolean | ChoiceListNumberKeyShortcutsConfig;
    }) {
      const companionRef = useRef<HTMLTextAreaElement>(null);
      return (
        <ChoiceListShortcutScopeContext.Provider value={companionRef}>
          <textarea data-testid="companion" ref={companionRef} />
          <ChoiceList ariaLabel="Pick" numberKeyShortcuts={shortcuts}>
            <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
            <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
            <ChoiceList.Item value="c">Charlie</ChoiceList.Item>
          </ChoiceList>
        </ChoiceListShortcutScopeContext.Provider>
      );
    }

    it('auto-scopes to the companion ref when no explicit config is passed', async () => {
      const user = userEvent.setup();
      render(<HarnessWithContext />);

      const companion = screen.getByTestId('companion');
      companion.focus();
      await user.keyboard('2');

      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      expect(document.activeElement).toBe(second);
      expect(companion).toHaveValue('');
    });

    it('still fires when focus is already inside the ChoiceList surface', async () => {
      const user = userEvent.setup();
      render(<HarnessWithContext />);

      const options = screen.getAllByRole('option');
      const first = options[0];
      if (!first) throw new Error('expected options');
      first.focus();
      await user.keyboard('3');

      const third = options[2];
      if (!third) throw new Error('expected options');
      expect(document.activeElement).toBe(third);
    });

    it('does not fire when focus is outside both the companion and the ChoiceList', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <input data-testid="outside" />
          <HarnessWithContext />
        </div>,
      );

      const outside = screen.getByTestId('outside');
      outside.focus();
      await user.keyboard('2');

      expect(outside).toHaveValue('2');
      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      expect(document.activeElement).not.toBe(second);
    });

    it('honors an explicit object config and does not auto-promote', async () => {
      const user = userEvent.setup();
      render(<HarnessWithContext shortcuts={{ enabled: false }} />);

      const companion = screen.getByTestId('companion');
      companion.focus();
      await user.keyboard('2');

      // Explicit config disabled the shortcut; companion captured the digit.
      expect(companion).toHaveValue('2');
      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      expect(document.activeElement).not.toBe(second);
    });

    it('falls back to self-mode when context is null', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <textarea data-testid="loose-textarea" />
          <ChoiceList ariaLabel="Pick">
            <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
            <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
            <ChoiceList.Item value="c">Charlie</ChoiceList.Item>
          </ChoiceList>
        </div>,
      );

      const loose = screen.getByTestId('loose-textarea');
      loose.focus();
      await user.keyboard('2');

      // No context provider → default 'self' mode → typing in an unrelated
      // textarea should NOT focus an option.
      expect(loose).toHaveValue('2');
      const options = screen.getAllByRole('option');
      const second = options[1];
      if (!second) throw new Error('expected options');
      expect(document.activeElement).not.toBe(second);
    });
  });
});
