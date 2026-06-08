/**
 * @vitest-environment jsdom
 *
 * No-op stub retained for rsync-managed template compatibility.
 *
 * IFRAME_FIRST_INTERACTION was removed from DevelopmentMode; the original
 * tests were deleted in main. Customer apps rsync --delete these dev-tools
 * paths on container start, so the file must remain until no in-flight app
 * could still depend on it being present in the synced tree.
 */
import { describe, it } from 'vitest';

describe.skip('DevelopmentMode iframe first interaction sender (deprecated)', function deprecated() {
  it('retained as rsync-managed stub', function stub() {});
});
