'use client'

import React, { useState } from 'react';
import Box from '@ux/box';
import Card from '@ux/card';
import DatabaseIcon from '@ux/icon/database';
import Spinner from '@ux/spinner';
import text from '@ux/text';

import { TableDataBrowser } from '@/app/develop/components/settings/Database/TableDataBrowser';
import { ChatTab } from '@/app/develop/components/types';
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useDatabaseTables } from '@/hooks/useDatabaseTables';
import { useTranslations } from '@/hooks/useTranslations';

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
      <div className='flex flex-col justify-center items-center h-[calc(100vh-40rem)] gap-4'>
        <Spinner size='md'/>
        <text.p>={t('builder_settings_database_loading')}  </text.p>
      </div>
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

  return (
    <Box orientation="vertical" gap="md" className="w-full" blockAlignChildren="start">
      {tables.length === 0 && (
        <EmptyStateCard
          icon={<DatabaseIcon width={48} height={48} />}
          title={t('builder_settings_database_empty_title')}
          description={t('builder_settings_database_empty_desc')}
          ctaLabel={t('builder_settings_database_empty_cta')}
          onCtaClick={() => {
            setActiveChatTab(ChatTab.CHAT);
          }}
        />
      )}

      {!error && tables.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {t('builder_settings_database_found', { count: tables.length })}
            </p>
          </div>

          <Box
            orientation="horizontal"
            gap="md"
            wrap={true}
          >
            {tables.map((table, index) => (
              <Card
                key={table}
                id={`table-card-${table}`}
                as="button"
                onClick={() => handleTableClick(table)}
                className="min-w-[200px]"
              >
                <div className="p-2">
                  <div className="text-xs text-muted-foreground mb-1">
                    #{index + 1}
                  </div>
                  <div className="font-mono font-medium">
                    {table}
                  </div>
                </div>
              </Card>
            ))}
          </Box>
        </div>
      )}
    </Box>
  );
}
