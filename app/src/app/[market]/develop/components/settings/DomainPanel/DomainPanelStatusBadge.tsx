import CircleFilledIcon from '@ux/icon/circle-filled';
import Tag from '@ux/tag';

import { type StatusValue } from '@/app/[market]/develop/components/types';
import { useTranslations } from '@/hooks/useTranslations';
import {
  DOMAIN_PANEL_STATUS_TAG_CLASS,
} from './domainPanelStyles';

export function DomainPanelStatusBadge({ status }: { status: StatusValue }) {
  const t = useTranslations();
  const { type, label } = status;

  return (
    <Tag
      design="inline"
      emphasis={type}
      highcontrast
      className={DOMAIN_PANEL_STATUS_TAG_CLASS}
      icon={<CircleFilledIcon />}
    >
      {t(`builder_status_${label?.toLowerCase() || 'ready'}`)}
    </Tag>
  );
}
