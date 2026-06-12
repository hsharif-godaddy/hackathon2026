'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import XIcon from '@ux/icon/x';
import text from '@ux/text';

import { useBreakpoints } from '@/hooks/useBreakpoints';
import { useTranslations } from '@/hooks/useTranslations';
import { Sheet, SheetContent } from '@/lib/shadcn/sheet';

export interface SeoRegressionAlertData {
  scoreDelta: number;
  currentScore: number;
  regressions: Array<{ path: string; newIssues: string[] }>;
}

interface SeoQualityRegressionAlertProps {
  onDismiss: () => void;
  onFix: () => void;
}

interface SeoQualityRegressionAlertContentProps {
  onDismiss: () => void;
  onFix: () => void;
}

function SeoQualityRegressionAlertContent({
  onDismiss,
  onFix,
}: SeoQualityRegressionAlertContentProps) {
  const t = useTranslations();

  return (
    <Box orientation="vertical" gap="md">
      <div className="flex w-full items-start justify-between gap-2">
        <text.h3 as="title" size={1}>
          {t('builder_tasks_seo_short_label')}
        </text.h3>
        <Button
          className="flex-shrink-0"
          design="inline"
          size="sm"
          icon={<XIcon />}
          onClick={onDismiss}
          aria-label={t('builder_common_close')}
        />
      </div>
      <text.p as="title" size={-1}>
        {t('builder_seo_quality_alert_subtitle', {}, "Your site's search visibility needs attention.")}
      </text.p>
      <text.p as="paragraph" size={-1}>
        {t('builder_seo_quality_alert_body', {}, 'Recent changes affected a few pages. Fix it now with an SEO audit. Credit usage is based on your site\'s size.')}
      </text.p>
      <Button
        design="secondary"
        type="button"
        size="sm"
        stretch
        text={t('builder_seo_quality_alert_cta', {}, 'Run SEO Scan')}
        onClick={onFix}
      />
    </Box>
  );
}

export default function SeoQualityRegressionAlert({
  onDismiss,
  onFix,
}: SeoQualityRegressionAlertProps) {
  const { isLgBreakpoint } = useBreakpoints();

  if (!isLgBreakpoint) {
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onDismiss();
        }}
      >
        <SheetContent
          side="bottom"
          role="alert"
          className="[&>button]:hidden rounded-t-xl border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-4 pb-6"
          data-testid="seo-quality-regression-alert"
        >
          <SeoQualityRegressionAlertContent onDismiss={onDismiss} onFix={onFix} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      role="alert"
      className="fixed top-4 right-4 z-50 w-[min(calc(100vw-2rem),22rem)] rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-4 shadow-lg"
      data-testid="seo-quality-regression-alert"
    >
      <SeoQualityRegressionAlertContent onDismiss={onDismiss} onFix={onFix} />
    </div>
  );
}
