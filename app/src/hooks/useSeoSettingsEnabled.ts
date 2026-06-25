import { useSwitchboard } from '@/hooks/useSwitchboard';
import { isProductionAppHost } from '@/lib/environment/is-production-app-host';

/** SEO settings + GSC: always on outside prod; prod requires `appbuilder-settings-seo`. */
export function useSeoSettingsEnabled(): boolean | undefined {
  const flag = useSwitchboard('appbuilder-settings-seo');
  if (!isProductionAppHost()) {
    return true;
  }
  return flag;
}
