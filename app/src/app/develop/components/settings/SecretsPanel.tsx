'use client'

import React, { useEffect, useRef,useState } from 'react';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import EditIcon from '@ux/icon/edit';
import LockIcon from '@ux/icon/locked';
import DeleteIcon from '@ux/icon/x-thick';
import Spinner from '@ux/spinner';
import Tag from '@ux/tag';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import IconButton from '@/app/develop/components/IconButton';
import BigCard from '@/components/layout/BigCard';
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { useSecretOperations } from '@/hooks/useSecretOperations';
import { type Secret,useSecrets } from '@/hooks/useSecrets';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';

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
  const t = useTranslations();

  const [formSecrets, setFormSecrets] = useState<SecretFormData[]>([]);
  const [newSecrets, setNewSecrets] = useState<Array<{ name: string; value: string }>>([
    { name: '', value: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    setFormSecrets(() => {
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
  }, [secrets.length, dataUpdatedAt]); /* eslint-disable-line react-hooks/exhaustive-deps */

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

  const getNewSecretNameError = (newSecret: { name: string; value: string }, index: number) => {
    if (!newSecret.name && isValueValid(newSecret.value)) {
      return t('builder_common_required_field_err');
    }
    if (newSecret.name && !isValidSecretName(newSecret.name)) {
      return newSecret.name.length < 2
        ? t('builder_common_field_req_min_characters', { number: 2 })
        : !/^[A-Z_]/.test(newSecret.name)
        ? t('builder_common_field_req_start_with')
        : t('builder_common_field_req_invalid_characters');
    }
    if (newSecret.name && isValidSecretName(newSecret.name) && !isSecretNameUnique(newSecret.name, index)) {
      return t('builder_settings_secrets_key_name_exists');
    }
    return null;
  };

  const getNewSecretNameHelp = (newSecret: { name: string; value: string }, index: number) => {
    if (focusedSecretIndex === index && !newSecret.name) {
      return t('builder_settings_secrets_key_name_allowed_characters');
    }
    return null;
  };

  const getNewSecretValueError = (newSecret: { name: string; value: string }, index: number) => {
    if (newSecret.name && isValidSecretName(newSecret.name) && isSecretNameUnique(newSecret.name, index) && !isValueValid(newSecret.value)) {
      return t('builder_common_required_field_err');
    }
    return null;
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
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

      // Reset form secrets to clear change flags (prevents brief button re-enable)
      setFormSecrets((prev) =>
        prev
          .filter((s) => !s.markedForDeletion)
          .map((s) => ({
            ...s,
            isEditing: false,
            editedValue: undefined,
          }))
      );

      // Show success growl notification
      Growl.addGrowlMessage({
        id: 'secrets-success',
        title: t('builder_status_success'),
        children: t('builder_settings_secrets_success_saving_description'),
        emphasis: 'success',
        lifetime: 5000
      });
    } catch (err) {
      logger.error('secrets.submit.failed', {
        appId,
        variant,
        error: err instanceof Error ? err.message : String(err)
      });

      // Extract error message from the error object
      let errorMessage = t('builder_settings_secrets_error_saving_description');

      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      }

      // Show error growl notification
      Growl.addGrowlMessage({
        id: 'secrets-error',
        title: t('builder_status_failed'),
        children: errorMessage,
        emphasis: 'critical'
      });
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
        <div className='flex flex-col items-center gap-0.5'>
          <text.div as='title' size={ -1 }>{t('builder_common_loading')}</text.div>
          <text.div emphasis='passive' size={ -1 }>
            {t('builder_common_loading_description')}
          </text.div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyStateCard
        icon={<LockIcon width={48} height={48} />}
        title={t('builder_settings_secrets_error_loading_title')}
        description={t('builder_settings_secrets_error_loading_description')}
        ctaLabel={t('builder_common_retry')}
        onCtaClick={() => refetch()}
      />
    );
  }

  return (
    <Box gap="lg" className="@container">
      <BigCard
        title={t('builder_settings_secrets_title')}
        button={(
          <Button
            design="primary"
            onClick={handleSubmit}
            disabled={!hasChanges || isSubmitting}
          >
            {isSubmitting ? t('builder_settings_secrets_saving') : t('builder_settings_secrets_save')}
          </Button>
        )}
        hideStatus={true}
      >
      {!error && (
        <div className="space-y-2">
          {/* New secrets section - moved to top */}
          <div className="space-y-1">
            <div className="border-2 border-dashed border-intents-ux-box-borderColor rounded-lg overflow-hidden">
              {newSecrets.map((newSecret, index) => (
                <div
                  key={index}
                  className={`flex items-start gap-1.5 p-2 ${
                    index !== newSecrets.length - 1 ? 'border-b border-intents-ux-box-borderColor ' : ''
                  }`}
                >
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-1.5 items-start">
                    <div>
                      <TextInput
                        id={`newSecretName-${index}`}
                        value={newSecret.name}
                        onChange={(value: string) => handleNewSecretChange(index, 'name', value)}
                        onFocus={() => setFocusedSecretIndex(index)}
                        onBlur={() => setFocusedSecretIndex(null)}
                        placeholder={t('builder_settings_secrets_placeholder_key_name')}
                        label={null}
                        visualSize="sm"
                        errorMessage={getNewSecretNameError(newSecret, index)}
                        helpMessage={getNewSecretNameHelp(newSecret, index)}
                      />
                    </div>
                    <div>
                      <TextInput
                        id={`newSecretValue-${index}`}
                        label={null}
                        visualSize="sm"
                        multiline={true}
                        value={newSecret.value}
                        onChange={(value: string) => handleNewSecretChange(index, 'value', value)}
                        placeholder={t('builder_settings_secrets_placeholder_key_value')}
                        size={calculateRows(newSecret.value)}
                        errorMessage={getNewSecretValueError(newSecret, index)}
                      />
                      {newSecret.name && isValidSecretName(newSecret.name) && isSecretNameUnique(newSecret.name, index) && isValueValid(newSecret.value) && (
                        <Tag emphasis="warning" className="mt-1">{t('builder_settings_secrets_tag_unsaved_new')}</Tag>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {formSecrets.length > 0 && (
            <>
              <div className="border border-intents-ux-box-borderColor rounded-lg overflow-hidden">
                {formSecrets.map((secret, index) => (
                  <div
                    key={secret.name}
                    className={`flex items-start gap-1.5 p-2 ${
                      index !== formSecrets.length - 1 ? 'border-b' : ''
                    } ${secret.markedForDeletion ? 'bg-intents-ux-feedbackCritical-feedbackColor' : ''}`}
                    style={{ opacity: secret.markedForDeletion ? 0.8 : 1 }}
                  >
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-1.5 items-start">
                      <div>
                        <TextInput
                          id={`secretName-${index}`}
                          value={secret.name}
                          disabled
                          label={null}
                          visualSize="sm"
                        />
                        {/* System managed and sync status tags */}
                        <div className="mt-1 flex gap-1 flex-wrap">
                          {secret.systemManaged ? (
                              <Tag emphasis="info">{t('builder_settings_secrets_tag_system')}</Tag>
                          ) : (
                            <>
                              {secret.syncStatus === 'synced' && (
                                <Tag emphasis="success">{t('builder_settings_secrets_tag_deployed')}</Tag>
                              )}
                              {secret.syncStatus === 'added' && (
                                <>
                                  <Tag emphasis="info">{t('builder_settings_secrets_tag_new')}</Tag>
                                  <Tag emphasis="warning">{t('builder_settings_secrets_tag_not_deployed')}</Tag>
                                </>
                              )}
                              {secret.syncStatus === 'updated' && (
                                <>
                                  <Tag emphasis="info">{t('builder_settings_secrets_tag_updated')}</Tag>
                                  <Tag emphasis="warning">{t('builder_settings_secrets_tag_not_deployed')}</Tag>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div>
                        <TextInput
                          id={`secretValue-${index}`}
                          label={null}
                          ref={(el) => { textareaRefs.current[secret.name] = el; }}
                          value={secret.isEditing ? (secret.editedValue ?? '') : ''}
                          onChange={(value: string) => handleValueChange(secret.name, value)}
                          onBlur={() => handleValueBlur(secret.name)}
                          disabled={!secret.isEditing}
                          size={secret.isEditing ? calculateRows(secret.editedValue) : 1}
                          placeholder={secret.isEditing ? t('builder_settings_secrets_placeholder_key_value') : '••••••••••••'}
                          visualSize="sm"
                          multiline={true}
                        />
                        {secret.isEditing && secret.editedValue && isValueValid(secret.editedValue) && (
                          <Tag emphasis="warning" className="mt-1">{t('builder_settings_secrets_tag_unsaved_edit')}</Tag>
                        )}
                        {secret.markedForDeletion && (
                          <Tag emphasis="critical" className="mt-1">{t('builder_settings_secrets_tag_unsaved_delete')}</Tag>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col md:flex-row items-center gap-0.5">
                      <IconButton
                        icon={<EditIcon />}
                        label={secret.isEditing ? t('builder_common_cancel') : t('builder_common_edit')}
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
                        label={secret.markedForDeletion ? t('builder_common_undo') : t('builder_common_delete')}
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
              <text.p emphasis='passive' size={ -1 }>
                {t('builder_settings_secrets_no_secrets')}
              </text.p>
            </div>
          )}

          {/* Not deployed secrets notice */}
          {formSecrets.some(s => s.syncStatus === 'added' || s.syncStatus === 'updated') && (
            <Alert title={t('builder_settings_secrets_alert_notdeployed_title')} emphasis='info'>
              {t('builder_settings_secrets_alert_notdeployed_children',
                {variant: variant === 'preview' ? t('builder_settings_secrets_env_preview') : t('builder_settings_secrets_env_publish')}
              )}
            </Alert>
          )}
        </div>
      )}
      </BigCard>
      <Growl />
    </Box>
  );
}
