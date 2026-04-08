'use client';

import { useEffect } from 'react';
import Box from '@ux/box';

import RemoteModulePage from '@/app/components/RemoteModulePage';
import { useAppIdFromParams } from '@/app/develop/components/utils';
import { clearLocalOverride, setLocalOverride } from '@/utils/moduleFederation';

/**
 * Backups panel for settings
 *
 * Loads and renders the remote backups UI component from the @partners/backups-ui
 * module federation package. Configures the component with necessary props including
 * account ID, product type, and upgrade modal handler.
 *
 * In development, uses a local module federation setup instead of fetching from the BFF API.
 *
 * @returns Rendered backups panel with remote component
 */
export default function BackupsPanel() {
  const accountId = useAppIdFromParams();
  const moduleName = '@partners/backups-ui';
  const version = 1;
  const productType = 'aab';

  // Setup local override for the backups UI module
  // This is used to load the backups UI module from the local server during development
  useEffect(function setupLocalOverride() {
    if (process.env.LOCAL_BACKUPS_UI === 'true') {
      setLocalOverride(
        moduleName,
        'https://local.gasket.dev-godaddy.com:8081/backup-ui-lib.js',
        'BackupUiLib',
        './Backup'
      );
    } else {
      clearLocalOverride(moduleName);
    }
  }, [moduleName]);

  const componentProps = {
    accountId,
    productType
  };

  return (
    <Box className="h-full bg-intents-ux-box-backgroundColor rounded-lg overflow-y-auto">
      <div className="max-w-[1200px] p-3">
        <RemoteModulePage
          moduleName={moduleName}
          version={version}
          componentProps={componentProps}
        />
      </div>
    </Box>
  );
}
