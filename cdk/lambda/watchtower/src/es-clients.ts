import { Client } from '@elastic/elasticsearch';
import type { EsReadCreds, EsWriteCreds } from './config.js';

export function makeReadClient(creds: EsReadCreds): Client {
  return new Client({ node: creds.node, auth: { apiKey: creds.apiKey } });
}

export function makeWriteClient(creds: EsWriteCreds): Client {
  return new Client({ node: creds.node, auth: { username: creds.username, password: creds.password } });
}
