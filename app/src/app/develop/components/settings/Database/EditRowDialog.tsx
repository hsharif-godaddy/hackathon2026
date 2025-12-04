'use client'

import React, { useState, useEffect, useMemo } from 'react';
import Modal from '@ux/modal';
import Button from '@ux/button';
import TextInput from '@ux/text-input';
import SelectInput from '@ux/select-input';
import { useUpdateRow } from '@/hooks/useTableMutations';
import { formatColumnName, formatColumnType, getGridClasses } from './utils';

interface EditRowDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  appId: string;
  tableName: string;
  schema: {
    name: string;
    type: string;
    nullable: boolean;
    key: string;
    default: string | null;
    extra: string;
  }[];
  row: Record<string, any> | null;
}

export function EditRowDialog({
  isOpen,
  onClose,
  onSuccess,
  appId,
  tableName,
  schema,
  row,
}: EditRowDialogProps) {
  const [formData, setFormData] = useState<Record<string, string>>({});

  // Extract primary key from row
  const primaryKey = useMemo(() => {
    if (!row) return {};

    const pk: Record<string, any> = {};
    schema.forEach(col => {
      if (col.key === 'PRI') {
        pk[col.name] = row[col.name];
      }
    });
    return pk;
  }, [row, schema]);

  const updateRow = useUpdateRow({
    appId,
    tableName,
    primaryKey,
    onSuccess: () => {
      setFormData({});
      onSuccess();
      handleClose();
    },
  });

  useEffect(() => {
    if (row) {
      // Initialize form with existing row data
      const initialData: Record<string, string> = {};
      Object.entries(row).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          initialData[key] = String(value);
        }
      });
      setFormData(initialData);
    }
  }, [row]);

  const handleClose = () => {
    updateRow.reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!row) {
      throw new Error('No row data provided');
    }

    if (Object.keys(primaryKey).length === 0) {
      throw new Error('No primary key found for this table');
    }

    // Convert form data to appropriate types
    const data: Record<string, any> = {};

    schema.forEach(col => {
      // Skip primary key columns (they shouldn't be editable)
      if (col.key === 'PRI') {
        return;
      }

      // Skip auto-managed timestamp fields
      if (isAutoManagedTimestamp(col)) {
        return;
      }

      const value = formData[col.name];

      // Handle empty values
      if (value === '' || value === undefined) {
        if (col.nullable) {
          data[col.name] = null;
        }
        return;
      }

      // Type conversion based on MySQL type
      const type = col.type.toLowerCase();
      // Check for enum/set first before checking for 'int' (to avoid matching 'intermediate' in enum values)
      if (type.startsWith('enum(') || type.startsWith('set(')) {
        data[col.name] = value;
      } else if (type.includes('int') || type.includes('decimal') || type.includes('float') || type.includes('double')) {
        data[col.name] = Number(value);
      } else if (type.includes('bool') || type.includes('tinyint(1)')) {
        data[col.name] = value === 'true' || value === '1';
      } else {
        data[col.name] = value;
      }
    });

    updateRow.mutate(data);
  };

  const handleChange = (columnName: string, value: string) => {
    setFormData(prev => ({ ...prev, [columnName]: value }));
  };

  /**
   * Checks if a column is an auto-managed timestamp field (like created_at, updated_at)
   * that should not be editable by users.
   *
   * @param col - Column information from database schema
   * @returns True if the field is auto-managed and should be hidden from editing
   */
  const isAutoManagedTimestamp = (col: {
    name: string;
    type: string;
    default: string | null;
    extra: string;
  }): boolean => {
    const columnName = col.name.toLowerCase();
    const isTimestampType = col.type.toLowerCase().includes('timestamp') ||
                           col.type.toLowerCase().includes('datetime');

    // Check if it's a common timestamp field name
    if ((columnName === 'created_at' || columnName === 'updated_at') && isTimestampType) {
      return true;
    }

    // Check if it has CURRENT_TIMESTAMP in default or extra
    const hasAutoTimestamp =
      (col.default && col.default.includes('CURRENT_TIMESTAMP')) ||
      (col.extra && (col.extra.includes('CURRENT_TIMESTAMP') || col.extra.includes('DEFAULT_GENERATED')));

    return isTimestampType && hasAutoTimestamp;
  };

  /**
   * Parse enum values from MySQL enum type definition
   * Example: "enum('easy','medium','hard')" returns ['easy', 'medium', 'hard']
   *
   * @param type - MySQL column type string
   * @returns Array of enum values or null if not an enum type
   */
  const parseEnumValues = (type: string): string[] | null => {
    const match = type.match(/^enum\((.*)\)$/i);
    if (!match) return null;

    // Parse the enum values, handling escaped quotes
    const valuesString = match[1];
    const values: string[] = [];
    let currentValue = '';
    let inQuote = false;
    let escapeNext = false;

    for (let i = 0; i < valuesString.length; i++) {
      const char = valuesString[i];

      if (escapeNext) {
        currentValue += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === "'" && !escapeNext) {
        inQuote = !inQuote;
        continue;
      }

      if (char === ',' && !inQuote) {
        if (currentValue) {
          values.push(currentValue);
          currentValue = '';
        }
        continue;
      }

      if (inQuote) {
        currentValue += char;
      }
    }

    if (currentValue) {
      values.push(currentValue);
    }

    return values;
  };

  const renderInput = (col: {
    name: string;
    type: string;
    nullable: boolean;
    key: string;
    default: string | null;
    extra: string;
  }) => {
    const type = col.type.toLowerCase();
    const enumValues = parseEnumValues(col.type);
    const isRequired = !col.nullable && col.default === null && col.key !== 'PRI';
    const labelText = `${formatColumnName(col.name)}${col.key === 'PRI' ? ' (Primary Key)' : ''}`;
    const helpText = `${formatColumnType(col.type)}${col.nullable ? ' (optional)' : ''}`;

    // Primary keys should be read-only
    if (col.key === 'PRI') {
      return (
        <TextInput
          key={col.name}
          id={`edit-row-${col.name}`}
          label={labelText}
          value={formData[col.name] || ''}
          disabled
          helpMessage="Primary key (read-only)"
          stretch
        />
      );
    }

    // Render SelectInput dropdown for enum fields
    if (enumValues) {
      return (
        <SelectInput
          key={col.name}
          id={`edit-row-${col.name}`}
          name={col.name}
          label={labelText}
          value={formData[col.name] || ''}
          onChange={(value) => handleChange(col.name, value)}
          required={isRequired}
          helpMessage={helpText}
          stretch
        >
          <option value=""></option>
          {col.nullable && <option value="null">NULL</option>}
          {enumValues.map((enumValue) => (
            <option key={enumValue} value={enumValue}>
              {enumValue}
            </option>
          ))}
        </SelectInput>
      );
    }

    let isMultiline = false;

    if (type.includes('text')) {
      // TEXT, TINYTEXT, MEDIUMTEXT, LONGTEXT columns should use multiline
      isMultiline = true;
    }

    return (
      <TextInput
        key={col.name}
        id={`edit-row-${col.name}`}
        label={labelText}
        placeholder={col.nullable ? 'NULL' : ''}
        value={formData[col.name] || ''}
        onChange={(value) => handleChange(col.name, value)}
        required={isRequired}
        helpMessage={helpText}
        stretch
        multiline={isMultiline}
      />
    );
  };

  if (!row || !isOpen) return null;

  const editableColumns = schema.filter(col => !isAutoManagedTimestamp(col));

  return (
    <Modal
      title={`Edit Row in ${tableName}`}
      onClose={handleClose}
      actions={
        <>
          <Button
            design="secondary"
            text="Cancel"
            onClick={handleClose}
            disabled={updateRow.isPending}
          />
          <Button
            design="primary"
            text={updateRow.isPending ? 'Updating...' : 'Update Row'}
            type="submit"
            disabled={updateRow.isPending}
            onClick={handleSubmit}
          />
        </>
      }
    >
      <form onSubmit={handleSubmit} id="edit-row-form">
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <div className={`grid gap-2 ${getGridClasses(editableColumns.length)}`}>
            {editableColumns.map(col => renderInput(col))}
          </div>
        </div>

        {updateRow.error && (
          <div className="bg-destructive/10 text-destructive rounded-lg p-1.5 mt-2 text-sm">
            {updateRow.error instanceof Error ? updateRow.error.message : String(updateRow.error)}
          </div>
        )}
      </form>
    </Modal>
  );
}
