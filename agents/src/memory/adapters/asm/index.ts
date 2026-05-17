import { getS2SToken, isS2SAuthEnabled } from '@airo/ai-lib';
import type { ConversationLifecycleStore, MessageStore, ConversationTokenStore } from '../../interfaces/conversation-store.js';
import { AsmClient } from './asm-client.js';
import { AsmConversationLifecycleStore } from './asm-conversation-store.js';
import { AsmMessageStore } from './asm-message-store.js';
import { AsmConversationTokenStore } from './asm-token-store.js';

let client: AsmClient | undefined;
let lifecycleStore: ConversationLifecycleStore | undefined;
let messageStore: MessageStore | undefined;
let tokenStore: ConversationTokenStore | undefined;

function getClient(): AsmClient {
  if (!client) {
    const baseUrl = process.env.ASM_BASE_URL;
    if (!baseUrl) {
      throw new Error('ASM_BASE_URL environment variable is required when USE_ASM_MEMORY=true');
    }
    client = new AsmClient({
      baseUrl,
      getAuthToken: async () => {
        if (isS2SAuthEnabled()) {
          return getS2SToken();
        }
        const token = process.env.SSO_JWT;
        if (!token) {
          throw new Error(
            'No ASM authentication configured. Set GOCODE_USE_S2S_AUTH=true or provide SSO_JWT.'
          );
        }
        return token;
      },
    });
  }
  return client;
}

function getServiceId(): string {
  return process.env.ASM_SERVICE_ID ?? 'airo-agents';
}

export function getAsmConversationLifecycleStore(): ConversationLifecycleStore {
  if (!lifecycleStore) {
    lifecycleStore = new AsmConversationLifecycleStore(getClient(), getServiceId());
  }
  return lifecycleStore;
}

export function getAsmMessageStore(): MessageStore {
  if (!messageStore) {
    const store = new AsmMessageStore(getClient());
    const ts = getAsmConversationTokenStore() as AsmConversationTokenStore;
    store.registerMessageAddedHook((msg) => {
      ts.recordMessageTimestamp(msg.createdAt);
    });
    messageStore = store;
  }
  return messageStore;
}

export function getAsmConversationTokenStore(): ConversationTokenStore {
  if (!tokenStore) {
    tokenStore = new AsmConversationTokenStore(getClient());
  }
  return tokenStore;
}
