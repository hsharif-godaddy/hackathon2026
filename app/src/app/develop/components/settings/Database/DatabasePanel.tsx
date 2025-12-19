'use client'

import React, { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import DatabaseIcon from '@ux/icon/database';
import EditIcon from '@ux/icon/edit';
import Skeleton from '@ux/skeleton';
import text from '@ux/text';

import { TableDataBrowser } from '@/app/develop/components/settings/Database/TableDataBrowser';
import { formatColumnName } from '@/app/develop/components/settings/Database/utils';
import { ChatTab } from '@/app/develop/components/types';
import BigCard from '@/components/layout/BigCard';
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { useDatabaseTables } from '@/hooks/useDatabaseTables';
import { useTranslations } from '@/hooks/useTranslations';
import { useChatTabs } from '@/hooks/useChatTabs';

interface DatabasePanelProps {
  appId: string;
}

export function DatabasePanel({ appId }: DatabasePanelProps) {
  const t = useTranslations();
  const { setActiveChatTab } = useChatTabs();
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const {
    data: tables = [],
    isLoading,
    error,
    refetch,
  } = useDatabaseTables({ appId });

  const handleTableClick = (tableName: string) => {
    setSelectedTable(tableName);
  };

  const handleBackToList = () => {
    setSelectedTable(null);
  };

  // Show table browser when a table is selected
  if (selectedTable) {
    return (
      <TableDataBrowser
        appId={appId}
        tableName={selectedTable}
        onBack={handleBackToList}
      />
    );
  }

  if (isLoading) {
    return (
      <BigCard
        title={t('builder_settings_database_title')}
        description={t('builder_settings_database_description')}
      >
        <Box gap="sm">
          {[1, 2, 3].map((i) => (
            <Box
              key={`skeleton-${i}`}
              orientation="horizontal"
              className="bg-intents-ux-box-backgroundColor rounded-lg px-2 py-1.5"
              blockAlignChildren="spaceBetween"
              inlineAlignChildren="center"
            >
              <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
                <Skeleton rounding="full" size="sm" width="24px" height="24px" />
                <Skeleton size="sm" width="180px" height="20px" />
              </Box>
              <Skeleton size="md" width="105px" height="36px" />
            </Box>
          ))}
        </Box>
      </BigCard>
    );
  }

  if (error) {
    return (
      <EmptyStateCard
        icon={<DatabaseIcon width={48} height={48} />}
        title={t('builder_settings_database_error_title')}
        description={t('builder_settings_database_error_desc')}
        ctaLabel={t('builder_common_retry')}
        onCtaClick={() => refetch()}
      />
    );
  }

  if (tables.length === 0) {
    return (
      <EmptyStateCard
        icon={<DatabaseIcon width={48} height={48} />}
        title={t('builder_settings_database_empty_title')}
        description={t('builder_settings_database_empty_desc')}
        ctaLabel={t('builder_settings_database_empty_cta')}
        onCtaClick={() => {
          setActiveChatTab(ChatTab.CHAT);
        }}
      />
    );
  }

  return (
    <BigCard
      title={t('builder_settings_database_title')}
      description={t('builder_settings_database_description')}
    >
      <Box gap="sm">
        {tables.map((table) => (
          <Box
            key={table}
            orientation="horizontal"
            className="bg-intents-ux-box-backgroundColor rounded-lg px-2 py-1.5"
            blockAlignChildren="spaceBetween"
            inlineAlignChildren="center"
          >
            <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
              <DatabaseIcon className="size-3" />
              <text.p title={table}>
                {formatColumnName(table)}
              </text.p>
            </Box>
            <Button
              icon={<EditIcon />}
              design="tertiary"
              size="sm"
              onClick={() => handleTableClick(table)}
              text={t('builder_settings_database_common_edit_table')}
            />
          </Box>
        ))}
      </Box>
    </BigCard>
  );
}
