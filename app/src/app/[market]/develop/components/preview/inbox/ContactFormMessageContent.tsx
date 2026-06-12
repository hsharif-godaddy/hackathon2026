'use client';

import { Form } from '@/types/inbox/local/conversation';
import { CUSTOMER_BUBBLE_CLASS } from './bubbleStyles';

interface ContactFormMessageContentProps {
  form: Form;
}

export function ContactFormMessageContent({ form }: ContactFormMessageContentProps) {
  return (
    <div className={CUSTOMER_BUBBLE_CLASS}>
      {form.title ? (
        <p className="mb-2 text-sm font-semibold text-ux-text-primary">{form.title}</p>
      ) : null}
      <dl className="flex flex-col gap-2" data-testid="contact-form-fields">
        {form.fields.map((field, index) => (
          <div key={`${field.name}-${index}`} className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-ux-text-secondary">
              {field.name}
            </dt>
            <dd className="wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed text-ux-text-primary">
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
