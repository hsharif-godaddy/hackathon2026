import { describe, expect, it, vi } from 'vitest';

vi.mock('@ux/growl', () => ({
  default: Object.assign(
    function Growl() {
      return null;
    },
    {
      addGrowlMessage: vi.fn(),
    }
  ),
}));

import Growl from '@ux/growl';

import { showEditApplyFailureGrowl } from '@/app/[market]/develop/utils/showEditApplyFailureGrowl';

describe('showEditApplyFailureGrowl', function showEditApplyFailureGrowlTest() {
  it('shows a critical localized edit failure message', function critical() {
    showEditApplyFailureGrowl(function translate(key: string) {
      return key;
    });

    expect(Growl.addGrowlMessage).toHaveBeenCalledWith({
      id: 'edit-apply-failure',
      title: 'builder_develop_edit_apply_failed_title',
      children: 'builder_develop_edit_apply_failed_body',
      emphasis: 'critical',
      lifetime: 5000,
    });
  });
});
