'use client';

import { useMemo, useState } from 'react';
import CheckmarkIcon from '@ux/icon/checkmark';
import ChevronDownIcon from '@ux/icon/chevron-down';
import SearchIcon from '@ux/icon/search';
import Spinner from '@ux/spinner';
import text from '@ux/text';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/lib/shadcn/popover';

interface DropdownSelectProps<T extends { key: string; label: string }> {
  items: T[];
  selected: string;
  onSelect: (key: string) => void;
  placeholder: string;
  isLoading?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  label: string;
  hideLabel?: boolean;
}

export default function DropdownSelect<T extends { key: string; label: string }>({
  items,
  selected,
  onSelect,
  placeholder,
  isLoading,
  disabled,
  searchable,
  label,
  hideLabel,
}: DropdownSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selectedItem = items.find((i) => i.key === selected);

  const filtered = useMemo(function filter() {
    if (!search) return items;
    const lower = search.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(lower));
  }, [items, search]);

  return (
    <div>
      {!hideLabel && <text.p className="text-sm font-medium mb-0.5">{label}</text.p>}
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(''); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isLoading || disabled}
            className="flex w-full items-center justify-between rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2 py-1.5 text-sm hover:border-intents-ux-box-borderColor-hover disabled:opacity-50"
          >
            <span className="truncate">
              {isLoading ? <Spinner size="sm" /> : (selectedItem?.label ?? placeholder)}
            </span>
            <ChevronDownIcon className="size-2 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {searchable && (
            <div className="flex items-center gap-1 border-b px-2 py-1">
              <SearchIcon className="size-2 opacity-50" />
              <input
                type="text"
                className="flex-1 bg-transparent text-sm outline-none placeholder:opacity-50"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          )}
          <div className="max-h-[240px] overflow-y-auto p-0.5">
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-center text-sm opacity-50">No results</div>
            )}
            {filtered.map((item) => (
              <button
                key={item.key}
                type="button"
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-sm hover:bg-intents-ux-box-backgroundColor-hover"
                onClick={() => { onSelect(item.key); setOpen(false); setSearch(''); }}
              >
                <span className="size-2 shrink-0">
                  {item.key === selected && <CheckmarkIcon className="size-2" />}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
