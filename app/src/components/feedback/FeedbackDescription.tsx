import text from "@ux/text"

import { useTranslations } from "@/hooks/useTranslations";

export function FeedbackDescription() {
  const t = useTranslations();
  return (
    <text.p size={-1} emphasis="passive">
      {t('builder_feedback_description', undefined, 'Feedback only. For immediate support,')}{' '}
      <a
        href="https://www.godaddy.com/help/contact-us"
        target="_blank"
        rel="noopener noreferrer"
        className="underline text-intents-ux-link-foregroundColor"
      >
        {t('builder_common_contact_support', undefined, 'contact us')}
      </a>
    </text.p>
  );
}
