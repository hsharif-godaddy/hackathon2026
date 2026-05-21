/**
 * Legacy path stub for rsync-managed dev-tools sync.
 *
 * Tests moved to ../components/__tests__/TextAlignButton.test.tsx. Customer
 * preview trees rsync --delete this directory; removing this file breaks
 * in-flight apps that still reference the old path.
 */
import { describe, it } from 'vitest';

describe.skip('TextAlignButton (legacy path)', function legacyPath() {
  it('moved to components/__tests__/TextAlignButton.test.tsx', function moved() {});
});
