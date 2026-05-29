/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import LoadingComponent from '@/components/auth/LoadingComponent';

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

describe('LoadingComponent', () => {
  it('renders dark marketing shell', function darkShell() {
    const { container } = render(<LoadingComponent />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('data-homepage-variation')).toBeNull();
    expect(root.className).toContain('bg-gradient');
  });
});
