import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  BuilderHeader,
  BuilderHeaderActions,
  BuilderHeaderBrand,
  BuilderHeaderSections,
  DEFAULT_BUILDER_SECTIONS,
} from '../BuilderHeader';

describe('BuilderHeader', () => {
  it('renders the three configurable clusters', () => {
    const { container } = render(
      <BuilderHeader
        leading={<span data-testid="leading">L</span>}
        center={<span data-testid="center">C</span>}
        trailing={<span data-testid="trailing">T</span>}
      />,
    );
    expect(container.querySelector('.airo-surfaces-builder-header')).not.toBeNull();
    expect(screen.getByTestId('leading')).toBeTruthy();
    expect(screen.getByTestId('center')).toBeTruthy();
    expect(screen.getByTestId('trailing')).toBeTruthy();
  });
});

describe('BuilderHeaderBrand', () => {
  it('renders Airo wordmark and Beta tag by default', () => {
    const { container } = render(<BuilderHeaderBrand />);
    expect(screen.getByLabelText('GoDaddy')).toBeTruthy();
    expect(screen.getByLabelText('Airo')).toBeTruthy();
    // Beta tag (highlight emphasis)
    expect(container.textContent).toContain('Beta');
  });

  it('hides the Beta tag when showBetaTag={false}', () => {
    const { container } = render(<BuilderHeaderBrand showBetaTag={false} />);
    expect(container.textContent).not.toContain('Beta');
  });

  it('substitutes a custom GoDaddy logo via the slot', () => {
    render(<BuilderHeaderBrand godaddyLogo={<span data-testid="custom-gd">X</span>} />);
    expect(screen.getByTestId('custom-gd')).toBeTruthy();
  });
});

describe('BuilderHeaderSections', () => {
  it('renders nothing when sections is empty', () => {
    const { container } = render(<BuilderHeaderSections sections={[]} />);
    expect(container.querySelector('.airo-surfaces-builder-header__sections')).toBeNull();
  });

  it('renders one segment per entry with its label', () => {
    render(<BuilderHeaderSections sections={DEFAULT_BUILDER_SECTIONS} />);
    // Role-based query — accessible name is the section label whether the
    // segment is rendered fully expanded or collapsed-with-tooltip via
    // `collapseInactive` (the default since the SegmentedController vendor).
    for (const s of DEFAULT_BUILDER_SECTIONS) {
      expect(screen.getByRole('radio', { name: s.label })).toBeInTheDocument();
    }
  });

  it('uncontrolled: defaults to first section unless `defaultActiveSectionId` is set', () => {
    render(<BuilderHeaderSections sections={DEFAULT_BUILDER_SECTIONS} />);
    expect(screen.getByRole('radio', { name: /Logo & brand/i }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('uncontrolled: respects `defaultActiveSectionId`', () => {
    render(
      <BuilderHeaderSections sections={DEFAULT_BUILDER_SECTIONS} defaultActiveSectionId="edit" />,
    );
    expect(screen.getByRole('radio', { name: /Edit/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('controlled: external state drives the active segment', () => {
    function Harness() {
      const [active, setActive] = useState('preview');
      return (
        <>
          <button type="button" data-testid="set-code" onClick={() => setActive('code')}>
            code
          </button>
          <BuilderHeaderSections
            sections={DEFAULT_BUILDER_SECTIONS}
            activeSectionId={active}
            onSectionChange={setActive}
          />
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('radio', { name: /Preview/i }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('controlled: clicking a segment fires onSectionChange and the parent flip propagates', async () => {
    const seen: string[] = [];
    function Harness() {
      const [active, setActive] = useState('preview');
      return (
        <BuilderHeaderSections
          sections={DEFAULT_BUILDER_SECTIONS}
          activeSectionId={active}
          onSectionChange={(id) => {
            seen.push(id);
            setActive(id);
          }}
        />
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole('radio', { name: /Edit/i }));
    expect(seen).toEqual(['edit']);
    expect(screen.getByRole('radio', { name: /Edit/i }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /Preview/i }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('forwards data-* attributes to the wrapping div', () => {
    const { container } = render(
      <BuilderHeaderSections sections={DEFAULT_BUILDER_SECTIONS} data-testid="sec-row" />,
    );
    expect(
      container
        .querySelector('.airo-surfaces-builder-header__sections')
        ?.getAttribute('data-testid'),
    ).toBe('sec-row');
  });
});

describe('BuilderHeaderActions', () => {
  it('omits handler-only buttons when no handler is provided (avoid no-op buttons)', () => {
    render(<BuilderHeaderActions />);
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'User menu' })).toBeNull();
    // Device toggle has internal state (icon flip) so it renders unconditionally.
    expect(screen.getByRole('button', { name: 'Switch to mobile view' })).toBeTruthy();
  });

  it('renders handler-driven buttons once their handlers are wired', () => {
    render(
      <BuilderHeaderActions
        onRefresh={vi.fn()}
        onShare={vi.fn()}
        onPublish={vi.fn()}
        onUserClick={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'User menu' })).toBeTruthy();
  });

  it('shows handler-only buttons when forced via showX={true} even with no handler', () => {
    render(<BuilderHeaderActions showRefresh showShare showPublish showUser />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'User menu' })).toBeTruthy();
  });

  it('hides the refresh button when showRefresh={false} even with onRefresh wired', () => {
    render(<BuilderHeaderActions onRefresh={vi.fn()} showRefresh={false} />);
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('uncontrolled: device toggle flips desktop ↔ mobile and fires onDeviceChange', async () => {
    const onDeviceChange = vi.fn();
    render(<BuilderHeaderActions onDeviceChange={onDeviceChange} />);
    const toggle = screen.getByRole('button', { name: 'Switch to mobile view' });
    await userEvent.click(toggle);
    expect(onDeviceChange).toHaveBeenCalledWith('mobile');
    // After toggle, the label flips
    expect(screen.getByRole('button', { name: 'Switch to desktop view' })).toBeTruthy();
  });

  it('controlled: external `device` drives icon + label, internal click does not change rendered state', async () => {
    const onDeviceChange = vi.fn();
    render(<BuilderHeaderActions device="mobile" onDeviceChange={onDeviceChange} />);
    expect(screen.getByRole('button', { name: 'Switch to desktop view' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to desktop view' }));
    expect(onDeviceChange).toHaveBeenCalledWith('desktop');
    // Still renders mobile-state label until the consumer flips `device`
    expect(screen.getByRole('button', { name: 'Switch to desktop view' })).toBeTruthy();
  });

  it('fires onPublish / onShare / onRefresh / onUserClick on their buttons', async () => {
    const onPublish = vi.fn();
    const onShare = vi.fn();
    const onRefresh = vi.fn();
    const onUserClick = vi.fn();
    render(
      <BuilderHeaderActions
        onPublish={onPublish}
        onShare={onShare}
        onRefresh={onRefresh}
        onUserClick={onUserClick}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await userEvent.click(screen.getByRole('button', { name: 'User menu' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onUserClick).toHaveBeenCalledTimes(1);
  });
});
