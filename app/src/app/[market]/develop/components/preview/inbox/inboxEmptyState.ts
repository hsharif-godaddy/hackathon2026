export interface InboxEmptyStateCta {
  labelKey: string;
  eid: string;
  testId: string;
  promptKey: string;
}

export interface InboxEmptyState {
  titleKey: string;
  bodyKey: string;
  ctas: InboxEmptyStateCta[];
}

const ADD_CHAT_CTA: InboxEmptyStateCta = {
  labelKey: 'builder_inbox_empty_cta_add_chat',
  eid: 'inbox.empty.cta.add_chat',
  testId: 'inbox-empty-cta-add-chat',
  promptKey: 'builder_inbox_empty_prompt_add_chat',
};

const ADD_FORM_CTA: InboxEmptyStateCta = {
  labelKey: 'builder_inbox_empty_cta_add_form',
  eid: 'inbox.empty.cta.add_form',
  testId: 'inbox-empty-cta-add-form',
  promptKey: 'builder_inbox_empty_prompt_add_form',
};

export function getInboxEmptyState(
  embeddableId: number | null,
  categoryId: number | string | null,
): InboxEmptyState {
  const hasChatWidget: boolean = embeddableId !== null;
  const hasContactForm: boolean = categoryId !== null;

  const ctas: InboxEmptyStateCta[] = [
    ...(hasChatWidget ? [] : [ADD_CHAT_CTA]),
    ...(hasContactForm ? [] : [ADD_FORM_CTA]),
  ];

  if (!hasChatWidget && !hasContactForm) {
    return {
      titleKey: 'builder_inbox_empty_setup_title',
      bodyKey: 'builder_inbox_empty_body_no_channels',
      ctas,
    };
  }

  const bodyKey: string = hasChatWidget
    ? hasContactForm
      ? 'builder_inbox_empty_body_all_channels'
      : 'builder_inbox_empty_body_chat_only'
    : 'builder_inbox_empty_body_form_only';

  return { titleKey: 'builder_inbox_empty_ready_title', bodyKey, ctas };
}
