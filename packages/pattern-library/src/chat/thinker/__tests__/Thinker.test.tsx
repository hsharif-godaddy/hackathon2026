import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { Thinker } from '../index';

beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(function (input) {
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;

    if (url.includes('/ux-assets/@ux/icon/')) {
      return Promise.resolve(
        new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        }),
      );
    }

    return Promise.reject(new Error(`Unexpected fetch in Thinker tests: ${url}`));
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

function mockReasoningOverflow() {
  const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollHeight',
  );
  const restoreDescriptor = scrollHeightDescriptor ?? {
    configurable: true,
    get() {
      return 0;
    },
  };

  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return this.classList.contains('airo-chat-thinker__reasoning-block-content') ? 96 : 0;
    },
  });

  return () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', restoreDescriptor);
  };
}

function getRenderedIconReference(container: HTMLElement) {
  const use = container.querySelector('svg use');
  return use?.getAttribute('href') ?? use?.getAttribute('xlink:href');
}

describe('Thinker', () => {
  describe('indicator', () => {
    it('renders with the base class and a polite status row', () => {
      const { container } = render(<Thinker />);
      const root = container.querySelector('.airo-chat-thinker');
      const status = screen.getByRole('status');
      expect(root).toBeInTheDocument();
      expect(status).toHaveAttribute('aria-live', 'polite');
    });

    it('renders three animated dots by default', () => {
      const { container } = render(<Thinker />);
      expect(container.querySelectorAll('.airo-primitives-thinking-indicator__dot')).toHaveLength(
        3,
      );
    });

    it('hides the dots when showAnimation=false', () => {
      const { container } = render(<Thinker showAnimation={false} />);
      expect(container.querySelectorAll('.airo-primitives-thinking-indicator__dot')).toHaveLength(
        0,
      );
    });

    it('renders the provided label', () => {
      render(<Thinker label="Generating ideas" />);
      expect(screen.getByText('Generating ideas')).toBeInTheDocument();
    });

    it('uses label as aria-label when ariaLabel is not provided', () => {
      render(<Thinker label="Generating ideas" />);
      expect(
        screen.getByLabelText('Generating ideas', { selector: '[role=status]' }),
      ).toBeInTheDocument();
    });

    it('prefers explicit ariaLabel over label for the status region', () => {
      render(<Thinker label="Generating ideas" ariaLabel="Working" />);
      expect(screen.getByLabelText('Working', { selector: '[role=status]' })).toBeInTheDocument();
    });

    it('prefers explicit ariaLabel over a native aria-label attribute', () => {
      render(
        <Thinker ariaLabel="Working" aria-label="Working natively" label="Generating ideas" />,
      );
      expect(screen.getByLabelText('Working', { selector: '[role=status]' })).toBeInTheDocument();
    });

    it('uses a native aria-label attribute as a fallback for the status region', () => {
      render(<Thinker aria-label="Working natively" />);
      expect(
        screen.getByLabelText('Working natively', { selector: '[role=status]' }),
      ).toBeInTheDocument();
    });

    it('trims whitespace from the effective status label', () => {
      render(<Thinker ariaLabel="  Working  " />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Working');
    });

    it('falls back to a default aria-label when neither label nor ariaLabel is provided', () => {
      render(<Thinker />);
      expect(screen.getByLabelText('Working…', { selector: '[role=status]' })).toBeInTheDocument();
    });

    it('falls back to the default aria-label when provided names are empty', () => {
      render(<Thinker label="" ariaLabel="" />);
      expect(screen.getByLabelText('Working…', { selector: '[role=status]' })).toBeInTheDocument();
    });

    it('forwards className and extra props to the root', () => {
      const { container } = render(<Thinker className="custom" data-testid="thinker-root" />);
      const root = container.querySelector('.airo-chat-thinker');
      expect(root).toHaveClass('custom');
      expect(root).toHaveAttribute('data-testid', 'thinker-root');
    });
  });

  describe('indicator prop', () => {
    it('renders the default ThinkingIndicator dots when no override is provided', () => {
      const { container } = render(<Thinker />);
      expect(container.querySelectorAll('.airo-primitives-thinking-indicator__dot')).toHaveLength(
        3,
      );
      expect(container.querySelector('.airo-primitives-thinking-indicator--dots')).toBeTruthy();
    });

    it('replaces the default graphic when a custom indicator is provided', () => {
      const { container } = render(
        <Thinker indicator={<span data-testid="custom-indicator">⏳</span>} />,
      );
      expect(screen.getByTestId('custom-indicator')).toBeInTheDocument();
      expect(container.querySelectorAll('.airo-primitives-thinking-indicator__dot')).toHaveLength(
        0,
      );
    });

    it('forwards the indicator prop into the aria-hidden wrapper', () => {
      const { container } = render(
        <Thinker indicator={<span data-testid="custom-indicator">⏳</span>} />,
      );
      const wrapper = container.querySelector('.airo-chat-thinker__indicator');
      expect(wrapper).toBeInTheDocument();
      expect(wrapper).toHaveAttribute('aria-hidden', 'true');
      expect(wrapper).toHaveAttribute('inert');
      expect(wrapper).toContainElement(screen.getByTestId('custom-indicator'));
    });

    it('does not render the custom indicator when showAnimation=false', () => {
      render(
        <Thinker
          showAnimation={false}
          indicator={<span data-testid="custom-indicator">⏳</span>}
        />,
      );
      expect(screen.queryByTestId('custom-indicator')).not.toBeInTheDocument();
    });

    it('treats indicator={null} as "no override" and falls back to the default', () => {
      // Explicit null is treated identically to undefined — it falls back
      // to the default `<ThinkingIndicator />`. To suppress the indicator
      // entirely, consumers should set `showAnimation={false}` instead.
      const { container } = render(<Thinker indicator={null} />);
      expect(container.querySelectorAll('.airo-primitives-thinking-indicator__dot')).toHaveLength(
        3,
      );
      expect(container.querySelector('.airo-primitives-thinking-indicator--dots')).toBeTruthy();
    });
  });

  describe('timeline panel (disclosure)', () => {
    const disclosureProps = {
      showDetailsLabel: 'Show reasoning steps',
      hideDetailsLabel: 'Hide reasoning steps',
    };

    const timeline = (
      <Thinker.Timeline>
        <Thinker.Step>Step 1…</Thinker.Step>
      </Thinker.Timeline>
    );

    it('does not render the toggle without children', () => {
      render(<Thinker />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders the toggle when children are provided', () => {
      render(<Thinker {...disclosureProps}>{timeline}</Thinker>);
      expect(
        screen.getByRole('button', { name: disclosureProps.showDetailsLabel }),
      ).toBeInTheDocument();
    });

    it('falls back to default disclosure labels when details labels are omitted', async () => {
      const user = userEvent.setup();
      render(<Thinker>{timeline}</Thinker>);

      const toggle = screen.getByRole('button', { name: 'Show details' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      await user.click(toggle);

      expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });

    it('starts closed by default (aria-expanded=false, panel hidden)', () => {
      render(<Thinker {...disclosureProps}>{timeline}</Thinker>);
      const toggle = screen.getByRole('button');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
      expect(panel).toBeTruthy();
      expect(panel).toHaveAttribute('hidden');
    });

    it('honors defaultOpen=true (uncontrolled)', () => {
      render(
        <Thinker {...disclosureProps} defaultOpen>
          {timeline}
        </Thinker>,
      );
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Step 1…')).toBeVisible();
    });

    it('toggles open/closed on click (uncontrolled)', async () => {
      const user = userEvent.setup();
      render(<Thinker {...disclosureProps}>{timeline}</Thinker>);
      const toggle = screen.getByRole('button');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAccessibleName(disclosureProps.hideDetailsLabel);
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('toggles on Enter key', async () => {
      const user = userEvent.setup();
      render(<Thinker {...disclosureProps}>{timeline}</Thinker>);
      const toggle = screen.getByRole('button');
      toggle.focus();
      await user.keyboard('{Enter}');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('toggles on Space key', async () => {
      const user = userEvent.setup();
      render(<Thinker {...disclosureProps}>{timeline}</Thinker>);
      const toggle = screen.getByRole('button');
      toggle.focus();
      await user.keyboard(' ');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('is controlled when `open` prop is provided', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const { rerender } = render(
        <Thinker {...disclosureProps} open={false} onOpenChange={onOpenChange}>
          {timeline}
        </Thinker>,
      );
      const toggle = screen.getByRole('button');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await user.click(toggle);
      expect(onOpenChange).toHaveBeenCalledWith(true);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      rerender(
        <Thinker {...disclosureProps} open={true} onOpenChange={onOpenChange}>
          {timeline}
        </Thinker>,
      );
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('fires onOpenChange in uncontrolled mode', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(
        <Thinker {...disclosureProps} onOpenChange={onOpenChange}>
          {timeline}
        </Thinker>,
      );
      await user.click(screen.getByRole('button'));
      expect(onOpenChange).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it('allows consumer-provided disclosure labels to override the defaults', async () => {
      const user = userEvent.setup();
      render(
        <Thinker showDetailsLabel="Show reasoning steps" hideDetailsLabel="Hide reasoning steps">
          {timeline}
        </Thinker>,
      );

      await user.click(screen.getByRole('button', { name: 'Show reasoning steps' }));
      expect(screen.getByRole('button', { name: 'Hide reasoning steps' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });

    it('links toggle to panel via aria-controls', () => {
      render(<Thinker {...disclosureProps}>{timeline}</Thinker>);
      const toggle = screen.getByRole('button');
      const controls = toggle.getAttribute('aria-controls');
      expect(controls).toBeTruthy();
      expect(document.getElementById(controls ?? '')).toBeInTheDocument();
    });
  });

  describe('complete prop', () => {
    const panelContent = (
      <Thinker.Timeline>
        <Thinker.Step>Final step.</Thinker.Step>
      </Thinker.Timeline>
    );

    it('renders the details panel before the label trigger in DOM order', () => {
      const { container } = render(
        <Thinker complete label="Done" showAnimation={false}>
          {panelContent}
        </Thinker>,
      );

      const panel = container.querySelector('.airo-chat-thinker__panel');
      const labelButton = container.querySelector('.airo-chat-thinker__label-button');
      expect(panel).toBeInTheDocument();
      expect(labelButton).toBeInTheDocument();
      if (!panel || !labelButton) throw new Error('panel and label button must exist');
      expect(
        panel.compareDocumentPosition(labelButton) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('applies the complete modifier class to the root', () => {
      const { container } = render(
        <Thinker complete label="Done" showAnimation={false}>
          {panelContent}
        </Thinker>,
      );
      expect(container.querySelector('.airo-chat-thinker--complete')).toBeInTheDocument();
    });

    it('makes the label act as the disclosure toggle (aria-expanded, aria-controls)', () => {
      render(
        <Thinker complete label="Done" showAnimation={false}>
          {panelContent}
        </Thinker>,
      );
      const toggle = screen.getByRole('button', { name: /Done/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const controls = toggle.getAttribute('aria-controls');
      expect(controls).toBeTruthy();
      expect(document.getElementById(controls ?? '')).toBeInTheDocument();
    });

    it('starts closed by default (panel hidden)', () => {
      render(
        <Thinker complete label="Done" showAnimation={false}>
          {panelContent}
        </Thinker>,
      );
      const toggle = screen.getByRole('button', { name: /Done/ });
      const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
      expect(panel).toHaveAttribute('hidden');
    });

    it('reveals all sub-content when the label is clicked', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <Thinker
          complete
          label="Done"
          showAnimation={false}
          reasoningBlock={<Thinker.Reasoning>Internal thoughts</Thinker.Reasoning>}
        >
          {panelContent}
        </Thinker>,
      );
      const toggle = screen.getByRole('button', { name: /Done/ });
      const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');

      expect(panel).toHaveAttribute('hidden');

      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(panel).not.toHaveAttribute('hidden');
      expect(container.querySelector('.airo-chat-thinker__caret--open')).toBeInTheDocument();
    });

    it('does not render the legacy icon-only toggle in complete mode', () => {
      const { container } = render(
        <Thinker complete label="Done" showAnimation={false}>
          {panelContent}
        </Thinker>,
      );
      expect(container.querySelector('.airo-chat-thinker__toggle')).not.toBeInTheDocument();
    });

    it('places the reasoning block inside the same collapsible panel as children', () => {
      const { container } = render(
        <Thinker
          complete
          label="Done"
          showAnimation={false}
          defaultOpen
          reasoningBlock={<Thinker.Reasoning data-testid="rb">Internal thoughts</Thinker.Reasoning>}
        >
          {panelContent}
        </Thinker>,
      );
      const panel = container.querySelector('.airo-chat-thinker__panel');
      expect(panel).toBeTruthy();
      expect(
        panel?.querySelector('.airo-chat-thinker__reasoning-block-wrapper'),
      ).toBeInTheDocument();
      expect(panel?.querySelector('.airo-chat-thinker__timeline')).toBeInTheDocument();
    });

    it('bypasses the 3-line reasoning preview when nested under a complete Thinker', () => {
      const restoreOverflow = mockReasoningOverflow();
      try {
        const { container } = render(
          <Thinker
            complete
            label="Done"
            showAnimation={false}
            defaultOpen
            reasoningBlock={
              <Thinker.Reasoning style={{ fontSize: '16px' }}>
                Lots of streaming thought content that would normally overflow
              </Thinker.Reasoning>
            }
          />,
        );

        expect(
          container.querySelector('.airo-chat-thinker__reasoning-block--expanded'),
        ).toBeInTheDocument();
        expect(
          container.querySelector('.airo-chat-thinker__reasoning-block--collapsed'),
        ).not.toBeInTheDocument();
        expect(
          container.querySelector('.airo-chat-thinker__reasoning-block-fade'),
        ).not.toBeInTheDocument();
        expect(
          container.querySelector('.airo-chat-thinker__reasoning-block-expand'),
        ).not.toBeInTheDocument();
      } finally {
        restoreOverflow();
      }
    });

    it('forces the panel closed when `complete` transitions from false → true (uncontrolled)', () => {
      const { container, rerender } = render(
        <Thinker label="Thinking" defaultOpen>
          {panelContent}
        </Thinker>,
      );
      const openToggle = screen.getByRole('button');
      expect(openToggle).toHaveAttribute('aria-expanded', 'true');

      rerender(
        <Thinker complete label="Done" showAnimation={false}>
          {panelContent}
        </Thinker>,
      );

      const completeToggle = screen.getByRole('button', { name: /Done/ });
      expect(completeToggle).toHaveAttribute('aria-expanded', 'false');
      const panel = container.querySelector('.airo-chat-thinker__panel');
      expect(panel).toHaveAttribute('hidden');
    });

    it('fires onOpenChange(false) when `complete` forces the uncontrolled panel closed', () => {
      const onOpenChange = vi.fn();
      const { rerender } = render(
        <Thinker label="Thinking" defaultOpen onOpenChange={onOpenChange}>
          {panelContent}
        </Thinker>,
      );
      expect(onOpenChange).not.toHaveBeenCalled();

      rerender(
        <Thinker complete label="Done" showAnimation={false} onOpenChange={onOpenChange}>
          {panelContent}
        </Thinker>,
      );

      expect(onOpenChange).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('does not fire onOpenChange when `complete` flips true but the panel was already closed', () => {
      const onOpenChange = vi.fn();
      const { rerender } = render(
        <Thinker label="Thinking" onOpenChange={onOpenChange}>
          {panelContent}
        </Thinker>,
      );

      rerender(
        <Thinker complete label="Done" showAnimation={false} onOpenChange={onOpenChange}>
          {panelContent}
        </Thinker>,
      );

      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('preserves the consumer-controlled open state when `complete` flips true', () => {
      const { container, rerender } = render(
        <Thinker label="Thinking" open onOpenChange={() => {}}>
          {panelContent}
        </Thinker>,
      );

      rerender(
        <Thinker complete label="Done" showAnimation={false} open onOpenChange={() => {}}>
          {panelContent}
        </Thinker>,
      );

      const completeToggle = screen.getByRole('button', { name: /Done/ });
      expect(completeToggle).toHaveAttribute('aria-expanded', 'true');
      const panel = container.querySelector('.airo-chat-thinker__panel');
      expect(panel).not.toHaveAttribute('hidden');
    });
  });

  describe('shimmer prop', () => {
    it('applies the shimmer class when both props use their defaults (showAnimation=true → shimmer on)', () => {
      const { container } = render(<Thinker label="Thinking" />);
      expect(container.querySelector('.airo-chat-thinker__label--shimmer')).toBeInTheDocument();
    });

    it('omits the shimmer class by default when showAnimation=false (resolved state)', () => {
      const { container } = render(<Thinker label="Done" showAnimation={false} />);
      expect(container.querySelector('.airo-chat-thinker__label--shimmer')).not.toBeInTheDocument();
    });

    it('applies the shimmer class when shimmer=true', () => {
      const { container } = render(<Thinker label="Thinking" shimmer={true} />);
      expect(container.querySelector('.airo-chat-thinker__label--shimmer')).toBeInTheDocument();
    });

    it('omits the shimmer class when shimmer=false', () => {
      const { container } = render(<Thinker label="Thinking" shimmer={false} />);
      expect(container.querySelector('.airo-chat-thinker__label--shimmer')).not.toBeInTheDocument();
    });

    it('explicit shimmer=true overrides showAnimation=false when consumer opts in', () => {
      const { container } = render(<Thinker label="Done" showAnimation={false} shimmer={true} />);
      expect(container.querySelector('.airo-chat-thinker__label--shimmer')).toBeInTheDocument();
    });

    it('does not render the shimmer class when no label is provided', () => {
      const { container } = render(<Thinker />);
      expect(container.querySelector('.airo-chat-thinker__label--shimmer')).not.toBeInTheDocument();
    });
  });

  describe('Thinker root reasoningBlock prop', () => {
    it('renders the reasoningBlock above the header when provided', () => {
      const { container } = render(
        <Thinker
          label="Thinking"
          reasoningBlock={
            <Thinker.ReasoningBlock expandLabel="Show full reasoning" data-testid="rb">
              thoughts
            </Thinker.ReasoningBlock>
          }
        />,
      );
      const wrapper = container.querySelector('.airo-chat-thinker__reasoning-block-wrapper');
      const header = container.querySelector('.airo-chat-thinker__header');
      expect(wrapper).toBeInTheDocument();
      expect(header).toBeInTheDocument();
      if (!wrapper || !header) throw new Error('wrapper and header must exist');
      expect(
        wrapper.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('does not render a reasoning block wrapper when prop is omitted', () => {
      const { container } = render(<Thinker label="Thinking" />);
      expect(
        container.querySelector('.airo-chat-thinker__reasoning-block-wrapper'),
      ).not.toBeInTheDocument();
    });
  });

  describe('Thinker.ReasoningBlock', () => {
    it('renders children inside a polite live region', () => {
      render(
        <Thinker.ReasoningBlock expandLabel="Show full reasoning">
          internal thoughts
        </Thinker.ReasoningBlock>,
      );
      const liveRegion = screen
        .getByText('internal thoughts')
        .closest('.airo-chat-thinker__reasoning-block-content');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
      expect(liveRegion).toHaveAttribute('aria-atomic', 'false');
    });

    it('renders the collapsed class by default', () => {
      const { container } = render(
        <Thinker.ReasoningBlock expandLabel="Show full reasoning">text</Thinker.ReasoningBlock>,
      );
      expect(
        container.querySelector('.airo-chat-thinker__reasoning-block--collapsed'),
      ).toBeInTheDocument();
      expect(
        container.querySelector('.airo-chat-thinker__reasoning-block--expanded'),
      ).not.toBeInTheDocument();
    });

    it('does not show the expand button when content does not overflow (jsdom has no layout)', () => {
      // jsdom has no layout engine so clientHeight / scrollHeight are both 0,
      // meaning needsCollapse stays false and the expand button is never shown.
      const { container } = render(
        <Thinker.ReasoningBlock expandLabel="Show full reasoning">
          short text
        </Thinker.ReasoningBlock>,
      );
      expect(
        container.querySelector('.airo-chat-thinker__reasoning-block-expand'),
      ).not.toBeInTheDocument();
    });

    it('forwards className and extra props to the wrapper', () => {
      const { container } = render(
        <Thinker.ReasoningBlock
          expandLabel="Show full reasoning"
          className="extra"
          data-testid="rb-root"
        >
          text
        </Thinker.ReasoningBlock>,
      );
      const wrapper = container.querySelector('.airo-chat-thinker__reasoning-block-wrapper');
      expect(wrapper).toHaveClass('extra');
      expect(wrapper).toHaveAttribute('data-testid', 'rb-root');
    });

    it('uses consumer-provided expand copy and disclosure wiring when content overflows', async () => {
      const restoreOverflow = mockReasoningOverflow();
      const user = userEvent.setup();

      try {
        render(
          <Thinker.ReasoningBlock expandLabel="Show full reasoning" style={{ fontSize: '16px' }}>
            internal thoughts
          </Thinker.ReasoningBlock>,
        );

        const expandButton = screen.getByRole('button', { name: 'Show full reasoning' });
        const controls = expandButton.getAttribute('aria-controls');

        expect(expandButton).toHaveAttribute('aria-expanded', 'false');
        expect(controls).toBeTruthy();
        expect(document.getElementById(controls ?? '')).toBeInTheDocument();

        await user.click(expandButton);

        expect(
          screen.queryByRole('button', { name: 'Show full reasoning' }),
        ).not.toBeInTheDocument();
      } finally {
        restoreOverflow();
      }
    });

    it('falls back to a default expand label when content overflows', async () => {
      const restoreOverflow = mockReasoningOverflow();
      const user = userEvent.setup();

      try {
        render(
          <Thinker.ReasoningBlock style={{ fontSize: '16px' }}>
            internal thoughts
          </Thinker.ReasoningBlock>,
        );

        const expandButton = screen.getByRole('button', { name: 'Expand reasoning' });
        expect(expandButton).toHaveAttribute('aria-expanded', 'false');

        await user.click(expandButton);

        expect(screen.queryByRole('button', { name: 'Expand reasoning' })).not.toBeInTheDocument();
      } finally {
        restoreOverflow();
      }
    });
  });

  describe('Thinker.Timeline', () => {
    it('renders children inside a polite live region', () => {
      render(
        <Thinker.Timeline>
          <Thinker.Step>Hello world</Thinker.Step>
        </Thinker.Timeline>,
      );
      const region = screen.getByText('Hello world').closest('.airo-chat-thinker__timeline');
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveAttribute('aria-atomic', 'false');
    });

    it('forwards className', () => {
      const { container } = render(
        <Thinker.Timeline className="my-extra">
          <Thinker.Step>content</Thinker.Step>
        </Thinker.Timeline>,
      );
      expect(container.querySelector('.airo-chat-thinker__timeline')).toHaveClass('my-extra');
    });
  });

  describe('Thinker.Step', () => {
    it('renders children as caption text', () => {
      const { container } = render(<Thinker.Step>Do the thing</Thinker.Step>);
      expect(screen.getByText('Do the thing')).toBeInTheDocument();
      expect(container.querySelector('.airo-chat-thinker__step')).toBeInTheDocument();
    });

    it('renders an icon when provided', () => {
      const { container } = render(
        <Thinker.Step icon={<svg data-testid="test-icon" />}>Step text</Thinker.Step>,
      );
      expect(container.querySelector('.airo-chat-thinker__step-icon')).toBeInTheDocument();
      expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    });

    it('does not render the icon wrapper when icon is omitted', () => {
      const { container } = render(<Thinker.Step>No icon</Thinker.Step>);
      expect(container.querySelector('.airo-chat-thinker__step-icon')).not.toBeInTheDocument();
    });

    it('applies the emphasis class to the track wrapper', () => {
      const { container } = render(
        <Thinker.Step icon={<svg />} emphasis="success">
          Done
        </Thinker.Step>,
      );
      const track = container.querySelector('.airo-chat-thinker__step-track');
      expect(track).toHaveClass('airo-chat-thinker__step-track--emphasis-success');
    });

    it('forwards className and extra props to the list item', () => {
      const { container } = render(
        <Thinker.Step className="extra" data-testid="step-root">
          text
        </Thinker.Step>,
      );
      const li = container.querySelector('.airo-chat-thinker__step');
      expect(li).toHaveClass('extra');
      expect(li).toHaveAttribute('data-testid', 'step-root');
    });
  });

  describe('Thinker.Checklist', () => {
    it('renders the container as a polite live region', () => {
      render(
        <Thinker.Checklist>
          <Thinker.ChecklistItem stateLabel="Pending">Item 1</Thinker.ChecklistItem>
        </Thinker.Checklist>,
      );
      const region = screen.getByText('Item 1').closest('.airo-chat-thinker__checklist');
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveAttribute('aria-atomic', 'false');
    });

    it('renders items inside an unordered list', () => {
      const { container } = render(
        <Thinker.Checklist>
          <Thinker.ChecklistItem stateLabel="Pending">Item</Thinker.ChecklistItem>
        </Thinker.Checklist>,
      );
      expect(container.querySelector('ul.airo-chat-thinker__checklist-list')).toBeInTheDocument();
    });

    it('forwards className and extra props to the container', () => {
      const { container } = render(
        <Thinker.Checklist className="my-extra" data-testid="checklist-root">
          <Thinker.ChecklistItem stateLabel="Pending">Item</Thinker.ChecklistItem>
        </Thinker.Checklist>,
      );
      const container_ = container.querySelector('.airo-chat-thinker__checklist');
      expect(container_).toHaveClass('my-extra');
      expect(container_).toHaveAttribute('data-testid', 'checklist-root');
    });
  });

  describe('Thinker.ChecklistItem', () => {
    it('renders children and the base list item class', () => {
      const { container } = render(
        <Thinker.ChecklistItem stateLabel="Pending">Pending item</Thinker.ChecklistItem>,
      );
      expect(screen.getByText('Pending item')).toBeInTheDocument();
      expect(container.querySelector('.airo-chat-thinker__checklist-item')).toBeInTheDocument();
    });

    it('renders the circle icon when complete is omitted (default)', () => {
      const { container } = render(<Thinker.ChecklistItem>Pending item</Thinker.ChecklistItem>);
      expect(getRenderedIconReference(container)).toContain('circle');
    });

    it('renders the circle icon when complete=false', () => {
      const { container } = render(
        <Thinker.ChecklistItem complete={false} stateLabel="Pending">
          Pending item
        </Thinker.ChecklistItem>,
      );
      expect(getRenderedIconReference(container)).toContain('circle');
    });

    it('renders the ok icon when complete=true', () => {
      const { container } = render(
        <Thinker.ChecklistItem complete stateLabel="Completed">
          Done item
        </Thinker.ChecklistItem>,
      );
      expect(getRenderedIconReference(container)).toContain('ok');
    });

    it('falls back to the default incomplete state label when stateLabel is omitted', () => {
      render(<Thinker.ChecklistItem>Pending item</Thinker.ChecklistItem>);
      expect(screen.getByText('In progress:')).toHaveClass('airo-chat-thinker__sr-only');
    });

    it('falls back to the default complete state label when stateLabel is omitted', () => {
      render(<Thinker.ChecklistItem complete>Done item</Thinker.ChecklistItem>);
      expect(screen.getByText('Completed:')).toHaveClass('airo-chat-thinker__sr-only');
    });

    it('renders the assistive-technology state label alongside the item text', () => {
      render(
        <Thinker.ChecklistItem complete stateLabel="Completed">
          Done item
        </Thinker.ChecklistItem>,
      );
      expect(screen.getByText('Completed:')).toHaveClass('airo-chat-thinker__sr-only');
    });

    it('swaps the icon when complete transitions from false to true', () => {
      const { rerender } = render(
        <Thinker.ChecklistItem complete={false} stateLabel="Pending">
          Step
        </Thinker.ChecklistItem>,
      );
      expect(getRenderedIconReference(document.body)).toContain('circle');

      rerender(
        <Thinker.ChecklistItem complete stateLabel="Completed">
          Step
        </Thinker.ChecklistItem>,
      );
      expect(getRenderedIconReference(document.body)).toContain('ok');
    });

    it('forwards className and extra props to the list item', () => {
      const { container } = render(
        <Thinker.ChecklistItem className="extra" data-testid="item-root" stateLabel="Pending">
          Item
        </Thinker.ChecklistItem>,
      );
      const li = container.querySelector('.airo-chat-thinker__checklist-item');
      expect(li).toHaveClass('extra');
      expect(li).toHaveAttribute('data-testid', 'item-root');
    });
  });
});
