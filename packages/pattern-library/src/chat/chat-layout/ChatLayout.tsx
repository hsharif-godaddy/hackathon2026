import Box from '@ux/box';
import classnames from 'classnames';
import { type HTMLAttributes, type ReactNode, useEffect, useRef } from 'react';

/**
 * Props for `ChatLayout`, the two-pane layout component for Airo chat surfaces.
 */
export interface ChatLayoutProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'content'> {
  /**
   * The message thread. Rendered in the chat column's scrollable region.
   * Streaming-safe — content is rendered as-is without deep copying.
   */
  children: ReactNode;
  /**
   * Optional header rendered at the top of the chat column, above the message
   * thread. Use this to place `AiroHeader.Sections` inside the chat panel so
   * the tab-switcher row is constrained to the chat column width rather than
   * spanning the full `AiroHeader`.
   *
   * @example
   * <ChatLayout header={<AiroHeader.Sections tabs={tabs} activeTabId={tab} onTabChange={setTab} />}>
   */
  header?: ReactNode;
  /**
   * Composer or prompt box. Sticky to the bottom of the chat column.
   * When omitted, no footer element is rendered.
   */
  footer?: ReactNode;
  /**
   * The primary content area — editor canvas, artifact viewer, etc.
   * Rendered in the leading pane. In 'centered' mode the layout still
   * reserves the leading column as gutter space, so provided content may
   * remain visible there. Pass `undefined` in 'centered' mode to omit the
   * leading-pane content entirely.
   */
  content?: ReactNode;
  /**
   * Layout mode. 'centered' caps the chat column at a max reading width and
   * centers it. 'sidebar' pins it to the leading edge (left in LTR) and gives
   * the content pane the remaining space to the right. Controlled.
   */
  layout?: 'centered' | 'sidebar';
  /**
   * Initial layout for uncontrolled usage. Defaults to 'centered'.
   */
  defaultLayout?: 'centered' | 'sidebar';
  /**
   * Passive callback included for controlled/uncontrolled API parity and to
   * support future resizable-split behaviour without a breaking change. Does
   * not fire today — the component has no internal layout trigger.
   */
  onLayoutChange?: (layout: 'centered' | 'sidebar') => void;
  /**
   * Enable smart-bottom auto-scroll on the messages region. Matches
   * PanelChrome's autoScroll="smart-bottom" contract.
   */
  autoScroll?: 'smart-bottom';
  /**
   * Distance from the bottom (px) at which smart-bottom re-engages.
   * @default 144
   */
  autoScrollThreshold?: number;
}

/**
 * `ChatLayout` is a two-pane layout component that sits inside `PanelChrome`'s
 * content area. It provides a smooth CSS-driven transition between:
 *
 * - **centered** — the chat column is capped at a max reading width and
 *   centered in the viewport. Used for open-ended chat sessions.
 * - **sidebar** — the chat column is pinned to the leading edge (left in LTR)
 *   at a fixed width and the content pane fills the remaining space to the
 *   right. Used when a secondary tool (e.g. a website editor) opens alongside
 *   the conversation.
 *
 * `ChatLayout` owns the scroll region for the message thread. Do **not** use
 * `PanelChrome`'s `autoScroll` prop at the same time — use `ChatLayout`'s own
 * `autoScroll` prop instead.
 *
 * @example
 * <PanelChrome aria-label="Airo" onClose={onClose}>
 *   <ChatLayout
 *     layout={hasEditor ? 'sidebar' : 'centered'}
 *     footer={<PromptBox />}
 *     content={hasEditor ? <WebsiteEditor /> : undefined}
 *   >
 *     {messages}
 *   </ChatLayout>
 * </PanelChrome>
 */
export function ChatLayout({
  children,
  header,
  footer,
  content,
  layout: layoutProp,
  defaultLayout = 'centered',
  onLayoutChange: _onLayoutChange,
  autoScroll,
  autoScrollThreshold = 144,
  className,
  ...rest
}: ChatLayoutProps) {
  // Controlled layout takes precedence; fall back to defaultLayout.
  // No internal state needed — the component has no internal layout trigger.
  const layout = layoutProp ?? defaultLayout;

  const messagesRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScroll !== 'smart-bottom') return;
    const scroller = messagesRef.current;
    if (!scroller) return;

    const initialDist = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    shouldAutoScrollRef.current = initialDist <= autoScrollThreshold;

    let lastScrollTop = scroller.scrollTop;
    let rafId = 0;

    const checkAndScroll = () => {
      if (!shouldAutoScrollRef.current) return;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (!shouldAutoScrollRef.current) return;
        scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
      });
    };

    const handleScroll = () => {
      const currentScrollTop = scroller.scrollTop;
      const distFromBottom = scroller.scrollHeight - currentScrollTop - scroller.clientHeight;
      if (distFromBottom <= autoScrollThreshold) {
        shouldAutoScrollRef.current = true;
      } else if (currentScrollTop < lastScrollTop) {
        shouldAutoScrollRef.current = false;
      }
      lastScrollTop = currentScrollTop;
    };

    const observer = new MutationObserver(checkAndScroll);
    observer.observe(scroller, { childList: true, subtree: true, characterData: true });
    scroller.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', handleScroll, false);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [autoScroll, autoScrollThreshold]);

  return (
    <div
      {...rest}
      className={classnames(
        'airo-chat-chat-layout',
        layout === 'sidebar' ? 'airo-chat-chat-layout--sidebar' : 'airo-chat-chat-layout--centered',
        className,
      )}
    >
      <div className="airo-chat-chat-layout__content">{content}</div>
      <div className="airo-chat-chat-layout__chat">
        {header != null && (
          <div className="airo-chat-chat-layout__header">
            <Box blockPadding="sm" inlinePadding="md">
              {header}
            </Box>
          </div>
        )}
        <div
          ref={messagesRef}
          className="airo-chat-chat-layout__messages"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable message region must be keyboard-focusable so keyboard-only users can scroll with arrow keys and PageUp/PageDown.
          tabIndex={0}
        >
          {children}
        </div>
        {footer != null && (
          <div className="airo-chat-chat-layout__footer">
            <Box blockPadding="sm" inlinePadding="md">
              {footer}
            </Box>
          </div>
        )}
      </div>
      <div className="airo-chat-chat-layout__trailing-gutter" aria-hidden />
    </div>
  );
}
