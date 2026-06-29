'use client';

import { type ReactElement, type ReactNode } from 'react';
import { FormattedMessage } from 'react-intl';
import Button from '@ux/button';
import AlertIcon from '@ux/icon/alert';
import Spinner from '@ux/spinner';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

interface PublishDomainConflictProps {
  domain: string;
  existingProjectName: string;
  isOverriding: boolean;
  onChangeDomain: () => void;
  onOverride: () => void;
}

export default function PublishDomainConflict({
  domain,
  existingProjectName,
  isOverriding,
  onChangeDomain,
  onOverride,
}: PublishDomainConflictProps): ReactElement {
  const t = useTranslations();

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-start gap-2 rounded-lg border border-intents-ux-boxLowContrast-borderColor p-3'>
        <AlertIcon className='mt-0.5 size-[1.6em] shrink-0 text-intents-ux-feedbackHighContrastWarning-feedbackColor' />
        <div className='flex min-w-0 flex-col gap-1'>
          <text.strong size={1} className='text-intents-ux-box-foregroundColor'>
            {t('builder_publish_domain_conflict_title')}
          </text.strong>
          <text.p size={-1} className='text-intents-ux-text-secondaryColor'>
            <FormattedMessage
              id='builder_publish_domain_conflict_body'
              values={{
                domain,
                projectName: existingProjectName,
                b: (chunks: ReactNode) => (
                  <strong className='font-semibold text-intents-ux-box-foregroundColor'>{chunks}</strong>
                ),
              }}
            />
          </text.p>
        </div>
      </div>

      <Button
        className='w-full !py-2'
        design='secondary'
        size='sm'
        disabled={isOverriding}
        onClick={onChangeDomain}
        data-eid={generateClickEID('develop.publish.domain_conflict.change_domain')}
        data-testid='publish-conflict-change-domain'
        text={t('builder_publish_change_domain')}
      />
      <Button
        className='w-full !py-2'
        design='primary'
        size='sm'
        data-partial='componentAiro'
        disabled={isOverriding}
        onClick={onOverride}
        icon={isOverriding ? <Spinner size='sm' /> : undefined}
        data-eid={generateClickEID('develop.publish.domain_conflict.override')}
        data-testid='publish-conflict-override'
        text={isOverriding
          ? t('builder_publish_overriding')
          : t('builder_publish_override_and_publish')}
      />
    </div>
  );
}
