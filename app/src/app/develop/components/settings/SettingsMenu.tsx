'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';
import Button from '@ux/button';
import SettingsIcon from '@ux/icon/settings';

import { ButtonGroup } from '@/app/develop/components/ButtonGroup';
import { useSettingsNavItems } from '@/app/develop/components/settings/useSettingsNavItems';
import { ChatTab, SettingsSection } from '@/app/develop/components/types';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useTranslations } from '@/hooks/useTranslations';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/lib/shadcn/popover";
import { generateClickEID } from '@/utils/instrumentation';

export interface SettingsMenuRef {
  openPopover: () => void;
}

const SettingsMenu = forwardRef<SettingsMenuRef>((props, ref) => {
  const t = useTranslations();

  const [open, setOpen] = useState(false);

  const { activeChatTab, activeSettingsSection, setActiveSettingsSection, setActiveChatTab } = useChatTabs();

  useImperativeHandle(ref, () => ({
    openPopover: () => setOpen(true),
  }));

  const handleNavigate = (id: SettingsSection) => {
    setActiveSettingsSection(id);
    setActiveChatTab(ChatTab.SETTINGS);
    setOpen(false);
  };

  // Only show an item as active when we're actually on the Settings tab
  const isOnSettingsTab = activeChatTab === ChatTab.SETTINGS;

  // Fetch settings nav items when menu is open or we're on Settings tab
  const items = useSettingsNavItems(open || isOnSettingsTab);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor>
        <ButtonGroup.Item
          value={ChatTab.SETTINGS}
          icon={<SettingsIcon className="size-2.5" />}
          label={t('builder_settings_title')}
          onClick={() => setOpen(!open)}
          data-eid={generateClickEID('develop.chat_toolbar.settings')}
        />
      </PopoverAnchor>
      <PopoverContent align="end" className="p-1">
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <Button
              key={item.id}
              design="option"
              size="sm"
              active={isOnSettingsTab && activeSettingsSection === item.id}
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
              data-eid={generateClickEID(`develop.settings_menu.${item.id}`)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});

SettingsMenu.displayName = 'SettingsMenu';

export default SettingsMenu;
