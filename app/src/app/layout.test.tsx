/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import RootLayout from './layout';

describe('RootLayout', () => {
  it('should render children as passthrough', () => {
    const testChild = <div data-testid="test-child">Test Content</div>;
    const result = RootLayout({ children: testChild });

    expect(result).toBe(testChild);
  });
});
