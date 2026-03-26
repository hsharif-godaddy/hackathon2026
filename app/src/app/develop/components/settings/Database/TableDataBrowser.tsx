'use client'

import React, { useCallback, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import ArrowLeftIcon from '@ux/icon/arrow-left';
import DatabaseIcon from '@ux/icon/database';
import DownloadIcon from '@ux/icon/download';
import EditIcon from '@ux/icon/edit';
import PlusIcon from '@ux/icon/plus';
import RefreshIcon from '@ux/icon/refresh';
import TrashIcon from '@ux/icon/trash';
import { Menu, MenuButton, MenuItem, MenuList } from '@ux/menu';
import Pagination from '@ux/pagination';
import Table, {
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@ux/table';
import text from '@ux/text';

import BigCard from '@/components/layout/BigCard';
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { useTableData } from '@/hooks/useTableData';
import { useDeleteRow } from '@/hooks/useTableMutations';
import { useTableSchema } from '@/hooks/useTableSchema';
import { useTranslations } from '@/hooks/useTranslations';
import { formatDate } from '@/utils/common';
import { AddRowDialog } from './AddRowDialog';
import { DeleteRowModal } from './DeleteRowModal';
import { EditRowDialog } from './EditRowDialog';
import { TableDataBrowserSkeleton } from './TableDataBrowserSkeleton';
import { formatColumnName, triggerTableExport } from './utils';

interface TableDataBrowserProps {
  appId: string;
  tableName: string;
  onBack: () => void;
}

export function TableDataBrowser({ appId, tableName, onBack }: TableDataBrowserProps) {
  const t = useTranslations();

  const [currentPage, setCurrentPage] = useState(1);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<Record<string, any> | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Record<string, any> | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<Error | string | null>(null);

  const { data: tableData, isLoading, error, refetch, isRefetching } = useTableData({
    appId,
    tableName,
    page: currentPage,
    limit: 9,
  });

  const { data: schema = [] } = useTableSchema({
    appId,
    tableName,
  });

  const deleteRowMutation = useDeleteRow({ appId, tableName });

  const data = tableData?.rows || [];
  const pagination = {
    page: tableData?.page || 1,
    limit: tableData?.limit || 9,
    total: tableData?.total || 0,
    hasMore: tableData?.hasMore || false,
  };

  const handleDeleteRow = useCallback((row: Record<string, any>) => {
    setDeleteRow(row);
    setDeleteError(null);
    setIsDeleteDialogOpen(true);
  }, []);

  const confirmDeleteRow = useCallback(async () => {
    if (!deleteRow) return;

    try {
      setDeleteError(null);

      // Extract primary key columns
      const primaryKey: Record<string, any> = {};
      schema.forEach(col => {
        if (col.key === 'PRI') {
          primaryKey[col.name] = deleteRow[col.name];
        }
      });

      if (Object.keys(primaryKey).length === 0) {
        throw new Error('No primary key found for this table');
      }

      await deleteRowMutation.mutateAsync(primaryKey);

      // Close modal and refresh data
      setIsDeleteDialogOpen(false);
      setDeleteRow(null);

      // If we deleted the last row on a page > 1, go back one page
      if (data.length === 1 && pagination.page > 1) {
        setCurrentPage(pagination.page - 1);
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err : String(err));
    }
  }, [deleteRow, schema, deleteRowMutation, data.length, pagination.page]);

  const handleEditRow = (row: Record<string, any>) => {
    setEditRow(row);
    setIsEditDialogOpen(true);
  };

  const handleAddSuccess = () => {
    setIsAddDialogOpen(false);
    setCurrentPage(1);
  };

  const handleEditSuccess = () => {
    setIsEditDialogOpen(false);
    setEditRow(null);
  };

  const handlePageChange = (newOffset: number) => {
    // Convert offset to page number (Pagination component passes offset, not page)
    const newPage = Math.floor(newOffset / pagination.limit) + 1;

    // Validate page bounds
    const maxPage = pagination.limit > 0 ? Math.ceil(pagination.total / pagination.limit) : 1;
    const validPage = Math.max(1, Math.min(newPage, maxPage));

    setCurrentPage(validPage);
  };

  const handleExport = useCallback((format: 'csv' | 'json') => {
    triggerTableExport(appId, tableName, format);
  }, [appId, tableName]);

  const isDateColumn = (columnType: string): boolean => {
    const type = columnType.toLowerCase().trim();
    // Remove precision/length parameters (e.g., datetime(6) -> datetime)
    const baseType = type.split('(')[0];

    // Date/time types
    const dateTimeTypes = new Set([
      'date',
      'datetime',
      'timestamp',
      'time',
      'year'
    ]);

    return dateTimeTypes.has(baseType);
  };

  const renderCellValue = (value: any, columnType?: string) => {
    if (value === null) return <div className="text-muted-foreground italic pr-1">null</div>;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value);

    // Format date/datetime/timestamp columns
    if (columnType && isDateColumn(columnType)) {
      try {
        return formatDate(value, true);
      } catch {
        return String(value);
      }
    }

    return String(value);
  };

  const getCellValueString = (value: any, columnType?: string): string => {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value);

    // Format date/datetime/timestamp columns
    if (columnType && isDateColumn(columnType)) {
      try {
        return formatDate(value, true);
      } catch {
        return String(value);
      }
    }

    return String(value);
  };

  if (isLoading && data.length === 0) {
    return <TableDataBrowserSkeleton tableName={tableName} onBack={onBack} />;
  }

  if (error) {
    return (
      <Box orientation="vertical" gap="md" className="@container w-full">
        <div className="flex">
          <Button
            text={t('builder_common_back')}
            icon={<ArrowLeftIcon />}
            onClick={onBack}
          />
        </div>
        <EmptyStateCard
          icon={<DatabaseIcon width={48} height={48} />}
          title={t('builder_settings_tabledata_error_title')}
          description={t('builder_settings_tabledata_error_desc', { tableName })}
          ctaLabel={t('builder_common_retry')}
          onCtaClick={() => refetch()}
        />
      </Box>
    );
  }

  const getDescription = () => {
    if (data.length === 0) return undefined;
    return `Showing ${((pagination.page - 1) * pagination.limit) + 1}-${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total} ${pagination.total === 1 ? 'row' : 'rows'}`;
  };

  return (
      <Box orientation="vertical" gap="md" className="@container w-full">
        <div className="flex">
          <Button
            text={t('builder_common_back')}
            icon={<ArrowLeftIcon />}
            onClick={onBack}
          />
        </div>
      <BigCard
        title={formatColumnName(tableName)}
        description={getDescription()}
        status={undefined}
        button={(
          <Box orientation="horizontal" gap="sm">
            <Button
              text={t('builder_settings_database_common_add_row')}
              icon={<PlusIcon />}
              design="primary"
              size="sm"
              onClick={() => setIsAddDialogOpen(true)}
            />
            <Menu id={`export-menu-${tableName}`} size="sm" closeOnSelect>
              <MenuButton
                design="secondary"
                size="sm"
                icon={<DownloadIcon />}
                text={t('builder_common_export')}
              />
              <MenuList>
                <MenuItem onClick={() => handleExport('csv')}>
                  {t('builder_settings_database_common_export_csv')}
                </MenuItem>
                <MenuItem onClick={() => handleExport('json')}>
                  {t('builder_settings_database_common_export_json')}
                </MenuItem>
              </MenuList>
            </Menu>
            <Button
              text={t('builder_common_refresh')}
              icon={<RefreshIcon className={isRefetching ? 'animate-spin' : ''} />}
              design="secondary"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading || isRefetching}
              aria-label={isRefetching ? t('builder_settings_datatable_refreshing_table') : t('builder_settings_datatable_refresh_table')}
              aria-busy={isRefetching}
            />
          </Box>
        )}
      >
        {/* Empty state */}
        {data.length === 0 && (
          <div className="text-sm bg-intents-ux-box-backgroundColor rounded-lg p-4 text-center border">
            <text.p emphasis="passive">{t('builder_settings_datatable_no_data_table')}</text.p>
            <text.p emphasis="passive" className="text-xs mt-1">{t('builder_settings_datatable_no_data_table_cta')}</text.p>
          </div>
        )}

        {/* Data table */}
        {data.length > 0 && (
          <Box gap="md">
            <div className="border rounded-lg overflow-x-auto">
              <Table stretch size="lg">
                  <Thead>
                    <Tr>
                      <Th className="px-2 py-1.5 border-r border-intents-ux-box-borderColor">
                        <text.span as='label' className="text-xs">{t('builder_common_actions')}</text.span>
                      </Th>
                      {schema.map((col) => (
                        <Th key={col.name} className="px-3 py-1.5 max-w-xs">
                          <text.span as='label' className="truncate">
                            {formatColumnName(col.name)}
                          </text.span>
                        </Th>
                      ))}
                    </Tr>
                  </Thead>
                <Tbody>
                  {data.map((row, rowIndex) => (
                    <Tr key={rowIndex}>
                      <Td key={`${rowIndex}-actions`} className="px-2 py-1 border-r border-intents-ux-box-borderColor">
                        <div className="flex items-center gap-1.5">
                          <Button
                            icon={<EditIcon />}
                            design="tertiary"
                            size="sm"
                            onClick={() => handleEditRow(row)}
                            aria-label={t('builder_common_edit', undefined, 'Edit')}
                          />
                          <Button
                            icon={<TrashIcon />}
                            design="critical"
                            size="sm"
                            onClick={() => handleDeleteRow(row)}
                            aria-label={t('builder_common_delete', undefined, 'Delete')}
                          />
                        </div>
                      </Td>
                      {schema.map((col) => (
                        <Td key={`${rowIndex}-${col.name}`} className="font-mono text-xs px-2 py-1 max-w-xs">
                          <div className="truncate" title={getCellValueString(row[col.name], col.type)}>
                            {renderCellValue(row[col.name], col.type)}
                          </div>
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>

            {/* Pagination */}
            {pagination.total > pagination.limit && (
              <div className="flex justify-center">
                <Pagination
                  limit={pagination.limit}
                  offset={(pagination.page - 1) * pagination.limit}
                  total={pagination.total}
                  onChange={handlePageChange}
                  atStart={pagination.page === 1}
                  atEnd={!pagination.hasMore}
                />
              </div>
            )}
          </Box>
        )}
      </BigCard>

      {/* Dialogs */}
      <AddRowDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onSuccess={handleAddSuccess}
        appId={appId}
        tableName={tableName}
        schema={schema}
      />
      <EditRowDialog
        isOpen={isEditDialogOpen}
        onClose={() => {
          setIsEditDialogOpen(false);
          setEditRow(null);
        }}
        onSuccess={handleEditSuccess}
        appId={appId}
        tableName={tableName}
        schema={schema}
        row={editRow}
      />

      <DeleteRowModal
        isOpen={isDeleteDialogOpen}
        onClose={() => {
          setIsDeleteDialogOpen(false);
          setDeleteRow(null);
          setDeleteError(null);
        }}
        onConfirm={confirmDeleteRow}
        isDeleting={deleteRowMutation.isPending}
        error={deleteError}
      />
    </Box>
  );
}
