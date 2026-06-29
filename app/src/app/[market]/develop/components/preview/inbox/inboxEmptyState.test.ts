import { describe, expect, it } from 'vitest';

import { getInboxEmptyState } from './inboxEmptyState';

describe('getInboxEmptyState', () => {
  it('returns setup title with both CTAs when both pointers are absent', () => {
    const state = getInboxEmptyState(null, null);

    expect(state.titleKey).toBe('builder_inbox_empty_setup_title');
    expect(state.bodyKey).toBe('builder_inbox_empty_body_no_channels');
    expect(state.ctas.map((cta) => cta.eid)).toEqual([
      'inbox.empty.cta.add_chat',
      'inbox.empty.cta.add_form',
    ]);
    expect(state.ctas.map((cta) => cta.promptKey)).toEqual([
      'builder_inbox_empty_prompt_add_chat',
      'builder_inbox_empty_prompt_add_form',
    ]);
  });

  it('returns ready title with no CTAs when both pointers are present', () => {
    const state = getInboxEmptyState(789, 'support');

    expect(state.titleKey).toBe('builder_inbox_empty_ready_title');
    expect(state.bodyKey).toBe('builder_inbox_empty_body_all_channels');
    expect(state.ctas).toEqual([]);
  });

  it('offers only the contact form CTA when the chat widget exists but the category is absent', () => {
    const state = getInboxEmptyState(789, null);

    expect(state.titleKey).toBe('builder_inbox_empty_ready_title');
    expect(state.bodyKey).toBe('builder_inbox_empty_body_chat_only');
    expect(state.ctas.map((cta) => cta.eid)).toEqual(['inbox.empty.cta.add_form']);
    expect(state.ctas.map((cta) => cta.promptKey)).toEqual(['builder_inbox_empty_prompt_add_form']);
  });

  it('offers only the chat widget CTA when the category exists but the chat widget is absent', () => {
    const state = getInboxEmptyState(null, 'support');

    expect(state.titleKey).toBe('builder_inbox_empty_ready_title');
    expect(state.bodyKey).toBe('builder_inbox_empty_body_form_only');
    expect(state.ctas.map((cta) => cta.eid)).toEqual(['inbox.empty.cta.add_chat']);
    expect(state.ctas.map((cta) => cta.promptKey)).toEqual(['builder_inbox_empty_prompt_add_chat']);
  });

  it('treats falsy-but-present category values (0, empty string) as present', () => {
    expect(getInboxEmptyState(0, '').bodyKey).toBe('builder_inbox_empty_body_all_channels');
    expect(getInboxEmptyState(0, '').ctas).toEqual([]);
  });
});
