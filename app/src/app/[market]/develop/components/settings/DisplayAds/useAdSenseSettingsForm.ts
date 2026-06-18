'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdSenseFieldName,
  AdSenseSettings,
  AdSenseSettingsInput,
  AdSenseTextFileSettings,
  AdSenseValidationErrors,
} from '@airo/shared/adsense';

type TextFileField = 'adsTxt' | 'appAdsTxt';

interface AdSenseSettingsFormValues {
  enabled: boolean;
  scriptSnippet: string;
  adsTxt: AdSenseTextFileSettings;
  appAdsTxt: AdSenseTextFileSettings;
}

const emptyFormValues: AdSenseSettingsFormValues = {
  enabled: false,
  scriptSnippet: '',
  adsTxt: { enabled: false, content: '' },
  appAdsTxt: { enabled: false, content: '' },
};

function toFormValues(settings: AdSenseSettings | null | undefined): AdSenseSettingsFormValues {
  if (!settings) {
    return emptyFormValues;
  }

  return {
    enabled: settings.enabled,
    scriptSnippet: settings.scriptSnippet,
    adsTxt: { ...settings.adsTxt },
    appAdsTxt: { ...settings.appAdsTxt },
  };
}

function serialize(values: AdSenseSettingsFormValues): string {
  return JSON.stringify(values);
}

function clearFieldError(errors: AdSenseValidationErrors, field: AdSenseFieldName): AdSenseValidationErrors {
  if (!errors[field]) {
    return errors;
  }

  const next = { ...errors };
  delete next[field];
  return next;
}

export function useAdSenseSettingsForm(settings: AdSenseSettings | null | undefined) {
  const initialValues = useMemo(() => toFormValues(settings), [settings]);
  const [values, setValues] = useState<AdSenseSettingsFormValues>(initialValues);
  const [baseline, setBaseline] = useState<AdSenseSettingsFormValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<AdSenseValidationErrors>({});
  const isDirty = serialize(values) !== serialize(baseline);
  const isDirtyRef = useRef(isDirty);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    if (isDirtyRef.current) {
      return;
    }

    setValues(initialValues);
    setBaseline(initialValues);
    setFieldErrors({});
  }, [initialValues]);

  const updateEnabled = (enabled: boolean) => {
    setValues((current) => ({ ...current, enabled }));
    setFieldErrors((current) => clearFieldError(current, 'enabled'));
  };

  const updateScriptSnippet = (scriptSnippet: string) => {
    setValues((current) => ({ ...current, scriptSnippet }));
    setFieldErrors((current) => clearFieldError(current, 'scriptSnippet'));
  };

  const updateTextFileEnabled = (field: TextFileField, enabled: boolean) => {
    setValues((current) => ({
      ...current,
      [field]: {
        ...current[field],
        enabled,
      },
    }));
    setFieldErrors((current) => clearFieldError(current, field));
  };

  const updateTextFileContent = (field: TextFileField, content: string) => {
    setValues((current) => ({
      ...current,
      [field]: {
        ...current[field],
        content,
      },
    }));
    setFieldErrors((current) => clearFieldError(current, field));
  };

  const reset = (nextSettings: AdSenseSettings | null | undefined) => {
    const nextValues = toFormValues(nextSettings);
    setValues(nextValues);
    setBaseline(nextValues);
    setFieldErrors({});
  };

  const toInput = (): AdSenseSettingsInput => ({
    enabled: values.enabled,
    scriptSnippet: values.scriptSnippet,
    adsTxt: { ...values.adsTxt },
    appAdsTxt: { ...values.appAdsTxt },
  });

  return {
    values,
    fieldErrors,
    isDirty,
    setServerErrors: setFieldErrors,
    updateEnabled,
    updateScriptSnippet,
    updateTextFileEnabled,
    updateTextFileContent,
    reset,
    toInput,
  };
}
