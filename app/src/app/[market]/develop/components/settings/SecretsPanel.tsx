'use client'

import React, { useEffect, useRef, useState } from 'react';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import CheckmarkIcon from '@ux/icon/checkmark';
import CopyIcon from '@ux/icon/copy';
import EditIcon from '@ux/icon/edit';
import HideIcon from '@ux/icon/hide';
import LockIcon from '@ux/icon/locked';
import MenuIcon from '@ux/icon/menu';
import ShowIcon from '@ux/icon/show';
import TrashIcon from '@ux/icon/trash';
import XIcon from '@ux/icon/x';
import { Menu, MenuButton, MenuItem, MenuList } from '@ux/menu';
import Tag from '@ux/tag';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import IconButton from '@/app/[market]/develop/components/IconButton';
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState';
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection';
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { useSecretOperations } from '@/hooks/useSecretOperations';
import { type Secret, useSecrets } from '@/hooks/useSecrets';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { generateClickEID } from '@/utils/instrumentation';

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
  /** Plaintext after save in this session; overrides API `value` until refetch replaces form state. */
  const [sessionPlaintextByName, setSessionPlaintextByName] = useState<Record<string, string>>({});
  /** When false, masked placeholder is shown for cached values until the user reveals them. */
  const [valueRevealedByName, setValueRevealedByName] = useState<Record<string, boolean>>({});
  const textareaRefs = useRef<{ [secretName: string]: HTMLTextAreaElement | null }>({});
  /** Coordinates overlapping submit operations (batch save vs per-row save). */
  const submissionCountRef = useRef(0);
  const savingSecretsRef = useRef(new Set<string>());

  const {
    data: secrets = [],
    isLoading,
    error,
    refetch,
    dataUpdatedAt
  } = useSecrets({ appId, variant });

  const secretOperations = useSecretOperations();

  // Merge latest server data without dropping local unsaved row state (editing, deletion flags).
  useEffect(() => {
    if (!dataUpdatedAt) {
      return;
    }

    if (secrets.length === 0) {
      setFormSecrets([]);
      return;
    }

    setFormSecrets((previousSecrets) => {
      const byName = new Map(previousSecrets.map((secret) => [secret.name, secret]));

      return secrets
        .map((secret) => {
          const isSystemManaged = Boolean(secret.systemManaged);
          const previous = byName.get(secret.name);
          if (!previous) {
            return {
              ...secret,
              isEditing: false,
              isNew: false,
              markedForDeletion: false,
              editedValue: undefined,
            };
          }

          return {
            ...secret,
            isEditing: isSystemManaged ? false : previous.isEditing,
            isNew: false,
            markedForDeletion: isSystemManaged ? false : previous.markedForDeletion,
            editedValue: !isSystemManaged && previous.isEditing ? previous.editedValue : undefined,
          };
        })
        .sort((a, b) => {
          // User-managed secrets first; system-managed at the bottom (actionable rows first)
          if (!a.systemManaged && b.systemManaged) return -1;
          if (a.systemManaged && !b.systemManaged) return 1;
          return a.name.localeCompare(b.name);
        });
    });
  }, [dataUpdatedAt, secrets]);

  const handleEdit = (secretName: string) => {
    const snapshot = formSecrets;
    const clicked = snapshot.find((s) => s.name === secretName);
    const wasEditingClickedSecret = Boolean(clicked?.isEditing);

    setFormSecrets((prev) =>
      prev.map((s) => {
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
      })
    );

    if (!wasEditingClickedSecret) {
      setTimeout(() => {
        textareaRefs.current[secretName]?.focus();
      }, 0);
    }
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
    // Defer one macrotask so we do not treat a transient blur as "user left the field" while focus
    // is still moving: opening edit moves focus from the menu trigger into the value textarea, and
    // that sequence can emit a blur on the new field in the same turn before focus has settled.
    // Same idea as double requestAnimationFrame, but setTimeout(0) is a bit easier to read.
    window.setTimeout(() => {
      const field = textareaRefs.current[secretName];
      const active = document.activeElement;
      if (field && (active === field || field.contains(active))) {
        return;
      }
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
    }, 0);
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

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) {
      return err.message;
    }
    if (typeof err === 'string') {
      return err;
    }
    return t('builder_settings_secrets_error_saving_description');
  };

  const startSubmit = () => {
    submissionCountRef.current += 1;
    if (submissionCountRef.current === 1) {
      setIsSubmitting(true);
    }
  };

  const endSubmit = () => {
    submissionCountRef.current = Math.max(0, submissionCountRef.current - 1);
    if (submissionCountRef.current === 0) {
      setIsSubmitting(false);
    }
  };

  const handleSaveSingle = async (secretName: string) => {
    const secret = formSecrets.find((s) => s.name === secretName);
    if (
      !secret?.editedValue ||
      !isValueValid(secret.editedValue) ||
      secret.systemManaged ||
      submissionCountRef.current > 0 ||
      savingSecretsRef.current.has(secretName)
    ) {
      return;
    }

    savingSecretsRef.current.add(secretName);
    startSubmit();
    try {
      await secretOperations.mutateAsync({
        appId,
        variant,
        operations: {
          updates: [{ name: secretName, value: secret.editedValue }],
          deletions: [],
          additions: [],
        },
      });

      setFormSecrets((prev) =>
        prev.map((s) =>
          s.name === secretName
            ? { ...s, isEditing: false, editedValue: undefined }
            : s
        )
      );

      setSessionPlaintextByName((prev) => ({
        ...prev,
        [secretName]: secret.editedValue,
      }));

      Growl.addGrowlMessage({
        id: `secrets-row-success-${secretName}`,
        title: t('builder_status_success'),
        children: t('builder_settings_secrets_success_saving_description'),
        emphasis: 'success',
        lifetime: 5000
      });
    } catch (err) {
      logger.error('secrets.single.submit.failed', {
        appId,
        variant,
        secretName,
        error: err instanceof Error ? err.message : String(err)
      });

      Growl.addGrowlMessage({
        id: `secrets-row-error-${secretName}`,
        title: t('builder_status_failed'),
        children: getErrorMessage(err),
        emphasis: 'critical'
      });
    } finally {
      savingSecretsRef.current.delete(secretName);
      endSubmit();
    }
  };

  const handleSubmit = async () => {
    // Row save / other paths call startSubmit first; block bulk save so we never overlap mutations
    // (bulk control is also disabled while isSubmitting — this guards races or non-UI callers).
    if (submissionCountRef.current > 0) {
      return;
    }

    startSubmit();
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

      setSessionPlaintextByName((prev) => {
        const next = { ...prev };
        for (const u of operations.updates) {
          next[u.name] = u.value;
        }
        for (const a of operations.additions) {
          next[a.name] = a.value;
        }
        for (const d of operations.deletions) {
          delete next[d];
        }
        return next;
      });
      setValueRevealedByName((prev) => {
        const next = { ...prev };
        for (const d of operations.deletions) {
          delete next[d];
        }
        return next;
      });

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

      Growl.addGrowlMessage({
        id: 'secrets-error',
        title: t('builder_status_failed'),
        children: getErrorMessage(err),
        emphasis: 'critical'
      });
    } finally {
      endSubmit();
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

  const getCopyablePlaintext = (secret: SecretFormData): string => {
    if (secret.isEditing && secret.editedValue !== undefined && isValueValid(secret.editedValue)) {
      return secret.editedValue;
    }
    const cached = sessionPlaintextByName[secret.name];
    if (cached !== undefined && cached !== '') {
      return cached;
    }
    return secret.value ?? '';
  };

  const handleCopySecretValue = async (secret: SecretFormData) => {
    const text = getCopyablePlaintext(secret);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      Growl.addGrowlMessage({
        id: `secret-copied-${secret.name}`,
        title: t('builder_status_success'),
        children: t('builder_common_copied'),
        emphasis: 'success',
        lifetime: 2500,
      });
    } catch {
      logger.error('secrets.copy.failed', { appId, secretName: secret.name });
      Growl.addGrowlMessage({
        id: `secret-copy-failed-${secret.name}`,
        title: t('builder_status_failed'),
        children: t(
          'builder_settings_secrets_copy_failed_named',
          { name: secret.name },
          'Could not copy {name} to the clipboard. Please try again.'
        ),
        emphasis: 'critical',
        lifetime: 4000,
      });
    }
  };

  const toggleValueReveal = (secretName: string) => {
    setValueRevealedByName((prev) => ({ ...prev, [secretName]: !prev[secretName] }));
  };

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
      <SettingsLoadingState
        fullPage
        description={t('builder_common_loading_description')}
      />
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
      <SettingsSection
        title={t('builder_settings_secrets_title')}
        description={t('builder_settings_secrets_description')}
        button={(
          <Button
            design="primary"
            onClick={handleSubmit}
            disabled={!hasChanges || isSubmitting}
            size="sm"
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
                {formSecrets.map((secret, index) => {
                  const plaintextSource =
                    sessionPlaintextByName[secret.name] ??
                    (typeof secret.value === 'string' && secret.value !== '' ? secret.value : undefined);
                  const hasPlaintextSource = plaintextSource !== undefined && plaintextSource !== '';
                  const revealed = !!valueRevealedByName[secret.name];
                  const canToggleShow = !secret.isEditing && hasPlaintextSource;
                  const visuallyShowingPlaintext =
                    !secret.isEditing && hasPlaintextSource && revealed;
                  const valueDisplay =
                    secret.isEditing
                      ? (secret.editedValue ?? '')
                      : hasPlaintextSource && revealed
                        ? plaintextSource
                        : '';
                  const valueRows = secret.isEditing
                    ? calculateRows(secret.editedValue)
                    : hasPlaintextSource && revealed
                      ? calculateRows(plaintextSource)
                      : 1;

                  const hasStatusRow =
                    secret.systemManaged ||
                    secret.syncStatus === 'synced' ||
                    secret.syncStatus === 'added' ||
                    secret.syncStatus === 'updated' ||
                    (secret.isEditing && !!secret.editedValue && isValueValid(secret.editedValue)) ||
                    secret.markedForDeletion;

                  return (
                  <div
                    key={secret.name}
                    className={`p-2 ${
                      index !== formSecrets.length - 1 ? 'border-b border-intents-ux-box-borderColor' : ''
                    } ${secret.markedForDeletion ? 'bg-intents-ux-feedbackCritical-feedbackColor' : ''}`}
                    style={{ opacity: secret.markedForDeletion ? 0.8 : 1 }}
                  >
                    {/* Row 1: name | value | actions (single horizontal group) */}
                    <div className="flex flex-col gap-1.5 @md:flex-row @md:items-center @md:gap-2 min-w-0">
                      <div className="w-full min-w-0 @md:w-[min(38%,14rem)] @md:shrink-0">
                        <TextInput
                          id={`secretName-${index}`}
                          value={secret.name}
                          disabled
                          label={null}
                          visualSize="sm"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <TextInput
                          id={`secretValue-${index}`}
                          label={null}
                          ref={(el) => { textareaRefs.current[secret.name] = el; }}
                          value={valueDisplay}
                          onChange={(value: string) => handleValueChange(secret.name, value)}
                          onBlur={() => handleValueBlur(secret.name)}
                          disabled={!secret.isEditing}
                          size={valueRows}
                          placeholder={secret.isEditing ? '' : '••••••••••••'}
                          visualSize="sm"
                          multiline={true}
                        />
                      </div>
                      {!secret.systemManaged && (
                        <div
                          className="flex flex-row items-center justify-end gap-0.5 shrink-0 w-full @md:w-auto"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {!secret.isEditing && (
                            <>
                              <IconButton
                                icon={visuallyShowingPlaintext ? <HideIcon /> : <ShowIcon />}
                                label={
                                  visuallyShowingPlaintext
                                    ? t('builder_settings_secrets_hide_value', undefined, 'Hide value')
                                    : t('builder_settings_secrets_show_value', undefined, 'Show value')
                                }
                                showLabelWhenActive={false}
                                showLabelAlways={false}
                                onClick={() => toggleValueReveal(secret.name)}
                                disabled={!canToggleShow}
                                active={visuallyShowingPlaintext}
                                size="sm"
                                ghost
                                className="!border-0"
                                dataEid={generateClickEID(`develop.settings.secrets.show.${secret.name}`)}
                              />
                              <IconButton
                                icon={<CopyIcon />}
                                label={t('builder_common_copy_clipboard', undefined, 'Copy to clipboard')}
                                onClick={() => void handleCopySecretValue(secret)}
                                disabled={!getCopyablePlaintext(secret)}
                                size="sm"
                                ghost
                                className="!border-0"
                                dataEid={generateClickEID(`develop.settings.secrets.copy.${secret.name}`)}
                              />
                            </>
                          )}
                          {secret.isEditing && (
                            <>
                              <IconButton
                                icon={<CheckmarkIcon />}
                                label={t('builder_common_save')}
                                aria-label={`${t('builder_common_save')} ${secret.name}`}
                                onClick={() => void handleSaveSingle(secret.name)}
                                showLabelWhenActive={false}
                                showLabelAlways={false}
                                disabled={
                                  secret.systemManaged ||
                                  !secret.editedValue ||
                                  !isValueValid(secret.editedValue) ||
                                  isSubmitting
                                }
                                size="sm"
                                ghost
                                className="!border-0"
                                dataEid={generateClickEID(`develop.settings.secrets.save.${secret.name}`)}
                              />
                              <IconButton
                                icon={<XIcon />}
                                label={t('builder_common_cancel')}
                                onClick={() => handleEdit(secret.name)}
                                showLabelWhenActive={false}
                                showLabelAlways={false}
                                disabled={isSubmitting}
                                size="sm"
                                ghost
                                className="!border-0"
                                dataEid={generateClickEID(`develop.settings.secrets.cancel-edit.${secret.name}`)}
                              />
                            </>
                          )}
                          {!secret.isEditing && (
                            <Menu
                              id={`secret-menu-${secret.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
                              size="sm"
                              closeOnSelect
                            >
                              <MenuButton
                                aria-label={t('builder_settings_secrets_row_actions', undefined, 'Secret actions')}
                                design="control"
                                size="sm"
                                icon={<MenuIcon />}
                                className="!border-0 !bg-transparent p-[6px] rounded-md shadow-none transition-all duration-200 hover:shadow-md hover:!bg-transparent active:!bg-transparent [&[aria-expanded='true']]:!bg-transparent"
                                data-eid={generateClickEID(`develop.settings.secrets.menu.${secret.name}`)}
                              />
                              <MenuList stretch placement="bottom-end">
                                <MenuItem
                                  id={`secret-edit-${index}`}
                                  disabled={secret.markedForDeletion}
                                  onClick={() => handleEdit(secret.name)}
                                >
                                  <Box orientation="horizontal" gap="sm">
                                    <EditIcon />
                                    <text.span>{t('builder_common_edit')}</text.span>
                                  </Box>
                                </MenuItem>
                                <MenuItem
                                  id={`secret-delete-${index}`}
                                  onClick={() => handleDelete(secret.name)}
                                >
                                  <Box orientation="horizontal" gap="sm">
                                    <TrashIcon />
                                    <text.span>
                                      {secret.markedForDeletion ? t('builder_common_undo') : t('builder_common_delete')}
                                    </text.span>
                                  </Box>
                                </MenuItem>
                              </MenuList>
                            </Menu>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Row 2: status and unsaved tags below the fields */}
                    {hasStatusRow && (
                      <div className="mt-1.5 flex flex-wrap gap-1 items-center">
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
                        {secret.isEditing && secret.editedValue && isValueValid(secret.editedValue) && (
                          <Tag emphasis="warning">{t('builder_settings_secrets_tag_unsaved_edit')}</Tag>
                        )}
                        {secret.markedForDeletion && (
                          <Tag emphasis="critical">{t('builder_settings_secrets_tag_unsaved_delete')}</Tag>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
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
      </SettingsSection>
      <Growl />
    </Box>
  );
}
