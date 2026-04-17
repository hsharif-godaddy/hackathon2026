import { logger } from '@/lib/request-context';

declare global {
  interface Window {
    _expDataLayer: any[];
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

const WINDOW_INSTRUMENTATION_APP_ID = '__airoInstrumentationAppId';

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

function normalizedAppId(value: string | null | undefined): string | undefined {
  if (value == null || value === '') {
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

/**
 * Merges custom properties with appId if available
 * @param {Record<string, boolean | string | number>} customProperties - Original custom properties
 * @returns {Record<string, boolean | string | number>} Merged custom properties with appId if applicable
 */
const mergeCustomPropertiesWithAppId = (customProperties?: Record<string, boolean | string | number>): Record<string, boolean | string | number> => {
  const raw = customProperties ?? {};
  const { appId: callerAppIdCandidate, ...rest } = raw;
  const callerAppId =
    typeof callerAppIdCandidate === 'string' && callerAppIdCandidate.length > 0 ? callerAppIdCandidate : undefined;
  const baseProperties = rest as Record<string, boolean | string | number>;

  const moduleAppId = normalizedAppId(readGlobalInstrumentationAppId());

  if (moduleAppId && callerAppId && moduleAppId !== callerAppId) {
    logger.warn('instrumentation.mergeCustomProperties.conflict', {
      message: 'appId in customProperties differs from currentAppId; using currentAppId',
      callerAppId,
      currentAppId: moduleAppId,
    });
  }

  const effectiveAppId = moduleAppId ?? callerAppId;
  if (!effectiveAppId) {
    return baseProperties;
  }

  return {
    ...baseProperties,
    appId: effectiveAppId,
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
  action?: 'blur' | 'drag' | 'focus' | 'hover' | 'load' | 'scroll' | 'custom';
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
    custom_properties?: Record<string, boolean | string | number>;
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
    const mergedProperties = mergeCustomPropertiesWithAppId(customProperties);
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
    const mergedProperties = mergeCustomPropertiesWithAppId(customProperties);

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
        custom_properties: mergedProperties,
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
    const mergedProperties = mergeCustomPropertiesWithAppId(customProperties);
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
