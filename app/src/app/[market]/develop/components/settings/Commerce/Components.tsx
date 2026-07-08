'use client';

import type { ReactNode } from 'react';
import Card from '@ux/card';
import ArrowRightIcon from '@ux/icon/arrow-right';
import AsyncIcon from '@ux/icon/async-icon.js';
import PageIcon from '@ux/icon/page';
import WindowNewIcon from '@ux/icon/window-new';
import Spinner from '@ux/spinner';
import Tag from '@ux/tag';
import text from '@ux/text';
import TextLockup from '@ux/text-lockup';

import type { SettingsItem, StatusBadge } from './Types';

function DescriptorIcon({ icon }: { icon: SettingsItem['icon'] }) {
  switch (icon.library) {
    case 'ux':
      return <AsyncIcon icon={icon.name} />;
    // TODO: need to add support for other icon libraries
    default:
      return <PageIcon />;
  }
}

function StatusTag({ status }: { status?: StatusBadge }) {
  if (!status?.label) return null;
  return (
    <Tag emphasis={status.emphasis} size="sm" className="w-fit">
      {status.label}
    </Tag>
  );
}

export function LoadingSpinner() {
  return (
    <div className="flex justify-center">
      <Spinner />
    </div>
  );
}

export function NoticePlaceholder({
  label,
  title,
  description,
}: {
  label: string;
  title: string;
  description?: string;
}) {
  return (
    <div
      aria-label={label}
      className="flex min-h-[240px] items-center justify-center rounded-md border border-dashed border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor px-2 py-2 text-center"
    >
      <div className="max-w-[32rem]">
        <text.p size={-1} className="font-medium">
          {title}
        </text.p>
        {description && (
          <text.p emphasis="passive" size={-1} className="mt-0.5">
            {description}
          </text.p>
        )}
      </div>
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  trailing,
}: {
  title: string;
  description?: string;
  trailing?: ReactNode;
}) {
  return (
    <TextLockup title={title}>
      <div className="flex items-start justify-between gap-2">
        {description}
        {trailing}
      </div>
    </TextLockup>
  );
}

export function ItemRow({
  item,
  onSelect,
}: {
  item: SettingsItem;
  onSelect: (item: SettingsItem) => void;
}) {
  const isExternal = item.renderer === 'external-link';

  return (
    <Card as="button" onClick={() => onSelect(item)} className="overflow-visible!">
      <div className="flex flex-col gap-1">
        <div className="flex justify-between">
          <TextLockup size="sm" title={item.title} icon={<DescriptorIcon icon={item.icon} />}>
            {item.description}
          </TextLockup>
          {isExternal ? <WindowNewIcon /> : <ArrowRightIcon />}
        </div>
        <StatusTag status={item.status} />
      </div>
    </Card>
  );
}

export const CommerceHomeLinkCard = ({ icon, title, content, to }) => {
  return (
    <Card
      as="button"
      onClick={() => {
        window.open(to, '_blank');
      }}
    >
      <div className="flex justify-between">
        <TextLockup icon={icon} title={title} size="sm">
          {content}
        </TextLockup>
        <WindowNewIcon />
      </div>
    </Card>
  );
};

export function DebugState({ state }: { state: Record<string, unknown> }) {
  return (
    <details className="rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-1.5 py-1">
      <summary className="cursor-pointer">
        <text.span emphasis="passive" size={-1} className="font-medium">
          Prototype state
        </text.span>
      </summary>
      <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-intents-ux-boxLowContrast-backgroundColor p-1.5 text-xs leading-tight">
        {JSON.stringify(state, null, 2)}
      </pre>
    </details>
  );
}
