/**
 * Legacy path stub for rsync-managed dev-tools sync.
 *
 * Tests moved to ../utils/__tests__/element-detection.test.ts. Customer
 * preview trees rsync --delete this directory; removing this file breaks
 * in-flight apps that still reference the old path.
 */
import { describe, it } from 'vitest';

describe.skip('element-detection (legacy path)', function legacyPath() {
  it('moved to utils/__tests__/element-detection.test.ts', function moved() {});
});
