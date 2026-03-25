import { Client } from '@elastic/elasticsearch';

const PDNA_ES_URL = process.env.PDNA_ES_ENDPOINT || '';
const PDNA_ES_API_KEY = process.env.PDNA_ES_API_KEY || '';

export const PDNA_PROVISIONING_INDEX = 'airo-builder-provisioning-summary-prod-*';

export const pdnaClient = PDNA_ES_URL && PDNA_ES_API_KEY
    ? new Client({
        node: PDNA_ES_URL,
        auth: { apiKey: PDNA_ES_API_KEY },
    })
    : null;
