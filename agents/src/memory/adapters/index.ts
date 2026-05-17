import type { ConversationLifecycleStore, MessageStore, ConversationTokenStore } from '../interfaces/conversation-store.js';
import type { KvMemoryStore } from '../interfaces/kv-memory-store.js';
import type { SummaryStore } from '../interfaces/summary-store.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import { SqliteConversationLifecycleStore, SqliteConversationTokenStore, SqliteMessageStore } from './sqlite/sqlite-conversation-store.js';
import { SqliteKvMemoryStore } from './sqlite/sqlite-kv-memory-store.js';
import { SqliteSummaryStore } from './sqlite/sqlite-summary-store.js';
import { getAsmConversationLifecycleStore, getAsmMessageStore, getAsmConversationTokenStore } from './asm/index.js';

const useAsm = process.env.AIRO_STANDALONE === 'true' || process.env.USE_ASM_MEMORY === 'true';

/**
 * All three conversation adapters share a single ConversationRepository
 * so that messageAddedHooks state is unified across adapters.
 *
 * Singletons are initialized on first access via getter functions below.
 */
let conversationLifecycleStore: ConversationLifecycleStore | null = null;
let messageStore: MessageStore | null = null;
let conversationTokenStore: ConversationTokenStore | null = null;
let kvMemoryStore: KvMemoryStore | null = null;
let summaryStore: SummaryStore | null = null;
let sharedConversationRepo: ConversationRepository | null = null;

function getSharedConversationRepo(): ConversationRepository {
  if (!sharedConversationRepo) {
    sharedConversationRepo = new ConversationRepository();
  }
  return sharedConversationRepo;
}

export function getConversationLifecycleStore(): ConversationLifecycleStore {
  if (!conversationLifecycleStore) {
    conversationLifecycleStore = useAsm
      ? getAsmConversationLifecycleStore()
      : new SqliteConversationLifecycleStore(getSharedConversationRepo());
  }
  return conversationLifecycleStore;
}

export function getMessageStore(): MessageStore {
  if (!messageStore) {
    messageStore = useAsm
      ? getAsmMessageStore()
      : new SqliteMessageStore(getSharedConversationRepo());
  }
  return messageStore;
}

export function getConversationTokenStore(): ConversationTokenStore {
  if (!conversationTokenStore) {
    conversationTokenStore = useAsm
      ? getAsmConversationTokenStore()
      : new SqliteConversationTokenStore(getSharedConversationRepo());
  }
  return conversationTokenStore;
}

export function getKvMemoryStore(): KvMemoryStore {
  if (!kvMemoryStore) {
    kvMemoryStore = new SqliteKvMemoryStore();
  }
  return kvMemoryStore;
}

export function getSummaryStore(): SummaryStore {
  if (!summaryStore) {
    summaryStore = new SqliteSummaryStore();
  }
  return summaryStore;
}
