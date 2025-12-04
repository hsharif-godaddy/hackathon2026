'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSecrets, type Secret } from '@/hooks/useSecrets';
import { useSecretOperations } from '@/hooks/useSecretOperations';
import IconButton from '@/app/develop/components/IconButton';
import Button from '@ux/button';
import Spinner from '@ux/spinner';
import LockIcon from '@ux/icon/locked';
import EditIcon from '@ux/icon/edit';
import DeleteIcon from '@ux/icon/x-thick';
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import text from '@ux/text';

interface SecretsPanelProps {
  appId: string;
  variant: 'preview' | 'publish';
}

/**
 * Represents a secret in the form state
 */
interface SecretFormData extends Secret {
  isEditing: boolean;
  isNew: boolean;
  markedForDeletion: boolean;
  editedValue?: string;
}

/**
 * Panel component for displaying and managing app-specific secrets
 *
 * Displays a list of secrets configured for the app with inline editing,
 * deletion, and addition capabilities. All changes are batched and submitted
 * together with a global submit button.
 *
 * @param props - Component props
 * @param props.appId - The ID of the app to display secrets for
 * @param props.variant - The variant (preview or publish) to display secrets for
 *
 * @example
 * ```tsx
 * <SecretsPanel appId="app-123" variant="preview" />
 * ```
 */
export function SecretsPanel({ appId, variant }: SecretsPanelProps) {
  const [formSecrets, setFormSecrets] = useState<SecretFormData[]>([]);
  const [newSecrets, setNewSecrets] = useState<Array<{ name: string; value: string }>>([
    { name: '', value: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [focusedSecretIndex, setFocusedSecretIndex] = useState<number | null>(null);
  const textareaRefs = useRef<{ [secretName: string]: HTMLTextAreaElement | null }>({});

  const {
    data: secrets = [],
    isLoading,
    error,
    refetch,
    dataUpdatedAt
  } = useSecrets({ appId, variant });

  const secretOperations = useSecretOperations();

  // Initialize form state when secrets are loaded
  // Only run when the actual secret names change, not on every render
  useEffect(() => {
    if (!dataUpdatedAt) {
      return;
    }

    if (secrets.length === 0) {
      setFormSecrets([]);
      return;
    }

    // Only update if the secrets have actually changed
    setFormSecrets((prevFormSecrets) => {
      // sort secrets with system-managed first
      return secrets
        .map((secret) => ({
          ...secret,
          isEditing: false,
          isNew: false,
          markedForDeletion: false,
        }))
        .sort((a, b) => {
          // System-managed secrets first (true comes before false)
          if (a.systemManaged && !b.systemManaged) return -1;
          if (!a.systemManaged && b.systemManaged) return 1;
          // Within each group, maintain alphabetical order by name
          return a.name.localeCompare(b.name);
        });
    });
  }, [secrets.length, dataUpdatedAt]);

  const handleEdit = (secretName: string) => {
    setFormSecrets((prev) => {
      const secret = prev.find((s) => s.name === secretName);
      const isCurrentlyEditing = secret?.isEditing;

      const updatedSecrets = prev.map((s) => {
        // If this is the clicked secret, toggle its edit state
        if (s.name === secretName) {
          return {
            ...s,
            isEditing: !s.isEditing,
            editedValue: !s.isEditing ? '' : undefined,
          };
        }

        // If another secret is being edited and has no content, reset it
        if (s.isEditing && (!s.editedValue || s.editedValue.trim() === '')) {
          return {
            ...s,
            isEditing: false,
            editedValue: undefined,
          };
        }

        return s;
      });

      // Focus the textarea if we're entering edit mode
      if (!isCurrentlyEditing) {
        setTimeout(() => {
          textareaRefs.current[secretName]?.focus();
        }, 0);
      }

      return updatedSecrets;
    });
  };

  const handleDelete = (secretName: string) => {
    setFormSecrets((prev) =>
      prev.map((s) =>
        s.name === secretName ? { ...s, markedForDeletion: !s.markedForDeletion } : s
      )
    );
  };

  const handleValueChange = (secretName: string, value: string) => {
    setFormSecrets((prev) =>
      prev.map((s) => (s.name === secretName ? { ...s, editedValue: value } : s))
    );
  };

  const handleValueBlur = (secretName: string) => {
    setFormSecrets((prev) =>
      prev.map((s) => {
        if (s.name === secretName && s.isEditing && (!s.editedValue || s.editedValue.trim() === '')) {
          return {
            ...s,
            isEditing: false,
            editedValue: undefined,
          };
        }
        return s;
      })
    );
  };

  const calculateRows = (value: string | undefined): number => {
    if (!value) return 1;
    const lineCount = value.split('\n').length;
    return Math.min(Math.max(lineCount, 1), 6);
  };

  const sanitizeSecretName = (value: string): string => {
    // Auto-capitalize to uppercase
    let sanitized = value.toUpperCase();

    // Only allow: A-Z, 0-9, /, _, +, =, ., @, -
    sanitized = sanitized.replace(/[^A-Z0-9/_+=.@-]/g, '');

    // Enforce max length of 128
    sanitized = sanitized.slice(0, 128);

    return sanitized;
  };

  const isValidSecretName = (name: string): boolean => {
    if (!name || name.length < 2 || name.length > 128) return false;

    // Must start with A-Z or _
    if (!/^[A-Z_]/.test(name)) return false;

    // Only allowed characters: A-Z, 0-9, /, _, +, =, ., @, -
    if (!/^[A-Z0-9/_+=.@-]+$/.test(name)) return false;

    return true;
  };

  const isSecretNameUnique = (name: string, currentIndex: number): boolean => {
    // Check against existing secrets
    const existsInFormSecrets = formSecrets.some((s) => s.name === name);
    if (existsInFormSecrets) return false;

    // Check against other new secrets (excluding current index)
    const existsInNewSecrets = newSecrets.some(
      (s, i) => i !== currentIndex && s.name === name
    );
    if (existsInNewSecrets) return false;

    return true;
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const validNewSecrets = newSecrets.filter(
        (s, index) => isValidSecretName(s.name) && isSecretNameUnique(s.name, index) && isValueValid(s.value)
      );

      const operations = {
        updates: formSecrets
          .filter((s) => !s.systemManaged && s.isEditing && s.editedValue !== undefined && isValueValid(s.editedValue))
          .map((s) => ({ name: s.name, value: s.editedValue! })),
        deletions: formSecrets
          .filter((s) => !s.systemManaged && s.markedForDeletion)
          .map((s) => s.name),
        additions: validNewSecrets,
      };

      // Submit all operations to the API
      // Note: The mutation automatically invalidates the cache and triggers a refetch
      await secretOperations.mutateAsync({
        appId,
        variant,
        operations,
      });

      // Reset new secrets form
      setNewSecrets([{ name: '', value: '' }]);

      // Show success message
      setSubmitSuccess(`Secrets updated successfully!`);

      // Auto-dismiss success message after 5 seconds
      setTimeout(() => {
        setSubmitSuccess(null);
      }, 5000);

      setSubmitError(null);
    } catch (err) {
      console.error('Failed to submit changes:', err);

      // Extract error message from the error object
      let errorMessage = 'Failed to save secrets. Please try again.';

      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      }

      setSubmitError(errorMessage);
      setSubmitSuccess(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValueValid = (value: string): boolean => {
    return value.trim() !== '';
  };

  const hasChanges =
    formSecrets.some((s) =>
      !s.systemManaged && (
        s.markedForDeletion ||
        (s.isEditing && s.editedValue !== undefined && isValueValid(s.editedValue))
      )
    ) ||
    newSecrets.some((s, index) =>
      isValidSecretName(s.name) &&
      isSecretNameUnique(s.name, index) &&
      isValueValid(s.value)
    );

  const handleNewSecretChange = (index: number, field: 'name' | 'value', value: string) => {
    let updatedSecrets = [...newSecrets];

    if (field === 'name') {
      updatedSecrets[index].name = sanitizeSecretName(value);
    } else {
      updatedSecrets[index].value = value;
    }

    // Remove completely empty rows, but keep at least one
    const nonEmptySecrets = updatedSecrets.filter(
      (s) => s.name !== '' || s.value !== ''
    );

    // Ensure at least one empty row exists
    if (nonEmptySecrets.length === 0) {
      updatedSecrets = [{ name: '', value: '' }];
    } else {
      updatedSecrets = nonEmptySecrets;

      // Add empty row if all rows have content
      const hasEmptyRow = updatedSecrets.some((s) => s.name === '' && s.value === '');
      if (!hasEmptyRow) {
        updatedSecrets.push({ name: '', value: '' });
      }
    }

    setNewSecrets(updatedSecrets);

    // Check if current secret is valid and it's the last one
    const currentSecretIndex = updatedSecrets.findIndex(
      (s) => s.name === (field === 'name' ? sanitizeSecretName(value) : updatedSecrets[index].name) &&
             s.value === (field === 'value' ? value : updatedSecrets[index].value)
    );

    if (currentSecretIndex !== -1) {
      const isCurrentValid = isValidSecretName(updatedSecrets[currentSecretIndex].name) &&
                            isSecretNameUnique(updatedSecrets[currentSecretIndex].name, currentSecretIndex) &&
                            isValueValid(updatedSecrets[currentSecretIndex].value);
      const isLastRow = currentSecretIndex === updatedSecrets.length - 1;

      // Add new empty row if current is valid and it's the last row
      if (isCurrentValid && isLastRow) {
        setNewSecrets([...updatedSecrets, { name: '', value: '' }]);
      }
    }
  };

  if (isLoading) {
    return (
      <div className='flex flex-col justify-center items-center h-[calc(100vh-40rem)] gap-2'>
        <Spinner size='md'/>
        <text.p>Loading secrets...</text.p>
        <text.p className="text-sm text-muted-foreground">
          This may take a few seconds...
        </text.p>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyStateCard
        icon={<LockIcon width={48} height={48} />}
        title="Error Loading Secrets"
        description="An error occurred while loading secrets. Please try again."
        ctaLabel="Retry"
        onCtaClick={() => refetch()}
      />
    );
  }

  return (
    <div className="w-full space-y-2">
      {!error && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div style={{ fontSize: '1.25rem', fontWeight: 600 }} className="mb-1">
              Manage secrets
            </div>
            {hasChanges && (
              <Button
                design="primary"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Saving...' : `Save secrets`}
              </Button>
            )}
          </div>

          {submitError && (
            <div className="border rounded-lg p-2 flex items-start justify-between" style={{ backgroundColor: '#fee8e89c', borderColor: '#db1802' }}>
              <div className="flex items-start gap-1.5">
                <div className="mt-0.25" style={{ color: '#ef4444'}}>⚠️</div>
                <div>
                  <div className="font-semibold mb-0.5" style={{ color: '#ef4444'}}>Failed!</div>
                  <text.p className="text-sm" style={{ color: '#ef4444'}}>{submitError}</text.p>
                </div>
              </div>
              <button
                onClick={() => setSubmitError(null)}
                className="transition-colors"
                style={{ color: '#ef4444', cursor: 'pointer'}}
                aria-label="Dismiss error"
              >
                <DeleteIcon width={20} height={20} />
              </button>
            </div>
          )}

          {submitSuccess && (
            <div className="border rounded-lg p-2 flex items-start justify-between" style={{ backgroundColor: '#f0fdf4', borderColor: '#22c55e' }}>
              <div className="flex items-start gap-1.5">
                <div className="mt-0.25" style={{ color: '#22c55e'}}>✓</div>
                <div>
                  <div className="font-semibold mb-0.5" style={{ color: '#16a34a'}}>Successful!</div>
                  <text.p className="text-sm" style={{ color: '#15803d'}}>{submitSuccess}</text.p>
                </div>
              </div>
              <button
                onClick={() => setSubmitSuccess(null)}
                className="transition-colors"
                style={{ color: '#22c55e', cursor: 'pointer'}}
                aria-label="Dismiss success"
              >
                <DeleteIcon width={20} height={20} />
              </button>
            </div>
          )}

          {/* New secrets section - moved to top */}
          <div className="space-y-1">
            <div className="border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 overflow-hidden">
              {newSecrets.map((newSecret, index) => (
                <div
                  key={index}
                  className={`flex items-start gap-1.5 p-2 ${
                    index !== newSecrets.length - 1 ? 'border-b border-gray-300' : ''
                  }`}
                >
                  <div className="flex-1 grid grid-cols-2 gap-1.5 items-start">
                    <div>
                      <input
                        type="text"
                        value={newSecret.name}
                        onChange={(e) => handleNewSecretChange(index, 'name', e.target.value)}
                        onFocus={() => setFocusedSecretIndex(index)}
                        onBlur={() => setFocusedSecretIndex(null)}
                        placeholder="NEW_SECRET_KEY_NAME"
                        className={`w-full px-1.5 py-1 h-[38px] border rounded-md font-mono text-sm bg-white leading-none ${
                          (newSecret.name && (!isValidSecretName(newSecret.name) || !isSecretNameUnique(newSecret.name, index))) ||
                          (!newSecret.name && isValueValid(newSecret.value))
                            ? 'border-red-300 focus:border-red-500'
                            : 'border-gray-300'
                        }`}
                      />
                      {!newSecret.name && isValueValid(newSecret.value) && (
                        <text.p className="mt-0.5" style={{ fontSize: '0.875rem', color: '#ef4444'}}>
                          Secret name is required
                        </text.p>
                      )}
                      {newSecret.name && !isValidSecretName(newSecret.name) && (
                        <text.p className="mt-0.5" style={{ fontSize: '0.875rem', color: '#ef4444'}}>
                          {newSecret.name.length < 2
                            ? 'Min 2 characters'
                            : !/^[A-Z_]/.test(newSecret.name)
                            ? 'Must start with A-Z or _'
                            : 'Invalid characters'}
                        </text.p>
                      )}
                      {newSecret.name && isValidSecretName(newSecret.name) && !isSecretNameUnique(newSecret.name, index) && (
                        <text.p className="mt-0.5" style={{ fontSize: '0.875rem', color: '#ef4444'}}>
                          Secret name already exists
                        </text.p>
                      )}
                      {focusedSecretIndex === 0 && index === 0 && !newSecret.name && (
                        <text.p className="mt-0.5" style={{ fontSize: '0.875rem', color: '#6b7280'}}>
                          Allowed: A-Z, 0-9, / _ + = . @ - (2-128 chars, must start with letter or _)
                        </text.p>
                      )}
                    </div>
                    <div>
                      <textarea
                        value={newSecret.value}
                        onChange={(e) => handleNewSecretChange(index, 'value', e.target.value)}
                        placeholder="Enter secret value"
                        rows={calculateRows(newSecret.value)}
                        className={`w-full px-1.5 py-1 border rounded-md font-mono text-sm bg-white resize-none overflow-y-auto min-h-[38px] ${
                          newSecret.name && isValidSecretName(newSecret.name) && isSecretNameUnique(newSecret.name, index) && !isValueValid(newSecret.value)
                            ? 'border-red-300 focus:border-red-500'
                            : 'border-gray-300'
                        }`}
                        style={{ maxHeight: '144px' }}
                      />
                      {newSecret.name && isValidSecretName(newSecret.name) && isSecretNameUnique(newSecret.name, index) && !isValueValid(newSecret.value) && (
                        <text.p className="mt-0.5" style={{ fontSize: '0.875rem', color: '#ef4444'}}>
                          Secret value is required
                        </text.p>
                      )}
                      {newSecret.name && isValidSecretName(newSecret.name) && isSecretNameUnique(newSecret.name, index) && isValueValid(newSecret.value) && (
                        <div className="mt-0.5 px-1 rounded inline-block" style={{ backgroundColor: '#dbeafe', borderColor: '#3b82f6' }}>
                          <text.p style={{ fontSize: '0.875rem', color: '#2563eb'}}>Unsaved new secret</text.p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {formSecrets.length > 0 && (
            <>
              <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                {formSecrets.map((secret, index) => (
                  <div
                    key={secret.name}
                    className={`flex items-start gap-1.5 p-2 ${
                      index !== formSecrets.length - 1 ? 'border-b border-gray-200' : ''
                    }`} style={{ opacity: secret.markedForDeletion ? 0.8 : 1, backgroundColor: secret.markedForDeletion ? '#ef44444d' : undefined }}
                  >
                    <div className="flex-1 grid grid-cols-2 gap-1.5 items-start">
                      <div>
                        <input
                          type="text"
                          value={secret.name}
                          disabled
                          className="w-full px-1.5 py-1 h-[38px] border border-gray-300 rounded-md bg-gray-50 text-gray-600 font-mono text-sm leading-none"
                        />
                        {/* System managed and sync status tags */}
                        <div className="mt-0.5 flex gap-1 flex-wrap">
                          {secret.systemManaged ? (
                            <div className="px-1 py-0.25 rounded inline-block" style={{ backgroundColor: '#f3f4f6', borderColor: '#9ca3af' }}>
                              <text.p style={{ fontSize: '0.75rem', color: '#6b7280'}}>System managed</text.p>
                            </div>
                          ) : (
                            <>
                              {secret.syncStatus === 'synced' && (
                                <div className="px-1 py-0.25 rounded inline-block" style={{ backgroundColor: '#d1fae5', borderColor: '#10b981' }}>
                                  <text.p style={{ fontSize: '0.75rem', color: '#059669'}}>Deployed</text.p>
                                </div>
                              )}
                              {secret.syncStatus === 'added' && (
                                <>
                                  <div className="px-1 py-0.25 rounded inline-block" style={{ backgroundColor: '#dbeafe', borderColor: '#3b82f6' }}>
                                    <text.p style={{ fontSize: '0.75rem', color: '#2563eb'}}>Newly added</text.p>
                                  </div>
                                  <div className="px-1 py-0.25 rounded inline-block" style={{ backgroundColor: '#fef3c7', borderColor: '#f59e0b' }}>
                                    <text.p style={{ fontSize: '0.75rem', color: '#d97706'}}>Not deployed</text.p>
                                  </div>
                                </>
                              )}
                              {secret.syncStatus === 'updated' && (
                                <>
                                  <div className="px-1 py-0.25 rounded inline-block" style={{ backgroundColor: '#e0e7ff', borderColor: '#6366f1' }}>
                                    <text.p style={{ fontSize: '0.75rem', color: '#4f46e5'}}>Updated</text.p>
                                  </div>
                                  <div className="px-1 py-0.25 rounded inline-block" style={{ backgroundColor: '#fef3c7', borderColor: '#f59e0b' }}>
                                    <text.p style={{ fontSize: '0.75rem', color: '#d97706'}}>Not deployed</text.p>
                                  </div>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div>
                        <textarea
                          ref={(el) => { textareaRefs.current[secret.name] = el; }}
                          value={secret.isEditing ? (secret.editedValue ?? '') : ''}
                          onChange={(e) => handleValueChange(secret.name, e.target.value)}
                          onBlur={() => handleValueBlur(secret.name)}
                          disabled={!secret.isEditing}
                          rows={secret.isEditing ? calculateRows(secret.editedValue) : 1}
                          className="w-full px-1.5 py-1 border border-gray-300 rounded-md font-mono text-sm disabled:bg-gray-50 disabled:text-gray-600 resize-none overflow-y-auto min-h-[38px]"
                          placeholder={secret.isEditing ? 'Enter the updated secret value' : '••••••••••••'}
                          style={{ maxHeight: '144px' }}
                        />
                        {secret.isEditing && secret.editedValue && isValueValid(secret.editedValue) && (
                          <div className="mt-0.5 px-1 rounded inline-block" style={{ backgroundColor: '#fefce8', borderColor: '#facc15' }}>
                            <text.p style={{ fontSize: '0.875rem', color: '#eab308'}}>Unsaved edit</text.p>
                          </div>
                        )}
                        {secret.markedForDeletion && (
                          <div className="mt-0.5 px-1 rounded inline-block" style={{ backgroundColor: '#ef4444', borderColor: '#fda4af' }}>
                            <text.p style={{ fontSize: '0.875rem', color: 'black'}}>Unsaved delete</text.p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <IconButton
                        icon={<EditIcon />}
                        label={secret.isEditing ? 'Cancel' : 'Edit secret'}
                        onClick={() => handleEdit(secret.name)}
                        onMouseDown={(e: React.MouseEvent) => {
                          // Prevent blur from firing before onClick when canceling with empty value
                          if (secret.isEditing) {
                            e.preventDefault();
                          }
                        }}
                        active={secret.isEditing}
                        disabled={secret.systemManaged || secret.markedForDeletion}
                        className="!border-0"
                      />
                      <IconButton
                        icon={<DeleteIcon />}
                        label={secret.markedForDeletion ? 'Undo' : 'Delete secret'}
                        onClick={() => handleDelete(secret.name)}
                        active={secret.markedForDeletion}
                        disabled={secret.systemManaged || secret.isEditing}
                        className="!border-0"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {formSecrets.length === 0 && (
            <div className="text-center py-4">
              <text.p className="text-sm text-muted-foreground">
                No secrets configured yet. Add your first secret below.
              </text.p>
            </div>
          )}

          {/* Not deployed secrets notice */}
          {formSecrets.some(s => s.syncStatus === 'added' || s.syncStatus === 'updated') && (
            <div className="border-l-4 rounded-r-lg p-2 flex items-start gap-1.5" style={{ backgroundColor: '#fffbeb', borderColor: '#f59e0b' }}>
              <div className="mt-0.25" style={{ color: '#f59e0b'}}>ℹ️</div>
              <div>
                <div className="font-semibold mb-0.5 flex items-center gap-1" style={{ color: '#d97706'}}>
                  <span className="px-1 py-0.25 rounded text-xs" style={{ backgroundColor: '#fef3c7', borderColor: '#f59e0b' }}>
                    Not deployed
                  </span>
                  <span>secrets</span>
                </div>
                <text.p className="text-sm" style={{ color: '#92400e'}}>
                  These secrets are available in the {variant} environment for development and testing.
                  They will be deployed to the final app after the next publish.
                </text.p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
