import { StatusValue } from "@/app/develop/components/types";
import Box from "@ux/box";
import text from "@ux/text";
import CircleFilledIcon from '@ux/icon/circle-filled';

interface BigCardProps {
  children: React.ReactNode
  title?: string
  description?: string
  status?: StatusValue
  button?: React.ReactNode
}

export default function BigCard({ children, title, description, status, button }: BigCardProps) {
  return (
    <Box
      gap="lg"
      className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-12"
    >
      <Box
        orientation="horizontal"
        blockAlignChildren="spaceBetween"
        inlineAlignChildren="start"
      >
        <Box gap="sm">
          { title && (
            <text.h2 as="heading" size={-2}>{title}</text.h2>
          )}
          { description && (
            <text.p>{description}</text.p>
          )}
        </Box>
        { (status || button) && (
          <Box gap="md" inlineAlignChildren="end">
            { status ? <BigCardStatus status={status} /> : <div className="h-6" /> }
            { button && button }
          </Box>
        )}
      </Box>
      { children }
    </Box>
  )
}

function BigCardStatus({ status }: { status: StatusValue }) {
  const { type, label } = status;
  return (
    <Box
      orientation="horizontal"
      gap="md"
      inlineAlignChildren="center"
      blockAlignChildren="start"
      className={getStatusColor(type)}
    >
      <text.p>{label}</text.p>
      <CircleFilledIcon className="size-6" />
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
