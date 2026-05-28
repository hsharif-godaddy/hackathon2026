import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatLayout } from '../ChatLayout';

describe('ChatLayout', () => {
  describe('render', () => {
    it('renders children in the messages region', () => {
      render(<ChatLayout>Hello messages</ChatLayout>);
      expect(screen.getByText('Hello messages')).toBeInTheDocument();
    });

    it('renders header when provided', () => {
      render(<ChatLayout header={<div>Header content</div>}>msgs</ChatLayout>);
      expect(screen.getByText('Header content')).toBeInTheDocument();
    });

    it('does not render a header element when header is omitted', () => {
      const { container } = render(<ChatLayout>msgs</ChatLayout>);
      expect(container.querySelector('.airo-chat-chat-layout__header')).toBeNull();
    });

    it('renders footer when provided', () => {
      render(<ChatLayout footer={<div>Composer</div>}>msgs</ChatLayout>);
      expect(screen.getByText('Composer')).toBeInTheDocument();
    });

    it('does not render a footer element when footer is omitted', () => {
      const { container } = render(<ChatLayout>msgs</ChatLayout>);
      expect(container.querySelector('.airo-chat-chat-layout__footer')).toBeNull();
    });

    it('renders content when provided', () => {
      render(
        <ChatLayout content={<div>Editor</div>} layout="sidebar">
          msgs
        </ChatLayout>,
      );
      expect(screen.getByText('Editor')).toBeInTheDocument();
    });

    it('renders the content pane element even when content prop is omitted', () => {
      const { container } = render(<ChatLayout>msgs</ChatLayout>);
      expect(container.querySelector('.airo-chat-chat-layout__content')).toBeInTheDocument();
    });

    it('gives the messages region tabIndex={0} for keyboard scrollability', () => {
      const { container } = render(<ChatLayout>msgs</ChatLayout>);
      const messages = container.querySelector('.airo-chat-chat-layout__messages');
      expect(messages).toHaveAttribute('tabindex', '0');
    });

    it('forwards className to the root element', () => {
      const { container } = render(<ChatLayout className="my-class">msgs</ChatLayout>);
      expect(container.firstChild).toHaveClass('airo-chat-chat-layout', 'my-class');
    });

    it('forwards data-* attributes to the root element', () => {
      const { container } = render(<ChatLayout data-testid="layout">msgs</ChatLayout>);
      expect(container.firstChild).toHaveAttribute('data-testid', 'layout');
    });
  });

  describe('layout mode', () => {
    it('applies --centered modifier by default', () => {
      const { container } = render(<ChatLayout>msgs</ChatLayout>);
      expect(container.firstChild).toHaveClass('airo-chat-chat-layout--centered');
      expect(container.firstChild).not.toHaveClass('airo-chat-chat-layout--sidebar');
    });

    it('applies --centered modifier when defaultLayout="centered"', () => {
      const { container } = render(<ChatLayout defaultLayout="centered">msgs</ChatLayout>);
      expect(container.firstChild).toHaveClass('airo-chat-chat-layout--centered');
    });

    it('applies --sidebar modifier when defaultLayout="sidebar"', () => {
      const { container } = render(<ChatLayout defaultLayout="sidebar">msgs</ChatLayout>);
      expect(container.firstChild).toHaveClass('airo-chat-chat-layout--sidebar');
      expect(container.firstChild).not.toHaveClass('airo-chat-chat-layout--centered');
    });

    it('applies --sidebar modifier when controlled layout="sidebar"', () => {
      const { container } = render(<ChatLayout layout="sidebar">msgs</ChatLayout>);
      expect(container.firstChild).toHaveClass('airo-chat-chat-layout--sidebar');
    });

    it('controlled layout prop overrides defaultLayout', () => {
      const { container } = render(
        <ChatLayout layout="centered" defaultLayout="sidebar">
          msgs
        </ChatLayout>,
      );
      expect(container.firstChild).toHaveClass('airo-chat-chat-layout--centered');
    });

    it('re-renders with updated layout prop', () => {
      const { container, rerender } = render(<ChatLayout layout="centered">msgs</ChatLayout>);
      expect(container.firstChild).toHaveClass('airo-chat-chat-layout--centered');
      rerender(<ChatLayout layout="sidebar">msgs</ChatLayout>);
      expect(container.firstChild).toHaveClass('airo-chat-chat-layout--sidebar');
    });

    it('calls onLayoutChange when provided (passive hook — does not fire internally)', () => {
      // onLayoutChange is passive today: no internal trigger exists.
      // Verify it can be passed without error; it does not fire on mount.
      const onChange = vi.fn();
      render(
        <ChatLayout onLayoutChange={onChange} layout="centered">
          msgs
        </ChatLayout>,
      );
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});

// Auto-scroll: mirrors the PanelChrome smart-bottom contract.
describe('ChatLayout — autoScroll="smart-bottom"', () => {
  function renderWithAutoScroll(threshold?: number) {
    const props = threshold !== undefined ? { autoScrollThreshold: threshold } : {};
    const { container } = render(
      <ChatLayout autoScroll="smart-bottom" {...props}>
        <div>initial</div>
      </ChatLayout>,
    );
    const messages = container.querySelector('.airo-chat-chat-layout__messages') as HTMLElement;
    // jsdom doesn't run layout — wire scroll properties manually.
    Object.defineProperty(messages, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(messages, 'clientHeight', { value: 600, configurable: true });
    // Explicitly establish "at the bottom" (engaged) state after stubbing dimensions.
    messages.scrollTop = 400; // 1000 - 400 - 600 = 0, within threshold → engaged
    fireEvent.scroll(messages);
    return { container, messages };
  }

  it('scrolls to bottom on childList mutation when engaged', async () => {
    vi.useFakeTimers();
    try {
      const { messages } = renderWithAutoScroll();
      await act(async () => {
        messages.appendChild(document.createElement('div'));
        await Promise.resolve();
        vi.runAllTimers();
      });
      expect(messages.scrollTop).toBe(messages.scrollHeight - messages.clientHeight);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disengages auto-scroll when user scrolls up', async () => {
    vi.useFakeTimers();
    try {
      const { messages } = renderWithAutoScroll();
      messages.scrollTop = 300;
      fireEvent.scroll(messages);
      messages.scrollTop = 100;
      fireEvent.scroll(messages);

      await act(async () => {
        messages.appendChild(document.createElement('div'));
        await Promise.resolve();
        vi.runAllTimers();
      });
      expect(messages.scrollTop).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-engages auto-scroll when user scrolls back within threshold', async () => {
    vi.useFakeTimers();
    try {
      const { messages } = renderWithAutoScroll(144);
      messages.scrollTop = 300;
      fireEvent.scroll(messages);
      messages.scrollTop = 100;
      fireEvent.scroll(messages);
      // distFromBottom = 1000 - 400 - 600 = 0 ≤ 144 → re-engage
      messages.scrollTop = 400;
      fireEvent.scroll(messages);

      await act(async () => {
        messages.appendChild(document.createElement('div'));
        await Promise.resolve();
        vi.runAllTimers();
      });
      expect(messages.scrollTop).toBe(messages.scrollHeight - messages.clientHeight);
    } finally {
      vi.useRealTimers();
    }
  });

  it('scrolls to bottom on characterData mutation (streaming text)', async () => {
    vi.useFakeTimers();
    try {
      const { messages } = renderWithAutoScroll();
      const textNode = document.createTextNode('Hello');
      messages.appendChild(textNode);

      await act(async () => {
        textNode.nodeValue = 'Hello world';
        await Promise.resolve();
        vi.runAllTimers();
      });
      expect(messages.scrollTop).toBe(messages.scrollHeight - messages.clientHeight);
    } finally {
      vi.useRealTimers();
    }
  });
});
