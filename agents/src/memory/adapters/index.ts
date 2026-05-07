import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import { SqliteConversationLifecycleStore, SqliteConversationTokenStore, SqliteMessageStore } from './sqlite-conversation-store.js';
import { SqliteKvMemoryStore } from './sqlite-kv-memory-store.js';
import { SqliteSummaryStore } from './sqlite-summary-store.js';

/**
 * All three conversation adapters share a single ConversationRepository
 * so that messageAddedHooks state is unified across adapters.
 *
 * Singletons are initialized on first access via getter functions below.
 */
let conversationLifecycleStore: SqliteConversationLifecycleStore | null = null;
let messageStore: SqliteMessageStore | null = null;
let conversationTokenStore: SqliteConversationTokenStore | null = null;
let kvMemoryStore: SqliteKvMemoryStore | null = null;
let summaryStore: SqliteSummaryStore | null = null;
let sharedConversationRepo: ConversationRepository | null = null;

function getSharedConversationRepo(): ConversationRepository {
  if (!sharedConversationRepo) {
    sharedConversationRepo = new ConversationRepository();
  }
  return sharedConversationRepo;
}

export function getConversationLifecycleStore(): SqliteConversationLifecycleStore {
  if (!conversationLifecycleStore) {
    conversationLifecycleStore = new SqliteConversationLifecycleStore(getSharedConversationRepo());
  }
  return conversationLifecycleStore;
}

export function getMessageStore(): SqliteMessageStore {
  if (!messageStore) {
    messageStore = new SqliteMessageStore(getSharedConversationRepo());
  }
  return messageStore;
}

export function getConversationTokenStore(): SqliteConversationTokenStore {
  if (!conversationTokenStore) {
    conversationTokenStore = new SqliteConversationTokenStore(getSharedConversationRepo());
  }
  return conversationTokenStore;
}

export function getKvMemoryStore(): SqliteKvMemoryStore {
  if (!kvMemoryStore) {
    kvMemoryStore = new SqliteKvMemoryStore();
  }
  return kvMemoryStore;
}

export function getSummaryStore(): SqliteSummaryStore {
  if (!summaryStore) {
    summaryStore = new SqliteSummaryStore();
  }
  return summaryStore;
}
