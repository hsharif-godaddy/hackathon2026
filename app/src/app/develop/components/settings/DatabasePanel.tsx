'use client'

import React, { useState, useEffect } from 'react';
import Box from '@ux/box';
import Card from '@ux/card';
import { TableDataBrowser } from './TableDataBrowser';

interface DatabasePanelProps {
  appId: string;
}

interface TablesResponse {
  tables: string[];
  count: number;
}

export function DatabasePanel({ appId }: DatabasePanelProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [tables, setTables] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  useEffect(() => {
    const fetchTables = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/database/${appId}/tables`);

        if (!response.ok) {
          const errorData = await response.json();
          // Handle nested error structures from API
          const errorMessage = errorData.error?.message || errorData.error || errorData.message || 'Failed to fetch tables';
          throw new Error(errorMessage);
        }

        const data: TablesResponse = await response.json();
        setTables(data.tables);
      } catch (err) {
        // Enhanced error logging for debugging
        console.error('Database tables fetch error:', {
          error: err,
          message: err instanceof Error ? err.message : String(err),
          type: typeof err,
        });

        // Set user-friendly error message
        let errorMessage = 'An error occurred while loading database tables';
        if (err instanceof Error) {
          errorMessage = err.message;
        } else if (typeof err === 'object' && err !== null) {
          // Handle cases where err is an object
          errorMessage = (err as any).message || JSON.stringify(err);
        } else {
          errorMessage = String(err);
        }

        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTables();
  }, [appId]);

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
      <Box
        blockAlignChildren="center"
        inlineAlignChildren="center"
        className="h-full bg-intents-ux-boxLowContrast-backgroundColor rounded-lg"
      >
        <div className="text-center text-muted-foreground">
          Loading database information...
        </div>
      </Box>
    );
  }

  return (
    <Box orientation="vertical" gap="md" className="w-full" blockAlignChildren="start">


              <h3 className="text-lg font-semibold mb-4">Database Schema</h3>

              {error && (
                <div className="bg-destructive/10 text-destructive rounded-lg p-4 mb-4">
                  <p className="font-medium">Error loading tables</p>
                  <p className="text-sm mt-1">{error}</p>
                </div>
              )}

              {!error && tables.length === 0 && (
                <div className="text-sm text-muted-foreground bg-muted rounded-lg p-8 text-center">
                  <p>No tables found in the database</p>
                  <p className="text-xs mt-2">Create tables to see them listed here</p>
                </div>
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
