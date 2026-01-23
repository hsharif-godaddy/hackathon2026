'use client'

import Box from '@ux/box';
import Button from '@ux/button';

import BigCard from '@/components/layout/BigCard';
import { useTranslations } from '@/hooks/useTranslations';
import { getRootDomain } from '@/utils/getRootDomain';

export default function TeamPanel() {
  const t = useTranslations();

  // Dynamically determine SSO host based on current domain
  // test-godaddy.com → sso.test-godaddy.com/access
  // godaddy.com → sso.godaddy.com/access
  const rootDomain = getRootDomain() || 'godaddy.com';
  const delegationUrl = `https://sso.${rootDomain}/access`;

  return (
    <Box gap="lg" className="@container">
      <BigCard
        title={t("builder_settings_team_title")}
        description={t("builder_settings_team_description")}
      >
        <div>
          <Button
            design="primary"
            size="md"
            text={t("builder_settings_team_manage_access")}
            href={delegationUrl}
            external
          />
        </div>
      </BigCard>
    </Box>
  );
}
