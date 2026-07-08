import type {
  ApiIcon,
  ApiSettingsItem,
  ApiSettingsSurface,
  ApiStatusBadge,
  SettingsItem,
  StatusBadge,
  StatusEmphasis,
  SurfaceSection,
} from './Types';

const commerceSettingsPrototypeTranslations: Record<string, string> = {
  LANDING_BUSINESS_PROFILE: 'Business Profile',
  LANDING_BUSINESS_PROFILE_DESC: 'Manage your business identity, users, and regional preferences.',
  LANDING_OWNER_CONTACT_INFO: 'Owner Contact Info',
  LANDING_OWNER_CONTACT_INFO_DESC: 'Edit your personal info and contact details.',
  LANDING_BUSINESS_INFO: 'Business Info',
  LANDING_BUSINESS_INFO_DESC: 'Edit your business address, email, and phone number.',
  LANDING_USERS_PERMISSIONS: 'Users & Permissions',
  LANDING_USERS_PERMISSIONS_DESC: 'Invite users and set roles and permissions.',
  LANDING_PAYMENTS_PROCESSING: 'Payment Processing',
  LANDING_PAYMENTS_PROCESSING_DESC:
    'Control how you get paid, manage fees, and set payment preferences.',
  LANDING_PAYMENT_PROFILE: 'Payment Profile',
  LANDING_PAYMENT_PROFILE_DESC: 'Manage your business and owner legal information.',
  LANDING_PAYOUTS: 'Payouts',
  LANDING_PAYOUTS_DESC: 'Manage payouts, bank account, and notifications.',
  LANDING_PRICING: 'Pricing',
  LANDING_PRICING_DESC: 'See your transaction fees and pricing.',
  LANDING_RATE_SAVER: 'Rate Saver',
  LANDING_RATE_SAVER_DESC: 'Manage credit card surcharge options.',
  LANDING_TIPS: 'Tips',
  LANDING_TIPS_DESC: 'Customize your tipping settings.',
  LANDING_TAX_CENTER: 'Tax Center',
  LANDING_TAX_CENTER_DESC: 'Manage your tax documents and info.',
  LANDING_RECEIPTS_STATEMENTS: 'Receipts & Statements',
  LANDING_RECEIPTS_STATEMENTS_DESC: 'Customize receipts and set up notifications.',
  LANDING_PAYMENT_METHODS: 'Payment Methods',
  LANDING_PAYMENT_METHODS_DESC: 'Choose which payment methods to accept.',
  LANDING_OFFLINE_PAYMENTS: 'Offline Payments',
  LANDING_OFFLINE_PAYMENTS_DESC: 'Allow offline payments when the terminal is offline.',
  LANDING_POYNT_COLLECT: 'Poynt Collect',
  LANDING_POYNT_COLLECT_DESC: 'Manage Poynt Collect settings.',
  LANDING_SALES_CHANNELS_CHECKOUT: 'Sales Channels & Checkout',
  LANDING_SALES_CHANNELS_CHECKOUT_DESC: 'Manage your sales channels and checkout experience.',
  LANDING_ONLINE_STORE: 'Online Store',
  LANDING_ONLINE_STORE_DESC: 'Manage abandoned carts, shipping, and more.',
  LANDING_DEVICE_SETTINGS: 'Device Settings',
  LANDING_DEVICE_SETTINGS_DESC: 'Manage your POS display and payment options.',
  SETTINGS_APPS: 'Apps',
  SETTINGS_APPS_DESC: 'Apps that add settings to this page.',
  SETTINGS_BUSINESS_INFO_SUBTITLE: 'Edit your business address, email, and phone number.',
  SETTINGS_OWNER_CONTACT_INFO_SUBTITLE: 'Edit your personal info and contact details.',
  SETTINGS_PAYMENT_PROFILE_SUBTITLE:
    'This info is used for underwriting and tax documents, so make sure everything is accurate.',
  SETTINGS_PAYOUTS_SUBTITLE: 'Manage payouts, bank account, and notifications.',
  SETTINGS_PRICING_SUBTITLE: 'See your transaction fees and pricing.',
  SETTINGS_RATE_SAVER_PAGE_SUBTITLE:
    'Reduce credit card processing fees and protect your margins with Rate Saver.',
  SETTINGS_TAX_CENTER_PAGE_SUBTITLE: 'Manage your company tax documents.',
  SETTINGS_RECEIPTS_STATEMENTS_SUBTITLE: "Manage your store's receipt info and notifications.",
  SETTINGS_PAYMENT_METHODS_SUBTITLE: 'View methods to accept payments from customers.',
  SETTINGS_STATUS_CONFIGURED: 'Configured',
  SETTINGS_STATUS_CONFIGURATION_REQUIRED: 'Configuration required',
  COMMON_SAVE: 'Save',
  COMMON_VALIDATE: 'Validate',
  COMMON_TEST_CONNECTION: 'Test connection',
  GPA_STRIPE_TITLE: 'Stripe Payments',
  GPA_STRIPE_DESCRIPTION: 'Configure Stripe payment processing',
  GPA_STRIPE_CONNECTION: 'Connection',
  GPA_STRIPE_API_KEY: 'Stripe API key',
};

function readableLabelFromKey(key: string) {
  const normalized = key
    .replace(/^(LANDING|SETTINGS|COMMON|GPA)_/, '')
    .replace(/_(DESC|SUBTITLE|TITLE)$/, '')
    .replace(/_PAGE$/, '');

  return normalized
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function textValue(value: string | undefined, key: string | undefined) {
  if (value) return value;
  if (!key) return '';

  return commerceSettingsPrototypeTranslations[key] ?? readableLabelFromKey(key);
}

function toneToEmphasis(tone?: ApiStatusBadge['tone']): StatusEmphasis {
  switch (tone) {
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'critical':
      return 'critical';
    case 'info':
      return 'info';
    default:
      return 'passive';
  }
}

export function normalizeStatus(input: ApiStatusBadge | undefined): StatusBadge | undefined {
  if (!input) return undefined;

  return {
    state: input.state ?? 'active',
    label: textValue(input.label, input.labelKey),
    emphasis: input.emphasis ?? toneToEmphasis(input.tone),
  };
}

function normalizeIcon(icon: ApiIcon | undefined): SettingsItem['icon'] {
  if (
    !icon ||
    !icon.name ||
    !icon.library ||
    icon.name?.toLowerCase() === '' ||
    icon.library.toLowerCase() === ''
  ) {
    return { name: 'page', library: 'ux' };
  }
  if (
    icon.name.includes('product') ||
    icon.name.includes('commerce') ||
    icon.name.includes('store')
  ) {
    return { name: 'products', library: 'ux' };
  }
  if (icon.name.includes('setting')) {
    return { name: 'settings', library: 'ux' };
  }
  return { library: icon.library, name: icon.name };
}

export function settingPathFromRoute(route: string | undefined): string | undefined {
  if (!route) return undefined;
  if (route === '/settings') return '';
  if (route.startsWith('/settings/')) return route.replace('/settings/', '');
  return route.replace(/^\/+/, '');
}

export function normalizeSettingPath(settingPath: string | undefined) {
  return settingPath?.replace(/^\/+|\/+$/g, '') ?? '';
}

export function normalizeItem(item: ApiSettingsItem): SettingsItem | undefined {
  const slug = item.slug ?? settingPathFromRoute(item.route) ?? item.path;
  const renderer = item.renderer;
  const source = item.source;

  if (!slug || !renderer || !source) return undefined;

  return {
    id: item.id ?? slug,
    slug,
    source,
    renderer,
    title: textValue(item.title, item.titleKey),
    description: textValue(item.description, item.descriptionKey),
    icon: normalizeIcon(item.icon),
    path: settingPathFromRoute(item.route) || item.path || slug,
    href: item.href,
    order: item.order ?? 0,
    status: normalizeStatus(item.status),
    capabilities: item.capabilities ?? [],
    appId: item.appId,
    appSettingSlug: item.appSettingSlug,
  };
}

export function normalizeSurfaceSections(
  surface: ApiSettingsSurface | null | undefined
): SurfaceSection[] {
  return (
    surface?.sections
      ?.map((section) => {
        const items =
          section.items
            ?.map(normalizeItem)
            .filter((item): item is SettingsItem => Boolean(item))
            .sort((a, b) => a.order - b.order) ?? [];

        if (items.length === 0) return undefined;

        return {
          id: section.id ?? textValue(section.title, section.titleKey),
          title: textValue(section.title, section.titleKey),
          description: textValue(section.description, section.descriptionKey),
          order: section.order ?? 0,
          items,
        };
      })
      .filter((section): section is SurfaceSection => Boolean(section))
      .sort((a, b) => a.order - b.order) ?? []
  );
}
