'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import EditIcon from '@ux/icon/edit';
import MailIcon from '@ux/icon/mail';
import ShareIcon from '@ux/icon/share';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
import { ContentType, ContentTypeOption } from './types';

interface ContentTypeSelectorProps {
  onSelectType: (type: ContentType) => void;
  onClose: () => void;
}

export default function ContentTypeSelector({
  onSelectType,
  onClose
}: ContentTypeSelectorProps) {
  const t = useTranslations();

  const contentTypeOptions: ContentTypeOption[] = [
    {
      type: 'blog',
      icon: <EditIcon className="w-4 h-4" />,
      title: t('builder_marketing_content_type_blog_post'),
      enabled: true,
      badge: null
    },
    {
      type: 'social',
      icon: <ShareIcon className="w-4 h-4" />,
      title: t('builder_marketing_content_type_social_post'),
      enabled: true,
      badge: null
    },
    {
      type: 'email',
      icon: <MailIcon className="w-4 h-4" />,
      title: t('builder_marketing_content_type_email'),
      enabled: false,
      badge: t('builder_marketing_coming_soon')
    }
  ];

  return (
    <Box gap="sm">
      <text.p className="text-sm font-semibold text-intents-ux-textStandard-textColor text-center">
        {t('builder_marketing_what_to_create')}
      </text.p>

      <div className="grid grid-cols-3 gap-2">
        {contentTypeOptions.map((option) => (
          <button
            key={option.type}
            onClick={() => {
              if (option.enabled) {
                onSelectType(option.type);
              }
            }}
            disabled={!option.enabled}
            className={cn(
              'relative px-2 py-2 rounded-md border text-center transition-all duration-200 flex flex-col items-center gap-1',
              option.enabled
                ? 'border-intents-ux-boxLowContrast-borderColor hover:border-intents-ux-actionPrimary-backgroundColor hover:shadow cursor-pointer bg-intents-ux-boxStandard-backgroundColor'
                : 'border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxLowContrast-backgroundColor/30 cursor-not-allowed opacity-60'
            )}
          >
            <div className={cn(
              'flex-shrink-0 w-7 h-7 rounded flex items-center justify-center transition-all duration-200',
              option.enabled
                ? 'bg-intents-ux-actionPrimary-backgroundColor/10 text-intents-ux-actionPrimary-textColor'
                : 'bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubdued-textColor'
            )}>
              {option.icon}
            </div>

            <div className="flex flex-col items-center">
              <span className="text-xs font-medium text-intents-ux-textStandard-textColor">
                {option.title}
              </span>
              {option.badge && (
                <span className="px-1 py-0 text-[10px] font-medium rounded-full bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubdued-textColor mt-0.5">
                  {option.badge}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      <Button
        onClick={onClose}
        design="secondary"
        size="md"
        className="w-full"
      >
        {t('builder_marketing_close')}
      </Button>
    </Box>
  );
}
