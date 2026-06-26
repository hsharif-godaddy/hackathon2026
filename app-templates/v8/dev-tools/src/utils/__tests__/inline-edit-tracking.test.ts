import { describe, it, expect, vi, beforeEach } from 'vitest';

const { trackClick } = vi.hoisted(() => ({ trackClick: vi.fn() }));
vi.mock('../eventBus', () => ({
  trackEventBus: { click: trackClick, impression: vi.fn() },
}));

import { trackInlineEdit } from '../inline-edit-tracking';

describe('trackInlineEdit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires a click EID with contentKey + fieldType for a content target', () => {
    trackInlineEdit('field', { key: 'home.hero.title', kind: 'copy' });
    expect(trackClick).toHaveBeenCalledWith('devtools.inline_edit.field', {
      contentKey: 'home.hero.title',
      fieldType: 'copy',
    });
  });

  it('maps save and cancel actions to their EIDs', () => {
    trackInlineEdit('save', { key: 'a.b', kind: 'richText' });
    trackInlineEdit('cancel', { key: 'a.b', kind: 'richText' });
    expect(trackClick).toHaveBeenNthCalledWith(1, 'devtools.inline_edit.save', {
      contentKey: 'a.b',
      fieldType: 'richText',
    });
    expect(trackClick).toHaveBeenNthCalledWith(2, 'devtools.inline_edit.cancel', {
      contentKey: 'a.b',
      fieldType: 'richText',
    });
  });

  it('is a no-op when target is null (non-content element)', () => {
    trackInlineEdit('field', null);
    expect(trackClick).not.toHaveBeenCalled();
  });

  it('swallows errors from the underlying track call so it never breaks the edit flow', () => {
    trackClick.mockImplementationOnce(() => {
      throw new Error('postMessage blocked');
    });
    expect(() => trackInlineEdit('save', { key: 'a.b', kind: 'copy' })).not.toThrow();
  });
});
