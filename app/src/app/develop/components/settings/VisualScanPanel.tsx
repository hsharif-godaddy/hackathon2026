import Box from '@ux/box';
import Button from '@ux/button';
import Card from '@ux/card';
import WandIcon from '@ux/icon/wand';

import BigCard from "@/components/layout/BigCard.tsx";
import { useTranslations } from '@/hooks/useTranslations';

export default function VisualScanPanel() {
  const t = useTranslations();
  return (
    <Box gap="lg" className="@container">
      <BigCard
        title={t('builder_settings_visualscan_title')}
        description={t('builder_settings_visualscan_desc')}
        button={(
          <Button
            design="primary"
            icon={<WandIcon />}
            disabled
            text={t('builder_settings_visualscan_button')}
          />
        )}>
        <Card>
          <p>{t('builder_settings_visualscan_no_result')}</p>
        </Card>
      </BigCard>
    </Box>
  )
}
