import '@ux/collapsible/styles';

import Box from '@ux/box';
import Collapsible from '@ux/collapsible';
import CircleFilledIcon from '@ux/icon/circle-filled';
import Tag from '@ux/tag';
import text from '@ux/text';

import { StatusValue } from "@/app/develop/components/types";
import { useTranslations } from "@/hooks/useTranslations";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  children?: React.ReactNode
  title?: string
  description?: string
  status?: StatusValue
  hideStatus?: boolean
  button?: React.ReactNode
  className?: string
  isCollapsible?: boolean
  defaultOpen?: boolean
}

export default function SettingsSection({ children, title, description, status, button, hideStatus, className, isCollapsible = false, defaultOpen = true }: SettingsSectionProps) {
  const titleLine = (
    <Box gap="md" orientation="horizontal" blockAlignChildren="spaceBetween">
      {title && <text.h3 as="title">{title}</text.h3>}
      {status && !hideStatus && <SettingsSectionStatus status={status} />}
    </Box>
  )

  const content = (
    <Box gap="md">
      {description && <text.p>{description}</text.p>}
      {button && (
        <Box gap="md" inlineAlignChildren="end" blockAlignChildren="end" className="w-full">
          {button}
        </Box>
      )}
      {children}
    </Box>
  )

  if (isCollapsible) {
    return (
      <Box gap="lg" className={cn(className)}>
        <Collapsible
          id={title?.toLowerCase().replace(/\s+/g, '-') ?? 'settings-section'}
          title={titleLine}
          defaultOpen={defaultOpen}
          size="sm"
        >
          {content}
        </Collapsible>
      </Box>
    );
  }

  return (
    <Box gap="md" className={cn(className)}>
      <div className="flex flex-col flex-1 @md:flex-row justify-between items-center @md:items-start gap-3 -mb-0.5">
        <Box className="flex-1 w-full">
          {titleLine}
        </Box>
      </div>
      {content}
    </Box>
  )
}

function SettingsSectionStatus({ status }: { status: StatusValue }) {
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
