'use client';

import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

interface DnsConflictModalProps {
  fqdn: string;
  onClose: () => void;
  onConfirm: (consent: boolean) => void;
  variant: 'conflict' | 'unverified';
}

export default function DnsConflictModal({
  fqdn,
  onClose,
  onConfirm,
  variant,
}: DnsConflictModalProps) {
  const t = useTranslations();
  const [shouldUpdateDns, setShouldUpdateDns] = useState(false);
  const isConflict = variant === 'conflict';
  const title = isConflict
    ? t(
      'builder_publish_dns_conflict_modal_title',
      undefined,
      'Publish domain with DNS update?'
    )
    : t(
      'builder_publish_dns_unverified_modal_title',
      { fqdn },
      "Couldn't verify DNS for {fqdn}"
    );
  const detail = isConflict
    ? t(
      'builder_publish_dns_conflict_modal_description',
      undefined,
      'Your domain currently points to another service. Update DNS records to direct visitors to your Airo Builder site.'
    )
    : t(
      'builder_publish_dns_unverified_modal_description',
      undefined,
      'We could not verify current DNS records. Select Update DNS records below if you want to route traffic to your Airo Builder app.'
    );
  const publishLabel = t(
    'builder_publish_button',
    undefined,
    'Publish'
  );
  const updateDnsLabel = t(
    'builder_publish_dns_conflict_modal_confirm',
    undefined,
    'Update DNS records'
  );
  return (
    <Modal
      title={title}
      centered={false}
      onClose={onClose}
      actions={(
        <Box orientation='horizontal' gap='md' className='w-full justify-end'>
          <Button
            design='primary'
            data-eid={generateClickEID('publish.dns_conflict.confirm')}
            text={publishLabel}
            onClick={() => onConfirm(shouldUpdateDns)}
          />
        </Box>
      )}
    >
      <Box className='-mt-2 md:max-w-lg text-left' orientation='vertical' gap='lg'>
        <text.p>{detail}</text.p>
        <Checkbox
          id='dns-update-consent'
          name='dns-update-consent'
          label={updateDnsLabel}
          checked={shouldUpdateDns}
          onChange={() => setShouldUpdateDns((value) => !value)}
        />
      </Box>
    </Modal>
  );
}
