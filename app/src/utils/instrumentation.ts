import { logger } from '@/lib/request-context';

declare global {
  interface Window {
    _expDataLayer: any[];
    _signalsDataLayer?: unknown[];
  }
}

/**
 * Current appId for instrumentation events. Set once when entering the develop page.
 *
 * WARNING: This is module-level state that persists across components.
 * Only used in client-side React components on the develop page.
 * Server-side usage would be shared across requests (SSR footgun).
 *
 * On the client we also mirror the value on `window` so every copy of this module
 * (e.g. split chunks) reads the same appId when merging `custom_properties`.
 */
let currentAppId: string | null = null;
let currentEntryPoint: string | null = null;
let currentPlanType: string | null = null;
let currentCreationSource: string | null = null;
let currentIntentCategory: string | null = null;
let currentBusinessName: string | null = null;

const WINDOW_INSTRUMENTATION_APP_ID = '__airoInstrumentationAppId';

/** Job / control-plane UUIDs must never be sent as `appId` (same charset as URL-safe ids at some lengths). */
const UUID_IN_PATH_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** URL-safe nanoid-style ids (length may change server-side; bounds keep obvious junk out). */
const INSTRUMENTATION_APP_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function readGlobalInstrumentationAppId(): string | null {
  if (typeof window === 'undefined') {
    return currentAppId;
  }
  if (!Object.prototype.hasOwnProperty.call(window, WINDOW_INSTRUMENTATION_APP_ID)) {
    return currentAppId;
  }
  const v = (window as unknown as Record<string, unknown>)[WINDOW_INSTRUMENTATION_APP_ID];
  if (typeof v === 'string' && v.length > 0) {
    return v;
  }
  return null;
}

export function normalizedAppId(value: string | null | undefined): string | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  if (UUID_IN_PATH_SHAPE.test(value) || !INSTRUMENTATION_APP_ID_PATTERN.test(value)) {
    return undefined;
  }
  return value;
}

/**
 * Sets the current appId for instrumentation events.
 * Should be called once when entering the develop page.
 *
 * @param {string | null} appId - The appId to set, or null to clear
 */
export function getInstrumentationAppId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return normalizedAppId(readGlobalInstrumentationAppId());
}

export const setInstrumentationAppId = (appId: string | null): void => {
  if (typeof window === 'undefined') {
    logger.warn('instrumentation.setAppId.server-side', {
      message: 'setInstrumentationAppId called on server - this may cause cross-request state leakage',
      appId
    });
    return;
  }

  currentAppId = normalizedAppId(appId) ?? null;
  (window as unknown as Record<string, unknown>)[WINDOW_INSTRUMENTATION_APP_ID] = currentAppId;
};

// Sets the entry point merged into CSP events; pass null to clear on unmount.
export const setInstrumentationEntryPoint = (entryPoint: string | null): void => {
  if (typeof window === 'undefined') {
    logger.warn('instrumentation.setEntryPoint.server-side', {
      message: 'setInstrumentationEntryPoint called on server - this may cause cross-request state leakage',
      entryPoint,
    });
    return;
  }
  currentEntryPoint = entryPoint;
};

export function getInstrumentationEntryPoint(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return currentEntryPoint ?? undefined;
}

// Sets the plan_type merged into CSP events; pass null to clear on unmount.
export const setInstrumentationPlanType = (plan: string | null): void => {
  if (typeof window === 'undefined') {
    logger.warn('instrumentation.setPlanType.server-side', {
      message: 'setInstrumentationPlanType called on server - this may cause cross-request state leakage',
      plan,
    });
    return;
  }
  currentPlanType = plan;
};

export function getInstrumentationPlanType(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return currentPlanType ?? undefined;
}

// Sets the creation_source merged into CSP events; pass null to clear on unmount.
export const setInstrumentationCreationSource = (source: string | null): void => {
  if (typeof window === 'undefined') {
    logger.warn('instrumentation.setCreationSource.server-side', {
      message: 'setInstrumentationCreationSource called on server - this may cause cross-request state leakage',
      source,
    });
    return;
  }
  currentCreationSource = source;
};

export function getInstrumentationCreationSource(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return currentCreationSource ?? undefined;
}

// Sets intent_category: 'new_build' | 'rebuild' | 'edit'; overridden dynamically during the session. Pass null to clear on unmount.
export const setInstrumentationIntentCategory = (category: string | null): void => {
  if (typeof window === 'undefined') {
    logger.warn('instrumentation.setIntentCategory.server-side', {
      message: 'setInstrumentationIntentCategory called on server - this may cause cross-request state leakage',
      category,
    });
    return;
  }
  currentIntentCategory = category;
};

export function getInstrumentationIntentCategory(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return currentIntentCategory ?? undefined;
}

// Sets business_name merged into CSP events when setProjectName tool completes.
export const setInstrumentationBusinessName = (name: string | null): void => {
  if (typeof window === 'undefined') {
    logger.warn('instrumentation.setBusinessName.server-side', {
      message: 'setInstrumentationBusinessName called on server - this may cause cross-request state leakage',
      name,
    });
    return;
  }
  currentBusinessName = name;
};

export function getInstrumentationBusinessName(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return currentBusinessName ?? undefined;
}

/**
 * Returns the current session's instrumentation context fields as a flat object with
 * only the fields that have a value (no undefined entries).
 *
 * Used by both analytics channels (CSP via mergeContext, ES via mergeAnalyticsContext)
 * so new context fields only need to be added here — both channels pick them up automatically.
 *
 * Pass `callerIntentCategory` so per-event values are not overridden by the session-level
 * baseline (e.g. a 'rebuild' event must not have its intent_category replaced by 'edit').
 */
export function getSharedInstrumentationContext(callerIntentCategory?: unknown): Record<string, string> {
  const entryPoint = getInstrumentationEntryPoint();
  const planType = getInstrumentationPlanType();
  const creationSource = getInstrumentationCreationSource();
  const intentCategory = getInstrumentationIntentCategory();
  const businessName = getInstrumentationBusinessName();

  return {
    ...(entryPoint && { entry_point: entryPoint }),
    ...(planType && { plan_type: planType }),
    ...(creationSource && { creation_source: creationSource }),
    // Caller-provided intent_category wins — per-event values must not be overridden by session baseline
    ...(!callerIntentCategory && intentCategory && { intent_category: intentCategory }),
    ...(businessName && { business_name: businessName }),
  };
}

const splitAppIdContext = (
  customProperties?: Record<string, boolean | string | number>
): {
  baseProperties: Record<string, boolean | string | number>;
  effectiveAppId: string | null;
} => {
  const raw = customProperties ?? {};
  const { appId: callerAppIdCandidate, ...rest } = raw;
  const callerAppId = normalizedAppId(
    typeof callerAppIdCandidate === 'string' ? callerAppIdCandidate : undefined
  );
  const moduleAppId = getInstrumentationAppId();

  if (moduleAppId && callerAppId && moduleAppId !== callerAppId) {
    logger.warn('instrumentation.mergeCustomProperties.conflict', {
      message: 'appId in customProperties differs from currentAppId; using currentAppId',
      callerAppId,
      currentAppId: moduleAppId,
    });
  }

  return {
    baseProperties: rest as Record<string, boolean | string | number>,
    effectiveAppId: moduleAppId ?? callerAppId,
  };
};

const mergeCustomPropertiesWithAppId = (customProperties?: Record<string, boolean | string | number>): Record<string, boolean | string | number> => {
  const { baseProperties, effectiveAppId } = splitAppIdContext(customProperties);

  if (!effectiveAppId) {
    return baseProperties;
  }

  return {
    ...baseProperties,
    appId: effectiveAppId,
  };
};

const mergeContext = (customProperties?: Record<string, boolean | string | number>): Record<string, boolean | string | number> => {
  const { baseProperties, effectiveAppId } = splitAppIdContext(customProperties);
  const sessionId = typeof window !== 'undefined' ? (sessionStorage.getItem('log_session_id') ?? undefined) : undefined;
  const ctx = getSharedInstrumentationContext(baseProperties.intent_category);

  if (!effectiveAppId && !sessionId && !Object.keys(ctx).length) {
    return baseProperties;
  }

  return {
    ...baseProperties,
    ...(effectiveAppId && { appId: effectiveAppId }),
    ...(sessionId && { log_session_id: sessionId }),
    ...ctx,
  };
};

const getExpDataLayer = () => typeof window !== 'undefined' ? window._expDataLayer : [];

/**
 * The default AREA for all App Builder events.
 * @type {string}
 *
 * See : https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/92314181/Event+Naming+and+Formats
 */
const DEFAULT_AREA = 'appbuilder';

interface EventActionProps {
  eid: string;
  action?: 'blur' | 'disabled' | 'drag' | 'focus' | 'hover' | 'load' | 'scroll';
  customProperties?: Record<string, boolean | string | number>;
}

interface EventElementProps {
  area?: string;
  product?: string;
  section: string;
  widget: string;
  action?: EventActionProps['action'];
}

/** Pushed to `_expDataLayer`; the batched Signals shape (`global`, `events[].schemaId`, …) is built downstream by CSP, not here. */
interface ElementChannelEvent {
  schema: 'add_click' | 'add_element_action';
  data: {
    element: EventElementProps;
    traffic?: {
      eid: string;
      customProperties?: Record<string, boolean | string | number>;
    };
  };
  targets: string[];
}

interface EventImpressionData {
  schema: 'add_impression';
  targets: string[];
  version: 'v2';
  data: {
    eid: string;
    type: 'impression';
    custom_properties: Record<string, boolean | string | number>;
  };
}

export const parseEID = (eid: string) => {
  if (!eid) {
    logger.warn('instrumentation.parseEID.failure', { message: `parseEID is missing attributes : ${eid}` });
    return {product: '', section: '', widget: ''};
  }
  if ((eid.match(/\./g) || []).length !== 2) {
    logger.warn('instrumentation.parseEID.failure', { message: 'parseEID is invalid' });
    return {product: '', section: '', widget: ''};
  }
  const [product, section, widget] = eid.split('.');
  return {product, section, widget};
};

/**
 * Generates a click event ID.
 * @param {string} eid represent the event ID.
 * @returns {string} the click event ID.
 *
 * generateClickEID('something.foo.bar') -> 'appbuilder.something.foo.bar.click'
 */
export const generateClickEID = (eid: string) => {
  const { product, section, widget } = parseEID(eid);
  if (!product || !section || !widget) {
    logger.warn('instrumentation.generateClickEID.failure', { message: 'generateClickEID is missing attributes', product, section, widget });
    return '';
  }
  return `${DEFAULT_AREA}.${product}.${section}.${widget}.click`;
};

/**
 * Logs a click event to CSP.
 * @param eid - Event ID (e.g. 'app.something.copy').
 * @param customProperties - Optional key-value props to attach to the click event.
 * @returns Function that logs the click when called.
 *
 * https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3160867144/Click+Events
 *
 * logClickEvent('app.something.copy')(); -> logs 'appbuilder.app.something.copy.click'
 * logClickEvent('app.something.copy', { userId: '123' })(); -> logs with custom properties including appId if on develop page
 */
export const logClickEvent = (eid: string, customProperties?: Record<string, boolean | string | number>): () => void => () => {
  const { product, section, widget } = parseEID(eid);
  if (!product || !section || !widget) {
    logger.warn('instrumentation.logClickEvent.failure', { message: 'logClickEvent is missing attributes' });
    return;
  }
  try {
    const mergedProperties = mergeContext(customProperties);
    const fullClickEid = generateClickEID(eid);
    const eventData: ElementChannelEvent = {
      schema: 'add_click',
      data: {
        element: {
          area: DEFAULT_AREA,
          product,
          section,
          widget,
        },
        traffic: {
          eid: fullClickEid,
          customProperties: mergedProperties,
        },
      },
      targets: ['fullstory']
    }
    getExpDataLayer()?.push(eventData);
  } catch (e) {
    logger.error('instrumentation.logClickEvent.failure', { message: 'Failed to log click event information', error: e, section, widget });
  }
};

/**
 * Logs an action event to CSP.
 * @param params - Event parameters including eid, action, and optional customProperties.
 * @returns Function that logs the action when called.
 *
 * https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3174957262/Element+Action+Events
 *
 * logActionEvent({ eid: 'some.foo.bar', action: 'hover' })(); -> logs 'appbuilder.some.foo.bar.hover'
 * logActionEvent({ eid: 'some.foo.bar', action: 'hover', customProperties: { userId: '123' } })(); -> logs with custom properties including appId if on develop page
 */
export const logActionEvent = ({
  eid,
  action,
  customProperties
}: EventActionProps): () => void => () => {
  const { product, section, widget } = parseEID(eid);
  if (!product || !section || !widget || !action) {
    logger.warn('instrumentation.logActionEvent.failure', { message: 'logActionEvent is missing attributes' });
    return;
  }
  try {
    const mergedProperties = mergeContext(customProperties);
    const fullEid = `${DEFAULT_AREA}.${product}.${section}.${widget}.${action}`;

    const eventData: ElementChannelEvent = {
      schema: 'add_element_action',
      data: {
        element: {
          area: DEFAULT_AREA,
          product,
          section,
          widget,
          action,
        },
        traffic: {
          eid: fullEid,
          customProperties: mergedProperties,
        },
      },
      targets: ['fullstory']
    }
    getExpDataLayer()?.push(eventData);
  } catch (e) {
    logger.error('instrumentation.logActionEvent.failure', { message: 'Failed to log action event information', error: e, section, widget });
  }
};

/**
 * Logs an impression event to CSP.
 * @param eid - Event ID (e.g. 'chat.budgetExceeded.view').
 * @param customProperties - Optional key-value props to attach to the impression (e.g. hasPublishedApp, hasCustomDomain). AppId will be automatically added if on develop page.
 * @returns Function that logs the impression when called.
 *
 * https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3169656862/Impression+Events
 *
 * logImpressionEvent('foo.page.view')(); -> logs 'appbuilder.foo.page.view.impression' with appId if on develop page
 * logImpressionEvent('chat.budgetExceeded.view', { hasPublishedApp: true, hasCustomDomain: false })(); -> logs with custom properties and appId if on develop page
 */
export const logImpressionEvent = (eid: string, customProperties?: Record<string, boolean | string | number>): (() => void) => () => {
  const { product, section, widget } = parseEID(eid);
  if (!product || !section || !widget) {
    logger.warn('instrumentation.logImpressionEvent.failure', { message: 'logImpressionEvent is missing attributes' });
    return;
  }
  try {
    const fullEid = `${DEFAULT_AREA}.${product}.${section}.${widget}.impression`;
    const mergedProperties = mergeContext(customProperties);
    const eventData: EventImpressionData = {
      schema: 'add_impression',
      targets: ['fullstory'],
      version: 'v2',
      data: {
        eid: fullEid,
        type: 'impression',
        custom_properties: mergedProperties
      }
    };
    getExpDataLayer()?.push(eventData);
  } catch (e) {
    logger.error('instrumentation.logImpressionEvent.failure', { message: 'Failed to log impression event information', error: e, section, widget });
  }
};

/**
 * Logs an Airo HQ event to CSP.
 * @param params - Event parameters including category, agent info, and optional custom properties.
 * @returns Function that logs the Airo HQ event when called.
 *
 * logAiroHQEvent({ category: 'click', recommendation_task: 'builder_develop_prompt_submit', recommendation_type: 'user_prompt' })();
 */
export const logAiroHQEvent = ({
  ai_agent_id = 'app-builder',
  agent_conversation_id,
  category,
  recommendation_task,
  recommendation_type,
  recommendation_id,
  ventureID,
  completedTask = false,
}: {
  ai_agent_id?: string,
  category: 'click' | 'impression',
  recommendation_id?: string,
  recommendation_task?: string,
  recommendation_type?: string,
  ventureID?: string,
  agent_conversation_id?: string
  completedTask?: boolean,
}): () => void => () => {
  try {
    const eventSchema = {
      impression: 'add_impression',
      click: 'add_event',
    }
    const customProperties = {
      ai_agent_id,
      agent_conversation_id,
      recommendation_id,
      recommendation_task,
      recommendation_type,
      ventureID
    }
    const mergedProperties = mergeCustomPropertiesWithAppId(customProperties);

    const eventData = {
      schema: eventSchema[category],
      targets: ['fullstory'],
      version: 'v2',
      data: {
        eid: `airohq.agent.${completedTask ? 'page_completed' : 'page'}.component.${category}`,
        type: category,
        custom_properties: mergedProperties
      }
    }
    getExpDataLayer()?.push(eventData);
  } catch (e) {
    const customProperties = {
      ai_agent_id,
      agent_conversation_id,
      recommendation_id,
      recommendation_task,
      recommendation_type,
      ventureID
    }
    const mergedProperties = mergeCustomPropertiesWithAppId(customProperties);

    logger.error('instrumentation.logAiroHQEvent.failure', {
      error: e,
      message: 'Failed to log Airo HQ event information',
      category,
      custom_properties: mergedProperties
    });
  }
};

interface SignalsConversionEvent {
  schema: 'add_generic_conversion';
  version: 'v1';
  data: {
    area: string;
    product: string;
    revenue: string;
    action: string;
    properties: Record<string, string>;
  };
}

interface ConversionEventParams {
  orderId?: string;
}

// GoDaddy Signals pipeline (_signalsDataLayer) -- separate from _expDataLayer
export const fireConversionEvent = ({ orderId }: ConversionEventParams = {}): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (!window._signalsDataLayer) {
      window._signalsDataLayer = [];
    }

    const eventData: SignalsConversionEvent = {
      schema: 'add_generic_conversion',
      version: 'v1',
      data: {
        area: 'airo-builder',
        product: 'airo-builder-freemium',
        revenue: 'freetrial',
        action: 'signup',
        properties: orderId ? { virtual_order_id: orderId } : {},
      },
    };

    window._signalsDataLayer.push(eventData);
  } catch (e) {
    logger.error('instrumentation.fireConversionEvent.failure', { error: e instanceof Error ? e.message : String(e), orderId });
  }
};
