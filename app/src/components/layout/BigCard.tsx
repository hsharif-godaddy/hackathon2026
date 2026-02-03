import Box from "@ux/box";
import CircleFilledIcon from '@ux/icon/circle-filled';
import Tag from '@ux/tag';
import text from "@ux/text";

import { StatusValue } from "@/app/develop/components/types";
import { useTranslations } from "@/hooks/useTranslations";

interface BigCardProps {
  children?: React.ReactNode
  title?: string
  description?: string
  status?: StatusValue
  hideStatus?: boolean
  button?: React.ReactNode
}

export default function BigCard({ children, title, description, status, button, hideStatus }: BigCardProps) {
  return (
    <Box
      gap="lg"
      className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-3 @md:p-4 @lg:p-5"
    >
      <div
        className="flex flex-col @md:flex-row justify-between items-center @md:items-start gap-1 @md:gap-3"
      >
        <Box gap="sm" className="flex-1">
          {title && (
            <text.h3 as="title" size={2}>{title}</text.h3>
          )}
          {description && (
            <text.p>{description}</text.p>
          )}
        </Box>
        {(status || button) && (
          <Box gap="md" inlineAlignChildren="end">
            {status && !hideStatus && <BigCardStatus status={status} />}
            {!status && !hideStatus && <div className="hidden @md:block h-3" />}
            {button && button}
          </Box>
        )}
      </div>
      {children}
    </Box>
  )
}

function BigCardStatus({ status }: { status: StatusValue }) {
  const t = useTranslations();
  const { type, label } = status;
  return (
    <Tag
      design="inline"
      emphasis={type}
      highcontrast
      icon={<CircleFilledIcon />}
    >
      {t(`builder_status_${label?.toLowerCase() || 'ready'}`)}
    </Tag>
  )
}
