import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';
import Button from "@ux/button";
import SiblingSet from '@ux/sibling-set';
import text from "@ux/text";

/**
 * Props for DomainConnectConfirmation component
 */
interface DomainConnectConfirmationProps {
  onConfirm: () => void;
  onCancel: () => void;
  isInternalOnly: boolean;
}

/**
 * Domain connection confirmation UI
 * 
 * Displays warning message and confirmation buttons when user attempts
 * to connect a domain. Warns about DNS updates affecting existing usage.
 * 
 * @param onConfirm - Callback when user confirms connection
 * @param onCancel - Callback when user cancels connection
 * @returns Confirmation UI component
 */
export default function DomainConnectConfirmation({
  onConfirm,
  onCancel,
}: DomainConnectConfirmationProps) {
  const t = useTranslations();
  
  return (
    <div className="flex flex-col gap-1.5 p-1">
        <text.h3 as="title" size={1}>
            {t('builder_domain_connect_confirmation_title')}
        </text.h3>
        <text.span as="paragraph">
            {t('builder_domain_connect_confirmation_description')}
        </text.span>
      <SiblingSet gap="md">
        <Button
          design="primary"
          onClick={onConfirm}
          text={t('builder_custom_domain_modal_button_continue')}
          data-eid={generateClickEID(`settings/domains.connect_confirm.continue`)}
        />
        <Button
          design="secondary"
          onClick={onCancel}
          text={t('builder_custom_domain_modal_button_cancel')}
          data-eid={generateClickEID(`settings/domains.connect_confirm.cancel`)}
        />
      </SiblingSet>
    </div>
  );
}

