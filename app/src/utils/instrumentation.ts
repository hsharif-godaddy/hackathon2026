/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { logger } from '@/lib/request-context';

declare global {
  interface Window {
    _expDataLayer: any[];
  }
}

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
  action?: 'blur' | 'drag' | 'focus' | 'hover' | 'load' | 'scroll';
}

interface EventElementProps {
  area?: string;
  product?: string;
  section: string;
  widget: string;
}

interface EventElementData {
  schema: 'add_click' | 'add_element_action';
  data: {
    element: EventElementProps;
  };
  targets: string[];
}

interface EventImpressionsData {
  schema: 'add_impressions';
  data: {
    impressions: {
      element: EventElementProps;
    }[];
  };
  targets: string[];
}

export const parseEID = (eid: string) => {
  if (!eid) {
    logger.error('instrumentation.parseEID.failure', { message: `parseEID is missing attributes : ${eid}` });
    return {product: '', section: '', widget: ''};
  }
  if ((eid.match(/\./g) || []).length !== 2) {
    logger.error('instrumentation.parseEID.failure', { message: 'parseEID is invalid' });
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
    logger.error('instrumentation.generateClickEID.failure', { message: 'generateClickEID is missing attributes', product, section, widget });
    return '';
  }
  return `${DEFAULT_AREA}.${product}.${section}.${widget}.click`;
};

/**
 * Logs a click event to CSP.
 * @param {EventProps} represent the event to track.
 * @returns {function} a function that logs the click event.
 *
 * https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3160867144/Click+Events
 *
 * logClickEvent('app.something.copy')(); -> logs 'appbuilder.app.something.copy.click'
 */
export const logClickEvent = (eid: string): () => void => () => {
  const { product, section, widget } = parseEID(eid);
  if (!product || !section || !widget) {
    logger.error('instrumentation.logClickEvent.failure', { message: 'logClickEvent is missing attributes' });
    return;
  }
  try {
    const eventData: EventElementData = {
      schema: 'add_click',
      data: {
        element: {
          area: DEFAULT_AREA,
          product,
          section,
          widget
        }
      },
      targets: ['fullstory']
    }
    getExpDataLayer()?.push(eventData);
  } catch (_e) {
    logger.error('instrumentation.logClickEvent.failure', { message: 'Failed to log click event information', section, widget });
  }
};

/**
 * Logs an action event to CSP.
 * @param {EventActionProps} represent the event to track.
 * @returns {function} a function that logs the action event.
 *
 * https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3174957262/Element+Action+Events
 *
 * logActionEvent({ eid: 'some.foo.bar', action: 'hover' })(); -> logs 'appbuilder.some.foo.bar.hover'
 */
export const logActionEvent = ({
  eid,
  action
}: EventActionProps): () => void => () => {
  const { product, section, widget } = parseEID(eid);
  if (!product || !section || !widget || !action) {
    logger.error('instrumentation.logActionEvent.failure', { message: 'logActionEvent is missing attributes' });
    return;
  }
  try {
    const eventData: EventElementData = {
      schema: 'add_element_action',
      data: {
        element: {
          area: DEFAULT_AREA,
          product,
          section,
          widget
        }
      },
      targets: ['fullstory']
    }
    getExpDataLayer()?.push(eventData);
  } catch (_e) {
    logger.error('instrumentation.logActionEvent.failure', { message: 'Failed to log action event information', section, widget });
  }
};

/**
 * Logs an impression event to CSP.
 * @param {EventProps} represent the event to track.
 * @returns {function} a function that logs the click event.
 *
 * https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3169656862/Impression+Events
 *
 * logImpressionEvent('foo.page.view')(); -> logs 'appbuilder.foo.page.view.impression'
 */
export const logImpressionEvent = (eid: string): () => void => () => {
  const { product, section, widget } = parseEID(eid);
  if (!product || !section || !widget) {
    logger.error('instrumentation.logImpressionEvent.failure', { message: 'logImpressionEvent is missing attributes' });
    return;
  }
  try {
    const eventData: EventImpressionsData = {
      schema: 'add_impressions',
      data: {
        impressions: [{
          element: {
            area: DEFAULT_AREA,
            product,
            section,
            widget
          }
        }]
      },
      targets: ['fullstory']
    }
    getExpDataLayer()?.push(eventData);
  } catch (_e) {
    logger.error('instrumentation.logImpressionEvent.failure', { message: 'Failed to log impression event information', section, widget });
  }
};

/**
 * Logs an Airo HQ event to CSP.
 * @param {EventProps} represent the event to track.
 * @returns {function} a function that logs the Airo HQ event.
 *
 * logAiroHQEvent({ category: 'click', task: 'builder_develop_prompt_submit', type: 'user_prompt' })();
 */
export const logAiroHQEvent = ({
  ai_agent_id = 'app-builder',
  agent_conversation_id,
  category,
  recommendation_task,
  recommendation_type,
  recommendation_id,
  ventureID
}: {
  ai_agent_id?: string,
  category: 'click' | 'impression',
  recommendation_id?: string,
  recommendation_task?: string,
  recommendation_type?: string,
  ventureID?: string,
  agent_conversation_id?: string
}): () => void => () => {
  try {
    const eventSchema = {
      impression: 'add_impression',
      click: 'add_event',
    }
    const eventData = {
      schema: eventSchema[category],
      targets: ['fullstory'],
      version: 'v2',
      data: {
        eid: `airohq.agent.page.component.${category}`,
        type: category,
        custom_properties: {
          ai_agent_id,
          agent_conversation_id,
          recommendation_id,
          recommendation_task,
          recommendation_type,
          ventureID
        }
      }
    }
    getExpDataLayer()?.push(eventData);
  } catch (_e) {
    logger.error('instrumentation.logAiroHQImpressionEvent.failure', {
      message: 'Failed to log Airo HQ impression event information',
      category,
      custom_properties: {
        ai_agent_id,
        agent_conversation_id,
        recommendation_task,
        recommendation_type,
        recommendation_id,
        ventureID
      }
    });
  }
};
