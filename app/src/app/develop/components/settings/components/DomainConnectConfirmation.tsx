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
  return (
    <div className="flex flex-col gap-3 p-2">
        <text.h3 as="title" size={1}>
            Are you sure you want to connect this domain?
        </text.h3>
        <text.span as="paragraph">
            By proceeding, this will automatically update the DNS for this domain. Anything already using this domain will stop working.
        </text.span>
      <SiblingSet gap="md">
        <Button
          design="primary"
          onClick={onConfirm}
          text="Yes, Continue"
          data-eid={generateClickEID(`settings/domains.connect_confirm.continue`)}
        />
        <Button
          design="secondary"
          onClick={onCancel}
          text="Cancel"
          data-eid={generateClickEID(`settings/domains.connect_confirm.cancel`)}
        />
      </SiblingSet>
    </div>
  );
}

