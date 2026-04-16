'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import Button from '@ux/button';
import MenuIcon from '@ux/icon/menu';

import { ButtonGroup } from '@/app/develop/components/ButtonGroup';
import { useSettingsNavItems } from '@/app/develop/components/settings/useSettingsNavItems';
import { ChatTab, SettingsSection } from '@/app/develop/components/types';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useTranslations } from '@/hooks/useTranslations';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/lib/shadcn/popover';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { generateClickEID } from '@/utils/instrumentation';

export interface SettingsMenuRef {
  openPopover: () => void;
  closePopover: () => void;
  togglePopover: () => void;
  isOpen: () => boolean;
}

const SettingsMenu = forwardRef<SettingsMenuRef>((props, ref) => {
  const t = useTranslations();

  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const isMobile = useDevelopPageStore((state) => state.isMobile)

  const { activeChatTab, activeSettingsSection, setActiveSettingsSection, setActiveChatTab } = useChatTabs();

  useImperativeHandle(ref, () => ({
    openPopover: () => setOpen(true),
    closePopover: () => setOpen(false),
    togglePopover: () => setOpen(prev => !prev),
    isOpen: () => open,
  }));

  const handleNavigate = (id: SettingsSection) => {
    setActiveSettingsSection(id);
    setActiveChatTab(ChatTab.SETTINGS);
    setOpen(false);
  };

  const isOnSettingsTab = activeChatTab === ChatTab.SETTINGS;

  const items = useSettingsNavItems(open || isOnSettingsTab);

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <ButtonGroup.Item
          ref={anchorRef}
          value={ChatTab.SETTINGS}
          icon={<MenuIcon className="size-2.5" />}
          onClick={() => setOpen(prev => !prev)}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-eid={generateClickEID('develop.chat_toolbar.settings')}
        />
      </PopoverAnchor>
      <PopoverContent
        align={isMobile ? "center" : "end"}
        className="p-1"
        onInteractOutside={(e) => {
          // Anchor clicks are toggled externally via the ButtonGroup onChange → togglePopover ref; suppress Radix dismiss
          if (anchorRef.current?.contains(e.target as Node)) {
            e.preventDefault();
            return;
          }
          // Non-anchor outside clicks close the popover
          setOpen(false);
        }}
        onEscapeKeyDown={() => setOpen(false)}
      >
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
                if (item.needsAuth) {
                  useAuthUIStore.getState().setNeedsReauth('session_expired');
                  setOpen(false);
                } else if (item.onClick) {
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
