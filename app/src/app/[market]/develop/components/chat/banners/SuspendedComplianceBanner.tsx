'use client'

import { FormattedMessage } from 'react-intl'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import ChatBanner from '@/lib/ChatBanner'
import { getRootDomain } from '@/utils/getRootDomain';

export default function SuspendedComplianceBanner() {
  const t = useTranslations();
  const rootDomain = getRootDomain() || 'godaddy.com';
  const contactUsUrl = `https://www.${rootDomain}/contact-us`;

  return (
    <ChatBanner variant="critical">
      <text.span as="caption" size={-1} className="flex-1">
        <FormattedMessage
          id="builder_chat_suspended_compliance_with_link_message"
          values={{
            contactLink: (
              <a
                key="contact-link"
                href={contactUsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block underline !cursor-pointer !lowercase"
              >
                {t('builder_unpublish_contact_support')}
              </a>
            ),
          }}
        />
      </text.span>
    </ChatBanner>
  )
}
