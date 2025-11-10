'use client'

import React, { useState, useEffect, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';
import Table, {
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@ux/table';
import Pagination from '@ux/pagination';
import Button from '@ux/button';
import Modal from '@ux/modal';
import { ArrowLeft, Plus, Edit2, Trash2 } from 'lucide-react';
import { AddRowDialog } from './AddRowDialog';
import { EditRowDialog } from './EditRowDialog';

interface TableDataBrowserProps {
  appId: string;
  tableName: string;
  onBack: () => void;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key: string;
  default: string | null;
  extra: string;
}

interface TableDataResult {
  rows: Record<string, any>[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export function TableDataBrowser({ appId, tableName, onBack }: TableDataBrowserProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<ColumnInfo[]>([]);
  const [data, setData] = useState<Record<string, any>[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    hasMore: false,
  });
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<Record<string, any> | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Record<string, any> | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchSchema = useCallback(async () => {
    try {
      const response = await fetch(`/api/database/${appId}/tables/${tableName}/schema`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch schema');
      }

      const result = await response.json();
      setSchema(result.columns);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [appId, tableName]);

  const fetchData = useCallback(async (page: number) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/database/${appId}/tables/${tableName}/data?page=${page}&limit=25`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch data');
      }

      const result: TableDataResult = await response.json();
      setData(result.rows);
      setPagination({
        page: result.page,
        limit: result.limit,
        total: result.total,
        hasMore: result.hasMore,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [appId, tableName]);

  useEffect(() => {
    fetchSchema();
    fetchData(1);
  }, [fetchSchema, fetchData]);

  const handleDeleteRow = useCallback((row: Record<string, any>) => {
    setDeleteRow(row);
    setIsDeleteDialogOpen(true);
  }, []);

  const confirmDeleteRow = useCallback(async () => {
    if (!deleteRow) return;

    setIsDeleting(true);
    try {
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

      const response = await fetch(`/api/database/${appId}/tables/${tableName}/rows`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryKey }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete row');
      }

      // Close modal and refresh data
      setIsDeleteDialogOpen(false);
      setDeleteRow(null);
      await fetchData(pagination.page);
    } catch (err) {
      alert(`Error deleting row: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteRow, schema, appId, tableName, fetchData, pagination.page]);

  const handleEditRow = (row: Record<string, any>) => {
    setEditRow(row);
    setIsEditDialogOpen(true);
  };

  const handleAddSuccess = () => {
    setIsAddDialogOpen(false);
    fetchData(pagination.page);
  };

  const handleEditSuccess = () => {
    setIsEditDialogOpen(false);
    setEditRow(null);
    fetchData(pagination.page);
  };

  const handlePageChange = (newPage: number) => {
    fetchData(newPage);
  };

  // Build columns dynamically from schema
  const columns: ColumnDef<Record<string, any>>[] = React.useMemo(() => {
    const baseColumns: ColumnDef<Record<string, any>>[] = schema.map((col) => ({
      accessorKey: col.name,
      header: col.name,
      cell: ({ getValue }) => {
        const value = getValue();
        if (value === null) return <span className="text-muted-foreground italic">null</span>;
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      },
    }));

    // Add actions column
    baseColumns.push({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            icon={<Edit2 className="h-4 w-4" />}
            design="inline"
            onClick={() => handleEditRow(row.original)}
            className="h-8 w-8 p-0"
          />
          <Button
            icon={<Trash2 className="h-4 w-4" />}
            design="critical"
            onClick={() => handleDeleteRow(row.original)}
            className="h-8 w-8 p-0"
          />
        </div>
      ),
    });

    return baseColumns;
  }, [schema, handleDeleteRow]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (isLoading && data.length === 0) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <Button
            text="Back"
            icon={<ArrowLeft className="h-4 w-4" />}
            design="secondary"
            onClick={onBack}
          />
          <h3 className="text-lg font-semibold">{tableName}</h3>
        </div>
        <div className="text-center text-muted-foreground">Loading table data...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Button
                text="Back"
                icon={<ArrowLeft className="h-4 w-4" />}
                design="secondary"
                onClick={onBack}
              />
              <h3 className="text-lg font-semibold">{tableName}</h3>
            </div>
            <Button
              text="Add Row"
              icon={<Plus className="h-4 w-4" />}
              design="primary"
              onClick={() => setIsAddDialogOpen(true)}
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="bg-destructive/10 text-destructive rounded-lg p-4 mb-4">
              <p className="font-medium">Error</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          )}

          {/* Empty state */}
          {!error && data.length === 0 && (
            <div className="text-sm text-muted-foreground bg-muted rounded-lg p-8 text-center">
              <p>No data found in this table</p>
              <p className="text-xs mt-2">Click &ldquo;Add Row&rdquo; to insert data</p>
            </div>
          )}

          {/* Data table */}
          {!error && data.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {((pagination.page - 1) * pagination.limit) + 1}-
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} rows
                </p>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <Thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <Tr key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <Th key={header.id} className="font-mono text-xs px-4 py-3">
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                          </Th>
                        ))}
                      </Tr>
                    ))}
                  </Thead>
                  <Tbody>
                    {table.getRowModel().rows.map((row) => (
                      <Tr key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <Td key={cell.id} className="font-mono text-xs px-4 py-2">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </Td>
                        ))}
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>

              {/* Pagination */}
              {pagination.total > pagination.limit && (
                <Pagination
                  limit={pagination.limit}
                  offset={(pagination.page - 1) * pagination.limit}
                  total={pagination.total}
                  onChange={handlePageChange}
                  atStart={pagination.page === 1}
                  atEnd={!pagination.hasMore}
                />
              )}
            </div>
          )}
        </div>
      </div>

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

      {/* Delete Confirmation Modal */}
      {isDeleteDialogOpen && (
        <Modal
          title="Delete Row"
          onClose={() => {
            setIsDeleteDialogOpen(false);
            setDeleteRow(null);
          }}
          actions={
            <>
              <Button
                design="secondary"
                text="Cancel"
                onClick={() => {
                  setIsDeleteDialogOpen(false);
                  setDeleteRow(null);
                }}
                disabled={isDeleting}
              />
              <Button
                design="critical"
                text={isDeleting ? 'Deleting...' : 'Delete'}
                onClick={confirmDeleteRow}
                disabled={isDeleting}
              />
            </>
          }
        >
          <p>Are you sure you want to delete this row? This action cannot be undone.</p>
        </Modal>
      )}
    </div>
  );
}
