import type { ConversationLifecycleStore, MessageStore, ConversationTokenStore } from '../interfaces/conversation-store.js';
import type { KvMemoryStore } from '../interfaces/kv-memory-store.js';
import type { SummaryStore } from '../interfaces/summary-store.js';
import { logger } from '../../logging/index.js';
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js';
import { SqliteConversationLifecycleStore, SqliteConversationTokenStore, SqliteMessageStore } from './sqlite/sqlite-conversation-store.js';
import { SqliteKvMemoryStore } from './sqlite/sqlite-kv-memory-store.js';
import { SqliteSummaryStore } from './sqlite/sqlite-summary-store.js';
import { getAsmConversationLifecycleStore, getAsmMessageStore, getAsmConversationTokenStore } from './asm/index.js';
import { AsmConversationLifecycleStore } from './asm/asm-conversation-store.js';
import { AsmMessageStore } from './asm/asm-message-store.js';
import {
  DualWriteConversationLifecycleStore,
  DualWriteMessageStore,
} from './asm/dual-write-stores.js';

const useAsm = process.env.AIRO_STANDALONE === 'true' || process.env.USE_ASM_MEMORY === 'true';

// Sticky flag — once construction fails, stay on SQLite-only for the rest of
// the process lifetime. Construction failures are typically env-config bugs
// (missing ASM_BASE_URL, etc.), not transient.
let dualWriteHealthy = true;

function tryGetAsm<T>(label: string, factory: () => T): T | null {
  if (!dualWriteHealthy) return null;
  try {
    return factory();
  } catch (err) {
    dualWriteHealthy = false;
    logger.warn('asm.dualwrite.disabled.construction_failed', {
      stage: label,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

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
    if (useAsm) {
      conversationLifecycleStore = getAsmConversationLifecycleStore();
    } else {
      const sqlite = new SqliteConversationLifecycleStore(getSharedConversationRepo());
      const asm = tryGetAsm(
        'conversation_lifecycle',
        () => getAsmConversationLifecycleStore() as AsmConversationLifecycleStore
      );
      // Wrap when ASM is constructible. The wrapper's inner gate decides per
      // call whether to actually mirror; non-flagged callers pass through.
      conversationLifecycleStore = asm
        ? new DualWriteConversationLifecycleStore(sqlite, asm)
        : sqlite;
    }
  }
  return conversationLifecycleStore;
}

export function getMessageStore(): MessageStore {
  if (!messageStore) {
    if (useAsm) {
      messageStore = getAsmMessageStore();
    } else {
      const sqlite = new SqliteMessageStore(getSharedConversationRepo());
      const asm = tryGetAsm('message_store', () => getAsmMessageStore() as AsmMessageStore);
      messageStore = asm ? new DualWriteMessageStore(sqlite, asm) : sqlite;
    }
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
