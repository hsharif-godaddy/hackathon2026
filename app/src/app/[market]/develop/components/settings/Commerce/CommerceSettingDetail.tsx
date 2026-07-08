'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import ArrowLeftIcon from '@ux/icon/arrow-left';
import CheckmarkIcon from '@ux/icon/checkmark';
import Select from '@ux/select';
import text from '@ux/text';
import TextInput from '@ux/text-input';
import TextLockup from '@ux/text-lockup';

import { appFetch } from '@/lib/gasket-config';
import {
  CommerceHomeLinkCard,
  ItemRow,
  LoadingSpinner,
  NoticePlaceholder,
  SectionHeader,
} from './Components';
import {
  normalizeItem,
  normalizeSettingPath,
  normalizeStatus,
  settingPathFromRoute,
  textValue,
} from './Normalizers';
import { fetchSettingsApi, localSettingsApiPath } from './SettingsApiClient';
import type { ApiSettingsItem, ApiStatusBadge, Renderer, SettingsItem, StatusBadge } from './Types';

export type FieldValue = string | boolean | string[];

const EMPTY_DIRTY_FIELDS: string[] = [];

type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'secret'
  | 'email'
  | 'url'
  | 'phone'
  | 'currency'
  | 'date'
  | 'time'
  | 'percentage'
  | 'radio'
  | 'display';

type FieldOption = {
  label: string;
  value: string;
};

type SettingsField = {
  key: string;
  type: FieldType;
  label: string;
  value: FieldValue;
  placeholder?: string;
  helpText?: string;
  options?: FieldOption[];
  required?: boolean;
  readOnly?: boolean;
  secretState?: {
    configured: boolean;
    updatedAt?: string;
  };
};

type FieldSection = {
  kind: 'fields';
  id: string;
  title?: string;
  description?: string;
  fields: SettingsField[];
};

type ItemSection = {
  kind: 'settings-items';
  id: string;
  title?: string;
  description?: string;
  items: SettingsItem[];
};

type NativeSlotSection = {
  kind: 'native-slot';
  id: string;
  title: string;
  description: string;
  route: string;
  href: string;
};

type PageSection = FieldSection | ItemSection | NativeSlotSection;

type OperationLink = {
  rel: 'update' | 'validate' | 'test-connection';
  label: string;
  method: 'POST' | 'PATCH';
  href: string;
  idempotencyRequired?: boolean;
  revisionRequired?: boolean;
};

type SettingsPage = {
  id: string;
  slug: string;
  source: 'commerce' | 'gpa';
  renderer: Exclude<Renderer, 'external-link'>;
  title: string;
  subtitle: string;
  revision: string;
  backPath: string;
  status?: StatusBadge;
  sections: PageSection[];
  operations: {
    update?: OperationLink;
    validate?: OperationLink;
    testConnection?: OperationLink;
  };
};

type ApiSettingsField = {
  key?: string;
  type?: FieldType;
  label?: string;
  labelKey?: string;
  value?: unknown;
  placeholder?: string;
  placeholderKey?: string;
  helpText?: string;
  helpTextKey?: string;
  options?: Array<{
    label?: string;
    labelKey?: string;
    value?: string;
  }>;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  secretState?: SettingsField['secretState'];
  visible?: boolean;
};

type ApiPageSection = {
  kind?: 'fields' | 'settings-items' | 'native-slot';
  id?: string;
  title?: string;
  titleKey?: string;
  description?: string;
  descriptionKey?: string;
  route?: string;
  items?: ApiSettingsItem[];
  fields?: ApiSettingsField[];
  href?: string;
};

type ApiSettingsPage = {
  id?: string;
  slug?: string;
  source?: 'commerce' | 'gpa';
  renderer?: Exclude<Renderer, 'external-link'>;
  title?: string;
  titleKey?: string;
  subtitle?: string;
  subtitleKey?: string;
  revision?: string;
  backPath?: string;
  back?: {
    route?: string;
  };
  status?: ApiStatusBadge;
  sections?: ApiPageSection[];
  operations?: {
    update?: Partial<OperationLink> & { labelKey?: string };
    validate?: Partial<OperationLink> & { labelKey?: string };
    testConnection?: Partial<OperationLink> & { labelKey?: string };
  };
};

type ApiOperationResponse = {
  result?: string;
  title?: string;
  detail?: string;
  fieldErrors?: Record<string, string>;
  next?: {
    refetchPage?: boolean;
    refetchSurface?: boolean;
  };
};

type ContextualAppSettingPath = {
  groupSlug: string;
  appId: string;
  appSettingSlug: string;
};

function parseContextualAppSettingPath(settingPath: string): ContextualAppSettingPath | undefined {
  const [groupSlug, appsSegment, appId, appSettingSlug, ...extra] =
    normalizeSettingPath(settingPath).split('/');

  if (!groupSlug || appsSegment !== 'apps' || !appId || !appSettingSlug || extra.length > 0) {
    return undefined;
  }

  return { groupSlug, appId, appSettingSlug };
}

function normalizeFieldValue(field: ApiSettingsField): FieldValue {
  if (field.type === 'boolean') return field.value === true;
  if (field.type === 'multiselect') {
    return Array.isArray(field.value)
      ? field.value.filter((value): value is string => typeof value === 'string')
      : [];
  }
  if (typeof field.value === 'number') return String(field.value);
  if (typeof field.value === 'string') return field.value;
  return '';
}

function normalizeField(field: ApiSettingsField): SettingsField | undefined {
  if (!field.key || !field.type || field.visible === false) return undefined;

  return {
    key: field.key,
    type: field.type,
    label: textValue(field.label, field.labelKey),
    value: normalizeFieldValue(field),
    placeholder: textValue(field.placeholder, field.placeholderKey) || undefined,
    helpText: textValue(field.helpText, field.helpTextKey) || undefined,
    options: field.options
      ?.map((option) => {
        if (!option.value) return undefined;
        return {
          label: textValue(option.label, option.labelKey),
          value: option.value,
        };
      })
      .filter((option): option is FieldOption => Boolean(option)),
    required: field.required,
    readOnly: field.readOnly || field.disabled,
    secretState: field.secretState,
  };
}

function normalizeOperation(
  operation: ApiSettingsPage['operations'] extends infer Operations
    ? Operations extends Record<string, unknown>
      ? Operations[keyof Operations]
      : never
    : never,
  rel: OperationLink['rel'],
  fallbackLabel: string,
  fallbackMethod: OperationLink['method']
): OperationLink | undefined {
  if (!operation?.href) return undefined;
  const method =
    operation.method === 'PATCH' || operation.method === 'POST' ? operation.method : fallbackMethod;

  return {
    rel,
    label: textValue(operation.label, operation.labelKey) || fallbackLabel,
    method,
    href: operation.href,
    idempotencyRequired: operation.idempotencyRequired,
    revisionRequired: operation.revisionRequired,
  };
}

function normalizeNativeSlotHref(href: string | undefined): string | undefined {
  if (!href?.trim()) return undefined;

  try {
    const url = new URL(href.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizePageSection(section: ApiPageSection): PageSection | undefined {
  const kind = section.kind ?? (section.fields ? 'fields' : undefined);
  const id = section.id;
  if (!id || !kind) return undefined;

  if (kind === 'fields') {
    const fields =
      section.fields
        ?.map(normalizeField)
        .filter((field): field is SettingsField => Boolean(field)) ?? [];

    if (fields.length === 0) return undefined;

    return {
      kind: 'fields',
      id,
      title: textValue(section.title, section.titleKey) || undefined,
      description: textValue(section.description, section.descriptionKey) || undefined,
      fields,
    };
  }

  if (kind === 'settings-items') {
    const items =
      section.items
        ?.map(normalizeItem)
        .filter((item): item is SettingsItem => Boolean(item))
        .sort((a, b) => a.order - b.order) ?? [];

    if (items.length === 0) return undefined;

    return {
      kind: 'settings-items',
      id,
      title: textValue(section.title, section.titleKey) || undefined,
      description: textValue(section.description, section.descriptionKey) || undefined,
      items,
    };
  }

  if (kind === 'native-slot') {
    const href = normalizeNativeSlotHref(section.href);
    if (!href) return undefined;

    return {
      kind: 'native-slot',
      id,
      title: textValue(section.title, section.titleKey),
      description: textValue(section.description, section.descriptionKey),
      route: section.route ?? '',
      href,
    };
  }

  return undefined;
}

function normalizePage(page: ApiSettingsPage | null | undefined): SettingsPage | undefined {
  if (!page?.slug || !page.renderer) return undefined;

  return {
    id: page.id ?? page.slug,
    slug: page.slug,
    source: page.source ?? 'commerce',
    renderer: page.renderer,
    title: textValue(page.title, page.titleKey),
    subtitle: textValue(page.subtitle, page.subtitleKey),
    revision: page.revision ?? '',
    backPath: page.backPath ?? settingPathFromRoute(page.back?.route) ?? '',
    status: normalizeStatus(page.status),
    sections:
      page.sections
        ?.map(normalizePageSection)
        .filter((section): section is PageSection => Boolean(section)) ?? [],
    operations: {
      update: normalizeOperation(page.operations?.update, 'update', 'Save', 'PATCH'),
      validate: normalizeOperation(page.operations?.validate, 'validate', 'Validate', 'POST'),
      testConnection: normalizeOperation(
        page.operations?.testConnection,
        'test-connection',
        'Test connection',
        'POST'
      ),
    },
  };
}

function settingPathFromOperationHref(href: string, storeId: string) {
  const marker = `/v2/commerce/stores/${storeId}/settings/`;
  const markerIndex = href.indexOf(marker);
  if (markerIndex >= 0) {
    return href.slice(markerIndex + marker.length);
  }

  return href.replace(/^\/+/, '');
}

function fieldStateKey(page: SettingsPage, field: SettingsField) {
  return `${page.slug}:${field.key}`;
}

function sectionFields(page: SettingsPage | undefined) {
  return (
    page?.sections.flatMap((section) => (section.kind === 'fields' ? section.fields : [])) ?? []
  );
}

function fieldInitialValues(page: SettingsPage | undefined) {
  return Object.fromEntries(
    sectionFields(page).map((field) => [`${page?.slug}:${field.key}`, field.value])
  ) satisfies Record<string, FieldValue>;
}

function reconcilePageValues(
  previous: Record<string, FieldValue>,
  page: SettingsPage,
  dirtyFields: string[]
) {
  const next = { ...previous };
  const pagePrefix = `${page.slug}:`;
  const initialValues = fieldInitialValues(page);
  const currentPageKeys = new Set(Object.keys(initialValues));
  const dirtyFieldKeys = new Set(dirtyFields.map((fieldKey) => `${page.slug}:${fieldKey}`));

  for (const key of Object.keys(next)) {
    if (key.startsWith(pagePrefix) && !currentPageKeys.has(key)) {
      delete next[key];
    }
  }

  for (const [key, value] of Object.entries(initialValues)) {
    next[key] = dirtyFieldKeys.has(key) && key in previous ? previous[key] : value;
  }

  return next;
}

function operationForPage(page: SettingsPage, operation: OperationLink) {
  switch (operation.rel) {
    case 'update':
      return page.operations.update ?? operation;
    case 'validate':
      return page.operations.validate ?? operation;
    case 'test-connection':
      return page.operations.testConnection ?? operation;
  }
}

function parseOperationResponse(body: string): ApiOperationResponse | undefined {
  if (!body) return undefined;

  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as ApiOperationResponse) : undefined;
  } catch {
    return undefined;
  }
}

function operationResponseMessage(body: ApiOperationResponse | undefined) {
  return [body?.title, body?.detail].filter(Boolean).join(' ') || body?.result;
}

function operationSucceeded(body: ApiOperationResponse | undefined) {
  return !body?.result || body.result === 'success';
}

function clearSecretValues(previous: Record<string, FieldValue>, page: SettingsPage) {
  const next = { ...previous };

  for (const field of sectionFields(page)) {
    if (field.type === 'secret') {
      delete next[fieldStateKey(page, field)];
    }
  }

  return next;
}

function randomIdempotencyKey() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function inputTypeForField(field: SettingsField): string | undefined {
  switch (field.type) {
    case 'secret':
      return 'password';
    case 'number':
      return 'number';
    case 'email':
      return 'email';
    case 'url':
      return 'url';
    case 'phone':
      return 'tel';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    default:
      return undefined;
  }
}

function placeholderForField(field: SettingsField, dirty: boolean) {
  if (field.type === 'secret' && field.secretState?.configured && !dirty) {
    return 'Configured secret';
  }

  return field.placeholder;
}

function FieldControl({
  page,
  field,
  value,
  dirty,
  onChange,
}: {
  page: SettingsPage;
  field: SettingsField;
  value: FieldValue;
  dirty: boolean;
  onChange: (value: FieldValue) => void;
}) {
  const inputId = `commerce-prototype-${page.slug}-${field.key}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const placeholder = placeholderForField(field, dirty);

  if (field.type === 'boolean') {
    return (
      <Checkbox
        id={inputId}
        name={inputId}
        checked={value === true}
        onChange={(checked: boolean) => onChange(checked)}
        label={field.label}
        disabled={field.readOnly}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <Select
        id={inputId}
        name={inputId}
        label={field.label}
        value={typeof value === 'string' ? value : ''}
        onChange={(nextValue: string) => onChange(nextValue)}
        disabled={field.readOnly}
        stretch
      >
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  }

  if (field.type === 'multiselect') {
    const selectedValues = Array.isArray(value) ? value : [];

    return (
      <div>
        <text.p className="mb-1 font-medium">{field.label}</text.p>
        <div className="grid gap-1 @2xl:grid-cols-2">
          {(field.options ?? []).map((option) => (
            <Checkbox
              key={option.value}
              id={`${inputId}-${option.value}`}
              name={`${inputId}-${option.value}`}
              checked={selectedValues.includes(option.value)}
              onChange={(checked: boolean) => {
                onChange(
                  checked
                    ? [...selectedValues, option.value]
                    : selectedValues.filter((selected) => selected !== option.value)
                );
              }}
              label={option.label}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {field.type === 'textarea' ? (
        <TextInput
          id={inputId}
          label={field.label}
          value={typeof value === 'string' ? value : ''}
          onChange={(nextValue: string) => onChange(nextValue)}
          placeholder={placeholder}
          helpMessage={field.helpText}
          multiline
          disabled={field.readOnly}
          required={field.required}
          stretch
        />
      ) : (
        <TextInput
          id={inputId}
          label={field.label}
          value={typeof value === 'string' ? value : ''}
          onChange={(nextValue: string) => onChange(nextValue)}
          placeholder={placeholder}
          helpMessage={field.helpText}
          type={inputTypeForField(field)}
          disabled={field.readOnly}
          required={field.required}
          stretch
        />
      )}
      {field.type === 'secret' && field.secretState?.configured && !dirty && (
        <div className="mt-1 flex items-center gap-1 text-intents-ux-feedbackSuccess-foregroundColor">
          <CheckmarkIcon className="size-2" />
          <text.p emphasis="passive">
            Configured{field.secretState.updatedAt ? ` on ${field.secretState.updatedAt}` : ''}
          </text.p>
        </div>
      )}
    </div>
  );
}

function FormPage({
  page,
  values,
  dirtyFields,
  onFieldChange,
  onOperation,
}: {
  page: SettingsPage;
  values: Record<string, FieldValue>;
  dirtyFields: string[];
  onFieldChange: (page: SettingsPage, field: SettingsField, value: FieldValue) => void;
  onOperation: (operation: OperationLink) => void;
}) {
  const hasOperations = Boolean(
    page.operations.testConnection || page.operations.validate || page.operations.update
  );
  const fieldSections = page.sections.filter(
    (section): section is FieldSection => section.kind === 'fields'
  );

  return (
    <div className="flex flex-col gap-2 p-1">
      {fieldSections.length === 0 ? (
        <NoticePlaceholder
          label="Commerce setting returned no editable fields"
          title="No settings fields returned"
          description="The settings provider returned a form page without fields."
        />
      ) : (
        fieldSections.map((section) => (
          <div key={section.id} className="flex flex-col gap-1.5">
            {(section.title || section.description) && (
              <SectionHeader title={section.title ?? ''} description={section.description} />
            )}
            <div className="grid gap-1.5 @3xl:grid-cols-2">
              {section.fields.map((field) => {
                const stateKey = fieldStateKey(page, field);
                const value = values[stateKey] ?? field.value;
                return (
                  <FieldControl
                    key={field.key}
                    page={page}
                    field={field}
                    value={value}
                    dirty={dirtyFields.includes(field.key)}
                    onChange={(nextValue) => onFieldChange(page, field, nextValue)}
                  />
                );
              })}
            </div>
          </div>
        ))
      )}
      {hasOperations && (
        <div className="sticky bottom-0 -mx-1 flex flex-wrap justify-end gap-1 border-t border-intents-ux-box-borderColor px-1 py-1.5">
          {page.operations.testConnection && (
            <Button
              design="secondary"
              size="sm"
              text={page.operations.testConnection.label}
              onClick={() => onOperation(page.operations.testConnection as OperationLink)}
            />
          )}
          {page.operations.validate && (
            <Button
              design="secondary"
              size="sm"
              text={page.operations.validate.label}
              onClick={() => onOperation(page.operations.validate as OperationLink)}
            />
          )}
          {page.operations.update && (
            <Button
              design="primary"
              size="sm"
              text={page.operations.update.label}
              disabled={dirtyFields.length === 0}
              onClick={() => onOperation(page.operations.update as OperationLink)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function GroupItemsSection({
  section,
  onSelect,
}: {
  section: ItemSection;
  onSelect: (item: SettingsItem) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 p-1">
      {(section.title || section.description) && (
        <SectionHeader title={section.title ?? ''} description={section.description} />
      )}
      <div className="flex flex-col gap-1">
        {section.items.map((item) => (
          <ItemRow key={item.id} item={item} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function NativeSlotCard({ section, storeId }: { section: NativeSlotSection; storeId?: string }) {
  const url = new URL(section.href);

  const urlsp = new URLSearchParams(url.search);
  if (storeId && !urlsp.get('storeId')) {
    urlsp.set('storeId', storeId);
  }

  url.search = urlsp.toString();

  return (
    <div className="p-1">
      <CommerceHomeLinkCard
        to={url}
        icon={null}
        title={section.title}
        content={section.description}
      />
    </div>
  );
}

function UnsupportedPage({ page }: { page: SettingsPage }) {
  return (
    <div className="flex flex-col gap-1.5 p-1">
      {page.sections.map((section) =>
        section.kind === 'native-slot' ? (
          <NativeSlotCard key={section.id} section={section} />
        ) : null
      )}
    </div>
  );
}

function PageHeader({ page, onBack }: { page?: SettingsPage; onBack: () => void }) {
  return (
    <div className="px-1">
      <Button design="tertiary" size="sm" icon={<ArrowLeftIcon />} text="Back" onClick={onBack} />
      {page && <TextLockup title={page.title}>{page.subtitle}</TextLockup>}
    </div>
  );
}

function PageView({
  page,
  storeId,
  values,
  dirtyFields,
  onSelect,
  onFieldChange,
  onOperation,
}: {
  page: SettingsPage;
  storeId: string;
  values: Record<string, FieldValue>;
  dirtyFields: string[];
  onSelect: (item: SettingsItem) => void;
  onFieldChange: (page: SettingsPage, field: SettingsField, value: FieldValue) => void;
  onOperation: (operation: OperationLink) => void;
}) {
  switch (page.renderer) {
    case 'settings-form-v1':
      return (
        <FormPage
          page={page}
          values={values}
          dirtyFields={dirtyFields}
          onFieldChange={onFieldChange}
          onOperation={onOperation}
        />
      );
    case 'settings-group-v1':
      return (
        <div className="flex flex-col gap-2">
          {page.sections.map((section) => {
            if (section.kind === 'native-slot')
              return <NativeSlotCard key={section.id} section={section} storeId={storeId} />;
            if (section.kind === 'settings-items')
              return <GroupItemsSection key={section.id} section={section} onSelect={onSelect} />;
            return null;
          })}
        </div>
      );
    default:
      return <UnsupportedPage page={page} />;
  }
}

function SettingUnavailable({
  label,
  title = 'Commerce setting unavailable',
  description,
  onBack,
}: {
  label: string;
  title?: string;
  description?: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button design="tertiary" size="sm" icon={<ArrowLeftIcon />} text="Back" onClick={onBack} />
      </div>
      <NoticePlaceholder label={label} title={title} description={description ?? label} />
    </div>
  );
}

export function CommerceSettingDetail({
  storeId,
  commercePath,
  onCommercePathChange,
  onLastAction,
  onRefetchSurface,
  baseDebugState,
}: {
  storeId: string;
  commercePath: string;
  onCommercePathChange: (path: string) => void;
  onLastAction: (action: string) => void;
  onRefetchSurface: () => Promise<unknown>;
  baseDebugState: Record<string, unknown>;
}) {
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [dirtyByPath, setDirtyByPath] = useState<Record<string, string[]>>({});

  const pageQuery = useQuery({
    queryKey: ['commerce-settings-page', storeId, commercePath],
    queryFn: ({ signal }) => fetchSettingsApi<ApiSettingsPage>(storeId, commercePath, signal),
    enabled: Boolean(storeId && commercePath),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const currentPage = useMemo(() => normalizePage(pageQuery.data), [pageQuery.data]);
  const contextualAppSettingPath = useMemo(
    () => parseContextualAppSettingPath(commercePath),
    [commercePath]
  );
  const dirtyFields = currentPage
    ? (dirtyByPath[currentPage.slug] ?? EMPTY_DIRTY_FIELDS)
    : EMPTY_DIRTY_FIELDS;

  useEffect(() => {
    if (!currentPage) return;
    setValues((previous) => reconcilePageValues(previous, currentPage, dirtyFields));
  }, [currentPage, dirtyFields]);

  const onSelect = useCallback(
    (item: SettingsItem) => {
      if (item.renderer === 'external-link') {
        onLastAction(`Would open external link: ${item.href}`);
        window.open(item.href, '_blank');
        return;
      }

      if (!item.path) return;
      const nextPath = normalizeSettingPath(item.path);
      onCommercePathChange(nextPath);
      onLastAction(`Selected ${item.title}`);
    },
    [onCommercePathChange, onLastAction]
  );

  const onFieldChange = useCallback(
    (page: SettingsPage, field: SettingsField, value: FieldValue) => {
      const stateKey = fieldStateKey(page, field);
      setValues((previous) => ({ ...previous, [stateKey]: value }));
      setDirtyByPath((previous) => {
        const current = previous[page.slug] ?? [];
        return current.includes(field.key)
          ? previous
          : { ...previous, [page.slug]: [...current, field.key] };
      });
      onLastAction(`Edited ${field.label}`);
    },
    [onLastAction]
  );

  const onOperation = useCallback(
    (operation: OperationLink) => {
      if (!currentPage) return;

      void (async () => {
        let pageForRequest = currentPage;

        if (operation.revisionRequired) {
          const refetchResult = await pageQuery.refetch();
          pageForRequest = normalizePage(refetchResult.data) ?? pageForRequest;
        }

        const operationForRequest = operationForPage(pageForRequest, operation);
        const dirtyFieldsForPage = dirtyByPath[pageForRequest.slug] ?? dirtyFields;
        const valuesForPage = Object.fromEntries(
          sectionFields(pageForRequest).map((field) => {
            const stateKey = fieldStateKey(pageForRequest, field);
            return [
              field.key,
              dirtyFieldsForPage.includes(field.key)
                ? (values[stateKey] ?? field.value)
                : field.value,
            ];
          })
        );

        const headers: HeadersInit = {
          Accept: 'application/json',
        };

        if (operationForRequest.rel !== 'test-connection') {
          headers['Content-Type'] = 'application/json';
        }

        if (operationForRequest.idempotencyRequired) {
          headers['Idempotency-Key'] = randomIdempotencyKey();
        }

        if (operationForRequest.revisionRequired && pageForRequest.revision) {
          headers['If-Match'] = pageForRequest.revision;
        }

        const body =
          operationForRequest.rel === 'test-connection'
            ? undefined
            : JSON.stringify({
                values: valuesForPage,
                changedFields: dirtyFieldsForPage,
                revision: pageForRequest.revision,
              });

        const settingPath = settingPathFromOperationHref(operationForRequest.href, storeId);

        try {
          const response = await appFetch(
            localSettingsApiPath(storeId, settingPath),
            {
              method: operationForRequest.method,
              headers,
              body,
            },
            { handle401: { level: 3 } }
          );
          const responseText = await response.text().catch(() => '');
          const responseBody = parseOperationResponse(responseText);
          const responseMessage = operationResponseMessage(responseBody);

          if (!response.ok) {
            onLastAction(
              `${operationForRequest.method} ${operationForRequest.href} failed (${response.status})${responseMessage ? `: ${responseMessage}` : ''}`
            );
            return;
          }

          if (!operationSucceeded(responseBody)) {
            onLastAction(
              `${operationForRequest.method} ${operationForRequest.href} returned ${responseMessage ?? 'unsuccessful result'}`
            );
            return;
          }

          if (operationForRequest.rel === 'update') {
            setDirtyByPath((previous) => ({
              ...previous,
              [currentPage.slug]: [],
              [pageForRequest.slug]: [],
            }));
            setValues((previous) => clearSecretValues(previous, pageForRequest));

            if (responseBody?.next?.refetchPage !== false) {
              await pageQuery.refetch();
            }

            if (responseBody?.next?.refetchSurface) {
              await onRefetchSurface();
            }
          }

          onLastAction(`${operationForRequest.method} ${operationForRequest.href}`);
        } catch (err: unknown) {
          onLastAction(
            `${operationForRequest.method} ${operationForRequest.href} failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })();
    },
    [
      currentPage,
      dirtyByPath,
      dirtyFields,
      onLastAction,
      onRefetchSurface,
      pageQuery,
      storeId,
      values,
    ]
  );

  const onPageBack = useCallback(() => {
    const backPath = currentPage?.backPath ?? contextualAppSettingPath?.groupSlug;
    if (backPath) {
      onCommercePathChange(backPath);
      onLastAction(`Returned to ${backPath}`);
      return;
    }
    onCommercePathChange('');
    onLastAction('Returned to commerce');
  }, [
    contextualAppSettingPath?.groupSlug,
    currentPage?.backPath,
    onCommercePathChange,
    onLastAction,
  ]);

  const debugState = useMemo(
    () => ({
      ...baseDebugState,
      pageError: pageQuery.error instanceof Error ? pageQuery.error.message : null,
      renderer: currentPage?.renderer ?? baseDebugState.renderer,
      source: currentPage?.source ?? baseDebugState.source,
      revision: currentPage?.revision ?? baseDebugState.revision,
      dirtyFields,
    }),
    [baseDebugState, currentPage, dirtyFields, pageQuery.error]
  );

  if (pageQuery.isLoading) {
    return (
      <div className="@container flex flex-col gap-2">
        <PageHeader onBack={onPageBack} />
        <LoadingSpinner />
      </div>
    );
  }

  if (pageQuery.error instanceof Error) {
    return (
      <div className="@container flex flex-col gap-2">
        <SettingUnavailable
          label={`Commerce setting unavailable: ${pageQuery.error.message}`}
          title="Couldn't load this setting"
          description={pageQuery.error.message}
          onBack={onPageBack}
        />
      </div>
    );
  }

  if (currentPage) {
    return (
      <div className="@container flex flex-col gap-2">
        <PageHeader page={currentPage} onBack={onPageBack} />
        <PageView
          page={currentPage}
          storeId={storeId}
          values={values}
          dirtyFields={dirtyFields}
          onSelect={onSelect}
          onFieldChange={onFieldChange}
          onOperation={onOperation}
        />
      </div>
    );
  }

  return (
    <div className="@container flex flex-col gap-2">
      <SettingUnavailable label="Commerce setting not returned" onBack={onPageBack} />
    </div>
  );
}
