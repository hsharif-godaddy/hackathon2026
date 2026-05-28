import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import {
  BuilderChatFooter,
  BuilderChatFooterSections,
  DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS,
} from '../BuilderChatFooter';

describe('BuilderChatFooter', () => {
  it('renders the BEM root and forwards children', () => {
    const { container } = render(
      <BuilderChatFooter>
        <span data-testid="footer-content">x</span>
      </BuilderChatFooter>,
    );
    expect(container.querySelector('.airo-surfaces-builder-chat-footer')).not.toBeNull();
    expect(screen.getByTestId('footer-content')).toBeTruthy();
  });

  it('forwards data-* attributes to the wrapping element', () => {
    const { container } = render(<BuilderChatFooter data-testid="cf">x</BuilderChatFooter>);
    expect(
      container.querySelector('.airo-surfaces-builder-chat-footer')?.getAttribute('data-testid'),
    ).toBe('cf');
  });
});

describe('BuilderChatFooterSections', () => {
  it('renders nothing when sections is empty', () => {
    const { container } = render(<BuilderChatFooterSections sections={[]} />);
    expect(container.querySelector('.airo-surfaces-builder-chat-footer__sections')).toBeNull();
  });

  it('renders one segment per entry with its label', () => {
    render(<BuilderChatFooterSections sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS} />);
    // Role-based query — accessible name is the section label whether the
    // segment is rendered fully expanded or collapsed-with-tooltip via
    // `collapseInactive` (the default since the SegmentedController vendor).
    for (const s of DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS) {
      expect(screen.getByRole('radio', { name: s.label })).toBeInTheDocument();
    }
  });

  it('uncontrolled: respects `defaultActiveSectionId`', () => {
    render(
      <BuilderChatFooterSections
        sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS}
        defaultActiveSectionId="settings"
      />,
    );
    expect(screen.getByRole('radio', { name: /Settings/i }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('controlled: external state drives the active segment', () => {
    function Harness() {
      const [active, setActive] = useState('analytics');
      return (
        <BuilderChatFooterSections
          sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS}
          activeSectionId={active}
          onSectionChange={setActive}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByRole('radio', { name: /Analytics/i }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('controlled: clicking a segment fires onSectionChange and the parent flip propagates', async () => {
    const seen: string[] = [];
    function Harness() {
      const [active, setActive] = useState('analytics');
      return (
        <BuilderChatFooterSections
          sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS}
          activeSectionId={active}
          onSectionChange={(id) => {
            seen.push(id);
            setActive(id);
          }}
        />
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole('radio', { name: /Settings/i }));
    expect(seen).toEqual(['settings']);
    expect(screen.getByRole('radio', { name: /Settings/i }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: /Analytics/i }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('forwards data-* attributes to the wrapping div', () => {
    const { container } = render(
      <BuilderChatFooterSections
        sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS}
        data-testid="cfs"
      />,
    );
    expect(
      container
        .querySelector('.airo-surfaces-builder-chat-footer__sections')
        ?.getAttribute('data-testid'),
    ).toBe('cfs');
  });
});
