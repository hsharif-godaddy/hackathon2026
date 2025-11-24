'use client'

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDatabaseTables } from '@/hooks/useDatabaseTables';
import Box from '@ux/box';
import Card from '@ux/card';
import Spinner from '@ux/spinner';
import DatabaseIcon from '@ux/icon/database';
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { ChatTab } from '@/app/develop/components/types';
import { TableDataBrowser } from '@/app/develop/components/settings/Database/TableDataBrowser';
import text from '@ux/text';

interface DatabasePanelProps {
  appId: string;
}

export function DatabasePanel({ appId }: DatabasePanelProps) {
  const router = useRouter();
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab);
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
        <text.p>Loading database tables...</text.p>
      </div>
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

  return (
    <Box orientation="vertical" gap="md" className="w-full" blockAlignChildren="start">
      {tables.length === 0 && (
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
      )}

      {!error && tables.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Found {tables.length} {tables.length === 1 ? 'table' : 'tables'}
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
                <div className="p-4">
                  <div className="text-xs text-muted-foreground mb-2">
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
