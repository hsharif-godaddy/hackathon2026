/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { logger } from '@/lib/request-context';

declare global {
  interface Window {
    _expDataLayer: any[];
  }
}

const getExpDataLayer = () => typeof window !== 'undefined' ? window._expDataLayer : [];

/**
 * The base event ID for all appbuilder events.
 * @type {string}
 * 
 * See : https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/92314181/Event+Naming+and+Formats
 * Valid format : area.product.page.section.widget.action
 */
const EID_BASE = 'appbuilder.app';

interface PageEventData {
  schema: string;
  version: string;
  data: {
    virtual_path: string;
  };
}

/**
 * Logs a page event to Traffic.
 * @param {string} page represent the page to track.
 * @returns {function} a function that logs the event.
 */
export const logPageEvent = (page: string): () => void => () => {
  try {
    const pageEventData: PageEventData = {
      schema: 'add_page_request',
      version: 'v1',
      data: {
        virtual_path: '/' + page,
      },
    };
    getExpDataLayer()?.push(pageEventData);
  } catch (_e) {
    logger.error('instrumentation.page.failure', { message: 'Failed to log page information', page });
  }
};

interface LogInteractionEventProps {
  eid: string;
  type?: 'click' | 'hover' | 'touch' | 'custom';
  data?: any;
}

interface EventData {
  schema: string;
  version: string;
  data: {
    eid: string;
    type: string;
    custom_properties: any;
  };
}

/**
 * Logs an interaction event to Traffic.
 * @param {LogInteractionEventProps} param0 represent the data eid to track.
 * @returns {function} a function that logs the event.
 * 
 * logInteractionEvent({ eid: 'something.copy' })(); -> logs 'app-builder.something.copy.click'
 */
export const logInteractionEvent = ({ eid, type = 'click', data = null }: LogInteractionEventProps): () => void => () => {
  try {
    const eventData: EventData = {
      schema: 'add_event',
      version: 'v2',
      data: {
        eid: EID_BASE + '.' + eid + '.' + type,
        type,
        custom_properties: data,
      },
    };
    getExpDataLayer()?.push(eventData);
  } catch (_e) {
    logger.error('instrumentation.interaction.failure', { message: 'Failed to log click event information', eid, fullEid: EID_BASE + '.' + eid + '.' + type });
  }
};

/**
 * Generates a click event ID.
 * @param {string} eid represent the event ID.
 * @returns {string} the click event ID.
 * 
 * generateClickEID('something') -> 'appbuilder.something.click'
 */
export const generateClickEID = (eid: string) => {
  return EID_BASE + '.' + eid + '.click';
};

/**
 * Generates multiple click event IDs.
 * @param {string[]} eids represent the event IDs.
 * @returns {void}
 * 
 * generateMultipleClickEID(['something', 'something_else']) -> logs 'appbuilder.something.click' and 'appbuilder.something_else.click'
 */
export const logMultipleClickEvents = (eids: string[]) => {
  eids.forEach(eid => {
    logInteractionEvent({ eid: eid, type: 'click' })();
  });
}

interface LogImpressionEventProps {
  eid: string;
  data?: any;
}

interface ImpressionData {
  schema: string;
  version: string;
  data: {
    eid: string;
    custom_properties: any;
  };
}

/**
 * Logs an impression event to Traffic.
 * @param {LogImpressionEventProps} param0 represent the data eid to track.
 * @returns {function} a function that logs the event.
 * 
 * logImpressionEvent({ eid: 'something' })(); -> logs 'app-builder.something.impression'
 */
export const logImpressionEvent = ({ eid, data = null }: LogImpressionEventProps): () => void => () => {
  try {
    const impressionData: ImpressionData = {
      schema: 'add_impression',
      version: 'v1',
      data: {
        eid: `${EID_BASE}.${eid}.impression`,
        custom_properties: data,
      },
    };
    getExpDataLayer()?.push(impressionData);
  } catch (_e) {
    logger.error('instrumentation.impression.failure', { message: 'Failed to log impression event information', eid, fullEid: EID_BASE + '.' + eid + '.impression' });
  }
};
