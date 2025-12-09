'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useAppIdFromParams } from '@/app/develop/components/utils';
import { SettingsSection } from '@/app/develop/components/types';
import { useSettingsNavItems } from '@/app/develop/components/settings/useSettingsNavItems';
import { generateClickEID } from '@/utils/instrumentation';
import clsx from 'clsx';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/lib/shadcn/popover";
import Button from '@ux/button';
import SettingsIcon from '@ux/icon/settings';

export default function SettingsMenu() {
  const router = useRouter();
  const appId = useAppIdFromParams();
  const [open, setOpen] = useState(false);

  const activeSettingsSection = useDevelopPageStore((state) => state.activeSettingsSection);
  const setActiveSettingsSection = useDevelopPageStore((state) => state.setActiveSettingsSection);

  const handleNavigate = (id: SettingsSection) => {
    setActiveSettingsSection(id);
    router.push(`/develop/${appId}?tab=settings&settings=${id}`, { scroll: false });
    setOpen(false);
  };

  const items = useSettingsNavItems();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={clsx(
            "flex gap-0 items-center relative border rounded-xl px-1 py-0.5 leading-none transition-opacity duration-700 ml-auto",
            {
              "bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor shadow-md border-intents-ux-boxHighContrast-borderColor": open,
              "hover:cursor-pointer": true,
            }
          )}
          data-eid={generateClickEID('develop.chat_toolbar.settings')}
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[220px] p-1">
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <Button
              key={item.id}
              design="option"
              size="sm"
              active={activeSettingsSection === item.id}
              icon={item.icon}
              text={item.label}
              disabled={item.disabled}
              className="!justify-start"
              onClick={() => {
                if (item.onClick) {
                  item.onClick();
                  setOpen(false);
                } else {
                  handleNavigate(item.id);
                }
              }}
              data-eid={generateClickEID(`develop.settings.menu.${item.id}`)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
