import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AiroHeader, AiroHeaderSections, type AiroHeaderTab } from '../AiroHeader';

vi.mock('@ux/icon/async-icon.js', () => ({
  default: ({ icon }: { icon: string }) => (
    <svg data-testid={`async-icon-${icon}`} data-icon={icon} />
  ),
}));

const TABS: AiroHeaderTab[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'activity', label: 'Activity' },
  { id: 'history', label: 'History' },
];

describe('AiroHeader', () => {
  describe('default rendering', () => {
    it('renders the wordmark with the default accessible name', () => {
      render(<AiroHeader tabs={TABS} />);
      expect(screen.getByRole('img', { name: 'Airo' })).toBeInTheDocument();
    });

    it('renders a custom wordmark aria-label', () => {
      render(<AiroHeader tabs={TABS} wordmarkAriaLabel="Airo assistant" />);
      expect(screen.getByRole('img', { name: 'Airo assistant' })).toBeInTheDocument();
    });

    it('renders the Beta tag by default', () => {
      render(<AiroHeader tabs={TABS} />);
      expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    it('hides the beta tag when showBetaTag is false', () => {
      render(<AiroHeader tabs={TABS} showBetaTag={false} />);
      expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    });

    it('honors a custom betaLabel', () => {
      render(<AiroHeader tabs={TABS} betaLabel="Preview" />);
      expect(screen.getByText('Preview')).toBeInTheDocument();
    });

    it('forwards className and data-* to the root', () => {
      render(<AiroHeader tabs={TABS} className="custom" data-testid="airo-header" />);
      const root = screen.getByTestId('airo-header');
      expect(root).toHaveClass('airo-surfaces-panel-chrome__airo-header', 'custom');
    });

    it('renders one segment per tab entry', () => {
      render(<AiroHeader tabs={TABS} />);
      // Antares's SegmentedController wraps React Aria's ToggleButtonGroup
      // with single-selection semantics, which renders as a
      // `role="radiogroup"` of `role="radio"` buttons labelled by the
      // aria-label. We query it to confirm the control mounted.
      expect(screen.getByRole('radiogroup', { name: 'Panel sections' })).toBeInTheDocument();
      for (const tab of TABS) {
        expect(screen.getByText(tab.label)).toBeInTheDocument();
      }
    });

    it('honors a custom sectionsAriaLabel on the segmented control', () => {
      render(<AiroHeader tabs={TABS} sectionsAriaLabel="Conversation modes" />);
      expect(screen.getByRole('radiogroup', { name: 'Conversation modes' })).toBeInTheDocument();
    });

    it('omits the segmented control when tabs is empty', () => {
      render(<AiroHeader tabs={[]} sectionsAriaLabel="Sections" />);
      expect(screen.queryByRole('radiogroup', { name: 'Sections' })).not.toBeInTheDocument();
    });
  });

  describe('controlled / uncontrolled', () => {
    it('passes defaultValue to SegmentedController when uncontrolled', () => {
      render(<AiroHeader tabs={TABS} defaultActiveTabId="activity" />);
      // SegmentedControllerItem renders react-aria's ToggleButton inside a
      // single-selection ToggleButtonGroup, which exposes the active segment
      // as `role="radio"` + `aria-checked="true"`.
      expect(screen.getByRole('radio', { name: 'Activity', checked: true })).toBeInTheDocument();
    });

    it('passes value to SegmentedController when controlled', () => {
      render(<AiroHeader tabs={TABS} activeTabId="history" />);
      expect(screen.getByRole('radio', { name: 'History', checked: true })).toBeInTheDocument();
    });

    it('fires onTabChange when a segment is selected', async () => {
      const onTabChange = vi.fn();
      render(<AiroHeader tabs={TABS} onTabChange={onTabChange} />);
      await userEvent.click(screen.getByRole('radio', { name: 'Activity' }));
      expect(onTabChange).toHaveBeenCalledWith('activity');
    });
  });

  describe('corner actions', () => {
    it('renders the default expand + close buttons when cornerActions is undefined', () => {
      render(<AiroHeader tabs={TABS} onClose={vi.fn()} onExpandedToggle={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    });

    it('swaps Expand for Collapse when expanded is true', () => {
      render(<AiroHeader tabs={TABS} expanded onClose={vi.fn()} onExpandedToggle={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument();
    });

    it('fires the onClose / onExpandedToggle handlers', async () => {
      const onClose = vi.fn();
      const onExpandedToggle = vi.fn();
      render(<AiroHeader tabs={TABS} onClose={onClose} onExpandedToggle={onExpandedToggle} />);
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      await userEvent.click(screen.getByRole('button', { name: 'Expand' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onExpandedToggle).toHaveBeenCalledTimes(1);
    });

    it('replaces corner actions entirely when a node is passed', () => {
      render(<AiroHeader tabs={TABS} cornerActions={<button type="button">Custom</button>} />);
      expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('omits corner actions when null is passed', () => {
      render(<AiroHeader tabs={TABS} cornerActions={null} />);
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });
  });

  describe('action slot', () => {
    it('renders nothing when action is undefined and no handler is provided', () => {
      render(<AiroHeader tabs={TABS} cornerActions={null} />);
      expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('async-icon-plus')).not.toBeInTheDocument();
    });

    it('renders the default plus button when onActionClick is provided', () => {
      render(<AiroHeader tabs={TABS} onActionClick={vi.fn()} />);
      const button = screen.getByRole('button', { name: 'Add' });
      expect(button).toBeInTheDocument();
      expect(screen.getByTestId('async-icon-plus')).toBeInTheDocument();
    });

    it('honors a custom actionLabel on the default plus button', () => {
      render(<AiroHeader tabs={TABS} onActionClick={vi.fn()} actionLabel="New chat" />);
      expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    });

    it('fires onActionClick when the default plus button is clicked', async () => {
      const onActionClick = vi.fn();
      render(<AiroHeader tabs={TABS} onActionClick={onActionClick} />);
      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(onActionClick).toHaveBeenCalledTimes(1);
    });

    it('replaces the action entirely when a node is passed', () => {
      render(
        <AiroHeader
          tabs={TABS}
          onActionClick={vi.fn()}
          action={<button type="button">Custom action</button>}
        />,
      );
      expect(screen.getByRole('button', { name: 'Custom action' })).toBeInTheDocument();
      // The default plus button should not render alongside the replacement.
      expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('async-icon-plus')).not.toBeInTheDocument();
    });

    it('omits the action when null is passed, even with onActionClick set', () => {
      render(<AiroHeader tabs={TABS} action={null} onActionClick={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('async-icon-plus')).not.toBeInTheDocument();
    });

    it('still mounts the sections row (with only the action) when tabs is empty', () => {
      // The action slot lives on the sections row. When `tabs` is empty,
      // that row must still render solely to host the action; otherwise
      // the button would disappear from any header configured without
      // sections.
      render(<AiroHeader tabs={[]} sectionsAriaLabel="Sections" onActionClick={vi.fn()} />);
      expect(screen.queryByRole('group', { name: 'Sections' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });
  });

  describe('showSections', () => {
    it('renders the sections row by default', () => {
      render(<AiroHeader tabs={TABS} sectionsAriaLabel="Panel sections" />);
      expect(screen.getByRole('radiogroup', { name: 'Panel sections' })).toBeInTheDocument();
    });

    it('hides the sections row when showSections={false}', () => {
      render(<AiroHeader tabs={TABS} sectionsAriaLabel="Panel sections" showSections={false} />);
      expect(screen.queryByRole('radiogroup', { name: 'Panel sections' })).not.toBeInTheDocument();
    });

    it('still renders wordmark and corner actions when showSections={false}', () => {
      render(<AiroHeader tabs={TABS} showSections={false} onClose={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('hides the action button when showSections={false}', () => {
      render(<AiroHeader tabs={TABS} showSections={false} onActionClick={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    });

    it('is accessible as AiroHeader.Sections compound property', () => {
      expect(AiroHeader.Sections).toBe(AiroHeaderSections);
    });
  });

  describe('AiroHeaderSections standalone', () => {
    it('renders the SegmentedController when tabs are provided', () => {
      render(<AiroHeaderSections tabs={TABS} sectionsAriaLabel="Sections" />);
      expect(screen.getByRole('radiogroup', { name: 'Sections' })).toBeInTheDocument();
    });

    it('renders the action button when onActionClick is provided', () => {
      render(<AiroHeaderSections tabs={TABS} onActionClick={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });

    it('renders only the action button when tabs is empty', () => {
      render(<AiroHeaderSections tabs={[]} sectionsAriaLabel="Sections" onActionClick={vi.fn()} />);
      expect(screen.queryByRole('radiogroup', { name: 'Sections' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });

    it('honors a custom actionLabel', () => {
      render(<AiroHeaderSections tabs={TABS} onActionClick={vi.fn()} actionLabel="New chat" />);
      expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    });

    it('does not render the no-tabs action row when both tabs and action are absent', () => {
      const { container } = render(<AiroHeaderSections tabs={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
