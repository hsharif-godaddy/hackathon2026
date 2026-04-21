'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import Card, { spaceOptions } from '@ux/card';
import EditIcon from '@ux/icon/edit';
import MailIcon from '@ux/icon/mail';
import ShareIcon from '@ux/icon/share';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
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
    <Box gap="xl">
      {/* Modal Content */}
      <Box gap="lg" blockAlignChildren='start'>
        <text.p as="label" size={1}>
          {t('builder_marketing_what_to_create')}
        </text.p>

        <div className="grid grid-cols-3 gap-2 w-full">
          {contentTypeOptions.map((option) => (
            <Card
              key={option.type}
              id={`content-type-${option.type}`}
              as="button"
              onClick={() => {
                if (option.enabled) {
                  onSelectType(option.type);
                }
              }}
              disabled={!option.enabled}
              space={{ inline: spaceOptions.MD, block: spaceOptions.MD }}
            >
              <Box inlineAlignChildren="center" gap="sm" className="pointer-events-none">
                {option.icon}
                <Box className="text-center">
                  <text.span as="caption">
                    {option.title}
                  </text.span>
                  {option.badge && (
                    <text.span as="caption" size={-2}>
                      {option.badge}
                    </text.span>
                  )}
                </Box>
              </Box>
            </Card>
          ))}
        </div>
      </Box>

      {/* Modal Actions */}
      <Box inlineAlignChildren='end'>
        <Button
          onClick={onClose}
          design="secondary"
          size="md"
        >
          {t('builder_marketing_close')}
        </Button>
      </Box>
    </Box>
  );
}
