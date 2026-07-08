export const AIRO_CONTROLS_WHATS_NEW_ATTRIBUTE_KEY: string = 'aab-whats-new-airo-controls';

export type WhatsNewModalDevice = 'desktop' | 'mobile';
export type WhatsNewModalAction = 'viewed' | 'completed';

export interface WhatsNewModalDeviceState {
  viewCount: number;
  lastViewedAt?: string;
  completedAt?: string;
}

export interface WhatsNewModalState {
  desktop: WhatsNewModalDeviceState;
  mobile: WhatsNewModalDeviceState;
}

const DEFAULT_DEVICE_STATE: WhatsNewModalDeviceState = { viewCount: 0 };
const MAX_VIEWS_BEFORE_COMPLETION: number = 2;

function normalizeDeviceState(value: unknown): WhatsNewModalDeviceState {
  if (!value || typeof value !== 'object') return { ...DEFAULT_DEVICE_STATE };

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const viewCount: number =
    typeof raw.viewCount === 'number' && raw.viewCount > 0
      ? Math.min(raw.viewCount, MAX_VIEWS_BEFORE_COMPLETION)
      : 0;

  return {
    viewCount,
    ...(typeof raw.lastViewedAt === 'string' ? { lastViewedAt: raw.lastViewedAt } : {}),
    ...(typeof raw.completedAt === 'string' ? { completedAt: raw.completedAt } : {}),
  };
}

export function normalizeWhatsNewModalState(value: unknown): WhatsNewModalState {
  const raw: Record<string, unknown> =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  return {
    desktop: normalizeDeviceState(raw.desktop),
    mobile: normalizeDeviceState(raw.mobile),
  };
}

export function shouldShowWhatsNewModal(
  state: WhatsNewModalState,
  device: WhatsNewModalDevice
): boolean {
  const deviceState: WhatsNewModalDeviceState = state[device];
  return !deviceState.completedAt && deviceState.viewCount < MAX_VIEWS_BEFORE_COMPLETION;
}

export function applyWhatsNewModalAction(
  state: WhatsNewModalState,
  device: WhatsNewModalDevice,
  action: WhatsNewModalAction,
  timestamp: string
): WhatsNewModalState {
  const current: WhatsNewModalDeviceState = state[device];
  const nextDeviceState: WhatsNewModalDeviceState =
    action === 'completed'
      ? { ...current, completedAt: current.completedAt ?? timestamp }
      : {
          ...current,
          viewCount: Math.min(current.viewCount + 1, MAX_VIEWS_BEFORE_COMPLETION),
          lastViewedAt: timestamp,
        };

  return {
    ...state,
    [device]: nextDeviceState,
  };
}
