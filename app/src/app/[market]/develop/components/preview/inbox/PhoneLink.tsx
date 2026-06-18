'use client';
import Growl from '@ux/growl';
import CopyIcon from '@ux/icon/copy';
import { Menu, MenuButton, MenuItem, MenuList } from '@ux/menu';

import { useTranslations } from '@/hooks/useTranslations';
import { tryFormatAsUSPhone } from '@/lib/inbox/format/phone';
import { PhoneString } from '@/types/inbox/local/core';

interface PhoneLinkProps {
  phone: PhoneString
}

export function PhoneLink({ phone }: PhoneLinkProps) {
  const t = useTranslations();
  const displayText = tryFormatAsUSPhone(phone);

  const handleCopyAction = async () => {
    try {
      await navigator.clipboard.writeText(displayText);
      Growl.addGrowlMessage({
        id: 'phone-number-copy',
        title: t('builder_common_copied'),
        emphasis: 'success',
        lifetime: 2000
      });
    } catch { /* no-op */ }
  };

  return (
    <Menu id={ `phone-link-menu-${phone.replace(/[^a-zA-Z0-9_-]/g, '_')}` } closeOnSelect>
      <MenuButton
        as='span'
        role='button'
        tabIndex={ 0 }
        className='phone-link font-bold underline cursor-pointer'
      >
        {displayText}
      </MenuButton>
      <MenuList placement='top-end' flip>
        <MenuItem onSelect={ handleCopyAction }>
          <span className='d-flex align-items-center'>
            <span style={{ marginRight: '0.75rem', display: 'inline-flex', alignItems: 'center' }}>
              <CopyIcon width={ 16 } height={ 16 } />
            </span>
            {t('builder_inbox_phone_copy', undefined, 'Copy Number')}
          </span>
        </MenuItem>
      </MenuList>
    </Menu>
  );
}
