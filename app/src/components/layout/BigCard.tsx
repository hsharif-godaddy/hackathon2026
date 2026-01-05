import Box from "@ux/box";
import CircleFilledIcon from '@ux/icon/circle-filled';
import text from "@ux/text";

import { StatusValue } from "@/app/develop/components/types";
import { useTranslations } from "@/hooks/useTranslations";

interface BigCardProps {
  children: React.ReactNode
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
      className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-3 @md:p-4 @lg:p-6"
    >
      <div className="flex flex-col-reverse @md:flex-row justify-between items-center @md:items-start gap-1 @md:gap-3">
        <Box gap="sm">
          { title && (
            <text.h3 as="title" size={2}>{title}</text.h3>
          )}
          { description && (
            <text.p>{description}</text.p>
          )}
        </Box>
        { (status || button) && (
          <Box gap="md" inlineAlignChildren="end">
            { status && !hideStatus && <BigCardStatus status={status} /> }
            { !status && !hideStatus && <div className="hidden @md:block h-3" /> }
            { button && button }
          </Box>
        )}
      </div>
      { children }
    </Box>
  )
}

function BigCardStatus({ status }: { status: StatusValue }) {
  const t = useTranslations();
  const { type, label } = status;
  return (
    <Box
      orientation="horizontal"
      gap="md"
      inlineAlignChildren="center"
      blockAlignChildren="start"
      className={getStatusColor(type)}
    >
      <text.p>{t(`builder_status_${label?.toLowerCase() || 'ready'}`)}</text.p>
      <CircleFilledIcon className="size-3" />
    </Box>
  )
}

function getStatusColor(type: string) {
  switch (type) {
    case 'success':
      return 'text-intents-ux-feedbackHighContrastSuccess-feedbackColor';
    case 'error':
      return 'text-intents-ux-feedbackHighContrastCritical-feedbackColor';
    case 'warning':
      // Using info color because the intent for warning is not actually the highcontrast orange and instead the light yellow so it's not visible enough
      return 'text-intents-ux-feedbackHighContrastInfo-feedbackColor';
    default:
      return 'text-intents-ux-box-foregroundColor';
  }
}
