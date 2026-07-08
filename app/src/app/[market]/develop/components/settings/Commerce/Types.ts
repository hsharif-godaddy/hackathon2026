export type CommercePanelTab = 'dashboard' | 'settings';

export type Renderer =
  | 'settings-group-v1'
  | 'settings-form-v1'
  | 'settings-workflow-v1'
  | 'custom-native-route'
  | 'external-link';

export type Source = 'commerce' | 'gpa' | 'external';

export type Capability = 'read' | 'write' | 'validate' | 'test' | 'delete' | 'external-open';

export type StatusEmphasis = 'success' | 'info' | 'critical' | 'warning' | 'passive';

export type StatusBadge = {
  state:
    | 'configured'
    | 'configuration-required'
    | 'active'
    | 'inactive'
    | 'invalid'
    | 'disabled'
    | 'pending'
    | 'requires-action';
  label: string;
  emphasis: StatusEmphasis;
};

export type SettingsItem = {
  id: string;
  slug: string;
  source: Source;
  renderer: Renderer;
  title: string;
  description: string;
  icon: { name: string; library: string };
  path?: string;
  href?: string;
  order: number;
  status?: StatusBadge;
  capabilities: Capability[];
  appId?: string;
  appSettingSlug?: string;
};

export type SurfaceSection = {
  id: string;
  title: string;
  description: string;
  order: number;
  items: SettingsItem[];
};

export type ApiStatusBadge = {
  state?: StatusBadge['state'];
  label?: string;
  labelKey?: string;
  emphasis?: StatusEmphasis;
  tone?: 'neutral' | 'success' | 'warning' | 'critical' | 'info';
};

export type ApiIcon = {
  name?: string;
  library?: string;
};

export type ApiSettingsItem = {
  id?: string;
  slug?: string;
  source?: Source;
  renderer?: Renderer;
  title?: string;
  titleKey?: string;
  description?: string;
  descriptionKey?: string;
  icon?: ApiIcon;
  route?: string;
  path?: string;
  href?: string;
  order?: number;
  status?: ApiStatusBadge;
  capabilities?: Capability[];
  appId?: string;
  appSettingSlug?: string;
};

export type ApiSettingsSurface = {
  storeId?: string;
  revision?: string;
  sections?: Array<{
    id?: string;
    title?: string;
    titleKey?: string;
    description?: string;
    descriptionKey?: string;
    order?: number;
    items?: ApiSettingsItem[];
  }>;
};
