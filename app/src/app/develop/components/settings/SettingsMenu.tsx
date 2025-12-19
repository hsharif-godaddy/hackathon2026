'use client';

import clsx from 'clsx';
import { useState } from 'react';
import Button from '@ux/button';
import SettingsIcon from '@ux/icon/settings';

import { useSettingsNavItems } from '@/app/develop/components/settings/useSettingsNavItems';
import { SettingsSection } from '@/app/develop/components/types';
import { useTranslations } from '@/hooks/useTranslations';
import { useChatTabs } from '@/hooks/useChatTabs';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/lib/shadcn/popover";
import { generateClickEID } from '@/utils/instrumentation';

export default function SettingsMenu() {
  const t = useTranslations();

  const [open, setOpen] = useState(false);

  const { activeSettingsSection, setActiveSettingsSection } = useChatTabs();

  const handleNavigate = (id: SettingsSection) => {
    setActiveSettingsSection(id);
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
          aria-label={t('builder_settings_title')}
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
