/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PreviewHeader from '../PreviewHeader';

describe('PreviewHeader', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('VITE_PARENT_ORIGIN', 'https://builder.example.com');
    vi.stubEnv('SITE_ID', 'test-site-123');
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    window.history.pushState({}, '', '/');
  });

  it('renders header when ?airoPreview=1 is present', () => {
    window.history.pushState({}, '', '/?airoPreview=1');

    const { container } = render(<PreviewHeader />);

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText("Preview — your changes aren't live yet")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });

  it('returns null when airoPreview param is missing', () => {
    window.history.pushState({}, '', '/');

    const { container } = render(<PreviewHeader />);

    expect(container.firstChild).toBeNull();
  });

  it('publish button opens builder with correct URL', async () => {
    window.history.pushState({}, '', '/?airoPreview=1');
    const user = userEvent.setup();

    render(<PreviewHeader />);

    await user.click(screen.getByRole('button', { name: 'Publish' }));

    expect(openSpy).toHaveBeenCalledWith(
      'https://builder.example.com/develop/test-site-123?siteId=test-site-123&openPublish=true',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
