'use client';

import { type KeyboardEvent, type ReactElement } from 'react';
import CartIcon from '@ux/icon/cart';
import SearchIcon from '@ux/icon/search';
import Tag from '@ux/tag';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
import { generateClickEID } from '@/utils/instrumentation';

const COMPACT_THRESHOLD: number = 3;

/** A domain the user owns, optionally flagged as the one currently connected to this app. */
export interface SelectableDomain {
  fqdn: string;
  inUse?: boolean;
}

interface DomainRadioRowProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
  testId: string;
  tabIndex: number;
  subtitle?: string;
  badgeLabel?: string;
}

function DomainRadioRow({
  label,
  selected,
  onSelect,
  testId,
  tabIndex,
  subtitle,
  badgeLabel,
}: DomainRadioRowProps): ReactElement {
  return (
    <button
      type='button'
      role='radio'
      aria-checked={selected}
      tabIndex={tabIndex}
      data-testid={testId}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2 py-1 text-left transition-colors duration-100',
        'hover:bg-intents-ux-actionHovered-backgroundColor',
      )}
    >
      <span
        aria-hidden='true'
        className={cn(
          'mt-px flex size-2 shrink-0 items-center justify-center rounded-full border-2 bg-intents-ux-box-backgroundColor',
          selected ? 'border-intents-ux-box-foregroundColor' : 'border-intents-ux-textSubtle-textColor',
        )}
      >
        {selected ? <span className='size-1 rounded-full bg-intents-ux-box-foregroundColor' /> : null}
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='flex items-center justify-between gap-2'>
          <text.span size={-1} className='min-w-0 truncate text-intents-ux-box-foregroundColor'>
            {label}
          </text.span>
          {badgeLabel ? (
            <Tag emphasis='warning' size='sm' className='shrink-0 uppercase'>
              {badgeLabel}
            </Tag>
          ) : null}
        </span>
        {subtitle ? (
          <text.span size={-2} className='text-intents-ux-text-secondaryColor'>
            {subtitle}
          </text.span>
        ) : null}
      </span>
    </button>
  );
}

// Roving-focus + arrow-key navigation for the radiogroup (ARIA radio pattern). Operates on the
// group's own [role=radio] buttons so it works regardless of how many rows are rendered.
function handleRadioGroupKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const radios: HTMLButtonElement[] = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  if (radios.length === 0) return;
  const activeIndex: number = radios.findIndex((radio) => radio === document.activeElement);
  const direction: number = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
  const baseIndex: number = activeIndex >= 0 ? activeIndex : 0;
  const nextIndex: number = (baseIndex + direction + radios.length) % radios.length;
  radios[nextIndex].focus();
  radios[nextIndex].click();
}

interface PublishDomainSelectorProps {
  customDomains: SelectableDomain[];
  freeProjectUrl: string;
  selectedFqdn: string;
  matchesProjectFqdn?: string;
  onSelect: (fqdn: string) => void;
  onNewDomain: () => void;
  onSeeAllDomains: () => void;
  onUseExternalDomain: () => void;
}

export default function PublishDomainSelector({
  customDomains,
  freeProjectUrl,
  selectedFqdn,
  matchesProjectFqdn,
  onSelect,
  onNewDomain,
  onSeeAllDomains,
  onUseExternalDomain,
}: PublishDomainSelectorProps): ReactElement {
  const t = useTranslations();
  const hasDomains: boolean = customDomains.length > 0;
  const hasMoreDomains: boolean = customDomains.length > COMPACT_THRESHOLD;
  // Show the first 3, but never hide the selected domain — if it sits beyond the cap, surface it.
  const visibleDomains: SelectableDomain[] = ((): SelectableDomain[] => {
    if (!hasMoreDomains) return customDomains;
    const top: SelectableDomain[] = customDomains.slice(0, COMPACT_THRESHOLD);
    if (top.some((d) => d.fqdn === selectedFqdn)) return top;
    const selectedDomain: SelectableDomain | undefined = customDomains.find((d) => d.fqdn === selectedFqdn);
    return selectedDomain ? [selectedDomain, ...top.slice(0, COMPACT_THRESHOLD - 1)] : top;
  })();
  // Roving tabindex: exactly one radio in the group is tabbable (the selected one, else the first).
  const selectedVisibleIndex: number = visibleDomains.findIndex((d) => d.fqdn === selectedFqdn);
  const rovingIndex: number = selectedVisibleIndex >= 0 ? selectedVisibleIndex : 0;

  return (
    <div className='flex flex-col gap-2'>
      <div className='rounded-lg border border-intents-ux-boxLowContrast-borderColor p-2'>
        <div className='mb-1 flex items-center justify-between gap-2'>
          <text.strong size={-1} className='text-intents-ux-box-foregroundColor'>
            {t('builder_publish_custom_domain_title')}
          </text.strong>
          {hasDomains ? (
            <button
              type='button'
              onClick={onNewDomain}
              data-eid={generateClickEID('develop.publish.new_domain')}
              data-testid='publish-new-domain'
              className='inline-flex shrink-0 items-center gap-0.5 text-intents-ux-link-foregroundColor hover:cursor-pointer'
            >
              <CartIcon className='size-2' />
              <text.span size={-1}>{t('builder_publish_new_domain')}</text.span>
            </button>
          ) : null}
        </div>

        {visibleDomains.length > 0 ? (
          <div
            role='radiogroup'
            aria-label={t('builder_publish_custom_domain_title')}
            onKeyDown={handleRadioGroupKeyDown}
            className='flex flex-col overflow-hidden rounded-md'
          >
            {visibleDomains.map((domain, index) => (
              <DomainRadioRow
                key={domain.fqdn}
                testId={`publish-domain-item-${index}`}
                label={domain.fqdn.replace(/^https?:\/\//, '')}
                selected={selectedFqdn === domain.fqdn}
                tabIndex={index === rovingIndex ? 0 : -1}
                onSelect={() => onSelect(domain.fqdn)}
                subtitle={
                  matchesProjectFqdn === domain.fqdn
                    ? t('builder_publish_domain_matches_project')
                    : undefined
                }
                badgeLabel={domain.inUse ? t('builder_publish_domain_in_use') : undefined}
              />
            ))}
          </div>
        ) : (
          <div className='flex items-stretch gap-0' data-testid='publish-no-domains'>
            <TextInput
              label={null}
              visualSize='sm'
              placeholder={t('builder_publish_find_domain_placeholder')}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter') onNewDomain();
              }}
              className='flex-1 [&_.ux-text-input-shell]:!rounded-r-none [&_.ux-text-input-shell]:!border-r-0 [&_.ux-text-input]:!rounded-r-none [&_.ux-text-input]:!border-r-0'
            />
            <button
              type='button'
              onClick={onNewDomain}
              data-eid={generateClickEID('develop.publish.search_domain')}
              data-testid='publish-search-domain'
              aria-label={t('builder_publish_find_domain_placeholder')}
              className='flex shrink-0 items-center justify-center rounded-l-none rounded-r-md bg-intents-ux-boxHighContrast-backgroundColor px-2 text-intents-ux-boxHighContrast-foregroundColor hover:cursor-pointer'
            >
              <SearchIcon className='size-2' />
            </button>
          </div>
        )}

        <div className='mt-1 flex flex-col gap-0'>
          {hasMoreDomains ? (
            <button
              type='button'
              onClick={onSeeAllDomains}
              data-eid={generateClickEID('develop.publish.see_all_domains')}
              data-testid='publish-see-all-domains'
              className='py-1 text-left hover:cursor-pointer'
            >
              <text.span size={-1} className='text-intents-ux-box-foregroundColor underline'>
                {t('builder_publish_see_all_domains')}
              </text.span>
            </button>
          ) : null}

          <button
            type='button'
            onClick={onUseExternalDomain}
            data-eid={generateClickEID('develop.publish.use_external_domain')}
            data-testid='publish-use-external-domain'
            className='py-1 text-left hover:cursor-pointer'
          >
            <text.span size={-1} className='text-intents-ux-box-foregroundColor underline'>
              {t('builder_publish_use_external_domain')}
            </text.span>
          </button>
        </div>
      </div>

      {freeProjectUrl ? (
        <div className='rounded-lg border border-intents-ux-boxLowContrast-borderColor p-2'>
          <text.strong size={-1} className='mb-1 block text-intents-ux-box-foregroundColor'>
            {t('builder_publish_free_project_url_title')}
          </text.strong>
          <div role='radiogroup' aria-label={t('builder_publish_free_project_url_title')}>
            <DomainRadioRow
              testId='publish-free-url-item'
              label={freeProjectUrl}
              selected={selectedFqdn === freeProjectUrl}
              tabIndex={0}
              onSelect={() => onSelect(freeProjectUrl)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
