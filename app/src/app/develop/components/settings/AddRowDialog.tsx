'use client'

import React, { useState } from 'react';
import Modal from '@ux/modal';
import Button from '@ux/button';
import TextInput from '@ux/text-input';
import SelectInput from '@ux/select-input';

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
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
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

      const response = await fetch(`/api/database/${appId}/tables/${tableName}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to insert row');
      }

      setFormData({});
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
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
    // Skip auto-increment fields
    if (col.extra === 'auto_increment') {
      return (
        <div key={col.name} className="text-sm text-muted-foreground">
          <span className="italic">Auto-generated</span>
        </div>
      );
    }

    const type = col.type.toLowerCase();
    const enumValues = parseEnumValues(col.type);
    const isRequired = !col.nullable && col.default === null && col.extra !== 'auto_increment';
    const labelText = `${col.name}${col.key === 'PRI' ? ' (PK)' : ''}`;
    const helpText = `${col.type}${col.nullable ? ' (nullable)' : ''}${col.default ? ` (default: ${col.default})` : ''}`;

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

    let inputType = 'text';
    let isMultiline = false;

    if (type.includes('int') || type.includes('decimal') || type.includes('float') || type.includes('double')) {
      inputType = 'number';
    } else if (type.includes('date') && !type.includes('time')) {
      inputType = 'date';
    } else if (type.includes('time') && !type.includes('stamp')) {
      inputType = 'time';
    } else if (type.includes('datetime') || type.includes('timestamp')) {
      inputType = 'datetime-local';
    } else if (type.includes('text')) {
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
        stretch
        multiline={isMultiline}
      />
    );
  };

  if (!isOpen) return null;

  return (
    <Modal
      title={`Add Row to ${tableName}`}
      onClose={onClose}
      className="max-w-5xl"
      actions={
        <>
          <Button
            design="secondary"
            text="Cancel"
            onClick={onClose}
            disabled={isSubmitting}
          />
          <Button
            design="primary"
            text={isSubmitting ? 'Adding...' : 'Add Row'}
            type="submit"
            disabled={isSubmitting}
            onClick={handleSubmit}
          />
        </>
      }
    >
      <form onSubmit={handleSubmit} id="add-row-form">
        <div className="space-y-4">
          {schema
            .filter(col => !isAutoManagedTimestamp(col))
            .map(col => renderInput(col))}
        </div>

        {error && (
          <div className="bg-destructive/10 text-destructive rounded-lg p-3 mt-4 text-sm">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
