'use client';

import { useRouter } from 'next/navigation';
import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

export default function NewAccountZeroState() {
  const t = useTranslations();
  const router = useRouter();

  return (
    <Box
      gap="lg"
      blockAlignChildren="center"
      inlineAlignChildren="center"
      className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-6 md:p-8"
    >
      <Box gap="md" blockAlignChildren="center" className="max-w-lg text-center">
        <text.h2
          as="title"
          size={3}
          text={t('builder_manageplan_newaccount_title')}
        />

        <text.p
          as="paragraph"
          size={0}
          className="text-center"
          text={t('builder_manageplan_newaccount_description')}
        />
      </Box>

      <Button
        design="primary"
        size="md"
        text={t('builder_manageplan_newaccount_cta')}
        onClick={() => router.push('/')}
        data-eid={generateClickEID('manageplan.new_account.create_app')}
        data-partial="componentAiro"
      />
    </Box>
  );
}
