'use client'

import React, { useState } from 'react';
import Button from '@ux/button';
import Modal from '@ux/modal';
import SelectInput from '@ux/select-input';
import TextInput from '@ux/text-input';

import { useAddRow } from '@/hooks/useTableMutations';
import { useTranslations } from '@/hooks/useTranslations';
import { formatColumnName, formatColumnType, getGridClasses } from './utils';

interface AddRowDialogProps {
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
}

export function AddRowDialog({
  isOpen,
  onClose,
  onSuccess,
  appId,
  tableName,
  schema,
}: AddRowDialogProps) {
  const t = useTranslations();
  const [formData, setFormData] = useState<Record<string, string>>({});

  const addRow = useAddRow({
    appId,
    tableName,
    onSuccess: () => {
      setFormData({});
      onSuccess();
      handleClose();
    },
  });

  const handleClose = () => {
    addRow.reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Convert form data to appropriate types
    const data: Record<string, any> = {};

    schema.forEach(col => {
      const value = formData[col.name];

      // Skip auto-increment fields
      if (col.extra === 'auto_increment') {
        return;
      }

      // Skip auto-managed timestamp fields
      if (isAutoManagedTimestamp(col)) {
        return;
      }

      // Handle empty values
      if (value === '' || value === undefined) {
        if (col.nullable) {
          data[col.name] = null;
        } else if (col.default !== null) {
          // Let database use default
          return;
        } else {
          // Required field with no value - this shouldn't happen if form validation works
          // but we'll skip it and let the backend validation catch it
          return;
        }
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

    addRow.mutate(data);
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
    // Show auto-increment fields as disabled
    if (col.extra === 'auto_increment') {
      const labelText = `${formatColumnName(col.name)}${col.key === 'PRI' ? ` (${t('builder_settings_database_common_primary_key')})` : ''}`;
      return (
        <TextInput
          key={col.name}
          id={`add-row-${col.name}`}
          name={col.name}
          label={labelText}
          value={t('builder_settings_database_common_auto_generated')}
          visualSize="sm"
          disabled
          stretch
        />
      );
    }

    const type = col.type.toLowerCase();
    const enumValues = parseEnumValues(col.type);
    const isRequired = !col.nullable && col.default === null && col.extra !== 'auto_increment';
    const labelText = `${formatColumnName(col.name)}${col.key === 'PRI' ? ` (${t('builder_settings_database_common_primary_key')})` : ''}`;
    const helpText = `${formatColumnType(col.type)}${col.nullable ? ` (${t('builder_settings_database_common_optional')})` : ''}${col.default ? ` (${t('builder_settings_database_common_default')}: ${col.default})` : ''}`;

    // Render SelectInput dropdown for enum fields
    if (enumValues) {
      return (
        <SelectInput
          key={col.name}
          id={`add-row-${col.name}`}
          name={col.name}
          label={labelText}
          value={formData[col.name] || ''}
          onChange={(value) => handleChange(col.name, value)}
          required={isRequired}
          helpMessage={helpText}
          visualSize="sm"
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
        id={`add-row-${col.name}`}
        label={labelText}
        placeholder={col.nullable ? 'NULL' : ''}
        value={formData[col.name] || ''}
        onChange={(value) => handleChange(col.name, value)}
        required={isRequired}
        helpMessage={helpText}
        visualSize="sm"
        stretch
        multiline={isMultiline}
      />
    );
  };

  if (!isOpen) return null;

  const editableColumns = schema.filter(col => !isAutoManagedTimestamp(col));

  return (
    <Modal
      title={t('builder_settings_database_add_row_title', { tableName })}
      onClose={handleClose}
      actions={
        <>
          <Button
            design="secondary"
            text={t('builder_common_cancel')}
            onClick={handleClose}
            disabled={addRow.isPending}
          />
          <Button
            design="primary"
            text={addRow.isPending ? t('builder_common_adding') : t('builder_settings_database_common_add_row')}
            type="submit"
            disabled={addRow.isPending}
            onClick={handleSubmit}
          />
        </>
      }
    >
      <form onSubmit={handleSubmit} id="add-row-form">
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <div className={`grid gap-2 ${getGridClasses(editableColumns.length)}`}>
            {editableColumns.map(col => renderInput(col))}
          </div>
        </div>

        {addRow.error && (
          <div className="bg-destructive/10 text-destructive rounded-lg p-1.5 mt-2 text-sm">
            {addRow.error instanceof Error ? addRow.error.message : String(addRow.error)}
          </div>
        )}
      </form>
    </Modal>
  );
}
