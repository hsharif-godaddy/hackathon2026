'use client'

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDatabaseTables } from '@/hooks/useDatabaseTables';
import Box from '@ux/box';
import Button from '@ux/button';
import Skeleton from '@ux/skeleton';
import DatabaseIcon from '@ux/icon/database';
import EditIcon from '@ux/icon/edit';
import BigCard from '@/components/layout/BigCard';
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { ChatTab } from '@/app/develop/components/types';
import { TableDataBrowser } from './TableDataBrowser';
import { formatColumnName } from './utils';
import text from '@ux/text';

interface DatabasePanelProps {
  appId: string;
}

const DATABASE_DESCRIPTION = "Manage the data tables that store your app's information. Browse existing records, add new entries, update values, or remove data as needed to keep your app's database organized and up-to-date.";

export function DatabasePanel({ appId }: DatabasePanelProps) {
  const router = useRouter();
  const { setActiveChatTab } = useDevelopPageStore();
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
        title="Database Tables"
        description={DATABASE_DESCRIPTION}
      >
        <Box gap="sm">
          {[1, 2, 3].map((i) => (
            <Box
              key={`skeleton-${i}`}
              orientation="horizontal"
              className="bg-intents-ux-box-backgroundColor rounded-lg px-4 py-3"
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
        title="Error Loading Database"
        description="An error occurred while loading database tables. Please try again."
        ctaLabel="Retry"
        onCtaClick={() => refetch()}
      />
    );
  }

  if (tables.length === 0) {
    return (
      <EmptyStateCard
        icon={<DatabaseIcon width={48} height={48} />}
        title="No Database Tables Yet"
        description="This app doesn't have any database tables integrated yet. Ask Airo through the chat to create tables for storing your app's data."
        ctaLabel="Go to Chat"
        onCtaClick={() => {
          setActiveChatTab(ChatTab.CHAT);
          router.push(`/develop/${appId}`, { scroll: false });
        }}
      />
    );
  }

  return (
    <BigCard
      title="Database Tables"
      description={DATABASE_DESCRIPTION}
    >
      <Box gap="sm">
        {tables.map((table) => (
          <Box
            key={table}
            orientation="horizontal"
            className="bg-intents-ux-box-backgroundColor rounded-lg px-4 py-3"
            blockAlignChildren="spaceBetween"
            inlineAlignChildren="center"
          >
            <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
              <DatabaseIcon className="size-6" />
              <text.p title={table}>
                {formatColumnName(table)}
              </text.p>
            </Box>
            <Button
              icon={<EditIcon />}
              design="tertiary"
              onClick={() => handleTableClick(table)}
              text="Edit Table"
            />
          </Box>
        ))}
      </Box>
    </BigCard>
  );
}
